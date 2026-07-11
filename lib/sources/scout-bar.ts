import { scoreEvent, type EventSeed } from "@/lib/event-scoring";
import type { EventItem } from "@/types/dashboard";

export const SCOUT_BAR_SOURCE_NAME = "Scout Bar";
export const SCOUT_BAR_SOURCE_URL = "https://scoutbar.com/";

const SCOUT_BAR_USER_AGENT = "DailyOverviewBot/1.0 (+https://localhost)";
const SCOUT_BAR_ADDRESS = "18307 Egret Bay Blvd. Houston, TX";
const MAX_SAMPLE_LINES = 20;

export interface ScoutBarSourceDebug {
  urlsChecked: string[];
  responseStatuses: Record<string, number | null>;
  fetchSucceeded: boolean;
  upcomingEventsFound: boolean;
  cleanedLineCount: number;
  dateMatches: number;
  timeMatches: number;
  titleCandidates: number;
  rawEventCandidates: number;
  parsedValidEvents: number;
  earliestEventDate?: string;
  latestEventDate?: string;
  todayChecked: boolean;
  todayHadEvents: boolean;
  todayCoverageVerified: boolean;
  sampleLines?: string[];
  warnings: string[];
}

export interface ScoutBarSourceResult {
  events: EventItem[];
  sourceName: string;
  sourceUrl: string;
  status: "success" | "unavailable" | "failed";
  message: string;
  debug: ScoutBarSourceDebug;
}

interface ScoutBarParsedListing {
  title: string;
  supportActs?: string;
  dateTime: string;
  showTimeText?: string;
  doorsTimeText?: string;
  genre?: string;
  price?: string;
  eventUrl: string;
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
  return decodeHtmlEntities(
    value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
  );
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
      .replace(
        /<\/(p|div|li|section|article|h1|h2|h3|h4|h5|h6|a|time|span)>/gi,
        "\n",
      )
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  );
}

function getHoustonNowParts(): { year: number; month: number; day: number; isoDate: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(new Date())
    .split("-")
    .map(Number);

  return {
    year: parts[0],
    month: parts[1],
    day: parts[2],
    isoDate: `${parts[0]}-${String(parts[1]).padStart(2, "0")}-${String(parts[2]).padStart(2, "0")}`,
  };
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

function inferGenreTags(listing: ScoutBarParsedListing): string[] {
  const normalized = `${listing.title} ${listing.supportActs ?? ""} ${listing.genre ?? ""}`.toLowerCase();
  const tags: string[] = [];

  if (normalized.includes("metal")) {
    tags.push("metal");
  }

  if (normalized.includes("metalcore")) {
    tags.push("metalcore");
  }

  if (normalized.includes("electronic")) {
    tags.push("electronic");
  }

  if (normalized.includes("new wave")) {
    tags.push("new wave");
  }

  if (normalized.includes("hip hop") || normalized.includes("rap")) {
    tags.push("left-field hip-hop");
  }

  if (normalized.includes("rock")) {
    tags.push("rock");
  }

  if (tags.length === 0) {
    tags.push("live music");
  }

  return tags;
}

function mapListingToEvent(listing: ScoutBarParsedListing): EventItem {
  const genreTags = inferGenreTags(listing);
  const extraTasteReasons: string[] = [];

  if (listing.supportActs) {
    extraTasteReasons.push(`with ${listing.supportActs}`);
  }

  if (listing.genre) {
    extraTasteReasons.push(`genre: ${listing.genre}`);
  }

  if (listing.price) {
    extraTasteReasons.push(`price: ${listing.price}`);
  }

  if (!listing.showTimeText && listing.doorsTimeText) {
    extraTasteReasons.push(`using doors time from source: ${listing.doorsTimeText}`);
  }

  const seed: EventSeed = {
    id: `scout-bar-${listing.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${listing.dateTime.slice(0, 10)}`,
    title: listing.title,
    dateTime: listing.dateTime,
    venue: SCOUT_BAR_SOURCE_NAME,
    city: "Houston",
    category: "Concert",
    genreTags,
    sourceLinks: [
      {
        label: SCOUT_BAR_SOURCE_NAME,
        url: listing.eventUrl || SCOUT_BAR_SOURCE_URL,
      },
    ],
    supportActs: listing.supportActs,
    rawGenre: listing.genre,
    price: listing.price,
    metadataConfidence: [listing.supportActs, listing.genre, listing.price, listing.doorsTimeText, listing.showTimeText].filter(Boolean).length,
    isGreatLiveAct: false,
    liveReputationStatus: "unknown",
    liveReputationConfidence: 0,
    liveReputationReasons: [],
    liveReputationSources: [],
    venueFitScore: 13,
    knownLiveReputationScore: 6,
    rarityScore: 6,
    distanceRelevanceScore: 7,
    feedbackHistoryPlaceholderScore: 5,
  };

  const scoredEvent = scoreEvent(seed);

  return {
    ...scoredEvent,
    sourceLabel: SCOUT_BAR_SOURCE_NAME,
    tasteReasons: [...scoredEvent.tasteReasons, ...extraTasteReasons],
  };
}

function sanitizeRelevantLines(lines: string[]): string[] {
  return lines
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean)
    .filter((line) =>
      /upcoming events|doors:|show:|scout bar|egret bay|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|\$\d|\b(?:rock|metal|electronic|hip hop|rap|new wave)\b/i.test(
        line,
      ),
    )
    .slice(0, MAX_SAMPLE_LINES);
}

