import { unstable_noStore as noStore } from "next/cache";
import { EVENT_DISPLAY_WINDOW_DAYS } from "@/lib/event-window";
import { filterCultureEvents, getHoustonTodayDate, addDaysToHoustonDate } from "@/lib/culture-date-filter";
import { scoreEvent, type EventSeed } from "@/lib/event-scoring";
import { HOUSTON_CULTURE_REGISTRY } from "@/lib/culture-registry";
import type {
  CultureCoverageSummary,
  CultureProviderResult,
  CultureSourceDebug,
  CultureSourceStatus,
  EventItem,
} from "@/types/dashboard";

const PRH_SOURCE_NAME = "Project Row Houses";
const PRH_SOURCE_URL = "https://projectrowhouses.org/";
const PRH_USER_AGENT = "DailyOverviewBot/1.0 (+https://localhost)";

interface PRHParsedListing {
  title: string;
  dateTime: string;
  timeLabel: string;
  venue: string;
  city: string;
  category: string;
  sourceLabel: string;
  sourceUrl: string;
  sourceLinks: EventItem["sourceLinks"];
  detailNote?: string;
  isRange?: boolean;
  startDate?: string;
  endDate?: string;
}

interface PageFetchResult {
  html: string;
  responseStatus: number;
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#8217;/g, "'")
    .replace(/&#8216;/g, "'")
    .replace(/&#8211;/g, "-")
    .replace(/&#8212;/g, "-")
    .replace(/&#038;/g, "&")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&ndash;/g, "-")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'");
}

function normalizeWhitespace(value: string): string {
  return decodeHtmlEntities(value.replace(/\u00a0/g, " ")).replace(/\s+/g, " ").trim();
}

function stripTags(value: string): string {
  return normalizeWhitespace(value.replace(/<[^>]+>/g, " "));
}

function extractVisibleLines(html: string): string[] {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|li|ul|ol|h1|h2|h3|h4|h5|h6|section|article|header|footer|nav|main|aside|figure|figcaption|blockquote|tr|td|th)>/gi, "\n")
    .replace(/<[^>]+>/g, " ");

  return text
    .replace(/\r/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((line) => stripTags(line))
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean);
}

function fetchHtml(url: string): Promise<PageFetchResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  return fetch(url, {
    headers: {
      "user-agent": PRH_USER_AGENT,
      accept: "text/html,application/xhtml+xml",
    },
    signal: controller.signal,
    cache: "no-store",
  })
    .then(async (response) => ({
      html: await response.text(),
      responseStatus: response.status,
    }))
    .finally(() => {
      clearTimeout(timeout);
    });
}

function parseDateLabel(text: string): string | null {
  const normalized = normalizeWhitespace(text).replace(/[–—]/g, "-");
  const match = normalized.match(
    /^(?:Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)?\s*,?\s*([A-Za-z]+)\s+(\d{1,2})(?:,\s*(\d{4}))?$/,
  );

  if (!match) {
    return null;
  }

  const monthMap: Record<string, number> = {
    january: 1,
    february: 2,
    march: 3,
    april: 4,
    may: 5,
    june: 6,
    july: 7,
    august: 8,
    september: 9,
    october: 10,
    november: 11,
    december: 12,
  };

  const month = monthMap[match[1].toLowerCase()];
  const day = Number(match[2]);
  const year = match[3]
    ? Number(match[3])
    : inferYear(month ?? 1, day);

  if (!month || Number.isNaN(day) || !Number.isFinite(year)) {
    return null;
  }

  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function inferYear(month: number, day: number): number {
  const today = new Date();
  const [currentYear, currentMonth, currentDay] = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(today)
    .split("-")
    .map(Number);

  if (month < currentMonth || (month === currentMonth && day < currentDay)) {
    return currentYear + 1;
  }

  return currentYear;
}

function parseDateRangeLabel(text: string): { startDate: string; endDate: string } | null {
  const normalized = normalizeWhitespace(text).replace(/[–—]/g, "-");
  const parts = normalized.split(/\s+-\s+/);

  if (parts.length !== 2) {
    return null;
  }

  const start = parseDateLabel(parts[0]);
  const end = parseDateLabel(parts[1]);

  if (!start || !end) {
    return null;
  }

  return { startDate: start, endDate: end };
}

function parseTimeLabel(text: string): string | null {
  const normalized = normalizeWhitespace(text).replace(/[–—]/g, "-");

  if (!normalized) {
    return null;
  }

  const rangeMatch = normalized.match(
    /^(\d{1,2}(?::\d{2})?\s*[ap]m)\s*-\s*(\d{1,2}(?::\d{2})?\s*[ap]m)$/i,
  );

  if (rangeMatch) {
    return `${normalizeClockTime(rangeMatch[1])} - ${normalizeClockTime(rangeMatch[2])}`;
  }

  const singleMatch = normalized.match(/^(\d{1,2}(?::\d{2})?\s*[ap]m)$/i);

  if (singleMatch) {
    return normalizeClockTime(singleMatch[1]);
  }

  return null;
}

function normalizeClockTime(value: string): string {
  const match = value.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*([ap]m)$/i);

  if (!match) {
    return value.trim();
  }

  const hours = Number(match[1]);
  const minutes = match[2] ?? "00";
  const meridiem = match[3].toUpperCase();

  return `${hours}:${minutes} ${meridiem}`;
}

function buildDateTime(date: string, timeLabel?: string | null): string {
  if (!timeLabel) {
    return `${date}T12:00:00-05:00`;
  }

  const match = timeLabel.match(/^(\d{1,2})(?::(\d{2}))?\s*([AP]M)/i);

  if (!match) {
    return `${date}T12:00:00-05:00`;
  }

  let hours = Number(match[1]);
  const minutes = match[2] ?? "00";
  const meridiem = match[3].toUpperCase();

  if (meridiem === "PM" && hours !== 12) {
    hours += 12;
  }

  if (meridiem === "AM" && hours === 12) {
    hours = 0;
  }

  return `${date}T${String(hours).padStart(2, "0")}:${minutes}:00-05:00`;
}

function extractAnchorMap(html: string, baseUrl: string): Map<string, string> {
  const anchors = new Map<string, string>();
  const pattern = /<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;

  for (const match of html.matchAll(pattern)) {
    const href = match[1];
    const text = normalizeWhitespace(match[2].replace(/<[^>]+>/g, " "));

    if (!text) {
      continue;
    }

    try {
      const resolved = new URL(href, baseUrl);
      const normalizedHref = resolved.toString();
      if (!anchors.has(text)) {
        anchors.set(text, normalizedHref);
      }
    } catch {
      continue;
    }
  }

  return anchors;
}

function inferGenreTags(title: string, detail?: string): string[] {
  const normalized = `${title} ${detail ?? ""}`.toLowerCase();
  const tags = new Set<string>(["arts", "culture"]);

  if (normalized.includes("public art") || normalized.includes("community") || normalized.includes("market")) {
    tags.add("community arts");
  }

  if (normalized.includes("performance") || normalized.includes("ballroom") || normalized.includes("music")) {
    tags.add("performance");
  }

  if (normalized.includes("reading") || normalized.includes("poet") || normalized.includes("summer studios")) {
    tags.add("readings");
  }

  if (normalized.includes("exhibition") || normalized.includes("on view") || normalized.includes("opening")) {
    tags.add("exhibition");
  }

  if (tags.size === 2) {
    tags.add("public program");
  }

  return [...tags];
}

function inferCategory(title: string, detail?: string): string {
  const normalized = `${title} ${detail ?? ""}`.toLowerCase();

  if (normalized.includes("performance") || normalized.includes("ballroom") || normalized.includes("music")) {
    return "Arts & Culture / Performance";
  }

  if (normalized.includes("reading") || normalized.includes("poet")) {
    return "Arts & Culture / Readings";
  }

  if (normalized.includes("exhibition") || normalized.includes("on view")) {
    return "Arts & Culture / Exhibition";
  }

  if (normalized.includes("market") || normalized.includes("community")) {
    return "Arts & Culture / Community";
  }

  return "Arts & Culture";
}

function inferVenueFit(title: string, detail?: string): number {
  const normalized = `${title} ${detail ?? ""}`.toLowerCase();

  if (normalized.includes("ballroom") || normalized.includes("performance")) {
    return 12;
  }

  if (normalized.includes("reading") || normalized.includes("poet") || normalized.includes("workshop")) {
    return 11;
  }

  return 10;
}

function inferRarity(title: string, detail?: string): number {
  const normalized = `${title} ${detail ?? ""}`.toLowerCase();

  if (normalized.includes("eldorado ballroom") || normalized.includes("floyd newsum summer studios")) {
    return 8;
  }

  if (normalized.includes("community market") || normalized.includes("workshop")) {
    return 7;
  }

  return 6;
}

function mapListingToEvent(listing: PRHParsedListing): EventItem {
  const seed: EventSeed = {
    id: `project-row-houses-${listing.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${listing.dateTime.slice(0, 10)}`,
    title: listing.title,
    dateTime: listing.dateTime,
    venue: PRH_SOURCE_NAME,
    city: listing.city,
    category: listing.category,
    genreTags: inferGenreTags(listing.title, listing.detailNote),
    sourceLinks: listing.sourceLinks,
    isGreatLiveAct: false,
    liveReputationStatus: "unknown",
    liveReputationConfidence: 0,
    liveReputationReasons: [],
    liveReputationSources: [],
    venueFitScore: inferVenueFit(listing.title, listing.detailNote),
    knownLiveReputationScore: 0,
    rarityScore: inferRarity(listing.title, listing.detailNote),
    distanceRelevanceScore: 9,
    feedbackHistoryPlaceholderScore: 5,
  };

  const scored = scoreEvent(seed);

  return {
    ...scored,
    sourceLabel: listing.sourceLabel,
    timeLabel: listing.timeLabel,
    startDate: listing.isRange ? listing.startDate : undefined,
    endDate: listing.isRange ? listing.endDate : undefined,
    isOngoing: listing.isRange,
    tasteReasons: listing.detailNote ? [...scored.tasteReasons, listing.detailNote] : scored.tasteReasons,
  };
}

function extractPublicProgramListings(html: string, pageUrl: string): {
  listings: PRHParsedListing[];
  homepageReached: boolean;
  usefulDatedEventTextFound: boolean;
  officialEventbriteLinkFound: boolean;
  thirdPartyCalendarLinksSkipped: number;
  cleanedLineCount: number;
  rawEventProgramCandidateCount: number;
  approximateOrAmbiguousSkipped: number;
  hiddenPastEventsCount: number;
  displayedInWindowEventsCount: number;
  todayEventCount: number;
  todayChecked: boolean;
  warnings: string[];
} {
  const lines = extractVisibleLines(html);
  const anchors = extractAnchorMap(html, pageUrl);
  const officialEventbriteLinkFound = /eventbrite/i.test(html);
  const homepageReached = /Attend An Event|Opening Soon|Floyd Newsum Summer Studios|Southern Survey Biennial III/i.test(html);
  const cleanedLines = lines.filter((line) =>
    ![
      "visit",
      "on view",
      "tours",
      "programs",
      "news",
      "give",
      "shop",
    ].includes(line.toLowerCase()),
  );

  const listings: PRHParsedListing[] = [];
  const warnings: string[] = [];
  let rawEventProgramCandidateCount = 0;
  let approximateOrAmbiguousSkipped = 0;
  let thirdPartyCalendarLinksSkipped = 0;

  const addListing = (listing: PRHParsedListing): void => {
    listings.push(listing);
  };

  for (let index = 0; index < cleanedLines.length; index += 1) {
    const line = cleanedLines[index];
    const dateRange = parseDateRangeLabel(line);
    const date = parseDateLabel(line);
    const time = parseTimeLabel(line);

    if (line.includes("Event Calendar") && /eventbrite/i.test(line)) {
      thirdPartyCalendarLinksSkipped += 1;
      continue;
    }

    if (dateRange) {
      rawEventProgramCandidateCount += 1;
      const title = cleanedLines[index - 1] && !parseDateLabel(cleanedLines[index - 1]) ? cleanedLines[index - 1] : "Project Row Houses program";
      addListing({
        title,
        dateTime: `${dateRange.startDate}T12:00:00-05:00`,
        timeLabel: `On view ${formatMonthDay(dateRange.startDate)}–${formatMonthDay(dateRange.endDate)}`,
        venue: PRH_SOURCE_NAME,
        city: "Houston",
        category: inferCategory(title, line),
        sourceLabel: PRH_SOURCE_NAME,
        sourceUrl: pageUrl,
        sourceLinks: [
          { label: PRH_SOURCE_NAME, url: PRH_SOURCE_URL },
          { label: "Source page", url: pageUrl },
        ],
        detailNote: line,
        isRange: true,
        startDate: dateRange.startDate,
        endDate: dateRange.endDate,
      });
      continue;
    }

    if (date) {
      const nextLine = cleanedLines[index + 1];
      const nextNextLine = cleanedLines[index + 2];
      const title = nextLine && !parseTimeLabel(nextLine) && !parseDateLabel(nextLine) ? nextLine : undefined;
      const detail = title ? nextNextLine && !parseTimeLabel(nextNextLine) && !parseDateLabel(nextNextLine) ? nextNextLine : undefined : undefined;

      if (!title) {
        approximateOrAmbiguousSkipped += 1;
        continue;
      }

      rawEventProgramCandidateCount += 1;
      const eventUrl = anchors.get(title) ?? pageUrl;
      const timeLabel = time ?? "Date listed on source; exact time not listed.";
      addListing({
        title,
        dateTime: buildDateTime(date, time),
        timeLabel,
        venue: PRH_SOURCE_NAME,
        city: "Houston",
        category: inferCategory(title, detail),
        sourceLabel: PRH_SOURCE_NAME,
        sourceUrl: eventUrl,
        sourceLinks: [
          { label: PRH_SOURCE_NAME, url: PRH_SOURCE_URL },
          { label: "Source page", url: pageUrl },
          { label: "Event page", url: eventUrl },
        ],
        detailNote: detail,
      });
    }
  }

  return {
    listings,
    homepageReached,
    usefulDatedEventTextFound: listings.length > 0,
    officialEventbriteLinkFound,
    thirdPartyCalendarLinksSkipped,
    cleanedLineCount: cleanedLines.length,
    rawEventProgramCandidateCount,
    approximateOrAmbiguousSkipped,
    hiddenPastEventsCount: 0,
    displayedInWindowEventsCount: 0,
    todayEventCount: 0,
    todayChecked: true,
    warnings,
  };
}

function formatMonthDay(date: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    month: "short",
    day: "numeric",
  }).format(new Date(`${date}T12:00:00-05:00`));
}

