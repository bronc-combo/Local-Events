import { cachedFetch } from "@/lib/source-cache";
import { scoreEvent } from "@/lib/event-scoring";
import { EVENT_DISPLAY_WINDOW_DAYS } from "@/lib/event-window";
import type { EventItem } from "@/types/dashboard";

export const HEIGHTS_THEATER_SOURCE_NAME = "The Heights Theater";
export const HEIGHTS_THEATER_SOURCE_URL = "https://theheightstheater.com/";
const HEIGHTS_THEATER_USER_AGENT = "DailyOverviewBot/1.0 (+https://localhost)";

export interface HeightsTheaterSourceDebug {
  urlsChecked: string[];
  fetchSucceeded: boolean;
  responseStatus?: number;
  cacheStatus?: "live" | "cached" | "cached_fallback" | "failed";
  fetchedTextLength: number;
  eventListFound: boolean;
  cleanedLineCount: number;
  rawEventCandidates: number;
  parsedBeforeDedupe: number;
  parsedValidEvents: number;
  canceledRowsSkipped: number;
  skippedRowsCount: number;
  skippedReasons?: string[];
  duplicateRowsRemoved: number;
  hiddenPastShows: number;
  displayedInWindowShows: number;
  visibleUpcomingShowsCount: number;
  lowPriorityUpcomingShowsCount: number;
  visibleUpcomingTitles: string[];
  concertRowsParsed: number;
  otherRowsParsed: number;
  todayChecked: boolean;
  todayEventCount: number;
  todayHadEvents: boolean;
  todayCoverageVerified: boolean;
  earliestEventDate?: string;
  latestEventDate?: string;
  warnings: string[];
}

export interface HeightsTheaterSourceResult {
  events: EventItem[];
  sourceName: string;
  sourceUrl: string;
  status: "success" | "unavailable" | "failed";
  message: string;
  debug: HeightsTheaterSourceDebug;
}

interface HeightsTheaterParsedListing {
  title: string;
  supportActs?: string;
  dateLabel: string;
  eventUrl: string;
  canceled: boolean;
}