function extractUpcomingEventsSection(html: string): string {
  const startMatch = html.match(/<h4[^>]*>\s*Upcoming Events\s*<\/h4>/i);

  if (!startMatch?.index) {
    return html;
  }

  return html.slice(startMatch.index, startMatch.index + 120000);
}

function parseMonthNumber(shortMonth: string): number | null {
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

  return months[shortMonth.toLowerCase()] ?? null;
}

function inferEventYear(month: number, day: number): number {
  const current = getHoustonNowParts();

  if (month < current.month || (month === current.month && day < current.day)) {
    return current.year + 1;
  }

  return current.year;
}

function convertTimeTo24Hour(timeText?: string): string {
  if (!timeText) {
    return "19:00:00";
  }

  const match = timeText.match(/(\d{1,2}):(\d{2})\s*([AP]M)/i);

  if (!match) {
    return "19:00:00";
  }

  let hours = Number(match[1]);
  const minutes = match[2];
  const meridiem = match[3].toUpperCase();

  if (meridiem === "PM" && hours !== 12) {
    hours += 12;
  }

  if (meridiem === "AM" && hours === 12) {
    hours = 0;
  }

  return `${String(hours).padStart(2, "0")}:${minutes}:00`;
}

function parseScoutBarListings(sectionHtml: string): {
  listings: ScoutBarParsedListing[];
  cleanedLineCount: number;
  dateMatches: number;
  timeMatches: number;
  titleCandidates: number;
  upcomingEventsFound: boolean;
  sampleLines: string[];
} {
  const upcomingEventsFound = /<h4[^>]*>\s*Upcoming Events\s*<\/h4>/i.test(
    sectionHtml,
  );
  const visibleText = extractVisibleText(sectionHtml);
  const visibleLines = visibleText
    .split(/\n+/)
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean);
  const sampleLines = sanitizeRelevantLines(visibleLines);
  const datePattern = /\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})\b/g;
  const timePattern = /Doors:\s*(\d{1,2}:\d{2}[AP]M)(?:\s*\/\s*Show:\s*(\d{1,2}:\d{2}[AP]M))?/gi;
  const titleAnchorPattern = /<p class="fs-18 bold mb-12 event-title"><a href="([^"]+)"[^>]*>([\s\S]*?)<\/a><\/p>/gi;
  const eventBlockPattern = /<div class="event-info-block">[\s\S]*?<\/div>/gi;
  const listings: ScoutBarParsedListing[] = [];
  const dateMatches = [...sectionHtml.matchAll(datePattern)].length;
  const timeMatches = [...sectionHtml.matchAll(timePattern)].length;
  const titleCandidates = [...sectionHtml.matchAll(titleAnchorPattern)].length;

  for (const match of sectionHtml.matchAll(eventBlockPattern)) {
    const block = match[0];
    const titleMatch = block.match(
      /<p class="fs-18 bold mb-12 event-title"><a href="([^"]+)"[^>]*>([\s\S]*?)<\/a><\/p>/i,
    );
    const supportMatch = block.match(
      /<p class="fs-12 supporting-talent">([\s\S]*?)<\/p>/i,
    );
    const dateMatch = block.match(
      /<p class="fs-18 bold mt-1r event-date">(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})<\/p>/i,
    );
    const timeMatch = block.match(
      /Doors:\s*<span[^>]*class="see-doortime[^"]*"[^>]*>(\d{1,2}:\d{2}[AP]M)<\/span>[\s\S]*?(?:Show:\s*<span[^>]*class="see-showtime[^"]*"[^>]*>(\d{1,2}:\d{2}[AP]M)<\/span>)?/i,
    ) ?? block.match(/Doors:\s*(\d{1,2}:\d{2}[AP]M)(?:\s*\/\s*Show:\s*(\d{1,2}:\d{2}[AP]M))?/i);
    const priceMatch = block.match(/<span class="price">([\s\S]*?)<\/span>/i);
    const genreMatch = block.match(/<p class="fs-12 genre">([\s\S]*?)<\/p>/i);

    if (!titleMatch || !dateMatch) {
      continue;
    }

    const month = parseMonthNumber(dateMatch[1]);
    const day = Number(dateMatch[2]);

    if (!month) {
      continue;
    }

    const year = inferEventYear(month, day);
    const showTimeText = timeMatch?.[2] ? normalizeWhitespace(timeMatch[2]) : undefined;
    const doorsTimeText = timeMatch?.[1] ? normalizeWhitespace(timeMatch[1]) : undefined;
    const primaryTime = showTimeText ?? doorsTimeText;

    listings.push({
      title: stripTags(titleMatch[2]),
      supportActs: supportMatch ? stripTags(supportMatch[1]).replace(/^with\s+/i, "") : undefined,
      dateTime: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${convertTimeTo24Hour(primaryTime)}-05:00`,
      showTimeText,
      doorsTimeText,
      genre: genreMatch ? stripTags(genreMatch[1]) : undefined,
      price: priceMatch ? stripTags(priceMatch[1]) : undefined,
      eventUrl: titleMatch[1],
    });
  }

  return {
    listings,
    cleanedLineCount: visibleLines.length,
    dateMatches,
    timeMatches,
    titleCandidates,
    upcomingEventsFound,
    sampleLines,
  };
}

function dedupeListings(listings: ScoutBarParsedListing[]): ScoutBarParsedListing[] {
  const byKey = new Map<string, ScoutBarParsedListing>();

  for (const listing of listings) {
    const key = `${listing.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}|${listing.dateTime.slice(0, 10)}|${listing.dateTime.slice(11, 16)}`;
    byKey.set(key, listing);
  }

  return [...byKey.values()];
}

async function fetchHtml(url: string): Promise<{ ok: boolean; status: number | null; html?: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": SCOUT_BAR_USER_AGENT,
        Accept: "text/html,application/xhtml+xml",
      },
      signal: controller.signal,
      next: { revalidate: 900 },
    });

    if (!response.ok) {
      return { ok: false, status: response.status };
    }

    return {
      ok: true,
      status: response.status,
      html: await response.text(),
    };
  } catch {
    return { ok: false, status: null };
  } finally {
    clearTimeout(timeout);
  }
}

function buildScoutBarSummary(debug: ScoutBarSourceDebug): string {
  if (!debug.fetchSucceeded) {
    return "Scout Bar source could not be loaded.";
  }

  if (debug.parsedValidEvents === 0) {
    return `Scout Bar source loaded, but parser found 0 valid events. Lines: ${debug.cleanedLineCount}, date matches: ${debug.dateMatches}, time matches: ${debug.timeMatches}, title candidates: ${debug.titleCandidates}.`;
  }

  if (debug.todayHadEvents) {
    return `Scout Bar loaded from official homepage: ${debug.parsedValidEvents} events parsed, including today's events.`;
  }

  return `Scout Bar loaded from official homepage: ${debug.parsedValidEvents} events parsed. No events found for today.`;
}