function dedupeListings(listings: PRHParsedListing[]): {
  listings: PRHParsedListing[];
  duplicateRowsRemoved: number;
} {
  const byKey = new Map<string, PRHParsedListing>();

  for (const listing of listings) {
    const key = [
      listing.title.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      listing.startDate ?? listing.dateTime.slice(0, 10),
      listing.endDate ?? "",
      listing.sourceLabel,
    ].join("|");
    byKey.set(key, listing);
  }

  return {
    listings: [...byKey.values()],
    duplicateRowsRemoved: listings.length - byKey.size,
  };
}

function buildSummary(params: {
  parsedReliableEvents: number;
  displayedInWindowEventsCount: number;
  todayEventCount: number;
  officialEventbriteLinkFound: boolean;
  usedHomepageFallback: boolean;
}): string {
  if (params.parsedReliableEvents === 0) {
    return "Project Row Houses homepage loaded, but no reliable first-party event rows were found.";
  }

  const sourceText = params.usedHomepageFallback ? "homepage fallback" : "official homepage";
  const todayText = params.todayEventCount > 0 ? `${params.todayEventCount} today` : "no events today";
  const windowText = params.displayedInWindowEventsCount > 0
    ? `${params.displayedInWindowEventsCount} in window`
    : "no events in window";
  const eventbriteText = params.officialEventbriteLinkFound ? "Eventbrite calendar link discovered." : "No Eventbrite calendar link discovered.";

  return `Project Row Houses loaded from ${sourceText}: ${params.parsedReliableEvents} events/programs parsed, ${windowText}, ${todayText}. ${eventbriteText}`;
}

