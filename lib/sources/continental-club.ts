import { scoreEvent, type EventSeed } from "@/lib/event-scoring";
import { EVENT_DISPLAY_WINDOW_DAYS } from "@/lib/event-window";
import { cachedFetch } from "@/lib/source-cache";
import type { EventItem } from "@/types/dashboard";

export const CONTINENTAL_CLUB_SOURCE_NAME = "Continental Club Houston";
export const CONTINENTAL_CLUB_SOURCE_URL = "https://continentalclub.com/houston/";
const CONTINENTAL_CLUB_TIMELY_CALENDAR_ID = "54706359";
const CONTINENTAL_CLUB_TIMELY_CATEGORY_ID = "677491865";
const CONTINENTAL_CLUB_TIMELY_VIEW = "tile";
const CONTINENTAL_CLUB_TIMELY_PER_PAGE = 30;
const CONTINENTAL_CLUB_TIMELY_MAX_PAGES = 5;
const CONTINENTAL_CLUB_TIMELY_FEED_TEMPLATE =
  "https://events.timely.fun/api/calendars/54706359/events?categories=677491865&timezone=America/Chicago&view=tile&start_date_utc={start_date_utc}&per_page=30&page={page}";

const CONTINENTAL_CLUB_USER_AGENT = "DailyOverviewBot/1.0 (+https://localhost)";
const MAX_DISCOVERED_SOURCE_FETCHES = 4;
const MAX_SAMPLE_LINES = 20;

export interface ContinentalClubSourceDebug {
  urlsChecked: string[];
  responseStatuses: Record<string, number | null>;
  fetchSucceeded: boolean;
  pagesFetched?: number;
  feedTotal?: number;
  rawFeedItemsCount?: number;
  parsedBeforeDedupe?: number;
  duplicateEventsRemoved?: number;
  usefulEventTextFound: boolean;
  structuredDataEventDetected: boolean;
  embeddedJsonEventDetected: boolean;
  visibleEventDatesFound: boolean;
  timelyFeedUrlTemplate?: string;
  timelyResponseStatuses?: Record<string, number | null>;
  timelyPagesFetched?: number;
  timelyFeedTotal?: number;
  timelyRawItemsCount?: number;
  timelyParsedBeforeDedupe?: number;
  timelyDuplicateEventsRemoved?: number;
  timelySkippedCount?: number;
  timelySkippedReasons?: Record<string, number>;
  timelyHiddenPastCount?: number;
  timelyInWindowCount?: number;
  timelyTodayCount?: number;
  timelyMusicCount?: number;
  timelyOtherCount?: number;
  timelyVenueCounts?: {
    continentalClubHouston: number;
    shoeshineCharleysBigTopLounge: number;
  };
  timelyVisibleMusicCount?: number;
  timelyLowPriorityMusicCount?: number;
  timelyVisibleOtherCount?: number;
  timelyLowPriorityOtherCount?: number;
  timelyVisibleMusicTitles?: string[];
  timelyVisibleOtherTitles?: string[];
  rawEventCandidates: number;
  parsedValidEvents: number;
  duplicateRowsRemoved?: number;
  hiddenPastCount?: number;
  inWindowCount?: number;
  todayEventCount?: number;
  concertRowsParsed?: number;
  otherRowsParsed?: number;
  skippedRows?: number;
  venueCounts?: {
    continentalClubHouston: number;
    shoeshineCharleysBigTopLounge: number;
  };
  visibleMusicCount?: number;
  lowPriorityMusicCount?: number;
  visibleOtherCount?: number;
  lowPriorityOtherCount?: number;
  visibleMusicTitles?: string[];
  visibleOtherTitles?: string[];
  earliestEventDate?: string;
  latestEventDate?: string;
  todayChecked: boolean;
  todayHadEvents: boolean;
  todayCoverageVerified: boolean;
  sampleLines?: string[];
  warnings: string[];
}

export interface ContinentalClubSourceResult {
  events: EventItem[];
  sourceName: string;
  sourceUrl: string;
  status: "success" | "unavailable" | "failed";
  message: string;
  debug: ContinentalClubSourceDebug;
}

interface ContinentalClubParsedListing {
  title: string;
  dateTime: string;
  eventUrl: string;
  supportActs?: string;
  startDate?: string;
  endDate?: string;
  timeLabel?: string;
  isOngoing?: boolean;
  category?: string;
  sectionCategory?: "concert" | "other";
  eventSubtype?: string;
  description?: string;
  genreTags?: string[];
  room?: string;
  sourceLabel?: string;
  sourceLinks?: EventItem["sourceLinks"];
  ticketUrl?: string;
  venueKey?: "continental-club" | "big-top";
  metadataConfidence?: number;
}

interface TimelyFeedVenue {
  title?: string;
  name?: string;
  address?: string;
}

interface TimelyFeedCategory {
  title?: string;
  name?: string;
}

interface TimelyFeedTag {
  title?: string;
  name?: string;
}

interface TimelyFeedEvent {
  id?: string | number;
  uid?: string;
  instance?: string | number;
  title?: string;
  start_datetime?: string;
  end_datetime?: string;
  start_utc_datetime?: string;
  end_utc_datetime?: string;
  timezone?: string;
  description_short?: string;
  canonical_url?: string;
  url?: string;
  cost_external_url?: string;
  ticket_type?: string;
  cost_display?: string;
  event_status?: string;
  venue?: TimelyFeedVenue | TimelyFeedVenue[] | string | null;
  categories?: TimelyFeedCategory[] | TimelyFeedCategory | string[] | string | null;
  tags?: TimelyFeedTag[] | TimelyFeedTag | string[] | string | null;
  image_url?: string;
  image?: { url?: string } | string;
  images?: Array<{ url?: string } | string>;
}

