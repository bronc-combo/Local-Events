import { scoreEvent, type EventSeed } from "@/lib/event-scoring";
import { EVENT_DISPLAY_WINDOW_DAYS } from "@/lib/event-window";
import { cachedFetch } from "@/lib/source-cache";
import type { EventItem } from "@/types/dashboard";

export const HOUSE_OF_BLUES_HOUSTON_SOURCE_NAME = "House of Blues Houston";
export const HOUSE_OF_BLUES_HOUSTON_SOURCE_URL = "https://houston.houseofblues.com/";
export const HOUSE_OF_BLUES_HOUSTON_SHOWS_URL = "https://houston.houseofblues.com/shows";
const HOUSE_OF_BLUES_HOUSTON_USER_AGENT = "DailyOverviewBot/1.0 (+https://localhost)";
const HOUSTON_TIME_ZONE = "America/Chicago";

export interface HouseOfBluesHoustonSourceDebug {
  urlsChecked: string[];
  fetchSucceeded: boolean;
  responseStatuses: Record<string, number>;
  cacheStatus?: "live" | "cached" | "cached_fallback" | "failed";
  fetchedTextLength: number;
  homepageReached: boolean;
  showsPageReached: boolean;
  eventListFound: boolean;
  cleanedLineCount: number;
  rawEventCandidates: number;
  parsedBeforeDedupe: number;
  parsedValidEvents: number;
  duplicateRowsRemoved: number;
  skippedRows: number;
  skippedReasons: string[];
  hiddenPastShows: number;
  displayedInWindowShows: number;
  visibleUpcomingShowsCount: number;
  lowPriorityUpcomingShowsCount: number;
  fallbackPromotedShowsCount: number;
  visibleUpcomingTitles: string[];
  concertRowsParsed: number;
  otherRowsParsed: number;
  todayChecked: boolean;
  todayEventCount: number;
  todayHadEvents: boolean;
  todayCoverageVerified: boolean;
  earliestEventDate?: string;
  latestEventDate?: string;
  roomFoundCount: number;
  titleDateTimeOnlyCount: number;
  enrichedMetadataRows: number;
  warnings: string[];
}

export interface HouseOfBluesHoustonSourceResult {
  events: EventItem[];
  sourceName: string;
  sourceUrl: string;
  status: "success" | "limited" | "failed";
  message: string;
  debug: HouseOfBluesHoustonSourceDebug;
}

interface CacheAwareResponse {
  ok: boolean;
  status: number;
  mode?: "live" | "cached" | "cached_fallback" | "failed";
  text(): Promise<string>;
}