function buildStatus(
  sourceName: string,
  sourceUrl: string,
  status: CultureSourceStatus["status"],
  message: string,
  debug: CultureSourceDebug,
): CultureSourceStatus {
  return {
    sourceName,
    sourceUrl,
    status,
    message,
    debug,
  };
}

export async function fetchProjectRowHousesSource(): Promise<CultureProviderResult> {
  noStore();

  const urlsChecked = [PRH_SOURCE_URL];
  const warnings: string[] = [];

  try {
    const response = await fetchHtml(PRH_SOURCE_URL);
    const parsed = extractPublicProgramListings(response.html, PRH_SOURCE_URL);
    const deduped = dedupeListings(parsed.listings);
    const mappedEvents = deduped.listings.map(mapListingToEvent);
    const filtered = filterCultureEvents(mappedEvents);
    const today = getHoustonTodayDate();
    const todayEventsCount = filtered.events.filter((event) => event.dateTime.slice(0, 10) === today).length;
    const source: CultureProviderResult["source"] = "mixed";
    const note = buildSummary({
      parsedReliableEvents: filtered.events.length,
      displayedInWindowEventsCount: filtered.inWindowEventsDisplayedCount,
      todayEventCount: todayEventsCount,
      officialEventbriteLinkFound: parsed.officialEventbriteLinkFound,
      usedHomepageFallback: parsed.listings.length === 0,
    });
    const coverageSummary: CultureCoverageSummary = {
      source,
      trackedSourcesCount: HOUSTON_CULTURE_REGISTRY.length,
      activeLiveProvidersCount: HOUSTON_CULTURE_REGISTRY.filter((entry) =>
        entry.providerStatus === "working" || entry.providerStatus === "limited" || entry.providerStatus === "audited_limited",
      ).length,
      notImplementedSourcesCount: HOUSTON_CULTURE_REGISTRY.filter((entry) => entry.providerStatus === "not_implemented").length,
      parsedEventsCount: filtered.events.length,
      todayChecked: true,
      todayEventsCount,
      earliestParsedEventDate: filtered.events[0]?.dateTime.slice(0, 10),
      latestParsedEventDate: filtered.events.at(-1)?.dateTime.slice(0, 10),
      dateWindowStart: today,
      dateWindowEnd: addDaysToHoustonDate(today, EVENT_DISPLAY_WINDOW_DAYS),
      eventCalendarHeadingFound: parsed.homepageReached,
      cleanedLineCount: parsed.cleanedLineCount,
      dateHeadingMatches: 0,
      titleMatches: parsed.rawEventProgramCandidateCount,
      dateTimeMatches: parsed.listings.filter((listing) => listing.timeLabel && !/^Date listed on source; exact time not listed\.$/i.test(listing.timeLabel)).length,
      hiddenPastEventsCount: filtered.hiddenPastEventsCount,
      ongoingEventsDisplayedCount: filtered.ongoingEventsDisplayedCount,
      inWindowEventsDisplayedCount: filtered.inWindowEventsDisplayedCount,
      note,
    };
    const debug: CultureSourceDebug = {
      urlsChecked,
      responseStatus: response.responseStatus,
      homepageReached: response.responseStatus >= 200 && response.responseStatus < 400,
      eventsPageReached: false,
      calendarPageReached: false,
      eventsArchiveHeadingFound: false,
      upcomingEventsHeadingFound: parsed.homepageReached,
      allUpcomingEventsHeadingFound: false,
      dateWindowStart: today,
      dateWindowEnd: addDaysToHoustonDate(today, EVENT_DISPLAY_WINDOW_DAYS),
      eventCalendarHeadingFound: parsed.homepageReached,
      cleanedLineCount: parsed.cleanedLineCount,
      dateHeadingMatches: 0,
      titleMatches: parsed.rawEventProgramCandidateCount,
      dateTimeMatches: parsed.listings.filter((listing) => listing.timeLabel && !/^Date listed on source; exact time not listed\.$/i.test(listing.timeLabel)).length,
      rawEventCandidates: parsed.rawEventProgramCandidateCount,
      parsedValidEvents: filtered.events.length,
      duplicateEventsRemoved: deduped.duplicateRowsRemoved,
      todayChecked: true,
      todayEventsCount,
      earliestParsedEventDate: filtered.events[0]?.dateTime.slice(0, 10),
      latestParsedEventDate: filtered.events.at(-1)?.dateTime.slice(0, 10),
      warnings: warnings.concat(parsed.warnings),
    };
    const status = buildStatus(
      PRH_SOURCE_NAME,
      PRH_SOURCE_URL,
      "audited_limited",
      note,
      debug,
    );

    return {
      source,
      note,
      events: filtered.events,
      coverageSummary,
      statuses: [status],
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Project Row Houses source failed before today-specific coverage could be verified.";
    warnings.push(message);
    const debug: CultureSourceDebug = {
      urlsChecked,
      responseStatus: undefined,
      homepageReached: false,
      eventsPageReached: false,
      calendarPageReached: false,
      eventsArchiveHeadingFound: false,
      upcomingEventsHeadingFound: false,
      allUpcomingEventsHeadingFound: false,
      dateWindowStart: getHoustonTodayDate(),
      dateWindowEnd: addDaysToHoustonDate(getHoustonTodayDate(), 14),
      eventCalendarHeadingFound: false,
      cleanedLineCount: 0,
      dateHeadingMatches: 0,
      titleMatches: 0,
      dateTimeMatches: 0,
      rawEventCandidates: 0,
      parsedValidEvents: 0,
      todayChecked: true,
      todayEventsCount: 0,
      warnings,
    };
    const note = "Project Row Houses homepage loaded, but no reliable first-party event rows were found.";

    return {
      source: "mock",
      note,
      events: [],
      coverageSummary: {
        source: "mock",
        trackedSourcesCount: HOUSTON_CULTURE_REGISTRY.length,
        activeLiveProvidersCount: HOUSTON_CULTURE_REGISTRY.filter((entry) =>
          entry.providerStatus === "working" || entry.providerStatus === "limited" || entry.providerStatus === "audited_limited",
        ).length,
        notImplementedSourcesCount: HOUSTON_CULTURE_REGISTRY.filter((entry) => entry.providerStatus === "not_implemented").length,
        parsedEventsCount: 0,
        todayChecked: true,
        todayEventsCount: 0,
        dateWindowStart: debug.dateWindowStart,
        dateWindowEnd: debug.dateWindowEnd,
        note,
      },
      statuses: [
        buildStatus(PRH_SOURCE_NAME, PRH_SOURCE_URL, "audited_limited", note, debug),
      ],
    };
  }
}
