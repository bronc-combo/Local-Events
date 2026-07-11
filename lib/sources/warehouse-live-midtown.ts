import { cachedFetch } from "@/lib/source-cache";
import { scoreEvent } from "@/lib/event-scoring";
import { EVENT_DISPLAY_WINDOW_DAYS } from "@/lib/event-window";
import type { EventItem } from "@/types/dashboard";

export const WAREHOUSE_LIVE_MIDTOWN_SOURCE_NAME = "Warehouse Live Midtown";
export const WAREHOUSE_LIVE_MIDTOWN_SOURCE_URL = "https://warehouselivemidtown.com/";
const WAREHOUSE_LIVE_MIDTOWN_USER_AGENT = "DailyOverviewBot/1.0 (+https://localhost)";

export interface WarehouseLiveMidtownSourceDebug {
  urlsChecked: string[];
  fetchSucceeded: boolean;
  responseStatus?: number;
  cacheStatus?: "live" | "cached" | "cached_fallback" | "failed";
  homepageReached: boolean;
  upcomingEventsSectionFound: boolean;
  cleanedLineCount: number;
  rawEventCandidates: number;
  parsedBeforeDedupe: number;
  parsedValidEvents: number;
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

export interface WarehouseLiveMidtownSourceResult {
  events: EventItem[];
  sourceName: string;
  sourceUrl: string;
  status: "success" | "unavailable" | "failed";
  message: string;
  debug: WarehouseLiveMidtownSourceDebug;
}

interface WarehouseLiveMidtownParsedListing {
  title: string;
  supportActs?: string;
  subtitle?: string;
  dateLabel: string;
  doorsTime?: string;
  showTime?: string;
  genre?: string;
  price?: string;
  eventUrl: string;
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

function normalizeWhitespace(value: string): string {
  return decodeHtmlEntities(value).replace(/\s+/g, " ").trim();
}

function stripTags(value: string): string {
  return normalizeWhitespace(value.replace(/<[^>]+>/g, " "));
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

function getMonthNumber(shortMonth: string): number | null {
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
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const [currentYear, currentMonth, currentDay] = formatter.format(now).split("-").map(Number);

  if (month < currentMonth || (month === currentMonth && day < currentDay)) {
    return currentYear + 1;
  }

  return currentYear;
}

function parseDateLabel(dateLabel: string): string | null {
  const match = dateLabel.match(/^[A-Za-z]{3}\s+([A-Za-z]{3})\s+(\d{1,2})$/);

  if (!match) {
    return null;
  }

  const month = getMonthNumber(match[1]);
  const day = Number(match[2]);

  if (!month || Number.isNaN(day)) {
    return null;
  }

  const year = inferEventYear(month, day);

  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
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

function inferGenreTags(listing: WarehouseLiveMidtownParsedListing): string[] {
  const normalized = `${listing.title} ${listing.supportActs ?? ""} ${listing.genre ?? ""}`.toLowerCase();
  const tags = new Set<string>();

  if (normalized.includes("post-hardcore") || normalized.includes("hardcore")) {
    tags.add("post-hardcore");
    tags.add("hardcore");
  }

  if (normalized.includes("punk")) {
    tags.add("punk");
  }

  if (normalized.includes("noise")) {
    tags.add("noise rock");
  }

  if (normalized.includes("math")) {
    tags.add("math rock");
  }

  if (normalized.includes("metal") || normalized.includes("sludge") || normalized.includes("doom") || normalized.includes("death") || normalized.includes("black")) {
    tags.add("metal");
  }

  if (normalized.includes("industrial")) {
    tags.add("industrial");
  }

  if (normalized.includes("electronic") || normalized.includes("dj") || normalized.includes("dance")) {
    tags.add("electronic");
    tags.add("dance");
  }

  if (normalized.includes("hip hop") || normalized.includes("rap")) {
    tags.add("hip hop");
  }

  if (normalized.includes("r&b") || normalized.includes("rb")) {
    tags.add("r&b");
  }

  if (normalized.includes("rock")) {
    tags.add("rock");
  }

  if (tags.size === 0) {
    tags.add("live music");
  }

  return [...tags];
}

function buildTasteReasons(listing: WarehouseLiveMidtownParsedListing): string[] {
  const reasons: string[] = [];

  if (listing.supportActs) {
    reasons.push(`support acts: ${listing.supportActs}`);
  }

  if (listing.genre) {
    reasons.push(`genre: ${listing.genre}`);
  }

  if (listing.price) {
    reasons.push(`price: ${listing.price}`);
  }

  if (listing.doorsTime || listing.showTime) {
    const pieces = [listing.doorsTime ? `doors ${listing.doorsTime}` : null, listing.showTime ? `show ${listing.showTime}` : null]
      .filter(Boolean)
      .join(" · ");

    if (pieces) {
      reasons.push(`time from source: ${pieces}`);
    }
  }

  return reasons;
}

function mapListingToEvent(listing: WarehouseLiveMidtownParsedListing): EventItem {
  const dateISO = parseDateLabel(listing.dateLabel);

  if (!dateISO) {
    throw new Error(`Unable to parse Warehouse Live Midtown date label: ${listing.dateLabel}`);
  }

  const timeLabel = [
    listing.doorsTime ? `Doors ${listing.doorsTime}` : null,
    listing.showTime ? `Show ${listing.showTime}` : null,
  ].filter(Boolean).join(" · ");
  const scoredEvent = scoreEvent({
    id: `warehouse-live-midtown-${listing.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${dateISO}`,
    title: listing.title,
    dateTime: `${dateISO}T${convertTimeTo24Hour(listing.showTime || listing.doorsTime)}-05:00`,
    venue: WAREHOUSE_LIVE_MIDTOWN_SOURCE_NAME,
    city: "Houston",
    category: "Concert",
    sectionCategory: "concert",
    genreTags: inferGenreTags(listing),
    sourceLinks: [
      {
        label: "Event page",
        url: listing.eventUrl,
      },
      {
        label: "Source page",
        url: WAREHOUSE_LIVE_MIDTOWN_SOURCE_URL,
      },
    ],
    eventUrl: listing.eventUrl,
    eventUrlLabel: "Event page",
    supportActs: listing.supportActs,
    subtitle: listing.subtitle,
    rawGenre: listing.genre,
    price: listing.price,
    metadataConfidence: [listing.supportActs, listing.subtitle, listing.genre, listing.price, listing.doorsTime, listing.showTime].filter(Boolean).length,
    isGreatLiveAct: false,
    liveReputationStatus: "unknown",
    liveReputationConfidence: 0,
    liveReputationReasons: [],
    liveReputationSources: [],
    venueFitScore: 16,
    knownLiveReputationScore: 9,
    rarityScore: 7,
    distanceRelevanceScore: 10,
    feedbackHistoryPlaceholderScore: 6,
  });

  return {
    ...scoredEvent,
    sourceLabel: WAREHOUSE_LIVE_MIDTOWN_SOURCE_NAME,
    timeLabel,
    tasteReasons: [...scoredEvent.tasteReasons, ...buildTasteReasons(listing)],
  };
}

function parseWarehouseLiveMidtownListings(html: string): WarehouseLiveMidtownParsedListing[] {
  const eventPattern = /<div class="event-info-block">[\s\S]*?<p class="fs-18 bold mb-12 event-title"><a href="([^"]+)"[^>]*>([\s\S]*?)<\/a><\/p><p class="fs-18 bold mt-1r event-date">([^<]+)<\/p><p class="fs-12 headliners">([\s\S]*?)<\/p><p class="fs-12 supporting-talent">([\s\S]*?)<\/p><p class="fs-12 subtitle">([\s\S]*?)<\/p><p class="fs-12 doortime-showtime">Doors:\s*<span[^>]*>([^<]+)<\/span><span[^>]*>\s*\/\s*<\/span>Show:\s*<span[^>]*>([^<]+)<\/span><\/p><p class="fs-12 venue">at ([^<]+)<\/p><p class="fs-12"><span class="price">([^<]+)<\/span><\/p><p class="fs-12 genre">([\s\S]*?)<\/p>[\s\S]*?<a href=['"]([^'"]+)['"][^>]*class=['"][^'"]*seetickets-buy-btn[^'"]*['"][^>]*>([\s\S]*?)<\/a>/g;

  return [...html.matchAll(eventPattern)].map((match) => {
    const title = stripTags(match[2]);
    const headliners = stripTags(match[4]);
    const supportingTalent = stripTags(match[5]);
    const subtitle = stripTags(match[6]);
    const supportActs = [headliners, supportingTalent, subtitle]
      .map((value) => value.trim())
      .filter(Boolean)
      .filter((value, index, array) => array.indexOf(value) === index)
      .filter((value) => value.toLowerCase() !== title.toLowerCase())
      .join(", ");

    return {
      title,
      supportActs: supportActs || undefined,
      subtitle: subtitle || undefined,
      dateLabel: normalizeWhitespace(match[3]),
      doorsTime: normalizeWhitespace(match[7]),
      showTime: normalizeWhitespace(match[8]),
      genre: stripTags(match[11]),
      price: stripTags(match[10]),
      eventUrl: match[12],
    };
  });
}

function dedupeListings(listings: WarehouseLiveMidtownParsedListing[]): WarehouseLiveMidtownParsedListing[] {
  const seen = new Set<string>();

  return listings.filter((listing) => {
    const dateISO = parseDateLabel(listing.dateLabel);
    const key = `${listing.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}|${dateISO ?? listing.dateLabel}|${listing.showTime ?? ""}`;

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

function buildSummary(debug: WarehouseLiveMidtownSourceDebug): string {
  if (!debug.fetchSucceeded) {
    return "Warehouse Live Midtown source could not be loaded.";
  }

  if (!debug.todayCoverageVerified) {
    return "Warehouse Live Midtown source loaded, but today-specific coverage could not be verified.";
  }

  if (debug.parsedValidEvents === 0) {
    return `Warehouse Live Midtown source loaded, but parser found 0 valid events. Raw candidates: ${debug.rawEventCandidates}, cleaned lines: ${debug.cleanedLineCount}, warnings: ${debug.warnings.join("; ") || "none"}.`;
  }

  if (debug.todayHadEvents) {
    return `Warehouse Live Midtown loaded from official homepage: ${debug.parsedValidEvents} events parsed, including ${debug.todayEventCount} today.`;
  }

  return `Warehouse Live Midtown loaded from official homepage: ${debug.parsedValidEvents} events parsed, earliest ${debug.earliestEventDate ?? "unknown"}. No events found for today.`;
}

export async function fetchWarehouseLiveMidtownSource(): Promise<WarehouseLiveMidtownSourceResult> {
  const urlsChecked = [WAREHOUSE_LIVE_MIDTOWN_SOURCE_URL];
  const debug: WarehouseLiveMidtownSourceDebug = {
    urlsChecked,
    fetchSucceeded: false,
    homepageReached: false,
    upcomingEventsSectionFound: false,
    cleanedLineCount: 0,
    rawEventCandidates: 0,
    parsedBeforeDedupe: 0,
    parsedValidEvents: 0,
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
    const response = (await cachedFetch(WAREHOUSE_LIVE_MIDTOWN_SOURCE_URL, {
      headers: {
        "user-agent": WAREHOUSE_LIVE_MIDTOWN_USER_AGENT,
        accept: "text/html,application/xhtml+xml",
      },
      category: "music",
      refreshPolicy: "daily",
      cacheKey: WAREHOUSE_LIVE_MIDTOWN_SOURCE_URL,
    })) as CacheAwareResponse;

    debug.fetchSucceeded = response.ok;
    debug.responseStatus = response.status;
    debug.cacheStatus = response.mode;

    const html = await response.text();
    debug.homepageReached = response.ok && html.includes("Warehouse Live Midtown");
    debug.upcomingEventsSectionFound = /Upcoming Events/i.test(html);

    const visibleText = extractVisibleText(html);
    const cleanedLines = visibleText
      .split("\n")
      .map((line) => normalizeWhitespace(line))
      .filter(Boolean);

    debug.cleanedLineCount = cleanedLines.length;

    const listings = parseWarehouseLiveMidtownListings(html);
    debug.rawEventCandidates = listings.length;
    debug.parsedBeforeDedupe = listings.length;

    const dedupedListings = dedupeListings(listings);
    debug.duplicateRowsRemoved = listings.length - dedupedListings.length;

    const scoredEvents = dedupedListings
      .map(mapListingToEvent)
      .filter((event) => Boolean(event.dateTime));

    debug.parsedValidEvents = scoredEvents.length;
    debug.concertRowsParsed = scoredEvents.length;
    debug.otherRowsParsed = 0;

    const today = getHoustonTodayDate();
    const upcomingEnd = addDays(today, EVENT_DISPLAY_WINDOW_DAYS);
    const inWindowEvents = scoredEvents.filter((event) => {
      const eventDate = event.dateTime.slice(0, 10);
      return eventDate >= today && eventDate <= upcomingEnd;
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

    if (!debug.upcomingEventsSectionFound) {
      debug.warnings.push("Upcoming Events heading not found in homepage HTML.");
    }

    if (debug.duplicateRowsRemoved > 0) {
      debug.warnings.push(`Deduped ${debug.duplicateRowsRemoved} duplicate listing(s).`);
    }

    if (debug.visibleUpcomingShowsCount === 0 && debug.lowPriorityUpcomingShowsCount === 0) {
      debug.warnings.push("No in-window upcoming events remained after taste filtering.");
    }

    const status: WarehouseLiveMidtownSourceResult["status"] =
      debug.parsedValidEvents > 0 ? "success" : debug.fetchSucceeded ? "unavailable" : "failed";

    return {
      events: scoredEvents,
      sourceName: WAREHOUSE_LIVE_MIDTOWN_SOURCE_NAME,
      sourceUrl: WAREHOUSE_LIVE_MIDTOWN_SOURCE_URL,
      status,
      message: buildSummary(debug),
      debug,
    };
  } catch (error) {
    debug.warnings.push(error instanceof Error ? error.message : "Warehouse Live Midtown fetch failed.");

    return {
      events: [],
      sourceName: WAREHOUSE_LIVE_MIDTOWN_SOURCE_NAME,
      sourceUrl: WAREHOUSE_LIVE_MIDTOWN_SOURCE_URL,
      status: "failed",
      message: "Warehouse Live Midtown source could not be loaded.",
      debug,
    };
  }
}