interface ParsedShowListing {
  title: string;
  dateTime: string;
  startTimeKey: string;
  room?: string;
  ticketUrl?: string;
  metadataConfidence: number;
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

function extractVisibleText(html: string): string[] {
  return decodeHtmlEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<\/(p|div|li|section|article|h1|h2|h3|h4|h5|h6|a|time|span)>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function extractAnchors(html: string, pageUrl: string): Array<{ text: string; url: string }> {
  const anchors = html.match(/<a [^>]*href="[^"]+"[^>]*>[\s\S]*?<\/a>/g) ?? [];

  return anchors
    .map((anchor) => {
      const hrefMatch = anchor.match(/href="([^"]+)"/);
      const text = normalizeWhitespace(stripTags(anchor));

      if (!hrefMatch || !text) {
        return null;
      }

      const href = hrefMatch[1];
      const url = href.startsWith("http")
        ? href
        : new URL(href, pageUrl).toString();

      return { text, url };
    })
    .filter((value): value is { text: string; url: string } => value !== null);
}

function normalizeComparableText(value: string): string {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getHoustonTodayDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: HOUSTON_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function addDays(baseDate: string, days: number): string {
  const base = new Date(`${baseDate}T12:00:00-05:00`);
  base.setDate(base.getDate() + days);

  return new Intl.DateTimeFormat("en-CA", {
    timeZone: HOUSTON_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(base);
}

function parseMonthNumber(monthText: string): number | null {
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

  return months[monthText.toLowerCase()] ?? null;
}

function inferDate(dateText: string): string | null {
  const match = dateText.match(/^[A-Za-z]{3}\s+([A-Za-z]{3})\s+(\d{1,2}),\s+(\d{4})$/);

  if (!match) {
    return null;
  }

  const month = parseMonthNumber(match[1]);
  const day = Number(match[2]);
  const year = Number(match[3]);

  if (!month || Number.isNaN(day) || Number.isNaN(year)) {
    return null;
  }

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

function isGenericLine(line: string): boolean {
  const normalized = normalizeComparableText(line);

  return [
    "skip to content",
    "shows",
    "all rooms",
    "music hall",
    "the bronze peacock",
    "foundation room",
    "upgrades",
    "membership",
    "nightlife",
    "lounge menu",
    "private events",
    "browse",
    "get in touch",
    "featured shows",
    "house of blues houston",
    "house of blues houston logo",
    "view shows",
    "enter",
    "filter",
    "loading",
    "more info",
    "buy tickets",
  ].some((value) => normalized === value);
}

function isDateLine(line: string): boolean {
  return /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat)\s+[A-Z][a-z]{2}\s+\d{1,2},\s+\d{4}$/i.test(line);
}

function isTimeLine(line: string): boolean {
  return /^\d{1,2}:\d{2}\s*[AP]M(?:\s*\|\s*.+)?$/i.test(line);
}

function getEventTitle(lines: string[], dateIndex: number): string | null {
  for (let index = dateIndex - 1; index >= Math.max(0, dateIndex - 4); index -= 1) {
    const candidate = lines[index];

    if (!candidate || isGenericLine(candidate) || isDateLine(candidate) || isTimeLine(candidate)) {
      continue;
    }

    if (/[A-Za-z]{3,}/.test(candidate)) {
      return candidate;
    }
  }

  return null;
}

function getEventTimeAndRoom(lines: string[], dateIndex: number): { time?: string; room?: string } {
  for (let index = dateIndex + 1; index < Math.min(lines.length, dateIndex + 8); index += 1) {
    const candidate = lines[index];

    if (isDateLine(candidate)) {
      break;
    }

    if (!isTimeLine(candidate)) {
      continue;
    }

    const [timePart, roomPart] = candidate.split("|").map((part) => normalizeWhitespace(part));
    return {
      time: timePart,
      room: roomPart || undefined,
    };
  }

  return {};
}

function discoverHouseOfBluesUrls(homepageHtml: string): string[] {
  const urls = new Set<string>([HOUSE_OF_BLUES_HOUSTON_SOURCE_URL, HOUSE_OF_BLUES_HOUSTON_SHOWS_URL]);
  const anchors = extractAnchors(homepageHtml, HOUSE_OF_BLUES_HOUSTON_SOURCE_URL);

  for (const anchor of anchors) {
    if (!anchor.url.includes("houseofblues.com")) {
      continue;
    }

    if (
      /shows|calendar|event|upcoming/i.test(anchor.url) ||
      /shows|calendar|event/i.test(anchor.text)
    ) {
      urls.add(anchor.url);
    }
  }

  return [...urls];
}

function inferGenreTags(title: string, room?: string): string[] {
  const normalized = `${title} ${room ?? ""}`.toLowerCase();
  const tags = new Set<string>();

  if (/post[-\s]?hardcore/.test(normalized)) {
    tags.add("post-hardcore");
    tags.add("hardcore");
  }

  if (/hardcore|punk/.test(normalized)) {
    tags.add("punk");
    tags.add("hardcore");
  }

  if (/metal|doom|sludge|death|black/.test(normalized)) {
    tags.add("metal");
  }

  if (/industrial/.test(normalized)) {
    tags.add("industrial");
  }

  if (/hip hop|rap/.test(normalized)) {
    tags.add("left-field hip-hop");
  }

  if (/dj|dance|electronic/.test(normalized)) {
    tags.add("electronic");
    tags.add("dance");
  }

  if (tags.size === 0) {
    tags.add("live music");
  }

  return [...tags];
}

function buildTasteReasons(title: string, room?: string): string[] {
  const reasons: string[] = [];
  const normalized = title.toLowerCase();

  if (/metal|hardcore|punk/.test(normalized)) {
    reasons.push("title/genre match");
  }

  if (/hip hop|rap/.test(normalized)) {
    reasons.push("left-field hip-hop match");
  }

  if (room) {
    reasons.push(`room: ${room}`);
  }

  return reasons;
}

function parseHouseOfBluesShows(
  html: string,
  pageUrl: string,
): {
  listings: ParsedShowListing[];
  eventListFound: boolean;
  cleanedLineCount: number;
  rawEventCandidates: number;
  skippedRows: number;
  skippedReasons: string[];
  roomFoundCount: number;
  titleDateTimeOnlyCount: number;
  enrichedMetadataRows: number;
} {
  const lines = extractVisibleText(html);
  const startIndex = lines.findIndex((line) =>
    normalizeComparableText(line) === "featured shows" || normalizeComparableText(line) === "shows",
  );
  const eventLines = startIndex >= 0 ? lines.slice(startIndex) : lines;
  const anchors = extractAnchors(html, pageUrl);
  const ticketLinksByTitle = new Map(
    anchors
      .filter((anchor) => anchor.url.includes("ticketmaster.com"))
      .map((anchor) => [normalizeComparableText(anchor.text), anchor.url]),
  );
  const dateIndices = eventLines
    .map((line, index) => (isDateLine(line) ? index : -1))
    .filter((index) => index >= 0);

  const listings: ParsedShowListing[] = [];
  const skippedReasons: string[] = [];
  let roomFoundCount = 0;
  let titleDateTimeOnlyCount = 0;
  let enrichedMetadataRows = 0;

  for (const dateIndex of dateIndices) {
    const title = getEventTitle(eventLines, dateIndex);

    if (!title) {
      skippedReasons.push("Missing title before date row.");
      continue;
    }

    const dateText = inferDate(eventLines[dateIndex]);
    const timeInfo = getEventTimeAndRoom(eventLines, dateIndex);

    if (!dateText) {
      skippedReasons.push(`Unparseable date row for ${title}.`);
      continue;
    }

    const dateTime = `${dateText}T${convertTimeTo24Hour(timeInfo.time)}-05:00`;
    const ticketUrl = ticketLinksByTitle.get(normalizeComparableText(title));
    const metadataConfidence = [timeInfo.room].filter(Boolean).length;

    if (timeInfo.room) {
      roomFoundCount += 1;
    }

    if (metadataConfidence === 0) {
      titleDateTimeOnlyCount += 1;
    } else {
      enrichedMetadataRows += 1;
    }

    listings.push({
      title,
      dateTime,
      startTimeKey: convertTimeTo24Hour(timeInfo.time).slice(0, 5),
      room: timeInfo.room,
      ticketUrl,
      metadataConfidence,
    });
  }

  const rawEventCandidates = dateIndices.length;

  return {
    listings,
    eventListFound: eventLines.some((line) => normalizeComparableText(line) === "featured shows"),
    cleanedLineCount: eventLines.length,
    rawEventCandidates,
    skippedRows: skippedReasons.length,
    skippedReasons,
    roomFoundCount,
    titleDateTimeOnlyCount,
    enrichedMetadataRows,
  };
}

function dedupeListings(listings: ParsedShowListing[]): {
  deduped: ParsedShowListing[];
  duplicateRowsRemoved: number;
} {
  const byKey = new Map<string, ParsedShowListing>();

  for (const listing of listings) {
    const key = [
      listing.title.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      listing.dateTime.slice(0, 10),
      listing.startTimeKey,
      listing.room ?? "",
    ].join("|");

    if (!byKey.has(key)) {
      byKey.set(key, listing);
    }
  }

  return {
    deduped: [...byKey.values()],
    duplicateRowsRemoved: listings.length - byKey.size,
  };
}

function mapListingToEvent(listing: ParsedShowListing): EventItem {
  const seed: EventSeed = {
    id: `house-of-blues-houston-${listing.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${listing.dateTime.slice(0, 10)}-${listing.startTimeKey}`,
    title: listing.title,
    dateTime: listing.dateTime,
    venue: HOUSE_OF_BLUES_HOUSTON_SOURCE_NAME,
    city: "Houston",
    category: "Concert",
    sectionCategory: "concert",
    genreTags: inferGenreTags(listing.title, listing.room),
    sourceLinks: [
      {
        label: "Source page",
        url: HOUSE_OF_BLUES_HOUSTON_SOURCE_URL,
      },
      {
        label: "Shows page",
        url: HOUSE_OF_BLUES_HOUSTON_SHOWS_URL,
      },
      ...(listing.ticketUrl
        ? [
            {
              label: "Buy Tickets",
              url: listing.ticketUrl,
            },
          ]
        : []),
    ],
    eventUrl: HOUSE_OF_BLUES_HOUSTON_SOURCE_URL,
    eventUrlLabel: "Source page",
    room: listing.room,
    metadataConfidence: listing.metadataConfidence,
    isGreatLiveAct: false,
    liveReputationStatus: "unknown",
    liveReputationConfidence: 0,
    liveReputationReasons: [],
    liveReputationSources: [],
    venueFitScore: 0,
    knownLiveReputationScore: 0,
    rarityScore: 6,
    distanceRelevanceScore: 0,
    feedbackHistoryPlaceholderScore: 4,
  };

  const scoredEvent = scoreEvent(seed);
  const extraReasons = buildTasteReasons(listing.title, listing.room);

  return {
    ...scoredEvent,
    sourceLabel: HOUSE_OF_BLUES_HOUSTON_SOURCE_NAME,
    tasteReasons: [...scoredEvent.tasteReasons, ...extraReasons].filter(
      (reason, index, reasons) => reasons.indexOf(reason) === index,
    ),
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

function buildSummary(debug: HouseOfBluesHoustonSourceDebug): string {
  if (!debug.fetchSucceeded) {
    return "House of Blues Houston source could not be loaded.";
  }

  if (!debug.eventListFound) {
    return "House of Blues Houston source loaded, but no server-visible featured shows were found.";
  }

  if (debug.parsedValidEvents === 0) {
    return `House of Blues Houston source loaded, but parser found 0 valid events. Raw candidates: ${debug.rawEventCandidates}, skipped: ${debug.skippedRows}.`;
  }

  if (debug.todayHadEvents) {
    return `House of Blues Houston loaded from official homepage: ${debug.parsedValidEvents} events parsed, including ${debug.todayEventCount} today.`;
  }

  return `House of Blues Houston loaded from official homepage: ${debug.parsedValidEvents} events parsed, earliest ${debug.earliestEventDate ?? "unknown"}. No events found for today.`;
}

async function fetchHtml(url: string): Promise<{ ok: boolean; status?: number; mode?: HouseOfBluesHoustonSourceDebug["cacheStatus"]; html?: string }> {
  const response = (await cachedFetch(url, {
    headers: {
      "user-agent": HOUSE_OF_BLUES_HOUSTON_USER_AGENT,
      accept: "text/html,application/xhtml+xml",
    },
    category: "music",
    refreshPolicy: "daily",
    cacheKey: url,
  })) as CacheAwareResponse;

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      mode: response.mode,
    };
  }

  return {
    ok: true,
    status: response.status,
    mode: response.mode,
    html: await response.text(),
  };
}

export async function fetchHouseOfBluesHoustonSource(): Promise<HouseOfBluesHoustonSourceResult> {
  const urlsChecked = discoverHouseOfBluesUrls("");
  const debug: HouseOfBluesHoustonSourceDebug = {
    urlsChecked,
    fetchSucceeded: false,
    responseStatuses: {},
    fetchedTextLength: 0,
    homepageReached: false,
    showsPageReached: false,
    eventListFound: false,
    cleanedLineCount: 0,
    rawEventCandidates: 0,
    parsedBeforeDedupe: 0,
    parsedValidEvents: 0,
    duplicateRowsRemoved: 0,
    skippedRows: 0,
    skippedReasons: [],
    hiddenPastShows: 0,
    displayedInWindowShows: 0,
    visibleUpcomingShowsCount: 0,
    lowPriorityUpcomingShowsCount: 0,
    fallbackPromotedShowsCount: 0,
    visibleUpcomingTitles: [],
    concertRowsParsed: 0,
    otherRowsParsed: 0,
    todayChecked: true,
    todayEventCount: 0,
    todayHadEvents: false,
    todayCoverageVerified: false,
    roomFoundCount: 0,
    titleDateTimeOnlyCount: 0,
    enrichedMetadataRows: 0,
    warnings: [],
  };

  try {
    const homepageResponse = await fetchHtml(HOUSE_OF_BLUES_HOUSTON_SOURCE_URL);

    if (!homepageResponse.ok || homepageResponse.html === undefined) {
      throw new Error(
        `House of Blues Houston request failed with ${homepageResponse.status ?? "unknown status"}.`,
      );
    }

    const homepageHtml = homepageResponse.html;
    const discoveredUrls = discoverHouseOfBluesUrls(homepageHtml);
    const fetchableUrls = discoveredUrls.filter((url) => url !== HOUSE_OF_BLUES_HOUSTON_SOURCE_URL).slice(0, 2);
    const checkedUrls = [HOUSE_OF_BLUES_HOUSTON_SOURCE_URL];
    let fetchedTextLength = homepageHtml.length;
    const homepageReached = homepageHtml.includes("House of Blues Houston");
    let showsPageReached = false;
    let eventListFound = homepageHtml.includes("Featured Shows");
    let rawEventCandidates = 0;
    let parsedBeforeDedupe = 0;
    let skippedRows = 0;
    const skippedReasons: string[] = [];
    let roomFoundCount = 0;
    let titleDateTimeOnlyCount = 0;
    let enrichedMetadataRows = 0;
    const listings: ParsedShowListing[] = [];

    const homepageParse = parseHouseOfBluesShows(homepageHtml, HOUSE_OF_BLUES_HOUSTON_SOURCE_URL);
    rawEventCandidates += homepageParse.rawEventCandidates;
    parsedBeforeDedupe += homepageParse.listings.length;
    skippedRows += homepageParse.skippedRows;
    skippedReasons.push(...homepageParse.skippedReasons);
    roomFoundCount += homepageParse.roomFoundCount;
    titleDateTimeOnlyCount += homepageParse.titleDateTimeOnlyCount;
    enrichedMetadataRows += homepageParse.enrichedMetadataRows;
    listings.push(...homepageParse.listings);

    for (const url of fetchableUrls) {
      checkedUrls.push(url);
      const response = await fetchHtml(url);

      if (!response.ok || response.html === undefined) {
        skippedReasons.push(`${url} returned ${response.status ?? "unknown error"}.`);
        continue;
      }

      fetchedTextLength += response.html.length;
      showsPageReached = showsPageReached || url === HOUSE_OF_BLUES_HOUSTON_SHOWS_URL ? response.html.includes("House of Blues Houston") : response.html.includes("House of Blues Houston");
      eventListFound = eventListFound || response.html.includes("Featured Shows") || response.html.includes("Buy Tickets");

      const pageParse = parseHouseOfBluesShows(response.html, url);
      rawEventCandidates += pageParse.rawEventCandidates;
      parsedBeforeDedupe += pageParse.listings.length;
      skippedRows += pageParse.skippedRows;
      skippedReasons.push(...pageParse.skippedReasons);
      roomFoundCount += pageParse.roomFoundCount;
      titleDateTimeOnlyCount += pageParse.titleDateTimeOnlyCount;
      enrichedMetadataRows += pageParse.enrichedMetadataRows;
      listings.push(...pageParse.listings);
    }

    const deduped = dedupeListings(listings);
    const events = deduped.deduped.map(mapListingToEvent);
    const today = getHoustonTodayDate();
    const upcomingEnd = addDays(today, EVENT_DISPLAY_WINDOW_DAYS);
    const todayEvents = events.filter((event) => event.dateTime.slice(0, 10) === today);
    const visibleUpcomingEvents = events.filter((event) => {
      const eventDate = event.dateTime.slice(0, 10);
      return eventDate > today && eventDate <= upcomingEnd;
    });
    const visibleUpcoming = visibleUpcomingEvents.filter((event) => !event.hiddenReason);
    const lowPriorityUpcoming = visibleUpcomingEvents.filter((event) => Boolean(event.hiddenReason));
    const fallbackPromoted = visibleUpcoming.length === 0
      ? lowPriorityUpcoming.filter((event) => !event.musicTasteOverrideSuppressed).slice(0, 3)
      : [];
    const renderedVisibleUpcoming = visibleUpcoming.length > 0 ? visibleUpcoming : fallbackPromoted;
    const renderedLowPriorityUpcoming = visibleUpcoming.length > 0
      ? lowPriorityUpcoming.filter((event) => !fallbackPromoted.some((promoted) => promoted.id === event.id))
      : lowPriorityUpcoming.slice(fallbackPromoted.length);
    const dates = summarizeDates(events);
    const hiddenPast = events.filter((event) => event.dateTime.slice(0, 10) < today).length;
    const displayedInWindow = events.filter((event) => {
      const eventDate = event.dateTime.slice(0, 10);
      return eventDate >= today && eventDate <= upcomingEnd;
    }).length;

    debug.fetchSucceeded = true;
    debug.responseStatuses = {
      homepage: homepageResponse.status ?? 200,
    };
    if (fetchableUrls.length > 0) {
      for (const url of fetchableUrls) {
        debug.responseStatuses[url] = 200;
      }
    }
    debug.cacheStatus = homepageResponse.mode;
    debug.fetchedTextLength = fetchedTextLength;
    debug.homepageReached = homepageReached;
    debug.showsPageReached = showsPageReached;
    debug.eventListFound = eventListFound;
    debug.cleanedLineCount = homepageParse.cleanedLineCount;
    debug.rawEventCandidates = rawEventCandidates;
    debug.parsedBeforeDedupe = parsedBeforeDedupe;
    debug.parsedValidEvents = events.length;
    debug.duplicateRowsRemoved = deduped.duplicateRowsRemoved;
    debug.skippedRows = skippedRows;
    debug.skippedReasons = skippedReasons;
    debug.hiddenPastShows = hiddenPast;
    debug.displayedInWindowShows = displayedInWindow;
    debug.visibleUpcomingShowsCount = renderedVisibleUpcoming.length;
    debug.lowPriorityUpcomingShowsCount = renderedLowPriorityUpcoming.length;
    debug.fallbackPromotedShowsCount = fallbackPromoted.length;
    debug.visibleUpcomingTitles = renderedVisibleUpcoming.slice(0, 6).map((event) => event.title);
    debug.concertRowsParsed = events.length;
    debug.otherRowsParsed = 0;
    debug.todayEventCount = todayEvents.length;
    debug.todayHadEvents = todayEvents.length > 0;
    debug.todayCoverageVerified = true;
    debug.earliestEventDate = dates.earliestEventDate;
    debug.latestEventDate = dates.latestEventDate;
    debug.roomFoundCount = roomFoundCount;
    debug.titleDateTimeOnlyCount = titleDateTimeOnlyCount;
    debug.enrichedMetadataRows = enrichedMetadataRows;
    debug.warnings = [];

    if (events.length === 0) {
      debug.warnings.push("Source loaded but no parseable event dates found.");
    }

    const status = events.length > 0 ? "success" : "limited";

    return {
      events,
      sourceName: HOUSE_OF_BLUES_HOUSTON_SOURCE_NAME,
      sourceUrl: HOUSE_OF_BLUES_HOUSTON_SOURCE_URL,
      status,
      message: buildSummary(debug),
      debug,
    };
  } catch (error) {
    debug.warnings = [
      error instanceof Error
        ? error.message
        : "House of Blues Houston source failed to load.",
    ];

    return {
      events: [],
      sourceName: HOUSE_OF_BLUES_HOUSTON_SOURCE_NAME,
      sourceUrl: HOUSE_OF_BLUES_HOUSTON_SOURCE_URL,
      status: "failed",
      message:
        error instanceof Error
          ? error.message
          : "House of Blues Houston source failed to load.",
      debug,
    };
  }
}
