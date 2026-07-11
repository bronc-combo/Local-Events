import { cachedFetch } from "@/lib/source-cache";
import { scoreEvent, type EventSeed } from "@/lib/event-scoring";
import { EVENT_DISPLAY_WINDOW_DAYS } from "@/lib/event-window";
import type { EventItem } from "@/types/dashboard";

export const SEVEN_THIRTEEN_MUSIC_HALL_SOURCE_NAME = "713 Music Hall";
export const SEVEN_THIRTEEN_MUSIC_HALL_SOURCE_URL = "https://www.713musichall.com/";
export const SEVEN_THIRTEEN_MUSIC_HALL_SHOWS_URL = "https://www.713musichall.com/shows";
const SEVEN_THIRTEEN_MUSIC_HALL_USER_AGENT = "DailyOverviewBot/1.0 (+https://localhost)";

export interface SevenThirteenMusicHallSourceDebug {
  urlsChecked: string[];
  fetchSucceeded: boolean;
  responseStatuses?: Record<string, number>;
  cacheStatus?: "live" | "cached" | "cached_fallback" | "failed";
  fetchedTextLength: number;
  homepageReached: boolean;
  showsPageReached: boolean;
  eventListFound: boolean;
  cleanedLineCount: number;
  rawEventCandidates: number;
  parsedBeforeDedupe: number;
  parsedValidEvents: number;
  skippedRows: number;
  skippedReasons: string[];
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

export interface SevenThirteenMusicHallSourceResult {
  events: EventItem[];
  sourceName: string;
  sourceUrl: string;
  status: "success" | "unavailable" | "failed";
  message: string;
  debug: SevenThirteenMusicHallSourceDebug;
}

interface CacheAwareResponse {
  ok: boolean;
  status: number;
  mode?: "live" | "cached" | "cached_fallback" | "failed";
  text(): Promise<string>;
}

interface ParsedSchemaEvent {
  title: string;
  dateTime: string;
  supportActs?: string;
  subtitle?: string;
  description?: string;
  rawGenre?: string;
  price?: string;
  ageRestriction?: string;
  room?: string;
  metadataConfidence?: number;
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

function normalizeMaybeString(value: unknown): string | undefined {
  if (typeof value === "string") {
    const normalized = normalizeWhitespace(value);

    return normalized.length > 0 ? normalized : undefined;
  }

  if (typeof value === "number") {
    return String(value);
  }

  return undefined;
}

function collectTextValues(value: unknown): string[] {
  if (!value) {
    return [];
  }

  if (typeof value === "string" || typeof value === "number") {
    const normalized = normalizeMaybeString(value);
    return normalized ? [normalized] : [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => collectTextValues(item));
  }

  if (typeof value === "object") {
    const objectValue = value as Record<string, unknown>;
    const candidates = [
      objectValue.name,
      objectValue.title,
      objectValue.description,
      objectValue.text,
      objectValue.genre,
    ];

    return candidates.flatMap((candidate) => collectTextValues(candidate));
  }

  return [];
}

function extractJoinedText(value: unknown): string | undefined {
  const text = collectTextValues(value)
    .filter((entry, index, entries) => entries.indexOf(entry) === index)
    .join(", ");

  return text.length > 0 ? text : undefined;
}

function extractPrice(value: unknown): string | undefined {
  if (!value) {
    return undefined;
  }

  if (typeof value === "string" || typeof value === "number") {
    return normalizeMaybeString(value);
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const extracted = extractPrice(item);
      if (extracted) {
        return extracted;
      }
    }

    return undefined;
  }

  if (typeof value === "object") {
    const objectValue = value as Record<string, unknown>;
    const candidates = [
      objectValue.price,
      (objectValue.priceSpecification as Record<string, unknown> | undefined)?.price,
      objectValue.value,
    ];

    for (const candidate of candidates) {
      const extracted = normalizeMaybeString(candidate);
      if (extracted) {
        return extracted;
      }
    }
  }