export async function fetchScoutBarSource(): Promise<ScoutBarSourceResult> {
  const warnings: string[] = [];
  const responseStatuses: Record<string, number | null> = {};

  const homepageResponse = await fetchHtml(SCOUT_BAR_SOURCE_URL);
  responseStatuses[SCOUT_BAR_SOURCE_URL] = homepageResponse.status;

  if (!homepageResponse.ok || homepageResponse.html === undefined) {
    const debug: ScoutBarSourceDebug = {
      urlsChecked: [SCOUT_BAR_SOURCE_URL],
      responseStatuses,
      fetchSucceeded: false,
      upcomingEventsFound: false,
      cleanedLineCount: 0,
      dateMatches: 0,
      timeMatches: 0,
      titleCandidates: 0,
      rawEventCandidates: 0,
      parsedValidEvents: 0,
      todayChecked: false,
      todayHadEvents: false,
      todayCoverageVerified: false,
      warnings: [
        `Primary Scout Bar request failed with ${homepageResponse.status ?? "an unknown error"}.`,
      ],
    };

    return {
      events: [],
      sourceName: SCOUT_BAR_SOURCE_NAME,
      sourceUrl: SCOUT_BAR_SOURCE_URL,
      status: "failed",
      message: buildScoutBarSummary(debug),
      debug,
    };
  }

  const parsed = parseScoutBarListings(
    extractUpcomingEventsSection(homepageResponse.html),
  );
  const dedupedListings = dedupeListings(parsed.listings);
  const events = dedupedListings.map(mapListingToEvent);
  const today = getHoustonNowParts().isoDate;
  const todayEvents = events.filter((event) => event.dateTime.slice(0, 10) === today);
  const dates = summarizeDates(events);

  if (!parsed.upcomingEventsFound) {
    warnings.push("Upcoming Events section was not found on the official homepage.");
  }

  if (events.length === 0) {
    warnings.push("Official homepage loaded but no parseable Scout Bar events were found.");
  }

  const debug: ScoutBarSourceDebug = {
    urlsChecked: [SCOUT_BAR_SOURCE_URL],
    responseStatuses,
    fetchSucceeded: true,
    upcomingEventsFound: parsed.upcomingEventsFound,
    cleanedLineCount: parsed.cleanedLineCount,
    dateMatches: parsed.dateMatches,
    timeMatches: parsed.timeMatches,
    titleCandidates: parsed.titleCandidates,
    rawEventCandidates: parsed.listings.length,
    parsedValidEvents: events.length,
    earliestEventDate: dates.earliestEventDate,
    latestEventDate: dates.latestEventDate,
    todayChecked: true,
    todayHadEvents: todayEvents.length > 0,
    todayCoverageVerified: true,
    sampleLines: events.length === 0 ? parsed.sampleLines : undefined,
    warnings,
  };

  return {
    events,
    sourceName: SCOUT_BAR_SOURCE_NAME,
    sourceUrl: SCOUT_BAR_SOURCE_URL,
    status: events.length > 0 ? "success" : "unavailable",
    message: buildScoutBarSummary(debug),
    debug,
  };
}

export { SCOUT_BAR_ADDRESS };