interface TimelyFeedPage {
  data?: TimelyFeedEvent[];
  items?: TimelyFeedEvent[];
  events?: TimelyFeedEvent[];
  has_next?: boolean;
  hasNext?: boolean;
  total?: number;
  meta?: {
    total?: number;
    has_next?: boolean;
    hasNext?: boolean;
  };
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

function getHoustonTodayDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function addHoustonDays(baseDate: string, days: number): string {
  const base = new Date(`${baseDate}T12:00:00-05:00`);
  base.setDate(base.getDate() + days);

  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(base);
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

function inferGenreTags(title: string, supportActs?: string): string[] {
  const normalized = `${title} ${supportActs ?? ""}`.toLowerCase();
  const tags: string[] = [];

  if (normalized.includes("punk") || normalized.includes("garage")) {
    tags.push("punk", "garage rock");
  }

  if (normalized.includes("country") || normalized.includes("americana")) {
    tags.push("americana");
  }

  if (normalized.includes("dj") || normalized.includes("dance")) {
    tags.push("electronic", "dance");
  }

  if (tags.length === 0) {
    tags.push("live music");
  }

  return tags;
}

function normalizeTimelyText(value: string): string {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getHoustonTimeZoneOffset(date: Date): string {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    timeZoneName: "shortOffset",
    hour: "numeric",
  });
  const offsetLabel = formatter.formatToParts(date).find((part) => part.type === "timeZoneName")?.value ?? "GMT-5";
  const match = offsetLabel.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/i);

  if (!match) {
    return "-05:00";
  }

  return `${match[1]}${match[2].padStart(2, "0")}:${(match[3] ?? "00").padStart(2, "0")}`;
}

function getHoustonDateTimeParts(date: Date): {
  date: string;
  time: string;
  offset: string;
} {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(date).reduce<Record<string, string>>((accumulator, part) => {
    if (part.type !== "literal") {
      accumulator[part.type] = part.value;
    }

    return accumulator;
  }, {});

  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}:${parts.second}`,
    offset: getHoustonTimeZoneOffset(date),
  };
}

function formatHoustonInstant(value?: string): {
  dateTime?: string;
  date?: string;
  timeLabel?: string;
  endDate?: string;
  isOngoing?: boolean;
} {
  if (!value) {
    return {};
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return {};
  }

  const parts = getHoustonDateTimeParts(date);
  const timeLabel = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);

  return {
    dateTime: `${parts.date}T${parts.time}${parts.offset}`,
    date: parts.date,
    timeLabel,
  };
}

function getTimelyText(value: unknown): string[] {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => getTimelyText(item));
  }

  if (typeof value === "string") {
    return [normalizeWhitespace(value)].filter(Boolean);
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const entries = [record.title, record.name, record.label, record.text]
      .flatMap((item) => getTimelyText(item));

    return entries;
  }

  return [];
}

function getTimelyCategoryText(item: TimelyFeedEvent): string {
  return [...getTimelyText(item.categories), ...getTimelyText(item.tags), ...getTimelyText(item.description_short)]
    .join(" | ")
    .trim();
}

function routeTimelyEvent(
  title: string,
  categoryText: string,
): {
  sectionCategory: "concert" | "other";
  eventSubtype?: string;
} {
  const normalized = normalizeTimelyText(`${title} ${categoryText}`);

  if (
    /open mic|storytime|story time|storytelling|karaoke|jam session|vinyl night|record swap|listening night|song swap|trivia|workshop|talk|lecture|reading/.test(normalized)
  ) {
    return {
      sectionCategory: "other",
      eventSubtype: /open mic/.test(normalized)
        ? "Open mic"
        : /story/.test(normalized)
          ? "Storytelling"
          : /karaoke/.test(normalized)
            ? "Karaoke"
            : /jam/.test(normalized)
              ? "Jam session"
          : /vinyl|record swap|listening/.test(normalized)
            ? "Vinyl night"
            : /trivia/.test(normalized)
              ? "Trivia night"
              : /workshop|talk|lecture|reading/.test(normalized)
                ? "Community event"
                : "Other event",
    };
  }

  if (/dance party|dj|late night|tribute|showcase|concert|live|band|music|perform/.test(normalized)) {
    return {
      sectionCategory: "concert",
      eventSubtype: /tribute/.test(normalized)
        ? "Tribute show"
        : /dance party|dj/.test(normalized)
          ? "Dance party"
          : "Concert",
    };
  }

  return {
    sectionCategory: "concert",
    eventSubtype: "Concert",
  };
}

function inferTimelyGenreTags(title: string, categoryText: string): string[] {
  const normalized = normalizeTimelyText(`${title} ${categoryText}`);
  const tags = new Set<string>();

  if (/punk/.test(normalized)) {
    tags.add("punk");
  }

  if (/garage/.test(normalized)) {
    tags.add("garage rock");
  }

  if (/country|americana/.test(normalized)) {
    tags.add("americana");
  }

  if (/dj|dance/.test(normalized)) {
    tags.add("electronic");
    tags.add("dance");
  }

  if (/blues/.test(normalized)) {
    tags.add("blues");
  }

  if (/soul|r&b|r and b/.test(normalized)) {
    tags.add("soul");
  }

  if (/jazz/.test(normalized)) {
    tags.add("jazz");
  }

  if (tags.size === 0) {
    tags.add("live music");
  }

  return [...tags];
}

function extractSupportActsFromTimelyTitle(title: string): { title: string; supportActs?: string } {
  const patterns = [
    /\s(?:w\/|with|featuring|feat\.)\s+(.+)$/i,
    /\s[-–—]\s+(.+)$/i,
  ];

  for (const pattern of patterns) {
    const match = title.match(pattern);

    if (match) {
      const cleanedTitle = normalizeWhitespace(title.replace(pattern, "").trim());
      return {
        title: cleanedTitle || title,
        supportActs: normalizeWhitespace(match[1]) || undefined,
      };
    }
  }

  return { title };
}

function isConfirmedTimelyEvent(item: TimelyFeedEvent): boolean {
  if (typeof item.event_status !== "string" || item.event_status.trim().length === 0) {
    return true;
  }

  return normalizeTimelyText(item.event_status) === "confirmed";
}

function buildTimelyFeedUrl(page: number, startDateUtcSeconds: number): string {
  const url = new URL(`https://events.timely.fun/api/calendars/${CONTINENTAL_CLUB_TIMELY_CALENDAR_ID}/events`);
  url.searchParams.set("categories", CONTINENTAL_CLUB_TIMELY_CATEGORY_ID);
  url.searchParams.set("timezone", "America/Chicago");
  url.searchParams.set("view", CONTINENTAL_CLUB_TIMELY_VIEW);
  url.searchParams.set("start_date_utc", String(startDateUtcSeconds));
  url.searchParams.set("per_page", String(CONTINENTAL_CLUB_TIMELY_PER_PAGE));
  url.searchParams.set("page", String(page));

  return url.toString();
}