interface CacheAwareResponse {
  ok: boolean;
  status: number;
  mode?: "live" | "cached" | "cached_fallback" | "failed";
  text(): Promise<string>;
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

function stripTags(value: string): string {
  return decodeHtmlEntities(value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function normalizeWhitespace(value: string): string {
  return decodeHtmlEntities(value).replace(/\s+/g, " ").trim();
}

function normalizeMultilineText(value: string): string {
  return decodeHtmlEntities(value)
    .replace(/\r/g, "")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((line) => line.trim())
    .join("\n");
}

function extractVisibleText(html: string): string {
  return normalizeMultilineText(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<\/(p|div|li|section|article|h1|h2|h3|h4|h5|h6|a|time|span)>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  );
}

function getHoustonTodayDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function addDays(baseDate: string, days: number): string {
  const base = new Date(`${baseDate}T12:00:00-05:00`);
  base.setDate(base.getDate() + days);

  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(base);
}

function getMonthNumber(monthName: string): number | null {
  const months: Record<string, number> = {
    jan: 1,
    feb: 2,
    mar: 3,
    apr: 4,
    may: 5,
    jun: 6,
    jul: 7,
    aug: 8,
    sep: 9,
    oct: 10,
    nov: 11,
    dec: 12,
  };

  return months[monthName.toLowerCase()] ?? null;
}

function inferEventYear(month: number, day: number): number {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const [currentYear, currentMonth, currentDay] = formatter.format(new Date()).split("-").map(Number);

  if (month < currentMonth || (month === currentMonth && day < currentDay)) {
    return currentYear + 1;
  }

  return currentYear;
}

function parseDateLabel(dateLabel: string): string | null {
  const match = dateLabel.match(/^(Sun|Mon|Tue|Wed|Thu|Fri|Sat)\s+(\d{1,2})\s+([A-Za-z]{3})$/i);

  if (!match) {
    return null;
  }

  const day = Number(match[2]);
  const month = getMonthNumber(match[3]);

  if (!month || Number.isNaN(day)) {
    return null;
  }

  const year = inferEventYear(month, day);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function inferGenreTags(listing: HeightsTheaterParsedListing): string[] {
  const normalized = `${listing.title} ${listing.supportActs ?? ""}`.toLowerCase();
  const tags = new Set<string>();

  if (normalized.includes("zeppelin") || normalized.includes("vile") || normalized.includes("dead") || normalized.includes("thorn")) {
    tags.add("rock");
  }

  if (normalized.includes("americana") || normalized.includes("folk") || normalized.includes("country")) {
    tags.add("americana");
  }

  if (normalized.includes("blues")) {
    tags.add("blues");
  }

  if (normalized.includes("punk") || normalized.includes("hardcore")) {
    tags.add("punk");
    tags.add("hardcore");
  }

  if (tags.size === 0) {
    tags.add("live music");
  }

  return [...tags];
}

function buildTasteReasons(listing: HeightsTheaterParsedListing): string[] {
  const reasons: string[] = [];

  if (listing.supportActs) {
    reasons.push(`support act match: ${listing.supportActs}`);
  }

  if (/being dead|zoso|kurt vile/i.test(`${listing.title} ${listing.supportActs ?? ""}`)) {
    reasons.push("genre/title match");
  }

  return reasons;
}

function parseEventSection(sectionHtml: string): HeightsTheaterParsedListing | null {
  const dateMatch = sectionHtml.match(/<p class="tour-date">\s*<span>([A-Za-z]{3})<\/span><span class="day">(\d{2})<\/span>([A-Za-z]{3})\s*<\/p>/i);
  const titleMatch = sectionHtml.match(/<span class="main-head"><a href="([^"]+)"[^>]*>([\s\S]*?)<\/a><\/span>/i);
  const supportMatch = sectionHtml.match(/<span class="sub-head">([\s\S]*?)<\/span>/i);
  const canceled = /class="action-btn canceled"|CANCELLED|Canceled/i.test(sectionHtml);

  if (!dateMatch || !titleMatch) {
    return null;
  }

  const title = stripTags(titleMatch[2]);
  if (!title) {
    return null;
  }

  const day = Number(dateMatch[2]);
  const month = getMonthNumber(dateMatch[3]);
  if (!month || Number.isNaN(day)) {
    return null;
  }

  const dateLabel = `${dateMatch[1]} ${String(day).padStart(2, "0")} ${dateMatch[3]}`;
  const eventUrl = titleMatch[1].startsWith("http") ? titleMatch[1] : HEIGHTS_THEATER_SOURCE_URL;

  return {
    title,
    supportActs: supportMatch ? stripTags(supportMatch[1]) || undefined : undefined,
    dateLabel,
    eventUrl,
    canceled,
  };
}

function mapListingToEvent(listing: HeightsTheaterParsedListing): EventItem {
  const dateISO = parseDateLabel(listing.dateLabel);

  if (!dateISO) {
    throw new Error(`Unable to parse Heights Theater date label: ${listing.dateLabel}`);
  }

  const scoredEvent = scoreEvent({
    id: `heights-theater-${listing.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${dateISO}`,
    title: listing.title,
    dateTime: `${dateISO}T19:00:00-05:00`,
    venue: HEIGHTS_THEATER_SOURCE_NAME,
    city: "Houston",
    category: "Concert",
    sectionCategory: "concert",
    genreTags: inferGenreTags(listing),
    sourceLinks: [
      {
        label: "Source page",
        url: HEIGHTS_THEATER_SOURCE_URL,
      },
    ],
    eventUrl: HEIGHTS_THEATER_SOURCE_URL,
    eventUrlLabel: "Source page",
    supportActs: listing.supportActs,
    metadataConfidence: [listing.supportActs].filter(Boolean).length,
    isGreatLiveAct: false,
    liveReputationStatus: "unknown",
    liveReputationConfidence: 0,
    liveReputationReasons: [],
    liveReputationSources: [],
    venueFitScore: 13,
    knownLiveReputationScore: 8,
    rarityScore: 6,
    distanceRelevanceScore: 9,
    feedbackHistoryPlaceholderScore: 5,
  });

  return {
    ...scoredEvent,
    sourceLabel: HEIGHTS_THEATER_SOURCE_NAME,
    timeLabel: "Time not listed on source.",
    tasteReasons: [...scoredEvent.tasteReasons, ...buildTasteReasons(listing)],
  };
}

function parseHeightsTheaterListings(html: string): {
  listings: HeightsTheaterParsedListing[];
  eventListFound: boolean;
  cleanedLineCount: number;
} {
  const currentDatesMatch = html.match(/<ul class="tour-dates current-dates">([\s\S]*?)<\/ul>/i);
  const eventListFound = Boolean(currentDatesMatch);
  const sourceHtml = currentDatesMatch?.[1] ?? "";

  const visibleText = extractVisibleText(sourceHtml);
  const cleanedLineCount = visibleText
    .split("\n")
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean).length;

  const listings = [...sourceHtml.matchAll(/<li class="group">([\s\S]*?)<\/li>/g)]
    .map((match) => parseEventSection(match[1]))
    .filter((listing): listing is HeightsTheaterParsedListing => listing !== null);

  return { listings, eventListFound, cleanedLineCount };
}

function dedupeListings(listings: HeightsTheaterParsedListing[]): HeightsTheaterParsedListing[] {
  const seen = new Set<string>();

  return listings.filter((listing) => {
    const dateISO = parseDateLabel(listing.dateLabel) ?? listing.dateLabel;
    const key = `${listing.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}|${dateISO}|${HEIGHTS_THEATER_SOURCE_NAME}`;

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function summarizeDates(events: EventItem[]): {
  earliestEventDate?: string;
  latestEventDate?: string;
} {
  if (events.length === 0) {
    return {};
  }

  const dates = events.map((event) => event.dateTime.slice(0, 10)).sort();
  return {
    earliestEventDate: dates[0],
    latestEventDate: dates[dates.length - 1],
  };
}

function buildSummary(debug: HeightsTheaterSourceDebug): string {
  if (!debug.fetchSucceeded) {
    return "The Heights Theater source could not be loaded.";
  }

  if (debug.parsedValidEvents === 0) {
    return `The Heights Theater source loaded, but parser found 0 valid events. Raw candidates: ${debug.rawEventCandidates}, cleaned lines: ${debug.cleanedLineCount}, canceled rows skipped: ${debug.canceledRowsSkipped}.`;
  }

  if (debug.todayHadEvents) {
    return `The Heights Theater loaded from official homepage: ${debug.parsedValidEvents} events parsed, including ${debug.todayEventCount} today.`;
  }

  return `The Heights Theater loaded from official homepage: ${debug.parsedValidEvents} events parsed, earliest ${debug.earliestEventDate ?? "unknown"}. No events found for today.`;
}

export async function fetchHeightsTheaterSource(): Promise<HeightsTheaterSourceResult> {
  const urlsChecked = [HEIGHTS_THEATER_SOURCE_URL];
  const debug: HeightsTheaterSourceDebug = {
    urlsChecked,
    fetchSucceeded: false,
    fetchedTextLength: 0,
    eventListFound: false,
    cleanedLineCount: 0,
    rawEventCandidates: 0,
    parsedBeforeDedupe: 0,
    parsedValidEvents: 0,
    canceledRowsSkipped: 0,
    skippedRowsCount: 0,
    duplicateRowsRemoved: 0,
    hiddenPastShows: 0,
    displayedInWindowShows: 0,
    visibleUpcomingShowsCount: 0,
    lowPriorityUpcomingShowsCount: 0,
    visibleUpcomingTitles: [],
    concertRowsParsed: 0,
    otherRowsParsed: 0,
    todayChecked: true,
    todayEventCount: 0,
    todayHadEvents: false,
    todayCoverageVerified: false,
    warnings: [],
  };

  try {
    const response = (await cachedFetch(HEIGHTS_THEATER_SOURCE_URL, {
      headers: {
        "user-agent": HEIGHTS_THEATER_USER_AGENT,
        accept: "text/html,application/xhtml+xml",
      },
      category: "music",
      refreshPolicy: "daily",
      cacheKey: HEIGHTS_THEATER_SOURCE_URL,
    })) as CacheAwareResponse;

    debug.fetchSucceeded = response.ok;
    debug.responseStatus = response.status;
    debug.cacheStatus = response.mode;

    const html = await response.text();
    debug.fetchedTextLength = html.length;

    const parsed = parseHeightsTheaterListings(html);
    debug.eventListFound = parsed.eventListFound;
    debug.cleanedLineCount = parsed.cleanedLineCount;
    debug.rawEventCandidates = parsed.listings.length;
    debug.parsedBeforeDedupe = parsed.listings.length;

    const nonCanceledListings = parsed.listings.filter((listing) => !listing.canceled);
    debug.canceledRowsSkipped = parsed.listings.length - nonCanceledListings.length;

    const dedupedListings = dedupeListings(nonCanceledListings);
    debug.duplicateRowsRemoved = nonCanceledListings.length - dedupedListings.length;

    const scoredEvents = dedupedListings.map(mapListingToEvent);
    debug.parsedValidEvents = scoredEvents.length;
    debug.concertRowsParsed = scoredEvents.length;

    const today = getHoustonTodayDate();
    const windowEnd = addDays(today, EVENT_DISPLAY_WINDOW_DAYS);
    const inWindowEvents = scoredEvents.filter((event) => {
      const eventDate = event.dateTime.slice(0, 10);
      return eventDate >= today && eventDate <= windowEnd;
    });
    const todayEvents = inWindowEvents.filter((event) => event.dateTime.slice(0, 10) === today);
    const upcomingEvents = inWindowEvents.filter((event) => event.dateTime.slice(0, 10) > today);

    debug.hiddenPastShows = scoredEvents.filter((event) => event.dateTime.slice(0, 10) < today).length;
    debug.displayedInWindowShows = inWindowEvents.length;
    debug.todayEventCount = todayEvents.length;
    debug.todayHadEvents = todayEvents.length > 0;
    debug.todayCoverageVerified = true;
    debug.visibleUpcomingShowsCount = upcomingEvents.filter((event) => !event.hiddenReason).length;
    debug.lowPriorityUpcomingShowsCount = upcomingEvents.filter((event) => Boolean(event.hiddenReason)).length;
    debug.visibleUpcomingTitles = upcomingEvents
      .filter((event) => !event.hiddenReason)
      .map((event) => event.title);

    const { earliestEventDate, latestEventDate } = summarizeDates(scoredEvents);
    debug.earliestEventDate = earliestEventDate;
    debug.latestEventDate = latestEventDate;

    if (!debug.eventListFound) {
      debug.warnings.push("Current dates event list not found in homepage HTML.");
    }

    if (debug.canceledRowsSkipped > 0) {
      debug.warnings.push(`Skipped ${debug.canceledRowsSkipped} canceled row(s).`);
    }

    if (debug.duplicateRowsRemoved > 0) {
      debug.warnings.push(`Deduped ${debug.duplicateRowsRemoved} duplicate listing(s).`);
    }

    const status: HeightsTheaterSourceResult["status"] =
      debug.parsedValidEvents > 0 ? "success" : debug.fetchSucceeded ? "unavailable" : "failed";

    return {
      events: scoredEvents,
      sourceName: HEIGHTS_THEATER_SOURCE_NAME,
      sourceUrl: HEIGHTS_THEATER_SOURCE_URL,
      status,
      message: buildSummary(debug),
      debug,
    };
  } catch (error) {
    debug.warnings.push(error instanceof Error ? error.message : "The Heights Theater fetch failed.");

    return {
      events: [],
      sourceName: HEIGHTS_THEATER_SOURCE_NAME,
      sourceUrl: HEIGHTS_THEATER_SOURCE_URL,
      status: "failed",
      message: "The Heights Theater source could not be loaded.",
      debug,
    };
  }
}