  return undefined;
}

function countMetadataSignals(listing: ParsedSchemaEvent): number {
  return [
    listing.supportActs,
    listing.description,
    listing.rawGenre,
    listing.price,
    listing.ageRestriction,
    listing.room,
  ].filter((value) => typeof value === "string" && value.trim().length > 0).length;
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

function summarizeDates(events: EventItem[]): {
  earliestEventDate?: string;
  latestEventDate?: string;
} {
  const dates = events
    .map((event) => event.dateTime.slice(0, 10))
    .filter(Boolean)
    .sort();

  return {
    earliestEventDate: dates[0],
    latestEventDate: dates[dates.length - 1],
  };
}

function dedupeEvents(events: ParsedSchemaEvent[]): {
  deduped: ParsedSchemaEvent[];
  duplicateRowsRemoved: number;
} {
  const byKey = new Map<string, ParsedSchemaEvent>();

  for (const event of events) {
    const key = `${event.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}|${event.dateTime}|713-music-hall`;
    if (!byKey.has(key)) {
      byKey.set(key, event);
    }
  }

  return {
    deduped: [...byKey.values()],
    duplicateRowsRemoved: events.length - byKey.size,
  };
}

function inferGenreTags(listing: ParsedSchemaEvent): string[] {
  const normalized = [
    listing.title,
    listing.supportActs,
    listing.subtitle,
    listing.description,
    listing.rawGenre,
    listing.room,
  ]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(" ")
    .toLowerCase();
  const tags = new Set<string>();

  if (listing.rawGenre) {
    const rawGenre = listing.rawGenre.toLowerCase();

    if (rawGenre.includes("post-punk")) {
      tags.add("post-punk");
    }

    if (rawGenre.includes("post-hardcore")) {
      tags.add("post-hardcore");
    }

    if (rawGenre.includes("metal")) {
      tags.add("metal");
    }

    if (rawGenre.includes("electron") || rawGenre.includes("dance")) {
      tags.add("electronic");
      tags.add("dance");
    }

    if (rawGenre.includes("hip hop") || rawGenre.includes("rap")) {
      tags.add("left-field hip-hop");
    }
  }

  if (normalized.includes("sabaton") || normalized.includes("metal")) {
    tags.add("metal");
  }

  if (normalized.includes("morrissey")) {
    tags.add("goth");
    tags.add("post-punk");
  }

  if (normalized.includes("jungle")) {
    tags.add("electronic");
    tags.add("indie");
  }

  if (normalized.includes("wave to earth")) {
    tags.add("indie");
    tags.add("dream pop");
  }

  if (normalized.includes("foster the people")) {
    tags.add("indie");
    tags.add("alt");
  }

  if (normalized.includes("alvaro diaz") || normalized.includes("arcángel") || normalized.includes("arcangel")) {
    tags.add("left-field hip-hop");
  }

  if (normalized.includes("demola")) {
    tags.add("experimental");
  }

  if (normalized.includes("blue october")) {
    tags.add("alt rock");
  }

  if (normalized.includes("role model")) {
    tags.add("indie");
  }

  if (tags.size === 0) {
    tags.add("live music");
  }

  return [...tags];
}

function buildTasteReasons(listing: ParsedSchemaEvent): string[] {
  const reasons: string[] = [];
  const normalized = listing.title.toLowerCase();

  if (
    normalized.includes("sabaton") ||
    normalized.includes("morrissey") ||
    normalized.includes("jungle") ||
    normalized.includes("wave to earth") ||
    normalized.includes("alvaro diaz") ||
    normalized.includes("arcángel") ||
    normalized.includes("arcangel")
  ) {
    reasons.push("genre/title match");
  }

  if (listing.supportActs) {
    reasons.push(`support acts: ${listing.supportActs}`);
  }

  if (listing.rawGenre) {
    reasons.push(`genre: ${listing.rawGenre}`);
  }

  if (listing.subtitle) {
    reasons.push(`subtitle: ${listing.subtitle}`);
  }

  if (listing.price) {
    reasons.push(`price: ${listing.price}`);
  }

  if (listing.metadataConfidence && listing.metadataConfidence > 2) {
    reasons.push("enriched source metadata");
  }

  return reasons;
}

function parseSchemaEvents(html: string, skippedReasons: string[]): ParsedSchemaEvent[] {
  const matches = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi) ?? [];
  const events: ParsedSchemaEvent[] = [];

  for (const match of matches) {
    const jsonMatch = match.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/i);
    const rawJson = jsonMatch?.[1];

    if (!rawJson) {
      skippedReasons.push("Missing JSON-LD payload.");
      continue;
    }

    try {
      const parsed = JSON.parse(rawJson) as Record<string, unknown>;

      if (parsed["@type"] !== "MusicEvent") {
        continue;
      }

      const title = typeof parsed.name === "string" ? normalizeWhitespace(parsed.name) : "";
      const dateTime = typeof parsed.startDate === "string" ? parsed.startDate.trim() : "";

      if (!title || !dateTime) {
        skippedReasons.push("MusicEvent missing title or startDate.");
        continue;
      }

      const supportActs = extractJoinedText(parsed.performer);
      const subtitle = normalizeMaybeString(parsed.headline) ?? normalizeMaybeString(parsed.alternativeHeadline);
      const description = normalizeMaybeString(parsed.description);
      const rawGenre = extractJoinedText(parsed.genre);
      const price = extractPrice(parsed.offers);
      const ageRestriction = extractJoinedText(parsed.typicalAgeRange ?? parsed.audience);
      const room = extractJoinedText((parsed.location as Record<string, unknown> | undefined)?.name ?? parsed.location);
      const metadataConfidence = countMetadataSignals({
        title,
        dateTime,
        supportActs,
        subtitle,
        description,
        rawGenre,
        price,
        ageRestriction,
        room,
      });

      events.push({
        title,
        dateTime,
        supportActs,
        subtitle,
        description,
        rawGenre,
        price,
        ageRestriction,
        room,
        metadataConfidence,
      });
    } catch {
      skippedReasons.push("Invalid JSON-LD event block.");
    }
  }