function getHoustonStartOfTodayUtcSeconds(): number {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .formatToParts(now)
    .reduce<Record<string, string>>((accumulator, part) => {
      if (part.type !== "literal") {
        accumulator[part.type] = part.value;
      }

      return accumulator;
    }, {});

  const utcMidday = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), 12, 0, 0));
  const offsetMinutes = Number(getHoustonTimeZoneOffset(utcMidday).slice(1, 3)) * 60 + Number(getHoustonTimeZoneOffset(utcMidday).slice(4, 6));
  const offsetSign = getHoustonTimeZoneOffset(utcMidday).startsWith("-") ? -1 : 1;
  const utcStart = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), 0, 0, 0) - offsetSign * offsetMinutes * 60000;

  return Math.floor(utcStart / 1000);
}

function normalizeTimelyUrl(value: string, baseUrl: string): string {
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return value;
  }
}

function getTimelyFeedItems(page: TimelyFeedPage): TimelyFeedEvent[] {
  const candidates = [page.data, page.items, page.events].find(
    (value): value is TimelyFeedEvent[] => Array.isArray(value) && value.length > 0,
  );

  return (candidates ?? []).filter((item): item is TimelyFeedEvent => Boolean(item));
}

function getTimelyPrimaryEventUrl(item: TimelyFeedEvent): string | undefined {
  const candidates = [
    item.canonical_url,
    item.url,
    item.cost_external_url,
  ];

  for (const candidate of candidates) {
    if (typeof candidate !== "string" || candidate.trim().length === 0) {
      continue;
    }

    return normalizeTimelyUrl(candidate, CONTINENTAL_CLUB_SOURCE_URL);
  }

  return undefined;
}

function getTimelyPrimaryLink(item: TimelyFeedEvent): { url: string; label: "Event page" | "Source page" } | null {
  const primaryUrl = getTimelyPrimaryEventUrl(item);

  if (!primaryUrl) {
    return null;
  }

  if (normalizeTimelyUrl(primaryUrl, CONTINENTAL_CLUB_SOURCE_URL) === CONTINENTAL_CLUB_SOURCE_URL) {
    return {
      url: CONTINENTAL_CLUB_SOURCE_URL,
      label: "Source page",
    };
  }

  return {
    url: primaryUrl,
    label: "Event page",
  };
}

function getTimelyVenueDetails(item: TimelyFeedEvent): {
  venue: string;
  room?: string;
  venueKey: "continental-club" | "big-top";
} {
  const venueText = getTimelyText(item.venue).join(" ");
  const normalized = normalizeTimelyText(venueText);

  if (/shoeshine charley|big top/.test(normalized)) {
    return {
      venue: "Shoeshine Charley's Big Top Lounge",
      room: "Shoeshine Charley's Big Top Lounge",
      venueKey: "big-top",
    };
  }

  return {
    venue: CONTINENTAL_CLUB_SOURCE_NAME,
    venueKey: "continental-club",
  };
}

function getTimelySourceLinks(item: TimelyFeedEvent): EventItem["sourceLinks"] {
  const sourceLinks: EventItem["sourceLinks"] = [];
  const primaryLink = getTimelyPrimaryLink(item);

  if (primaryLink) {
    sourceLinks.push(primaryLink);
  }

  if (!primaryLink || primaryLink.url !== CONTINENTAL_CLUB_SOURCE_URL) {
    sourceLinks.push({
      label: CONTINENTAL_CLUB_SOURCE_NAME,
      url: CONTINENTAL_CLUB_SOURCE_URL,
    });
  }

  return sourceLinks;
}

