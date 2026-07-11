import { unstable_noStore as noStore } from "next/cache";
import { EVENT_DISPLAY_WINDOW_DAYS } from "@/lib/event-window";
import { addDaysToHoustonDate, filterCultureEvents, getHoustonTodayDate } from "@/lib/culture-date-filter";
import { scoreEvent } from "@/lib/event-scoring";
import type {
  CultureCoverageSummary,
  CultureProviderResult,
  CultureSourceDebug,
  CultureSourceStatus,
  EventItem,
  SourceLink,
} from "@/types/dashboard";

const ORANGE_SHOW_SOURCE_NAME = "Orange Show";
const ORANGE_SHOW_HOME_URL = "https://www.orangeshow.org/";
const ORANGE_SHOW_CALENDAR_URL = "https://www.orangeshow.org/calendar";
const ORANGE_SHOW_USER_AGENT = "DailyOverviewBot/1.0 (+https://localhost)";
const ORANGE_SHOW_GENERIC_PATHS = new Set([
  "/",
  "/calendar",
  "/education",
  "/performances",
  "/special-events",
  "/art-installations",
  "/visit",
  "/orange-show-monument",
  "/beer-can-house",
  "/smither-park",
  "/smokesax",
  "/team-4",
  "/about-1",
  "/gala",
  "/donate",
]);

interface PageFetchResult {
  html: string;
  responseStatus: number;
}

interface ParsedOrangeShowRow {
  title: string;
  date: string;
  timeLabel: string;
  dateTime: string;
  venue: string;
  city: string;
  category: string;
  sourceLabel: string;
  eventUrl: string;
  eventUrlLabel: "Event page" | "Source page";
  sourceLinks: SourceLink[];
  venueFitScore: number;
  rarityScore: number;
  thirdPartyLinksDiscovered: number;
  thirdPartyPagesSkipped: number;
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
  const timeout = setTimeout(() => controller.abort(), 12_000);