  return events;
}

function mapParsedEventToEventItem(listing: ParsedSchemaEvent): EventItem {
  const seed: EventSeed = {
    id: `713-music-hall-${listing.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${listing.dateTime.slice(0, 10)}`,
    title: listing.title,
    dateTime: listing.dateTime,
    venue: SEVEN_THIRTEEN_MUSIC_HALL_SOURCE_NAME,
    city: "Houston",
    category: "Concert",
    sectionCategory: "concert",
    genreTags: inferGenreTags(listing),
    sourceLinks: [
      {
        label: SEVEN_THIRTEEN_MUSIC_HALL_SOURCE_NAME,
        url: SEVEN_THIRTEEN_MUSIC_HALL_SHOWS_URL,
      },
    ],
    eventUrl: SEVEN_THIRTEEN_MUSIC_HALL_SHOWS_URL,
    eventUrlLabel: "Source page",
    supportActs: listing.supportActs,
    description: listing.description,
    rawGenre: listing.rawGenre,
    price: listing.price,
    ageRestriction: listing.ageRestriction,
    room: listing.room,
    metadataConfidence: listing.metadataConfidence,
    isGreatLiveAct: false,
    liveReputationStatus: "unknown",
    liveReputationConfidence: 0,
    liveReputationReasons: [],
    liveReputationSources: [],
    venueFitScore: 8,
    knownLiveReputationScore: 0,
    rarityScore: 3,
    distanceRelevanceScore: 7,
    feedbackHistoryPlaceholderScore: 4,
  };

  const event = scoreEvent(seed);
  return {
    ...event,
    tasteReasons: [...event.tasteReasons, ...buildTasteReasons(listing)].filter(
      (reason, index, reasons) => reasons.indexOf(reason) === index,
    ),
  };
}

function buildSummary(debug: SevenThirteenMusicHallSourceDebug): string {
  if (!debug.fetchSucceeded) {
    return "713 Music Hall source could not be loaded.";
  }

  if (!debug.eventListFound) {
    return "713 Music Hall official shows page loaded, but no server-visible MusicEvent rows were found.";
  }

  if (debug.parsedValidEvents === 0) {
    return `713 Music Hall source loaded, but parser found 0 valid events. Raw candidates: ${debug.rawEventCandidates}, skipped: ${debug.skippedRows}.`;
  }

  if (debug.todayHadEvents) {
    return `713 Music Hall loaded from official shows page: ${debug.parsedValidEvents} events parsed, including ${debug.todayEventCount} today.`;
  }

  return `713 Music Hall loaded from official shows page: ${debug.parsedValidEvents} events parsed, earliest ${debug.earliestEventDate ?? "unknown"}. No events found for today.`;
}