function buildTimelyEventId(
  item: TimelyFeedEvent,
  dateTime: string,
  venueKey: "continental-club" | "big-top",
): string {
  const seed = [
    item.id,
    item.uid,
    item.instance,
    item.title,
    dateTime,
    venueKey,
  ]
    .map((value) => String(value ?? "").trim())
    .find((value) => value.length > 0) ?? "timely-event";

  return `continental-club-timely-${seed.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

function parseTimelyFeedEvent(item: TimelyFeedEvent): EventItem | null {
  if (!isConfirmedTimelyEvent(item)) {
    return null;
  }

  const rawTitle = normalizeWhitespace(item.title ?? "");

  if (!rawTitle) {
    return null;
  }

  const startValue = item.start_datetime || item.start_utc_datetime;
  const start = formatHoustonInstant(startValue);

  if (!start.dateTime || !start.date) {
    return null;
  }

  const endValue = item.end_datetime || item.end_utc_datetime;
  const end = formatHoustonInstant(endValue);
  const titleSplit = extractSupportActsFromTimelyTitle(rawTitle);
  const categoryText = getTimelyCategoryText(item);
  const route = routeTimelyEvent(titleSplit.title, categoryText);
  const genreTags = inferTimelyGenreTags(titleSplit.title, categoryText);
  const venueDetails = getTimelyVenueDetails(item);
  const sourceLinks = getTimelySourceLinks(item);
  const primaryLink = getTimelyPrimaryLink(item);
  const subtitle = normalizeWhitespace([
    item.ticket_type,
    item.cost_display,
  ].filter(Boolean).join(" • "));
  const description = normalizeWhitespace(item.description_short ?? "");

  const seed: EventSeed = {
    id: buildTimelyEventId(item, start.dateTime, venueDetails.venueKey),
    title: titleSplit.title,
    dateTime: start.dateTime,
    venue: venueDetails.venue,
    city: "Houston",
    category: route.sectionCategory === "concert" ? "Concert" : "Other",
    sectionCategory: route.sectionCategory,
    eventSubtype: route.eventSubtype,
    genreTags,
    sourceLinks,
    eventUrl: primaryLink?.url,
    eventUrlLabel: primaryLink?.label,
    supportActs: titleSplit.supportActs,
    subtitle: subtitle || undefined,
    description: description || undefined,
    rawGenre: categoryText || undefined,
    price: normalizeWhitespace(item.cost_display ?? "") || undefined,
    room: venueDetails.room,
    metadataConfidence: [
      titleSplit.supportActs,
      item.description_short,
      item.cost_display,
      item.ticket_type,
      categoryText,
    ].filter(Boolean).length,
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

  const scored = scoreEvent(seed);

  return {
    ...scored,
    sourceLabel: CONTINENTAL_CLUB_SOURCE_NAME,
    startDate: start.date,
    endDate: end.date && end.date !== start.date ? end.date : undefined,
    isOngoing: Boolean(start.date && end.date && end.date !== start.date),
    timeLabel: start.timeLabel,
  };
}

function dedupeTimelyEvents(events: EventItem[]): EventItem[] {
  const byKey = new Map<string, EventItem>();

  for (const event of events) {
    const key = [
      event.title.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      event.dateTime.slice(0, 16),
      normalizeWhitespace(event.venue).toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    ].join("|");

    if (!byKey.has(key)) {
      byKey.set(key, event);
    }
  }

  return [...byKey.values()];
}

function countTimelyVenueCounts(events: EventItem[]): {
  continentalClubHouston: number;
  shoeshineCharleysBigTopLounge: number;
} {
  return {
    continentalClubHouston: events.filter((event) => normalizeTimelyText(event.venue) === normalizeTimelyText(CONTINENTAL_CLUB_SOURCE_NAME)).length,
    shoeshineCharleysBigTopLounge: events.filter((event) => normalizeTimelyText(event.venue) === normalizeTimelyText("Shoeshine Charley's Big Top Lounge")).length,
  };
}

function extractSupportActsFromTitle(title: string): { title: string; supportActs?: string } {
  const supportMatch = title.match(/\s(?:w\/|with)\s+(.+)$/i);

  if (!supportMatch) {
    return { title };
  }

  const cleanedTitle = normalizeWhitespace(title.replace(/\s(?:w\/|with)\s+(.+)$/i, "").trim());

  return {
    title: cleanedTitle || title,
    supportActs: normalizeWhitespace(supportMatch[1]) || undefined,
  };
}

function mapListingToEvent(listing: ContinentalClubParsedListing): EventItem {
  const seed: EventSeed = {
    id: `continental-club-${listing.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${listing.dateTime.slice(0, 10)}`,
    title: listing.title,
    dateTime: listing.dateTime,
    venue: CONTINENTAL_CLUB_SOURCE_NAME,
    city: "Houston",
    category: "Concert",
    genreTags: inferGenreTags(listing.title, listing.supportActs),
    sourceLinks: [
      {
        label: CONTINENTAL_CLUB_SOURCE_NAME,
        url: listing.eventUrl || CONTINENTAL_CLUB_SOURCE_URL,
      },
    ],
    supportActs: listing.supportActs,
    metadataConfidence: [listing.supportActs].filter(Boolean).length,
    isGreatLiveAct: false,
    liveReputationStatus: "unknown",
    liveReputationConfidence: 0,
    liveReputationReasons: [],
    liveReputationSources: [],
    venueFitScore: 15,
    knownLiveReputationScore: 8,
    rarityScore: 7,
    distanceRelevanceScore: 10,
    feedbackHistoryPlaceholderScore: 5,
  };

  return {
    ...scoreEvent(seed),
    sourceLabel: CONTINENTAL_CLUB_SOURCE_NAME,
  };
}

function isLikelyEventTitle(text: string): boolean {
  if (text.length < 8) {
    return false;
  }

  return ![
    "houston shows",
    "houston music calendar",
    "welcome",
    "about",
    "no results found",
  ].includes(text.toLowerCase());
}

function sanitizeRelevantLines(lines: string[]): string[] {
  return lines
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean)
    .filter((line) => {
      return /calendar|show|event|music|january|february|march|april|may|june|july|august|september|october|november|december|\d{1,2}:\d{2}|am\b|pm\b/i.test(
        line,
      );
    })
    .slice(0, MAX_SAMPLE_LINES);
}

function discoverContinentalClubUrls(
  html: string,
  baseUrl: string,
): string[] {
  const base = new URL(baseUrl);
  const normalizeUrl = (value: URL): string => {
    const normalized = new URL(value.toString());
    normalized.hash = "";
    normalized.search = "";

    return normalized.toString().replace(/\/$/, "");
  };
  const urls = new Set<string>([normalizeUrl(base)]);
  const anchorPattern = /<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;

  for (const match of html.matchAll(anchorPattern)) {
    const href = match[1];
    const text = normalizeWhitespace(match[2].replace(/<[^>]+>/g, " "));

    try {
      const resolved = new URL(href, baseUrl);
      const normalizedResolved = normalizeUrl(resolved);

      if (resolved.hostname !== base.hostname) {
        continue;
      }

      if (
        /shop/i.test(resolved.pathname)
      ) {
        continue;
      }

      if (
        /calendar|event|show|music/i.test(resolved.pathname) ||
        /calendar|event|show|music|houston/i.test(text)
      ) {
        urls.add(normalizedResolved);
      }
    } catch {
      continue;
    }
  }

  return [...urls].slice(0, MAX_DISCOVERED_SOURCE_FETCHES + 1);
}

function parseStructuredEventObjects(
  html: string,
  pageUrl: string,
): { listings: ContinentalClubParsedListing[]; foundEventObjects: boolean } {
  const scriptMatches =
    html.match(/<script type="application\/ld\+json">[\s\S]*?<\/script>/gi) ?? [];
  const listings: ContinentalClubParsedListing[] = [];
  let foundEventObjects = false;

  for (const script of scriptMatches) {
    const content = script
      .replace(/^<script type="application\/ld\+json">/i, "")
      .replace(/<\/script>$/i, "")
      .trim();

    try {
      const parsed = JSON.parse(content);
      const objects = Array.isArray(parsed) ? parsed : [parsed];

      for (const object of objects) {
        if (!object || typeof object !== "object") {
          continue;
        }

        const objectType = typeof object["@type"] === "string"
          ? object["@type"].toLowerCase()
          : "";

        if (objectType !== "event") {
          continue;
        }

        foundEventObjects = true;

        if (
          typeof object.name === "string" &&
          typeof object.startDate === "string"
        ) {
          const titleText = normalizeWhitespace(object.name);
          const titleSplit = extractSupportActsFromTitle(titleText);
          listings.push({
            title: titleSplit.title,
            dateTime: object.startDate,
            eventUrl:
              typeof object.url === "string" ? object.url : pageUrl,
            supportActs: titleSplit.supportActs,
          });
        }
      }
    } catch {
      continue;
    }
  }

  return { listings, foundEventObjects };
}

function parseVisibleLineEvents(
  html: string,
  pageUrl: string,
): {
  listings: ContinentalClubParsedListing[];
  usefulEventTextFound: boolean;
  visibleEventDatesFound: boolean;
  relevantLines: string[];
} {
  const visibleText = extractVisibleText(html);
  const lines = visibleText
    .split(/\n+/)
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean);
  const relevantLines = sanitizeRelevantLines(lines);
  const datePattern =
    /^(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:,\s*(\d{4}))?$/i;
  const timePattern = /(\d{1,2}:\d{2}\s*[AP]M)(?:\s*[-–]\s*(\d{1,2}:\d{2}\s*[AP]M))?/i;
  const listings: ContinentalClubParsedListing[] = [];
  const usefulEventTextFound = relevantLines.length > 0;
  let visibleEventDatesFound = lines.some((line) =>
    /(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:,\s*\d{4})?/i.test(
      line,
    ),
  );

  for (let index = 0; index < lines.length; index += 1) {
    const dateMatch = lines[index].match(datePattern);

    if (!dateMatch) {
      continue;
    }

    visibleEventDatesFound = true;
    const monthName = dateMatch[1];
    const day = Number(dateMatch[2]);
    const parsedYear = dateMatch[3] ? Number(dateMatch[3]) : undefined;
    const year = parsedYear ?? Number(getHoustonTodayDate().slice(0, 4));
    const month = new Date(`${monthName} 1, ${year}`).getMonth() + 1;

    let timeText: string | undefined;
    let titleText: string | undefined;

    for (let lookAhead = index + 1; lookAhead < Math.min(lines.length, index + 8); lookAhead += 1) {
      if (datePattern.test(lines[lookAhead])) {
        break;
      }

      if (!timeText) {
        const timeMatch = lines[lookAhead].match(timePattern);

        if (timeMatch) {
          timeText = timeMatch[2]
            ? `${timeMatch[1]} - ${timeMatch[2]}`
            : timeMatch[1];
          continue;
        }
      }

      if (!titleText && isLikelyEventTitle(lines[lookAhead])) {
        titleText = lines[lookAhead];
        break;
      }
    }

    if (!titleText) {
      continue;
    }

    let hours = "19";
    let minutes = "00";

    if (timeText) {
      const startMatch = timeText.match(/(\d{1,2}):(\d{2})\s*([AP]M)/i);

      if (startMatch) {
        let startHours = Number(startMatch[1]);
        minutes = startMatch[2];
        const meridiem = startMatch[3].toUpperCase();

        if (meridiem === "PM" && startHours !== 12) {
          startHours += 12;
        }

        if (meridiem === "AM" && startHours === 12) {
          startHours = 0;
        }

        hours = String(startHours).padStart(2, "0");
      }
    }

    const titleSplit = extractSupportActsFromTitle(titleText);

    listings.push({
      title: titleSplit.title,
      dateTime: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${hours}:${minutes}:00-05:00`,
      eventUrl: pageUrl,
      supportActs: titleSplit.supportActs,
    });
  }

  return {
    listings,
    usefulEventTextFound,
    visibleEventDatesFound,
    relevantLines,
  };
}

