import { scoreEvent, type EventSeed } from "@/lib/event-scoring";
import { EVENT_DISPLAY_WINDOW_DAYS } from "@/lib/event-window";
import { cachedFetch, installSourceCache } from "@/lib/source-cache";
import type { EventItem } from "@/types/dashboard";

export const NUMBERS_SOURCE_NAME = "Numbers Nightclub";
export const NUMBERS_SOURCE_URL = "https://numbersnightclub.com/";
export const NUMBERS_EVENTS_URL = "https://numbersnightclub.com/events/";
const NUMBERS_EVENTS_MONTH_URL = "https://numbersnightclub.com/events/month/";
const NUMBERS_USER_AGENT = "DailyOverviewBot/1.0 (+https://localhost)";
const HOUSTON_TIME_ZONE = "America/Chicago";

export interface NumbersSourceDebug {
  urlsChecked: string[];
  fetchSucceeded: boolean;
  responseStatuses: Record<string, number>;
  cacheStatus?: "live" | "cached" | "cached_fallback" | "failed";
  fetchedTextLength: number;
  eventsPageReached: boolean;
  monthPageReached: boolean;
  eventsListFound: boolean;
  monthViewFound: boolean;
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
  visibleUpcomingTitles: string[];
  lowPriorityUpcomingTitles: string[];
  todayChecked: boolean;
  todayEventCount: number;
  todayHadEvents: boolean;
  todayCoverageVerified: boolean;
  earliestEventDate?: string;
  latestEventDate?: string;
  warnings: string[];
}

export interface NumbersSourceResult {
  events: EventItem[];
  sourceName: string;
  sourceUrl: string;
  status: "success" | "unavailable" | "failed";
  message: string;
  debug: NumbersSourceDebug;
}

interface CacheAwareResponse {
  ok: boolean;
  status: number;
  mode?: "live" | "cached" | "cached_fallback" | "failed";
  text(): Promise<string>;
}

interface NumbersParsedListing {
  title: string;
  dateTime: string;
  timeLabel?: string;
  eventUrl: string;
  description?: string;
  metadataConfidence: number;
}

interface NumbersStructuredEventNode {
  "@id"?: string;
  "@type"?: string | string[];
  name?: string;
  description?: string;
  url?: string;
  startDate?: string;
  endDate?: string;
  location?:
  | {
    name?: string;
    description?: string;
    url?: string;
    address?: {
      streetAddress?: string;
      addressLocality?: string;
      addressRegion?: string;
      postalCode?: string;
      addressCountry?: string;
    };
  }
  | string;
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
  return normalizeWhitespace(decodeHtmlEntities(value).replace(/<[^>]+>/g, " "));
}

function normalizeComparableText(value: string): string {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractVisibleLines(html: string): string[] {
  return decodeHtmlEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<\/(p|div|li|section|article|h1|h2|h3|h4|h5|h6|a|time|span|tr|td|th)>/gi, "\n")
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

function extractJsonLdBlocks(html: string): unknown[] {
  const scriptPattern = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
  const blocks: unknown[] = [];

  for (const match of html.matchAll(scriptPattern)) {
    const raw = match[1]?.trim();

    if (!raw) {
      continue;
    }

    try {
      blocks.push(JSON.parse(raw));
    } catch {
      continue;
    }
  }

  return blocks;
}

function collectEventNodes(value: unknown, results: NumbersStructuredEventNode[] = []): NumbersStructuredEventNode[] {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectEventNodes(item, results);
    }

    return results;
  }

  if (!value || typeof value !== "object") {
    return results;
  }

  const node = value as NumbersStructuredEventNode & Record<string, unknown>;
  const typeValue = node["@type"];

  if (typeof typeValue === "string" && typeValue.toLowerCase() === "event") {
    results.push(node);
  } else if (Array.isArray(typeValue) && typeValue.some((type) => typeof type === "string" && type.toLowerCase() === "event")) {
    results.push(node);
  }

  if ("@graph" in node) {
    const graph = (node as { "@graph"?: unknown })["@graph"];
    collectEventNodes(graph, results);
  }

  return results;
}