  return fetch(url, {
    headers: {
      "user-agent": ORANGE_SHOW_USER_AGENT,
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

function getMonthNumber(monthName: string): number | null {
  const months: Record<string, number> = {
    jan: 1,
    january: 1,
    feb: 2,
    february: 2,
    mar: 3,
    march: 3,
    apr: 4,
    april: 4,
    may: 5,
    jun: 6,
    june: 6,
    jul: 7,
    july: 7,
    aug: 8,
    august: 8,
    sep: 9,
    sept: 9,
    september: 9,
    oct: 10,
    october: 10,
    nov: 11,
    november: 11,
    dec: 12,
    december: 12,
  };

  return months[monthName.toLowerCase()] ?? null;
}

function inferYear(): number {
  const today = new Date();
  const [currentYear] = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(today)
    .split("-")
    .map(Number);

  return currentYear;
}

function parseDateTimeLine(line: string): { date: string; timeLabel: string } | null {
  const normalized = normalizeWhitespace(line).replace(/[–—]/g, "-");
  const match = normalized.match(
    /^([A-Za-z]{3,9})\s+(\d{1,2})(?:,\s*(\d{4}))?\s*\|\s*(.+)$/,
  );

  if (!match) {
    return null;
  }

  const month = getMonthNumber(match[1]);
  const day = Number(match[2]);
  const year = match[3] ? Number(match[3]) : inferYear();
  const timeLabel = normalizeTimeLabel(match[4]);

  if (!month || Number.isNaN(day) || !Number.isFinite(year) || !timeLabel) {
    return null;
  }

  return {
    date: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    timeLabel,
  };
}

function normalizeClockTime(token: string, fallbackMeridiem?: "AM" | "PM"): string | null {
  const cleaned = token.trim().replace(/\./g, "").replace(/\s+/g, " ");
  const shorthand = cleaned.match(/^(\d{1,2})(?::(\d{2}))?\s*([ap])$/i);

  if (shorthand) {
    const hours = Number(shorthand[1]);
    const minutes = shorthand[2] ?? "00";
    const meridiem = shorthand[3].toUpperCase() === "A" ? "AM" : "PM";
    return `${hours}:${minutes} ${meridiem}`;
  }

  const full = cleaned.match(/^(\d{1,2})(?::(\d{2}))?\s*([ap]m)?$/i);

  if (!full) {
    return null;
  }

  const hours = Number(full[1]);
  const minutes = full[2] ?? "00";
  const meridiem = full[3]?.toUpperCase() ?? fallbackMeridiem;

  if (!meridiem) {
    return null;
  }

  return `${hours}:${minutes} ${meridiem}`;
}

function normalizeTimeLabel(value: string): string | null {
  const normalized = normalizeWhitespace(value).replace(/[–—]/g, "-");

  if (!normalized) {
    return null;
  }

  if (/^time not listed on source\.?$/i.test(normalized)) {
    return "Time not listed on source.";
  }

  const parts = normalized.split(/\s*-\s*/);

  if (parts.length === 1) {
    const single = normalizeClockTime(parts[0]);
    return single ?? null;
  }

  const start = normalizeClockTime(parts[0], normalizeClockTime(parts.at(-1) ?? "")?.slice(-2) as "AM" | "PM" | undefined);
  const end = normalizeClockTime(parts[parts.length - 1], start?.slice(-2) as "AM" | "PM" | undefined);

  if (start && end) {
    return `${start} - ${end}`;
  }

  return null;
}

function buildDateTime(date: string, timeLabel: string): string {
  if (!timeLabel || /^time not listed on source\.?$/i.test(timeLabel)) {
    return `${date}T12:00:00-05:00`;
  }

  const firstToken = timeLabel.split(/\s*-\s*/)[0] ?? timeLabel;
  const match = firstToken.match(/^(\d{1,2})(?::(\d{2}))?\s*([AP]M)$/i);

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

function isActionLine(line: string): boolean {
  return /^(donate|learn more|buy tickets|rsvp|perform|click here|visit us)$/i.test(line.trim());
}

function isSectionBoundary(line: string): boolean {
  return /^(visit us|top of page|calendar of events|calender of events|the orange show|the beer can house is currently open|use tab to navigate through the menu items)$/i.test(
    line.trim(),
  );
}

function isLikelyTitleLine(line: string): boolean {
  if (isActionLine(line) || isSectionBoundary(line)) {
    return false;
  }

  if (/^(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\b/i.test(line)) {
    return false;
  }

  return line.length > 1;
}

function shouldJoinTitle(title: string, nextLine: string): boolean {
  return (
    /:\s*$/.test(title) ||
    /^(featuring|presented by|with|by)\b/i.test(nextLine) ||
    (/performance series/i.test(title) && /^[A-Z0-9][A-Za-z0-9'&.\- ]{2,}$/.test(nextLine) && nextLine.length < 60)
  );
}

function combineTitleLines(lines: string[]): { title: string; detailNote?: string } | null {
  if (lines.length === 0) {
    return null;
  }

  const titleParts = [lines[0]];
  let detailStartIndex = 1;

  if (lines[1] && shouldJoinTitle(lines[0], lines[1])) {
    titleParts.push(lines[1]);
    detailStartIndex = 2;
  }

  const title = normalizeWhitespace(titleParts.join(" ")).replace(/\s+:\s+/g, ": ");
  const detailNote = lines.slice(detailStartIndex).find((line) => !isActionLine(line));

  return {
    title,
    detailNote,
  };
}

function isSameSiteSpecificLink(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "");
    const path = parsed.pathname.replace(/\/+$/, "") || "/";

    if (host !== "orangeshow.org") {
      return false;
    }

    return !ORANGE_SHOW_GENERIC_PATHS.has(path);
  } catch {
    return false;
  }
}

function extractLinksFromRow(html: string): { eventUrl: string; eventUrlLabel: "Event page" | "Source page"; sourceLinks: SourceLink[]; thirdPartyLinksDiscovered: number; thirdPartyPagesSkipped: number } {
  const links: SourceLink[] = [];
  let specificLink: string | null = null;
  let thirdPartyLinksDiscovered = 0;
  let thirdPartyPagesSkipped = 0;

  for (const match of html.matchAll(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = match[1];
    const inner = match[2];
    const label = normalizeWhitespace(
      inner
        .replace(/<[^>]+>/g, " ")
        .replace(/^\s*[\u200b-\u200f]\s*/g, ""),
    );

    if (!label) {
      continue;
    }

    let resolved: URL;
    try {
      resolved = new URL(href, ORANGE_SHOW_CALENDAR_URL);
    } catch {
      continue;
    }

    const resolvedUrl = resolved.toString();
    const host = resolved.hostname.replace(/^www\./, "");

    if (host !== "orangeshow.org") {
      thirdPartyLinksDiscovered += 1;
      thirdPartyPagesSkipped += 1;
      continue;
    }

    if (isSameSiteSpecificLink(resolvedUrl) && !specificLink) {
      specificLink = resolvedUrl;
      continue;
    }

    if (!links.some((link) => link.url === resolvedUrl)) {
      links.push({ label, url: resolvedUrl });
    }
  }

  if (specificLink) {
    return {
      eventUrl: specificLink,
      eventUrlLabel: "Event page",
      sourceLinks: links,
      thirdPartyLinksDiscovered,
      thirdPartyPagesSkipped,
    };
  }

  return {
    eventUrl: ORANGE_SHOW_CALENDAR_URL,
    eventUrlLabel: "Source page",
    sourceLinks: links,
    thirdPartyLinksDiscovered,
    thirdPartyPagesSkipped,
  };
}

function inferVenueAndCategory(title: string, detailNote?: string): { venue: string; category: string; venueFitScore: number; rarityScore: number } {
  const normalized = `${title} ${detailNote ?? ""}`.toLowerCase();

  if (normalized.includes("beer can house")) {
    return {
      venue: "Beer Can House",
      category: "Arts & Culture / Community",
      venueFitScore: 12,
      rarityScore: normalized.includes("block party") ? 8 : 6,
    };
  }

  if (normalized.includes("smither park")) {
    return {
      venue: "Smither Park",
      category: "Arts & Culture / Workshop",
      venueFitScore: 11,
      rarityScore: 8,
    };
  }

  if (normalized.includes("art car")) {
    return {
      venue: "Orange Show World HQ",
      category: "Arts & Culture / Art Car",
      venueFitScore: 11,
      rarityScore: 8,
    };
  }

  if (
    normalized.includes("performance") ||
    normalized.includes("happening") ||
    normalized.includes("fire") ||
    normalized.includes("show") ||
    normalized.includes("concert")
  ) {
    return {
      venue: "Orange Show World HQ",
      category: "Arts & Culture / Performance",
      venueFitScore: 10,
      rarityScore: 8,
    };
  }

  return {
    venue: "Orange Show World HQ",
    category: normalized.includes("workshop") || normalized.includes("class") || normalized.includes("painting") || normalized.includes("mosaic") || normalized.includes("welding") || normalized.includes("torch")
      ? "Arts & Culture / Workshop"
      : "Arts & Culture",
    venueFitScore: 10,
    rarityScore: 7,
  };
}

function buildSourceLinksFromRow(row: ParsedOrangeShowRow): SourceLink[] {
  return row.sourceLinks;
}

function parseRowsFromCalendar(html: string): {
  rows: ParsedOrangeShowRow[];
  rawEventCandidates: number;
  duplicateEventsRemoved: number;
  thirdPartyLinksDiscovered: number;
  thirdPartyPagesSkipped: number;
  cleanedLineCount: number;
  dateHeadingMatches: number;
  usefulDatedEventTextFound: boolean;
  sampleLines: string[];
} {
  const cleanedLines = extractVisibleLines(html);
  const calendarStart = cleanedLines.findIndex((line) => /^upcoming events$/i.test(line));
  const relevantLines = calendarStart >= 0 ? cleanedLines.slice(calendarStart + 1) : cleanedLines;
  const stopIndex = relevantLines.findIndex((line) => isSectionBoundary(line));
  const scopedLines = stopIndex >= 0 ? relevantLines.slice(0, stopIndex) : relevantLines;

  const rawEventCandidates = scopedLines.filter((line) => parseDateTimeLine(line) !== null).length;
  const dateHeadingMatches = rawEventCandidates;
  const sampleLines = scopedLines.slice(0, 20);
  const chunks = html.split(/<div[^>]*role="listitem"[^>]*class="[^"]*_FiCX[^"]*"[^>]*>/i).slice(1);
  const rows: ParsedOrangeShowRow[] = [];
  let duplicateEventsRemoved = 0;
  let thirdPartyLinksDiscovered = 0;
  let thirdPartyPagesSkipped = 0;

  for (const chunk of chunks) {
    const lines = extractVisibleLines(chunk);
    const dateIndex = lines.findIndex((line) => parseDateTimeLine(line) !== null);

    if (dateIndex < 0) {
      continue;
    }

    const dateInfo = parseDateTimeLine(lines[dateIndex]);

    if (!dateInfo) {
      continue;
    }

    const contentLines = lines
      .slice(dateIndex + 1)
      .filter((line) => !isActionLine(line) && !isSectionBoundary(line));

    const titleBlock = combineTitleLines(contentLines.filter(isLikelyTitleLine));

    if (!titleBlock?.title) {
      continue;
    }

    const { eventUrl, eventUrlLabel, sourceLinks, thirdPartyLinksDiscovered: discoveredCount, thirdPartyPagesSkipped: skippedCount } = extractLinksFromRow(chunk);
    const inferred = inferVenueAndCategory(titleBlock.title, titleBlock.detailNote);
    const sourceLinksForEvent = buildSourceLinksFromRow({
      title: titleBlock.title,
      date: dateInfo.date,
      timeLabel: dateInfo.timeLabel,
      dateTime: buildDateTime(dateInfo.date, dateInfo.timeLabel),
      venue: inferred.venue,
      city: "Houston",
      category: inferred.category,
      sourceLabel: ORANGE_SHOW_SOURCE_NAME,
      eventUrl,
      eventUrlLabel,
      sourceLinks,
      venueFitScore: inferred.venueFitScore,
      rarityScore: inferred.rarityScore,
      thirdPartyLinksDiscovered: discoveredCount,
      thirdPartyPagesSkipped: skippedCount,
    });

    const parsedRow: ParsedOrangeShowRow = {
      title: titleBlock.title,
      date: dateInfo.date,
      timeLabel: dateInfo.timeLabel,
      dateTime: buildDateTime(dateInfo.date, dateInfo.timeLabel),
      venue: inferred.venue,
      city: "Houston",
      category: inferred.category,
      sourceLabel: ORANGE_SHOW_SOURCE_NAME,
      eventUrl,
      eventUrlLabel,
      sourceLinks: sourceLinksForEvent,
      venueFitScore: inferred.venueFitScore,
      rarityScore: inferred.rarityScore,
      thirdPartyLinksDiscovered: discoveredCount,
      thirdPartyPagesSkipped: skippedCount,
    };

    thirdPartyLinksDiscovered += discoveredCount;
    thirdPartyPagesSkipped += skippedCount;

    rows.push(parsedRow);
  }

  const byKey = new Map<string, ParsedOrangeShowRow>();

  for (const row of rows) {
    const key = `${row.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}|${row.date}|${row.timeLabel}|${row.sourceLabel}`;
    if (byKey.has(key)) {
      duplicateEventsRemoved += 1;
      continue;
    }
    byKey.set(key, row);
  }

  return {
    rows: [...byKey.values()],
    rawEventCandidates,
    duplicateEventsRemoved,
    thirdPartyLinksDiscovered,
    thirdPartyPagesSkipped,
    cleanedLineCount: cleanedLines.length,
    dateHeadingMatches,
    usefulDatedEventTextFound: rawEventCandidates > 0,
    sampleLines,
  };
}

function mapRowsToEvents(rows: ParsedOrangeShowRow[]): EventItem[] {
  return rows.map((row) =>
    scoreEvent({
      id: `orange-show-${row.date}-${row.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      title: row.title,
      dateTime: row.dateTime,
      venue: row.venue,
      city: row.city,
      category: row.category,
      genreTags: [
        "arts and culture",
        "community art",
        "performance art",
        row.category.toLowerCase(),
      ],
      sourceLinks: row.sourceLinks,
      eventUrl: row.eventUrl,
      eventUrlLabel: row.eventUrlLabel,
      similarArtists: undefined,
      isGreatLiveAct: false,
      liveReputationStatus: "unknown",
      liveReputationConfidence: 0,
      liveReputationReasons: [],
      liveReputationSources: [],
      venueFitScore: row.venueFitScore,
      knownLiveReputationScore: 0,
      rarityScore: row.rarityScore,
      distanceRelevanceScore: 6,
      feedbackHistoryPlaceholderScore: 0,
    }),
  );
}

function buildStatusMessage(
  visibleEvents: EventItem[],
  todayEventsCount: number,
  parsedValidEvents: number,
  note: string,
): string {
  if (parsedValidEvents === 0) {
    return note;
  }

  if (visibleEvents.length > 0) {
    return `Orange Show loaded from official calendar: ${visibleEvents.length} events in window, including ${todayEventsCount} today.`;
  }

  return "Orange Show official calendar loaded, but no events overlap the current window.";
}

function buildCoverageSummary(
  visibleEvents: EventItem[],
  todayEventsCount: number,
  note: string,
  merged: Partial<CultureCoverageSummary>,
  source: CultureCoverageSummary["source"],
): CultureCoverageSummary {
  const today = getHoustonTodayDate();

  return {
    source,
    trackedSourcesCount: 1,
    activeLiveProvidersCount: visibleEvents.length > 0 ? 1 : 0,
    notImplementedSourcesCount: 0,
    parsedEventsCount: visibleEvents.length,
    todayChecked: true,
    todayEventsCount,
    earliestParsedEventDate: visibleEvents[0]?.dateTime.slice(0, 10),
    latestParsedEventDate: visibleEvents.at(-1)?.dateTime.slice(0, 10),
    dateWindowStart: merged.dateWindowStart ?? today,
    dateWindowEnd: merged.dateWindowEnd ?? addDaysToHoustonDate(today, EVENT_DISPLAY_WINDOW_DAYS),
    eventCalendarHeadingFound: merged.eventCalendarHeadingFound,
    cleanedLineCount: merged.cleanedLineCount,
    dateHeadingMatches: merged.dateHeadingMatches,
    titleMatches: merged.titleMatches,
    dateTimeMatches: merged.dateTimeMatches,
    hiddenPastEventsCount: merged.hiddenPastEventsCount,
    ongoingEventsDisplayedCount: merged.ongoingEventsDisplayedCount,
    inWindowEventsDisplayedCount: merged.inWindowEventsDisplayedCount,
    note,
  };
}

export async function fetchOrangeShowSource(): Promise<CultureProviderResult> {
  noStore();

  const [homeResult, calendarResult] = await Promise.allSettled([
    fetchHtml(ORANGE_SHOW_HOME_URL),
    fetchHtml(ORANGE_SHOW_CALENDAR_URL),
  ]);

  const homepage = homeResult.status === "fulfilled" ? homeResult.value : null;
  const calendarPage = calendarResult.status === "fulfilled" ? calendarResult.value : null;
  const responseStatuses: Record<string, number> = {};

  if (homepage) {
    responseStatuses.homepage = homepage.responseStatus;
  }

  if (calendarPage) {
    responseStatuses.calendar = calendarPage.responseStatus;
  }

  if (!calendarPage) {
    const note = "Orange Show official calendar could not be fetched.";

    return {
      source: "mock",
      note,
      events: [],
      coverageSummary: {
        source: "mock",
        trackedSourcesCount: 1,
        activeLiveProvidersCount: 0,
        notImplementedSourcesCount: 0,
        parsedEventsCount: 0,
        todayChecked: true,
        todayEventsCount: 0,
        note,
      },
      statuses: [
        {
          sourceName: ORANGE_SHOW_SOURCE_NAME,
          sourceUrl: ORANGE_SHOW_CALENDAR_URL,
          status: "failed",
          message: note,
          debug: {
            urlsChecked: [ORANGE_SHOW_HOME_URL, ORANGE_SHOW_CALENDAR_URL],
            responseStatuses,
            homepageReached: Boolean(homepage),
            calendarPageReached: false,
            dateWindowStart: getHoustonTodayDate(),
            dateWindowEnd: addDaysToHoustonDate(getHoustonTodayDate(), 14),
            eventCalendarHeadingFound: false,
            cleanedLineCount: 0,
            dateHeadingMatches: 0,
            rawEventCandidates: 0,
            parsedValidEvents: 0,
            todayChecked: true,
            todayEventsCount: 0,
            warnings: [note],
          } satisfies CultureSourceDebug,
        },
      ],
    };
  }

  const parsed = parseRowsFromCalendar(calendarPage.html);
  const parsedEvents = mapRowsToEvents(parsed.rows);
  const filtered = filterCultureEvents(parsedEvents);
  const todayEventsCount = filtered.events.filter((event) => event.dateTime.slice(0, 10) === getHoustonTodayDate()).length;
  const note = buildStatusMessage(filtered.events, todayEventsCount, parsedEvents.length, "Orange Show calendar loaded.");
  const source: CultureProviderResult["source"] = parsedEvents.length > 0 ? "live_provider" : "mixed";
  const sourceStatus: CultureSourceStatus = {
    sourceName: ORANGE_SHOW_SOURCE_NAME,
    sourceUrl: ORANGE_SHOW_CALENDAR_URL,
    status:
      filtered.events.length > 0
        ? "working"
        : parsedEvents.length > 0
          ? "limited"
          : "audited_limited",
    message: note,
    debug: {
      urlsChecked: [ORANGE_SHOW_HOME_URL, ORANGE_SHOW_CALENDAR_URL],
      responseStatuses,
      homepageReached: Boolean(homepage && homepage.responseStatus >= 200 && homepage.responseStatus < 400),
      calendarPageReached: Boolean(calendarPage && calendarPage.responseStatus >= 200 && calendarPage.responseStatus < 400),
      upcomingEventsHeadingFound: parsed.usefulDatedEventTextFound,
      dateWindowStart: getHoustonTodayDate(),
      dateWindowEnd: addDaysToHoustonDate(getHoustonTodayDate(), 14),
      eventCalendarHeadingFound: true,
      cleanedLineCount: parsed.cleanedLineCount,
      dateHeadingMatches: parsed.dateHeadingMatches,
      rawEventCandidates: parsed.rawEventCandidates,
      parsedValidEvents: parsedEvents.length,
      duplicateEventsRemoved: parsed.duplicateEventsRemoved,
      thirdPartyLinksDiscovered: parsed.thirdPartyLinksDiscovered,
      thirdPartyPagesSkipped: parsed.thirdPartyPagesSkipped,
      hiddenPastEventsCount: filtered.hiddenPastEventsCount,
      displayedInWindowEventsCount: filtered.events.length,
      todayChecked: true,
      todayEventsCount,
      earliestParsedEventDate: filtered.events[0]?.dateTime.slice(0, 10),
      latestParsedEventDate: filtered.events.at(-1)?.dateTime.slice(0, 10),
      usefulDatedEventTextFound: parsed.usefulDatedEventTextFound,
      sampleLines: parsedEvents.length > 0 ? undefined : parsed.sampleLines.slice(0, 20),
      warnings:
        parsedEvents.length === 0
          ? ["No reliable dated rows parsed from the official calendar."]
          : [],
    } satisfies CultureSourceDebug,
  };

  const coverageSummary = buildCoverageSummary(
    filtered.events,
    todayEventsCount,
    note,
    {
      eventCalendarHeadingFound: true,
      cleanedLineCount: parsed.cleanedLineCount,
      dateHeadingMatches: parsed.dateHeadingMatches,
      titleMatches: parsed.rawEventCandidates,
      dateTimeMatches: parsed.rawEventCandidates,
      hiddenPastEventsCount: filtered.hiddenPastEventsCount,
      ongoingEventsDisplayedCount: filtered.ongoingEventsDisplayedCount,
      inWindowEventsDisplayedCount: filtered.inWindowEventsDisplayedCount,
      dateWindowStart: getHoustonTodayDate(),
      dateWindowEnd: addDaysToHoustonDate(getHoustonTodayDate(), 14),
    },
    source,
  );

  return {
    source,
    note,
    events: filtered.events,
    coverageSummary,
    statuses: [sourceStatus],
  };
}