function dedupeEvents(events: EventItem[]): EventItem[] {
  const byKey = new Map<string, EventItem>();

  for (const event of events) {
    const key = `${event.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}|${event.dateTime.slice(0, 10)}|${event.dateTime.slice(11, 16)}`;
    byKey.set(key, event);
  }

  return [...byKey.values()];
}

async function fetchHtml(url: string): Promise<{ ok: boolean; status: number | null; html?: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": CONTINENTAL_CLUB_USER_AGENT,
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
    return {
      ok: false,
      status: null,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function getTimelySkipReason(item: TimelyFeedEvent): string | null {
  if (!isConfirmedTimelyEvent(item)) {
    return "not confirmed";
  }

  const title = normalizeWhitespace(item.title ?? "");

  if (!title) {
    return "missing title";
  }

  const startValue = item.start_datetime || item.start_utc_datetime;

  if (!startValue) {
    return "missing start date";
  }

  const start = formatHoustonInstant(startValue);

  if (!start.dateTime || !start.date) {
    return "unparseable start date";
  }

  return null;
}

async function fetchTimelyFeedPage(
  page: number,
  startDateUtcSeconds: number,
): Promise<{
  ok: boolean;
  status: number | null;
  url: string;
  data?: TimelyFeedPage;
}> {
  const url = buildTimelyFeedUrl(page, startDateUtcSeconds);

  try {
    const response = await cachedFetch(url, {
      cacheKey: url,
      category: "music",
      refreshPolicy: "daily",
      cache: "no-store",
      headers: {
        "User-Agent": CONTINENTAL_CLUB_USER_AGENT,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        url,
      };
    }

    return {
      ok: true,
      status: response.status,
      url,
      data: await response.json<TimelyFeedPage>(),
    };
  } catch {
    return {
      ok: false,
      status: null,
      url,
    };
  }
}

function buildTimelySummary(debug: ContinentalClubSourceDebug): string {
  if (!debug.fetchSucceeded) {
    return "Continental Club Houston Timely feed could not be loaded.";
  }

  if ((debug.parsedValidEvents ?? 0) > 0) {
    return debug.todayHadEvents
      ? `Continental Club Houston loaded from official embedded Timely feed: ${debug.parsedValidEvents} events parsed, including today's events.`
      : `Continental Club Houston loaded from official embedded Timely feed: ${debug.parsedValidEvents} events parsed. No events found for today.`;
  }

  return "Continental Club Houston Timely feed loaded, but no parseable events were found.";
}

function buildContinentalClubSummary(
  debug: ContinentalClubSourceDebug,
): string {
  if (!debug.fetchSucceeded) {
    return "Continental Club Houston source could not be loaded.";
  }

  if (debug.parsedValidEvents > 0) {
    return debug.todayHadEvents
      ? `Continental Club Houston loaded from official pages: ${debug.parsedValidEvents} events parsed, including today's events.`
      : `Continental Club Houston loaded from official pages: ${debug.parsedValidEvents} events parsed. No events found for today.`;
  }

  return "Continental Club Houston official page loaded, but no parseable same-site events were found.";
}

async function fetchContinentalClubStaticSource(): Promise<ContinentalClubSourceResult> {
  const warnings: string[] = [];
  const responseStatuses: Record<string, number | null> = {};

  const homepageResponse = await fetchHtml(CONTINENTAL_CLUB_SOURCE_URL);
  responseStatuses[CONTINENTAL_CLUB_SOURCE_URL] = homepageResponse.status;

  if (!homepageResponse.ok || homepageResponse.html === undefined) {
    const debug: ContinentalClubSourceDebug = {
      urlsChecked: [CONTINENTAL_CLUB_SOURCE_URL],
      responseStatuses,
      fetchSucceeded: false,
      usefulEventTextFound: false,
      structuredDataEventDetected: false,
      embeddedJsonEventDetected: false,
      visibleEventDatesFound: false,
      rawEventCandidates: 0,
      parsedValidEvents: 0,
      todayChecked: false,
      todayHadEvents: false,
      todayCoverageVerified: false,
      warnings: [
        `Primary Continental Club request failed with ${homepageResponse.status ?? "an unknown error"}.`,
      ],
    };

    return {
      events: [],
      sourceName: CONTINENTAL_CLUB_SOURCE_NAME,
      sourceUrl: CONTINENTAL_CLUB_SOURCE_URL,
      status: "failed",
      message: buildContinentalClubSummary(debug),
      debug,
    };
  }

  const homepageHtml = homepageResponse.html;
  const discoveredUrls = discoverContinentalClubUrls(
    homepageHtml,
    CONTINENTAL_CLUB_SOURCE_URL,
  );
  const candidateUrls = discoveredUrls
    .filter((url) => url !== CONTINENTAL_CLUB_SOURCE_URL)
    .slice(0, MAX_DISCOVERED_SOURCE_FETCHES);
  const checkedUrls = [CONTINENTAL_CLUB_SOURCE_URL];
  const eventMap = new Map<string, EventItem>();
  let rawEventCandidates = 0;
  let usefulEventTextFound = false;
  let structuredDataEventDetected = false;
  let embeddedJsonEventDetected = false;
  let visibleEventDatesFound = false;
  let sampleLines: string[] = [];

  const pagesToParse = [
    {
      url: CONTINENTAL_CLUB_SOURCE_URL,
      html: homepageHtml,
    },
  ];

  for (const url of candidateUrls) {
    checkedUrls.push(url);
    const response = await fetchHtml(url);
    responseStatuses[url] = response.status;

    if (!response.ok || response.html === undefined) {
      warnings.push(`${url} returned ${response.status ?? "an unknown error"}.`);
      continue;
    }

    pagesToParse.push({ url, html: response.html });
  }

  for (const page of pagesToParse) {
    const structured = parseStructuredEventObjects(page.html, page.url);
    structuredDataEventDetected =
      structuredDataEventDetected || structured.foundEventObjects;

    const visible = parseVisibleLineEvents(page.html, page.url);
    usefulEventTextFound = usefulEventTextFound || visible.usefulEventTextFound;
    visibleEventDatesFound = visibleEventDatesFound || visible.visibleEventDatesFound;

    if (sampleLines.length === 0 && visible.relevantLines.length > 0) {
      sampleLines = visible.relevantLines.slice(0, MAX_SAMPLE_LINES);
    }

    rawEventCandidates += structured.listings.length + visible.listings.length;

    for (const listing of [...structured.listings, ...visible.listings]) {
      const event = mapListingToEvent(listing);
      eventMap.set(event.id, event);
    }

    const contextMatches = page.html.match(/"event"|"events"|timely_script|events\.timely\.fun/gi) ?? [];

    if (contextMatches.length > 0) {
      embeddedJsonEventDetected = true;
    }
  }

  if (candidateUrls.length === 0) {
    warnings.push("No additional same-site event page was discovered from the official Houston page.");
  }

  if (!visibleEventDatesFound) {
    warnings.push("No server-fetchable event dates found on official same-site pages.");
  }

  if (structuredDataEventDetected && eventMap.size === 0) {
    warnings.push("Structured data found but no event objects parsed.");
  }

  const events = dedupeEvents([...eventMap.values()]);
  const today = getHoustonTodayDate();
  const todayEvents = events.filter((event) => event.dateTime.slice(0, 10) === today);
  const dates = summarizeDates(events);

  const debug: ContinentalClubSourceDebug = {
    urlsChecked: checkedUrls,
    responseStatuses,
    fetchSucceeded: true,
    usefulEventTextFound,
    structuredDataEventDetected,
    embeddedJsonEventDetected,
    visibleEventDatesFound,
    rawEventCandidates,
    parsedValidEvents: events.length,
    earliestEventDate: dates.earliestEventDate,
    latestEventDate: dates.latestEventDate,
    todayChecked: true,
    todayHadEvents: todayEvents.length > 0,
    todayCoverageVerified: true,
    sampleLines: events.length === 0 ? sampleLines : undefined,
    warnings,
  };

  return {
    events,
    sourceName: CONTINENTAL_CLUB_SOURCE_NAME,
    sourceUrl: CONTINENTAL_CLUB_SOURCE_URL,
    status: events.length > 0 ? "success" : "unavailable",
    message: buildContinentalClubSummary(debug),
    debug,
  };
}

async function fetchContinentalClubTimelySource(): Promise<ContinentalClubSourceResult> {
  const warnings: string[] = [];
  const responseStatuses: Record<string, number | null> = {};
  const checkedUrls: string[] = [CONTINENTAL_CLUB_SOURCE_URL];
  const officialPageResponse = await fetchHtml(CONTINENTAL_CLUB_SOURCE_URL);
  responseStatuses[CONTINENTAL_CLUB_SOURCE_URL] = officialPageResponse.status;

  if (!officialPageResponse.ok || officialPageResponse.html === undefined) {
    warnings.push(`Official Continental Club page returned ${officialPageResponse.status ?? "an unknown error"}.`);
  }

  const startDateUtcSeconds = getHoustonStartOfTodayUtcSeconds();
  const parsedEvents: EventItem[] = [];
  const skippedReasons: Record<string, number> = {};
  let pagesFetched = 0;
  let feedTotal: number | undefined;
  let rawItemsCount = 0;
  let parsedBeforeDedupe = 0;
  let hasNext = true;

  for (let page = 1; page <= CONTINENTAL_CLUB_TIMELY_MAX_PAGES && hasNext; page += 1) {
    const pageResponse = await fetchTimelyFeedPage(page, startDateUtcSeconds);
    checkedUrls.push(pageResponse.url);
    responseStatuses[pageResponse.url] = pageResponse.status;

    if (!pageResponse.ok || !pageResponse.data) {
      warnings.push(`Timely feed page ${page} returned ${pageResponse.status ?? "an unknown error"}.`);
      break;
    }

    pagesFetched += 1;
    const items = getTimelyFeedItems(pageResponse.data);
    rawItemsCount += items.length;
    feedTotal = typeof pageResponse.data.total === "number"
      ? pageResponse.data.total
      : typeof pageResponse.data.meta?.total === "number"
        ? pageResponse.data.meta.total
        : feedTotal;

    hasNext = Boolean(
      pageResponse.data.has_next ??
      pageResponse.data.hasNext ??
      pageResponse.data.meta?.has_next ??
      pageResponse.data.meta?.hasNext,
    );

    for (const item of items) {
      const skipReason = getTimelySkipReason(item);

      if (skipReason) {
        skippedReasons[skipReason] = (skippedReasons[skipReason] ?? 0) + 1;
        continue;
      }

      const event = parseTimelyFeedEvent(item);

      if (!event) {
        skippedReasons["unparsed event"] = (skippedReasons["unparsed event"] ?? 0) + 1;
        continue;
      }

      parsedEvents.push(event);
      parsedBeforeDedupe += 1;
    }
  }

  const events = dedupeTimelyEvents(parsedEvents);
  const today = getHoustonTodayDate();
  const displayWindowEnd = addHoustonDays(today, EVENT_DISPLAY_WINDOW_DAYS);
  const hiddenPastEvents = events.filter((event) => event.dateTime.slice(0, 10) < today);
  const todayEvents = events.filter((event) => event.dateTime.slice(0, 10) === today);
  const inWindowEvents = events.filter((event) => {
    const eventDate = event.dateTime.slice(0, 10);
    return eventDate > today && eventDate <= displayWindowEnd;
  });
  const musicEvents = events.filter((event) => event.sectionCategory === "concert");
  const otherEvents = events.filter((event) => event.sectionCategory === "other");
  const visibleMusicEvents = musicEvents.filter((event) => !event.hiddenReason);
  const lowPriorityMusicEvents = musicEvents.filter((event) => Boolean(event.hiddenReason));
  const visibleOtherEvents = otherEvents.filter((event) => !event.hiddenReason);
  const lowPriorityOtherEvents = otherEvents.filter((event) => Boolean(event.hiddenReason));
  const venueCounts = countTimelyVenueCounts(events);
  const skippedCount = Object.values(skippedReasons).reduce((sum, count) => sum + count, 0);
  const dates = summarizeDates(events);
  const debug: ContinentalClubSourceDebug = {
    urlsChecked: checkedUrls,
    responseStatuses,
    fetchSucceeded: true,
    usefulEventTextFound: officialPageResponse.ok && Boolean(officialPageResponse.html?.length),
    structuredDataEventDetected: false,
    embeddedJsonEventDetected: Boolean(officialPageResponse.html?.match(/events\.timely\.fun|timely/i)),
    visibleEventDatesFound: events.length > 0,
    timelyFeedUrlTemplate: CONTINENTAL_CLUB_TIMELY_FEED_TEMPLATE,
    timelyResponseStatuses: responseStatuses,
    timelyPagesFetched: pagesFetched,
    timelyFeedTotal: feedTotal,
    timelyRawItemsCount: rawItemsCount,
    timelyParsedBeforeDedupe: parsedBeforeDedupe,
    timelyDuplicateEventsRemoved: parsedBeforeDedupe - events.length,
    timelySkippedCount: skippedCount,
    timelySkippedReasons: skippedReasons,
    timelyHiddenPastCount: hiddenPastEvents.length,
    timelyInWindowCount: inWindowEvents.length,
    timelyTodayCount: todayEvents.length,
    timelyMusicCount: musicEvents.length,
    timelyOtherCount: otherEvents.length,
    timelyVenueCounts: venueCounts,
    timelyVisibleMusicCount: visibleMusicEvents.length,
    timelyLowPriorityMusicCount: lowPriorityMusicEvents.length,
    timelyVisibleOtherCount: visibleOtherEvents.length,
    timelyLowPriorityOtherCount: lowPriorityOtherEvents.length,
    timelyVisibleMusicTitles: visibleMusicEvents.slice(0, 6).map((event) => event.title),
    timelyVisibleOtherTitles: visibleOtherEvents.slice(0, 6).map((event) => event.title),
    rawEventCandidates: rawItemsCount,
    parsedValidEvents: events.length,
    parsedBeforeDedupe,
    duplicateRowsRemoved: parsedBeforeDedupe - events.length,
    hiddenPastCount: hiddenPastEvents.length,
    inWindowCount: inWindowEvents.length,
    todayEventCount: todayEvents.length,
    concertRowsParsed: musicEvents.length,
    otherRowsParsed: otherEvents.length,
    skippedRows: skippedCount,
    venueCounts,
    visibleMusicCount: visibleMusicEvents.length,
    lowPriorityMusicCount: lowPriorityMusicEvents.length,
    visibleOtherCount: visibleOtherEvents.length,
    lowPriorityOtherCount: lowPriorityOtherEvents.length,
    visibleMusicTitles: visibleMusicEvents.slice(0, 6).map((event) => event.title),
    visibleOtherTitles: visibleOtherEvents.slice(0, 6).map((event) => event.title),
    earliestEventDate: dates.earliestEventDate,
    latestEventDate: dates.latestEventDate,
    todayChecked: true,
    todayHadEvents: todayEvents.length > 0,
    todayCoverageVerified: true,
    sampleLines: events.length === 0 ? checkedUrls : undefined,
    warnings,
  };

  return {
    events,
    sourceName: CONTINENTAL_CLUB_SOURCE_NAME,
    sourceUrl: CONTINENTAL_CLUB_SOURCE_URL,
    status: events.length > 0 ? "success" : "unavailable",
    message: buildTimelySummary(debug),
    debug,
  };
}

export async function fetchContinentalClubSource(): Promise<ContinentalClubSourceResult> {
  const timelyResult = await fetchContinentalClubTimelySource();

  if (timelyResult.events.length > 0) {
    return timelyResult;
  }

  const staticResult = await fetchContinentalClubStaticSource();

  staticResult.debug.warnings = [
    ...timelyResult.debug.warnings,
    ...staticResult.debug.warnings,
  ];
  staticResult.message = `Official embedded Timely feed was empty or unavailable; using the official page fallback. ${staticResult.message}`;

  return staticResult;
}
