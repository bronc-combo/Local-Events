import { unstable_noStore as noStore } from "next/cache";
import { EVENT_DISPLAY_WINDOW_DAYS } from "@/lib/event-window";
import {
  filterCultureEvents,
  getHoustonTodayDate as getHoustonTodayDateBase,
  addDaysToHoustonDate,
} from "@/lib/culture-date-filter";
import { scoreEvent, type EventSeed } from "@/lib/event-scoring";
import { HOUSTON_CULTURE_REGISTRY } from "@/lib/culture-registry";
import type {
  CultureCoverageSummary,
  CultureProviderResult,
  CultureSourceDebug,
  CultureSourceStatus,
  EventItem,
} from "@/types/dashboard";

export const LAWNDALE_SOURCE_NAME = "Lawndale Art Center";
export const LAWNDALE_SOURCE_LABEL = "Lawndale";
export const LAWNDALE_HOME_URL = "https://lawndaleartcenter.org/";
export const LAWNDALE_EVENTS_URL = "https://lawndaleartcenter.org/events/";
const LAWNDALE_USER_AGENT = "DailyOverviewBot/1.0 (+https://localhost)";

interface LawndaleParsedEvent {
  title: string;
  date: string;
  timeLabel: string;
  dateTime: string;
  venue: string;
  city: string;
  category: string;
  sourceLabel: string;
  sourceUrl: string;
  sourceLinks: EventItem["sourceLinks"];
  detailNote?: string;
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
      "user-agent": LAWNDALE_USER_AGENT,
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

function getMonthNumber(monthName: string): number | null {
  const months: Record<string, number> = {
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

  return months[monthName.toLowerCase()] ?? null;
}

function parseDateLine(text: string): string | null {
  const match = normalizeWhitespace(text).match(
    /^(?:Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday),\s+([A-Za-z]+)\s+(\d{1,2})(?:,\s*(\d{4}))?$/,
  );

  if (!match) {
    return null;
  }

  const month = getMonthNumber(match[1]);
  const day = Number(match[2]);
  const year = match[3] ? Number(match[3]) : inferYear(month ?? 1, day);

  if (!month || Number.isNaN(day) || !Number.isFinite(year)) {
    return null;
  }

  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function normalizeTimeLabel(value: string): string | null {
  const normalized = normalizeWhitespace(value).replace(/[–—]/g, "-");

  if (!normalized) {
    return null;
  }

  if (/^time not listed on source\.?$/i.test(normalized)) {
    return "Time not listed on source.";
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
  if (!timeLabel || /^time not listed on source\.?$/i.test(timeLabel)) {
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

function isSkipLine(line: string): boolean {
  return [
    "all upcoming events",
    "upcoming events",
    "gallery hours",
    "contact",
    "social",
    "follow us",
    "physical address",
    "mailing address",
    "lawndale art center",
    "no events",
  ].includes(line.toLowerCase());
}

function isMonthHeading(line: string): boolean {
  return /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)(?:ember|uary|ch|il|e|y|ust|tember|ober|ember)?\s+\d{4}$/i.test(
    line,
  );
}

function isCalendarNumber(line: string): boolean {
  return /^(?:[1-9]|[12]\d|3[01])$/.test(line);
}

function isPotentialDate(line: string): boolean {
  return parseDateLine(line) !== null;
}

function isPotentialTime(line: string): boolean {
  return normalizeTimeLabel(line) !== null;
}

function isPotentialTitle(line: string): boolean {
  if (line.length < 6) {
    return false;
  }

  if (isSkipLine(line) || isMonthHeading(line) || isCalendarNumber(line) || isPotentialDate(line) || isPotentialTime(line)) {
    return false;
  }

  if (/^with\s+/i.test(line)) {
    return false;
  }

  if (/^\*+$/.test(line)) {
    return false;
  }

  return /[A-Za-z]{4}/.test(line);
}

interface LawndaleAnchorEntry {
  text: string;
  href: string;
}

function extractEventAnchors(html: string, baseUrl: string): LawndaleAnchorEntry[] {
  const anchors: LawndaleAnchorEntry[] = [];
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

      if (!/\/events?\//i.test(normalizedHref) && !/event-details/i.test(normalizedHref)) {
        continue;
      }

      anchors.push({ text, href: normalizedHref });
    } catch {
      continue;
    }
  }

  return anchors;
}

function inferGenreTags(title: string, detailNote?: string): string[] {
  const normalized = `${title} ${detailNote ?? ""}`.toLowerCase();
  const tags = new Set<string>(["arts", "culture"]);

  if (normalized.includes("performance") || normalized.includes("music")) {
    tags.add("performance");
  }

  if (normalized.includes("read") || normalized.includes("poet") || normalized.includes("writing")) {
    tags.add("readings");
    tags.add("literary");
  }

  if (normalized.includes("workshop")) {
    tags.add("workshop");
  }

  if (normalized.includes("talk") || normalized.includes("conversation")) {
    tags.add("talk");
  }

  if (normalized.includes("experimental") || normalized.includes("sound")) {
    tags.add("experimental");
  }

  if (tags.size === 2) {
    tags.add("public program");
  }

  return [...tags];
}

function inferCategory(title: string, detailNote?: string): string {
  const normalized = `${title} ${detailNote ?? ""}`.toLowerCase();

  if (normalized.includes("performance") || normalized.includes("music")) {
    return "Arts & Culture / Performance";
  }

  if (normalized.includes("read") || normalized.includes("poet")) {
    return "Arts & Culture / Readings";
  }

  if (normalized.includes("workshop")) {
    return "Arts & Culture / Workshop";
  }

  if (normalized.includes("conversation") || normalized.includes("talk")) {
    return "Arts & Culture / Talk";
  }

  return "Arts & Culture";
}

function inferVenueFit(title: string, detailNote?: string): number {
  const normalized = `${title} ${detailNote ?? ""}`.toLowerCase();

  if (normalized.includes("reading") || normalized.includes("talk") || normalized.includes("workshop")) {
    return 11;
  }

  if (normalized.includes("performance") || normalized.includes("music") || normalized.includes("experimental")) {
    return 12;
  }

  return 10;
}

function inferRarity(title: string, detailNote?: string): number {
  const normalized = `${title} ${detailNote ?? ""}`.toLowerCase();

  if (normalized.includes("experimental") || normalized.includes("poet")) {
    return 8;
  }

  if (normalized.includes("workshop") || normalized.includes("talk") || normalized.includes("reading")) {
    return 7;
  }

  return 6;
}

function mapListingToEvent(listing: LawndaleParsedEvent): EventItem {
  const seed: EventSeed = {
    id: `lawndale-${listing.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${listing.date}`,
    title: listing.title,
    dateTime: listing.dateTime,
    venue: LAWNDALE_SOURCE_NAME,
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

  const scoredEvent = scoreEvent(seed);

  return {
    ...scoredEvent,
    sourceLabel: listing.sourceLabel,
    timeLabel: listing.timeLabel,
    tasteReasons: listing.detailNote
      ? [...scoredEvent.tasteReasons, listing.detailNote]
      : scoredEvent.tasteReasons,
  };
}

function parseListingsFromHtml(html: string, pageUrl: string, sourceLabel: string): {
  listings: LawndaleParsedEvent[];
  homepageReached: boolean;
  eventsPageReached: boolean;
  upcomingEventsHeadingFound: boolean;
  allUpcomingEventsHeadingFound: boolean;
  usefulEventTextFound: boolean;
  cleanedLineCount: number;
  dateMatches: number;
  timeMatches: number;
  titleMatches: number;
  rawEventCandidates: number;
  warnings: string[];
} {
  const lines = extractVisibleLines(html);
  const anchors = extractEventAnchors(html, pageUrl);
  const allUpcomingEventsHeadingFound = lines.includes("All Upcoming Events");
  const upcomingEventsHeadingFound = lines.includes("Upcoming Events");
  const startIndex = allUpcomingEventsHeadingFound
    ? lines.indexOf("All Upcoming Events")
    : lines.indexOf("Upcoming Events");
  const endCandidates = [
    "Gallery Hours",
    "Contact",
    "Social",
    "Follow Us",
    "Mailing Address",
    "Physical Address",
  ];
  const endIndex = lines.findIndex((line, index) => index > startIndex && endCandidates.includes(line));
  const relevantLines = startIndex >= 0
    ? lines.slice(startIndex + 1, endIndex > startIndex ? endIndex : undefined)
    : lines;
  const cleanedLineCount = relevantLines.length;
  const warnings: string[] = [];
  const listings: LawndaleParsedEvent[] = [];
  let dateMatches = 0;
  let timeMatches = 0;
  let titleMatches = 0;
  let currentDate: string | null = null;
  let currentTimeLabel: string | null = null;

  for (let index = 0; index < relevantLines.length; index += 1) {
    const line = relevantLines[index];
    const date = parseDateLine(line);

    if (date) {
      currentDate = date;
      currentTimeLabel = null;
      dateMatches += 1;
      continue;
    }

    if (isPotentialTime(line)) {
      currentTimeLabel = normalizeTimeLabel(line);
      timeMatches += 1;
      continue;
    }

    if (!currentDate || !isPotentialTitle(line)) {
      continue;
    }

    const nextLine = relevantLines[index + 1];
    const detailNote = nextLine && /^with\s+/i.test(nextLine) ? nextLine : undefined;
    if (detailNote) {
      index += 1;
    }

    titleMatches += 1;
    const eventUrl = anchors[titleMatches - 1]?.href ?? pageUrl;
    const timeLabel = currentTimeLabel ?? "Time not listed on source.";
    const eventDateTime = buildDateTime(currentDate, currentTimeLabel);

    listings.push({
      title: line,
      date: currentDate,
      timeLabel,
      dateTime: eventDateTime,
      venue: LAWNDALE_SOURCE_NAME,
      city: "Houston",
      category: inferCategory(line, detailNote),
      sourceLabel,
      sourceUrl: eventUrl,
      sourceLinks: [
        { label: LAWNDALE_SOURCE_LABEL, url: LAWNDALE_HOME_URL },
        { label: "Events", url: LAWNDALE_EVENTS_URL },
        { label: "Event page", url: eventUrl },
      ],
      detailNote,
    });

    currentTimeLabel = null;
  }

  return {
    listings,
    homepageReached: /Upcoming Events/i.test(html),
    eventsPageReached: /All Upcoming Events/i.test(html),
    upcomingEventsHeadingFound,
    allUpcomingEventsHeadingFound,
    usefulEventTextFound: listings.length > 0,
    cleanedLineCount,
    dateMatches,
    timeMatches,
    titleMatches,
    rawEventCandidates: listings.length,
    warnings,
  };
}

function dedupeListings(listings: LawndaleParsedEvent[]): {
  listings: LawndaleParsedEvent[];
  duplicateRowsRemoved: number;
} {
  const byKey = new Map<string, LawndaleParsedEvent>();

  for (const listing of listings) {
    const key = [
      listing.title.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      listing.date,
      listing.timeLabel,
      listing.sourceLabel,
    ].join("|");
    byKey.set(key, listing);
  }

  return {
    listings: [...byKey.values()],
    duplicateRowsRemoved: listings.length - byKey.size,
  };
}

function buildSummary(input: {
  fetchSucceeded: boolean;
  usedHomepageFallback: boolean;
  parsedValidEvents: number;
  cleanedLineCount: number;
  dateHeadingMatches: number;
  titleMatches: number;
  dateTimeMatches: number;
  todayEventsCount: number;
  inWindowEventsDisplayedCount: number;
}): string {
  if (!input.fetchSucceeded) {
    return "Lawndale source could not be loaded.";
  }

  if (input.parsedValidEvents === 0) {
    return `Lawndale source loaded, but parser found 0 valid events. Lines: ${input.cleanedLineCount}, dates: ${input.dateHeadingMatches}, titles: ${input.titleMatches}, times: ${input.dateTimeMatches}.`;
  }

  const sourceText = input.usedHomepageFallback ? "homepage fallback" : "official events page";
  const todayText = input.todayEventsCount > 0 ? `${input.todayEventsCount} today` : "no events today";
  const windowText = input.inWindowEventsDisplayedCount > 0
    ? `${input.inWindowEventsDisplayedCount} in window`
    : "no events in window";

  return `Lawndale loaded from ${sourceText}: ${input.parsedValidEvents} events parsed, ${windowText}, ${todayText}.`;
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

export async function fetchLawndaleSource(): Promise<CultureProviderResult> {
  noStore();

  const urlsChecked = [LAWNDALE_HOME_URL, LAWNDALE_EVENTS_URL];
  const warnings: string[] = [];

  try {
    const [homeResult, eventsResult] = await Promise.all([
      fetchHtml(LAWNDALE_HOME_URL),
      fetchHtml(LAWNDALE_EVENTS_URL),
    ]);

    const homeParsed = parseListingsFromHtml(homeResult.html, LAWNDALE_HOME_URL, LAWNDALE_SOURCE_LABEL);
    const eventsParsed = parseListingsFromHtml(eventsResult.html, LAWNDALE_EVENTS_URL, LAWNDALE_SOURCE_LABEL);
    const mergedListings = dedupeListings([
      ...eventsParsed.listings,
      ...homeParsed.listings,
    ]);
    const mappedEvents = mergedListings.listings.map(mapListingToEvent);
    const filtered = filterCultureEvents(mappedEvents);
    const today = getHoustonTodayDateBase();
    const todayEventsCount = filtered.events.filter((event) => event.dateTime.slice(0, 10) === today).length;
    const earliestParsedEventDate = filtered.events[0]?.dateTime.slice(0, 10);
    const latestParsedEventDate = filtered.events.at(-1)?.dateTime.slice(0, 10);
    const hasLiveEvents = filtered.events.length > 0;
    const source: CultureProviderResult["source"] = "live_provider";
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
      earliestParsedEventDate,
      latestParsedEventDate,
      dateWindowStart: today,
      dateWindowEnd: addDaysToHoustonDate(today, EVENT_DISPLAY_WINDOW_DAYS),
      eventCalendarHeadingFound: eventsParsed.allUpcomingEventsHeadingFound || homeParsed.upcomingEventsHeadingFound,
      cleanedLineCount: homeParsed.cleanedLineCount + eventsParsed.cleanedLineCount,
      dateHeadingMatches: homeParsed.dateMatches + eventsParsed.dateMatches,
      titleMatches: homeParsed.titleMatches + eventsParsed.titleMatches,
      dateTimeMatches: homeParsed.timeMatches + eventsParsed.timeMatches,
      hiddenPastEventsCount: filtered.hiddenPastEventsCount,
      ongoingEventsDisplayedCount: filtered.ongoingEventsDisplayedCount,
      inWindowEventsDisplayedCount: filtered.inWindowEventsDisplayedCount,
      note: "",
    };

    const statusStatus: CultureSourceStatus["status"] = hasLiveEvents ? "working" : "limited";
    const responseStatuses = {
      home: homeResult.responseStatus,
      events: eventsResult.responseStatus,
    };
    const statusDebug: CultureSourceDebug = {
      urlsChecked,
      responseStatuses,
      homepageReached: homeResult.responseStatus >= 200 && homeResult.responseStatus < 400,
      eventsPageReached: eventsResult.responseStatus >= 200 && eventsResult.responseStatus < 400,
      upcomingEventsHeadingFound: homeParsed.upcomingEventsHeadingFound,
      allUpcomingEventsHeadingFound: eventsParsed.allUpcomingEventsHeadingFound,
      dateWindowStart: today,
      dateWindowEnd: addDaysToHoustonDate(today, EVENT_DISPLAY_WINDOW_DAYS),
      eventCalendarHeadingFound: eventsParsed.allUpcomingEventsHeadingFound || homeParsed.upcomingEventsHeadingFound,
      cleanedLineCount: homeParsed.cleanedLineCount + eventsParsed.cleanedLineCount,
      dateHeadingMatches: homeParsed.dateMatches + eventsParsed.dateMatches,
      titleMatches: homeParsed.titleMatches + eventsParsed.titleMatches,
      dateTimeMatches: homeParsed.timeMatches + eventsParsed.timeMatches,
      rawEventCandidates: homeParsed.rawEventCandidates + eventsParsed.rawEventCandidates,
      parsedValidEvents: filtered.events.length,
      todayChecked: true,
      todayEventsCount,
      earliestParsedEventDate,
      latestParsedEventDate,
      warnings: warnings.concat(homeParsed.warnings, eventsParsed.warnings),
    };
    const note = buildSummary({
      fetchSucceeded: homeResult.responseStatus >= 200 && homeResult.responseStatus < 400
        || eventsResult.responseStatus >= 200 && eventsResult.responseStatus < 400,
      usedHomepageFallback: eventsParsed.listings.length === 0 && homeParsed.listings.length > 0,
      parsedValidEvents: filtered.events.length,
      cleanedLineCount: statusDebug.cleanedLineCount,
      dateHeadingMatches: statusDebug.dateHeadingMatches,
      titleMatches: statusDebug.titleMatches ?? 0,
      dateTimeMatches: statusDebug.dateTimeMatches ?? 0,
      todayEventsCount,
      inWindowEventsDisplayedCount: filtered.inWindowEventsDisplayedCount,
    });

    const status = buildStatus(
      LAWNDALE_SOURCE_NAME,
      LAWNDALE_EVENTS_URL,
      statusStatus,
      note,
      statusDebug,
    );

    return {
      source,
      note,
      events: filtered.events,
      coverageSummary: {
        ...coverageSummary,
        note,
      },
      statuses: [status],
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Lawndale source failed before today-specific coverage could be verified.";
    warnings.push(message);
    const debug: CultureSourceDebug = {
      urlsChecked,
      responseStatuses: {},
      homepageReached: false,
      eventsPageReached: false,
      upcomingEventsHeadingFound: false,
      allUpcomingEventsHeadingFound: false,
      dateWindowStart: getHoustonTodayDateBase(),
      dateWindowEnd: addDaysToHoustonDate(getHoustonTodayDateBase(), EVENT_DISPLAY_WINDOW_DAYS),
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

    const note = buildSummary({
      fetchSucceeded: false,
      usedHomepageFallback: false,
      parsedValidEvents: 0,
      cleanedLineCount: 0,
      dateHeadingMatches: 0,
      titleMatches: 0,
      dateTimeMatches: 0,
      todayEventsCount: 0,
      inWindowEventsDisplayedCount: 0,
    });

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
        buildStatus(
          LAWNDALE_SOURCE_NAME,
          LAWNDALE_EVENTS_URL,
          "failed",
          note,
          debug,
        ),
      ],
    };
  }
}