export async function fetchSevenThirteenMusicHallSource(): Promise<SevenThirteenMusicHallSourceResult> {
  const urlsChecked = [
    SEVEN_THIRTEEN_MUSIC_HALL_SOURCE_URL,
    SEVEN_THIRTEEN_MUSIC_HALL_SHOWS_URL,
  ];
  const debug: SevenThirteenMusicHallSourceDebug = {
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
    skippedRows: 0,
    skippedReasons: [],
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
    try {
      const homepageResponse = (await cachedFetch(SEVEN_THIRTEEN_MUSIC_HALL_SOURCE_URL, {
        headers: {
          "user-agent": SEVEN_THIRTEEN_MUSIC_HALL_USER_AGENT,
          accept: "text/html,application/xhtml+xml",
        },
        category: "music",
        refreshPolicy: "daily",
        cacheKey: SEVEN_THIRTEEN_MUSIC_HALL_SOURCE_URL,
      })) as CacheAwareResponse;
      const homepageHtml = await homepageResponse.text();
      debug.responseStatuses = {
        homepage: homepageResponse.status,
      };
      debug.cacheStatus = homepageResponse.mode;
      debug.homepageReached = homepageResponse.ok && homepageHtml.includes("713 Music Hall");

      const showsLinkFound =
        homepageHtml.includes('"/shows"') ||
        homepageHtml.includes('https://www.713musichall.com/shows');

      if (!showsLinkFound) {
        debug.warnings.push("Official homepage did not advertise the shows page.");
      }
    } catch (error) {
      debug.warnings.push(
        error instanceof Error
          ? `Homepage fetch warning: ${error.message}`
          : "Homepage fetch warning: official homepage could not be read.",
      );
    }

    const showsResponse = (await cachedFetch(SEVEN_THIRTEEN_MUSIC_HALL_SHOWS_URL, {
      headers: {
        "user-agent": SEVEN_THIRTEEN_MUSIC_HALL_USER_AGENT,
        accept: "text/html,application/xhtml+xml",
      },
      category: "music",
      refreshPolicy: "daily",
      cacheKey: SEVEN_THIRTEEN_MUSIC_HALL_SHOWS_URL,
    })) as CacheAwareResponse;
    const showsHtml = await showsResponse.text();

    debug.fetchSucceeded = showsResponse.ok;
    debug.responseStatuses = {
      ...debug.responseStatuses,
      shows: showsResponse.status,
    };
    debug.showsPageReached = showsResponse.ok && showsHtml.includes("713 Music Hall Upcoming Shows");
    debug.fetchedTextLength = showsHtml.length;
    debug.cleanedLineCount = showsHtml
      .replace(/></g, ">\n<")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean).length;

    const skippedReasons: string[] = [];
    const parsedCandidates = parseSchemaEvents(showsHtml, skippedReasons);
    debug.eventListFound = parsedCandidates.length > 0;
    debug.rawEventCandidates = parsedCandidates.length;
    debug.parsedBeforeDedupe = parsedCandidates.length;
    debug.skippedReasons = skippedReasons;
    debug.skippedRows = skippedReasons.length;

    const { deduped, duplicateRowsRemoved } = dedupeEvents(parsedCandidates);
    debug.duplicateRowsRemoved = duplicateRowsRemoved;

    const scoredEvents = deduped.map(mapParsedEventToEventItem);
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

    if (!debug.showsPageReached) {
      debug.warnings.push("Official shows page title was not found in server HTML.");
    }

    if (!debug.eventListFound) {
      debug.warnings.push("No server-visible MusicEvent blocks were found on the official shows page.");
    }

    if (debug.duplicateRowsRemoved > 0) {
      debug.warnings.push(`Deduped ${debug.duplicateRowsRemoved} duplicate event row(s).`);
    }

    const status: SevenThirteenMusicHallSourceResult["status"] =
      debug.parsedValidEvents > 0 ? "success" : debug.fetchSucceeded ? "unavailable" : "failed";

    return {
      events: scoredEvents,
      sourceName: SEVEN_THIRTEEN_MUSIC_HALL_SOURCE_NAME,
      sourceUrl: SEVEN_THIRTEEN_MUSIC_HALL_SHOWS_URL,
      status,
      message: buildSummary(debug),
      debug,
    };
  } catch (error) {
    debug.warnings.push(
      error instanceof Error ? error.message : "713 Music Hall fetch failed.",
    );

    return {
      events: [],
      sourceName: SEVEN_THIRTEEN_MUSIC_HALL_SOURCE_NAME,
      sourceUrl: SEVEN_THIRTEEN_MUSIC_HALL_SHOWS_URL,
      status: "failed",
      message: "713 Music Hall source could not be loaded.",
      debug,
    };
  }
}