function extractStructuredEventNodes(html: string): NumbersStructuredEventNode[] {
  return extractJsonLdBlocks(html).flatMap((block) => collectEventNodes(block));
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

function inferYear(month: number, day: number): number {
  const today = new Date(`${getHoustonTodayDate()}T12:00:00-05:00`);
  let year = today.getFullYear();
  const candidate = new Date(year, month - 1, day, 12, 0, 0);

  if (candidate < today && month < today.getMonth() + 1) {
    year += 1;
  }

  return year;
}

function convertTimeTo24Hour(timeText?: string): string {
  if (!timeText) {
    return "12:00:00";
  }

  const match = timeText.match(/(\d{1,2}):(\d{2})\s*([AP]M)/i);

  if (!match) {
    return "12:00:00";
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

function formatTimeLabel(dateTime: string): string {
  const date = new Date(dateTime);

  if (Number.isNaN(date.getTime())) {
    return "Time not listed on source";
  }

  return new Intl.DateTimeFormat("en-US", {
    timeZone: HOUSTON_TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function isGenericLine(line: string): boolean {
  const normalized = normalizeComparableText(line);

  return [
    "skip to content",
    "home",
    "about",
    "numbers history",
    "concert history",
    "contact",
    "concerts and events",
    "numbers merch",
    "media",
    "numbers concert photos",
    "classic numbers prince celebration party",
    "show fliers",
    "customer pics",
    "bowie tribute pics",
    "videos",
    "venue and ticket info",
    "bookings",
    "press",
    "map and parking",
    "list",
    "month",
    "day",
    "today",
    "previous events",
    "next events",
    "subscribe to calendar",
    "google calendar",
    "icalendar",
    "outlook 365",
    "outlook live",
    "export ics file",
    "export outlook ics file",
    "this month",
    "events found",
    "events",
    "calendar of events",
    "select date",
    "select a date",
    "loading",
    "numbers nightclub",
    "numbers nightclub 300 westheimer houston tx united states",
  ].includes(normalized);
}

function isLikelyEventTitle(line: string): boolean {
  if (!line || line.length < 6) {
    return false;
  }

  if (isGenericLine(line)) {
    return false;
  }

  if (/^\d{1,2}:\d{2}\s*[AP]M$/i.test(line)) {
    return false;
  }

  if (/^[A-Za-z]+\s+\d{1,2}(?:,\s*\d{4})?(?:\s*@\s*\d{1,2}:\d{2}\s*[AP]M)?$/i.test(line)) {
    return false;
  }

  return /[A-Za-z]/.test(line);
}

function parseDateTimeLine(line: string): { date: string; timeLabel?: string } | null {
  const match = line.match(/^([A-Za-z]+)\s+(\d{1,2})(?:,\s*(\d{4}))?(?:\s*@\s*(\d{1,2}:\d{2}\s*[AP]M))?$/i);

  if (!match) {
    return null;
  }

  const month = parseMonthNumber(match[1]);
  const day = Number(match[2]);
  const explicitYear = match[3] ? Number(match[3]) : null;

  if (!month || Number.isNaN(day)) {
    return null;
  }

  const year = explicitYear ?? inferYear(month, day);
  const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

  return {
    date,
    timeLabel: match[4],
  };
}

function parseTimeOnlyLine(line: string): string | null {
  return /^\d{1,2}:\d{2}\s*[AP]M$/i.test(line) ? line.toUpperCase().replace(/\s+/g, " ") : null;
}

function findDateTime(lines: string[], index: number): { dateTime: string; timeLabel: string } | null {
  const offsets = [0, 1, 2, 3, 4, 5, -1, -2, -3, -4, -5];

  for (const offset of offsets) {
    const line = lines[index + offset];

    if (!line) {
      continue;
    }

    const direct = parseDateTimeLine(line);

    if (direct?.timeLabel) {
      return {
        dateTime: `${direct.date}T${convertTimeTo24Hour(direct.timeLabel)}-05:00`,
        timeLabel: direct.timeLabel,
      };
    }

    const dateOnly = direct?.date ?? (() => {
      const match = line.match(/^([A-Za-z]+)\s+(\d{1,2})(?:,\s*(\d{4}))?$/i);

      if (!match) {
        return null;
      }

      const month = parseMonthNumber(match[1]);
      const day = Number(match[2]);
      const explicitYear = match[3] ? Number(match[3]) : null;

      if (!month || Number.isNaN(day)) {
        return null;
      }

      const year = explicitYear ?? inferYear(month, day);

      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    })();

    if (dateOnly) {
      const prevTime = parseTimeOnlyLine(lines[index + offset - 1] ?? "");
      const nextTime = parseTimeOnlyLine(lines[index + offset + 1] ?? "");
      const timeLabel = prevTime ?? nextTime;

      return {
        dateTime: `${dateOnly}T${convertTimeTo24Hour(timeLabel ?? undefined)}-05:00`,
        timeLabel: timeLabel ?? "Time not listed on source",
      };
    }
  }

  return null;
}

function normalizeDateKey(dateTime: string): string {
  return dateTime.slice(0, 10);
}

function inferGenreTags(title: string, description?: string): string[] {
  const normalized = `${title} ${description ?? ""}`.toLowerCase();
  const tags = new Set<string>();

  if (/new wave/.test(normalized)) {
    tags.add("new wave");
  }

  if (/post[-\s]?hardcore/.test(normalized)) {
    tags.add("post-hardcore");
    tags.add("hardcore");
  }

  if (/hardcore|punk/.test(normalized)) {
    tags.add("punk");
    tags.add("hardcore");
  }

  if (/industrial/.test(normalized)) {
    tags.add("industrial");
  }

  if (/noise/.test(normalized)) {
    tags.add("noise rock");
  }

  if (/math/.test(normalized)) {
    tags.add("math rock");
  }

  if (/metal|doom|sludge|death|black/.test(normalized)) {
    tags.add("metal");
  }

  if (/dj|dance|electronic/.test(normalized)) {
    tags.add("electronic");
    tags.add("dance");
  }

  if (/goth/.test(normalized)) {
    tags.add("goth");
  }

  if (tags.size === 0) {
    tags.add("live music");
  }

  return [...tags];
}

function determineEventSubtype(title: string, description?: string): string | undefined {
  const normalized = `${title} ${description ?? ""}`.toLowerCase();

  if (normalized.includes("classic numbers")) {
    return "Classic Numbers";
  }

  if (normalized.includes("underworld")) {
    return "Monthly bash";
  }

  if (normalized.includes("party")) {
    return "Party";
  }

  if (normalized.includes("dj") || normalized.includes("dance")) {
    return "Dance night";
  }

  return "Live music";
}

function buildStableEventId(title: string, dateTime: string, eventUrl: string, fallbackIndex: number): string {
  const slug = normalizeComparableText(title).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const urlSlug = normalizeComparableText(eventUrl).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const dateSlug = dateTime.slice(0, 10);

  return `numbers-${slug || "event"}-${dateSlug}-${urlSlug.slice(0, 24) || String(fallbackIndex)}`;
}

function parseStructuredListings(html: string, pageUrl: string, debug: NumbersSourceDebug): NumbersParsedListing[] {
  const eventNodes = extractStructuredEventNodes(html);

  debug.rawEventCandidates += eventNodes.length;
  debug.eventsListFound = debug.eventsListFound || /events archive/i.test(html) || /events found/i.test(html);
  debug.monthViewFound = debug.monthViewFound || /view_slug":"month"/i.test(html) || /events\/month\//i.test(pageUrl);
  debug.eventsPageReached = debug.eventsPageReached || /numbers nightclub/i.test(html);

  const results: NumbersParsedListing[] = [];

  for (const node of eventNodes) {
    const title = normalizeWhitespace(node.name ?? "");
    const startDate = normalizeWhitespace(node.startDate ?? "");
    const eventUrl = normalizeWhitespace(node.url ?? pageUrl) || pageUrl;
    const description = normalizeWhitespace(stripTags(node.description ?? ""));

    if (!title) {
      debug.skippedRows += 1;
      debug.skippedReasons.push("missing title");
      continue;
    }

    if (!startDate) {
      debug.skippedRows += 1;
      debug.skippedReasons.push(`missing date: ${title}`);
      continue;
    }

    const parsedDate = new Date(startDate);

    if (Number.isNaN(parsedDate.getTime())) {
      debug.skippedRows += 1;
      debug.skippedReasons.push(`malformed date: ${title}`);
      continue;
    }

    const normalizedEventUrl = /^https?:\/\//i.test(eventUrl) ? eventUrl : pageUrl;

    results.push({
      title,
      dateTime: startDate,
      timeLabel: formatTimeLabel(startDate),
      eventUrl: normalizedEventUrl,
      description: description || undefined,
      metadataConfidence: description ? 1 : 0.9,
    });
  }

  return results;
}

function parseLegacyListings(html: string, pageUrl: string, debug: NumbersSourceDebug): NumbersParsedListing[] {
  const lines = extractVisibleLines(html);
  const anchors = extractAnchors(html, pageUrl);
  const titleAnchors = anchors.filter((anchor) => isLikelyEventTitle(anchor.text));
  const anchorMap = new Map<string, string>();

  for (const anchor of titleAnchors) {
    const key = normalizeComparableText(anchor.text);

    if (!anchorMap.has(key)) {
      anchorMap.set(key, anchor.url);
    }
  }

  debug.cleanedLineCount += lines.length;
  debug.rawEventCandidates += titleAnchors.length;
  debug.eventsPageReached = debug.eventsPageReached || /numbers nightclub/i.test(html);
  debug.eventsListFound = debug.eventsListFound || lines.some((line) => /events found/i.test(line)) || lines.some((line) => isLikelyEventTitle(line));
  debug.monthViewFound = debug.monthViewFound || /calendar of events/i.test(lines.join(" ")) || pageUrl.includes("/month/");

  const titleSet = new Set(titleAnchors.map((anchor) => normalizeComparableText(anchor.text)));
  const results: NumbersParsedListing[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const normalized = normalizeComparableText(line);

    if (!titleSet.has(normalized)) {
      continue;
    }

    const nearbyDateTime = findDateTime(lines, index);

    if (!nearbyDateTime) {
      debug.skippedRows += 1;
      debug.skippedReasons.push(`missing date or time: ${line}`);
      continue;
    }

    const titleUrl = getEventUrl(anchorMap, line);
    const description = buildDescription(lines, index, line);

    results.push({
      title: line,
      dateTime: nearbyDateTime.dateTime,
      eventUrl: titleUrl,
      description,
      metadataConfidence: description ? 0.9 : 0.8,
    });
  }

  return results;
}

function getEventUrl(anchorMap: Map<string, string>, title: string): string {
  return anchorMap.get(normalizeComparableText(title)) ?? NUMBERS_EVENTS_URL;
}

function buildDescription(lines: string[], index: number, title: string): string | undefined {
  const snippets: string[] = [];

  for (let offset = 1; offset <= 5; offset += 1) {
    const line = lines[index + offset];

    if (!line) {
      continue;
    }

    if (isLikelyEventTitle(line) || parseDateTimeLine(line) || parseTimeOnlyLine(line)) {
      break;
    }

    if (normalizeComparableText(line).includes("numbers nightclub")) {
      continue;
    }

    if (normalizeComparableText(line) === normalizeComparableText(title)) {
      continue;
    }

    snippets.push(line);
  }

  return snippets.length > 0 ? snippets.join(" ") : undefined;
}

function mapListingToEvent(listing: NumbersParsedListing): EventItem {
  const genreTags = inferGenreTags(listing.title, listing.description);
  const seed: EventSeed = {
    id: buildStableEventId(listing.title, listing.dateTime, listing.eventUrl, 0),
    title: listing.title,
    dateTime: listing.dateTime,
    venue: NUMBERS_SOURCE_NAME,
    city: "Houston",
    category: "Concert",
    sectionCategory: "concert",
    eventSubtype: determineEventSubtype(listing.title, listing.description),
    genreTags,
    sourceLinks: [
      {
        label: "Event page",
        url: listing.eventUrl,
      },
      {
        label: "Source page",
        url: NUMBERS_EVENTS_URL,
      },
    ],
    description: listing.description,
    metadataConfidence: listing.metadataConfidence,
    isGreatLiveAct: false,
    liveReputationStatus: "unknown",
    liveReputationConfidence: 0,
    liveReputationReasons: [],
    liveReputationSources: [],
    venueFitScore: 0,
    knownLiveReputationScore: 0,
    rarityScore: 0,
    distanceRelevanceScore: 0,
    feedbackHistoryPlaceholderScore: 0,
  };

  const scoredEvent = scoreEvent(seed);

  return {
    ...scoredEvent,
    sourceLabel: NUMBERS_SOURCE_NAME,
    timeLabel: listing.timeLabel,
  };
}

function parseNumbersPage(html: string, pageUrl: string, debug: NumbersSourceDebug): NumbersParsedListing[] {
  const structuredListings = parseStructuredListings(html, pageUrl, debug);

  if (structuredListings.length > 0) {
    debug.parsedBeforeDedupe += structuredListings.length;
    return structuredListings;
  }

  const legacyListings = parseLegacyListings(html, pageUrl, debug);
  debug.parsedBeforeDedupe += legacyListings.length;

  return legacyListings;
}

function dedupeListings(listings: NumbersParsedListing[], debug: NumbersSourceDebug): NumbersParsedListing[] {
  const byKey = new Map<string, NumbersParsedListing>();

  for (const listing of listings) {
    const key = `${listing.eventUrl || ""}|${normalizeDateKey(listing.dateTime)}|${normalizeComparableText(listing.title)}`;
    const existing = byKey.get(key);

    if (!existing || (listing.metadataConfidence ?? 0) >= (existing.metadataConfidence ?? 0)) {
      byKey.set(key, listing);
    }
  }

  debug.duplicateRowsRemoved += Math.max(0, listings.length - byKey.size);

  return [...byKey.values()].sort((left, right) => left.dateTime.localeCompare(right.dateTime));
}

function summarizeDates(events: EventItem[]): { earliestEventDate?: string; latestEventDate?: string } {
  if (events.length === 0) {
    return {};
  }

  const dates = events.map((event) => event.dateTime.slice(0, 10)).sort();

  return {
    earliestEventDate: dates[0],
    latestEventDate: dates[dates.length - 1],
  };
}

function buildSummary(debug: NumbersSourceDebug): string {
  if (!debug.fetchSucceeded) {
    return "Numbers source could not be loaded.";
  }

  if (debug.parsedValidEvents === 0) {
    return `Numbers source loaded, but parser found 0 valid events. Raw candidates: ${debug.rawEventCandidates}, skipped: ${debug.skippedRows}.`;
  }

  if (debug.todayHadEvents) {
    return `Numbers loaded from official events pages: ${debug.parsedValidEvents} events parsed, including ${debug.todayEventCount} today.`;
  }

  return `Numbers loaded from official events pages: ${debug.parsedValidEvents} events parsed, earliest ${debug.earliestEventDate ?? "unknown"}. No events found for today.`;
}

async function fetchPage(url: string): Promise<CacheAwareResponse> {
  return cachedFetch(url, {
    cache: "no-store",
    category: "music",
    refreshPolicy: "daily",
    headers: {
      "user-agent": NUMBERS_USER_AGENT,
    },
  }) as unknown as Promise<CacheAwareResponse>;
}

export async function fetchNumbersSource(): Promise<NumbersSourceResult> {
  installSourceCache();

  const debug: NumbersSourceDebug = {
    urlsChecked: [NUMBERS_EVENTS_URL],
    fetchSucceeded: false,
    responseStatuses: {},
    fetchedTextLength: 0,
    eventsPageReached: false,
    monthPageReached: false,
    eventsListFound: false,
    monthViewFound: false,
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
    visibleUpcomingTitles: [],
    lowPriorityUpcomingTitles: [],
    todayChecked: false,
    todayEventCount: 0,
    todayHadEvents: false,
    todayCoverageVerified: false,
    warnings: [],
  };

  try {
    const listResponse = await fetchPage(NUMBERS_EVENTS_URL);
    debug.responseStatuses[NUMBERS_EVENTS_URL] = listResponse.status;
    const listHtml = await listResponse.text();
    debug.fetchedTextLength += listHtml.length;

    const listListings = parseNumbersPage(listHtml, NUMBERS_EVENTS_URL, debug);

    let parsedListings = listListings;

    if (listListings.length === 0) {
      const monthResponse = await fetchPage(NUMBERS_EVENTS_MONTH_URL);
      debug.urlsChecked.push(NUMBERS_EVENTS_MONTH_URL);
      debug.responseStatuses[NUMBERS_EVENTS_MONTH_URL] = monthResponse.status;
      const monthHtml = await monthResponse.text();
      debug.fetchedTextLength += monthHtml.length;
      debug.monthPageReached = /numbers nightclub/i.test(monthHtml);

      const monthListings = parseNumbersPage(monthHtml, NUMBERS_EVENTS_MONTH_URL, debug);
      parsedListings = monthListings;
    }

    const dedupedListings = dedupeListings(parsedListings, debug);
    const events = dedupedListings.map(mapListingToEvent);
    const today = getHoustonTodayDate();
    const windowEnd = addDays(today, EVENT_DISPLAY_WINDOW_DAYS);
    const inWindowEvents = events.filter((event) => {
      const eventDate = event.dateTime.slice(0, 10);
      return eventDate >= today && eventDate <= windowEnd;
    });
    const visibleUpcoming = inWindowEvents.filter((event) => !event.hiddenReason);
    const lowPriorityUpcoming = inWindowEvents.filter((event) => Boolean(event.hiddenReason));
    const todayEvents = events.filter((event) => event.dateTime.slice(0, 10) === today);
    const filteredEvents = inWindowEvents.filter((event) => event.dateTime.slice(0, 10) >= today);
    const dateSummary = summarizeDates(events);

    debug.parsedValidEvents = events.length;
    debug.hiddenPastShows = events.filter((event) => event.dateTime.slice(0, 10) < today).length;
    debug.displayedInWindowShows = inWindowEvents.length;
    debug.visibleUpcomingShowsCount = visibleUpcoming.length;
    debug.lowPriorityUpcomingShowsCount = lowPriorityUpcoming.length;
    debug.visibleUpcomingTitles = visibleUpcoming.slice(0, 6).map((event) => event.title);
    debug.lowPriorityUpcomingTitles = lowPriorityUpcoming.slice(0, 6).map((event) => event.title);
    debug.todayChecked = true;
    debug.todayEventCount = todayEvents.length;
    debug.todayHadEvents = todayEvents.length > 0;
    debug.todayCoverageVerified = true;
    debug.earliestEventDate = dateSummary.earliestEventDate;
    debug.latestEventDate = dateSummary.latestEventDate;
    debug.fetchSucceeded = true;
    debug.cacheStatus = listResponse.mode;

    return {
      events: filteredEvents,
      sourceName: NUMBERS_SOURCE_NAME,
      sourceUrl: NUMBERS_EVENTS_URL,
      status: events.length > 0 ? "success" : "unavailable",
      message: buildSummary(debug),
      debug,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Numbers source failed to load.";

    debug.warnings.push(message);
    debug.fetchSucceeded = false;
    debug.cacheStatus = "failed";

    return {
      events: [],
      sourceName: NUMBERS_SOURCE_NAME,
      sourceUrl: NUMBERS_EVENTS_URL,
      status: "failed",
      message: "Numbers source failed to load.",
      debug,
    };
  }
}
