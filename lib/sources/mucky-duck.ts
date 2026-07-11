import { scoreEvent, type EventSeed } from "@/lib/event-scoring";
import { EVENT_DISPLAY_WINDOW_DAYS } from "@/lib/event-window";
import { cachedFetch, installSourceCache } from "@/lib/source-cache";
import type { EventItem } from "@/types/dashboard";

export const MUCKY_DUCK_SOURCE_NAME = "McGonigel’s Mucky Duck";
export const MUCKY_DUCK_SOURCE_URL = "https://www.mcgonigels.com/";
const MUCKY_DUCK_USER_AGENT = "DailyOverviewBot/1.0 (+https://localhost)";

export interface MuckyDuckSourceDebug {
  urlsChecked: string[];
  fetchSucceeded: boolean;
  responseStatus?: number;
  cacheStatus?: "live" | "cached" | "cached_fallback" | "failed";
  homepageReached: boolean;
  showCardsFound: boolean;
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
  todayChecked: boolean;
  todayEventCount: number;
  todayHadEvents: boolean;
  todayCoverageVerified: boolean;
  earliestEventDate?: string;
  latestEventDate?: string;
  warnings: string[];
}

export interface MuckyDuckSourceResult {
  events: EventItem[];
  sourceName: string;
  sourceUrl: string;
  status: "success" | "unavailable" | "failed";
  message: string;
  debug: MuckyDuckSourceDebug;
}

interface CacheAwareResponse {
  ok: boolean;
  status: number;
  mode?: "live" | "cached" | "cached_fallback" | "failed";
  text(): Promise<string>;
}

interface MuckyDuckParsedListing {
  id: string;
  title: string;
  dateTime: string;
  eventUrl: string;
  timeLabel?: string;
  dataTags?: string;
  sourceThemeTags?: string[];
  mainArtist?: string[];
  image?: string;
  eventSubtype?: string;
  supportActs?: string;
  structured: boolean;
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

function splitTags(value?: string): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(/[|,/]+/)
    .map((item) => normalizeWhitespace(item))
    .filter(Boolean);
}

function normalizeGenreTag(tag: string): string | null {
  const normalized = tag.toLowerCase();

  if (/americana/.test(normalized)) {
    return "americana";
  }

  if (/folk|songwriter/.test(normalized)) {
    return "folk";
  }

  if (/irish|celtic/.test(normalized)) {
    return "irish";
  }

  if (/blues?/.test(normalized)) {
    return "blues";
  }

  if (/country/.test(normalized)) {
    return "country";
  }

  if (/acoustic/.test(normalized)) {
    return "acoustic";
  }

  if (/roots/.test(normalized)) {
    return "roots";
  }

  if (/bluegrass/.test(normalized)) {
    return "bluegrass";
  }

  return null;
}

function inferGenreTags(title: string, sourceTags: string[], sourceThemeTags: string[], mainArtist?: string[]): string[] {
  const normalized = `${title} ${mainArtist?.join(" ") ?? ""} ${sourceTags.join(" ")} ${sourceThemeTags.join(" ")}`.toLowerCase();
  const tags = new Set<string>();

  if (/songwriter/.test(normalized)) {
    tags.add("songwriter");
    tags.add("folk");
  }

  if (/blues/.test(normalized)) {
    tags.add("blues");
  }

  if (/country|americana/.test(normalized)) {
    tags.add("americana");
    tags.add("country");
  }

  if (/irish|celtic/.test(normalized)) {
    tags.add("irish");
    tags.add("folk");
  }

  if (/acoustic/.test(normalized)) {
    tags.add("acoustic");
  }

  if (/roots/.test(normalized)) {
    tags.add("roots");
  }

  if (/bluegrass/.test(normalized)) {
    tags.add("bluegrass");
  }

  for (const tag of [...sourceTags, ...sourceThemeTags]) {
    const normalizedTag = normalizeGenreTag(tag);

    if (normalizedTag) {
      tags.add(normalizedTag);
    }
  }

  if (tags.size === 0) {
    tags.add("live music");
  }

  return [...tags];
}

function parseTitleMetadata(title: string): {
  displayTitle: string;
  eventSubtype?: string;
  supportActs?: string;
  structured: boolean;
} {
  const normalizedTitle = stripTags(title);
  const descriptorMatch = normalizedTitle.match(
    /^(.*?)(?:\s+[–—-]\s+|\s+with\s+|\s+featuring\s+)(.+)$/i,
  );
  const structuredByTitle =
    /early show|late show|songwriters? night|songswap|solo|band|acoustic|showcase|trio|duo|night/i.test(normalizedTitle);
  const mapSubtype = (value: string): string => {
    if (/early show/i.test(value)) {
      return "Early Show";
    }
    if (/late show/i.test(value)) {
      return "Late Show";
    }
    if (/songwriters? night/i.test(value)) {
      return "Songwriters Night";
    }
    if (/songswap/i.test(value)) {
      return "Songswap";
    }
    if (/solo/i.test(value)) {
      return "Solo";
    }
    if (/band/i.test(value)) {
      return "Band";
    }
    if (/acoustic/i.test(value)) {
      return "Acoustic";
    }
    if (/showcase/i.test(value)) {
      return "Showcase";
    }
    if (/night/i.test(value)) {
      return "Night";
    }
    return normalizeWhitespace(value);
  };

  if (descriptorMatch) {
    const left = normalizeWhitespace(descriptorMatch[1]);
    const right = normalizeWhitespace(descriptorMatch[2]);
    const leftLooksLikeDescriptor = structuredByTitle || /early show|late show|songwriters? night|songswap|solo|band|acoustic|showcase|night/i.test(left);
    const rightLooksLikeDescriptor = /early show|late show|songwriters? night|songswap|solo|band|acoustic|showcase|night/i.test(right);

    if (leftLooksLikeDescriptor) {
      return {
        displayTitle: normalizedTitle,
        eventSubtype: mapSubtype(left),
        supportActs: right,
        structured: true,
      };
    }

    if (rightLooksLikeDescriptor) {
      return {
        displayTitle: normalizedTitle,
        eventSubtype: mapSubtype(right),
        supportActs: left,
        structured: true,
      };
    }

    return {
      displayTitle: normalizedTitle,
      supportActs: right,
      structured: true,
    };
  }

  const coBillMatch = normalizedTitle.match(/^(.*?)(?:\s+&\s+|\s+and\s+|\s*\/\s*|\s+\+\s+)(.+)$/i);

  if (coBillMatch) {
    const left = normalizeWhitespace(coBillMatch[1]);
    const right = normalizeWhitespace(coBillMatch[2]);

    return {
      displayTitle: normalizedTitle,
      eventSubtype: "Co-bill",
      supportActs: [left, right].filter(Boolean).join(" · "),
      structured: true,
    };
  }

  if (structuredByTitle) {
    return {
      displayTitle: normalizedTitle,
      eventSubtype: mapSubtype(normalizedTitle),
      structured: true,
    };
  }

  return {
    displayTitle: normalizedTitle,
    structured: false,
  };
}

function getSourceThemeTags(html: string): string[] {
  const tags = new Set<string>();
  const lowerHtml = html.toLowerCase();

  if (lowerHtml.includes("americana")) {
    tags.add("americana");
  }

  if (lowerHtml.includes("folk")) {
    tags.add("folk");
  }

  if (lowerHtml.includes("irish")) {
    tags.add("irish");
  }

  if (lowerHtml.includes("celtic")) {
    tags.add("irish");
  }

  return [...tags];
}

function parseEventDate(eventDateText: string): string | null {
  const match = eventDateText.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s*([ap]m)$/i);

  if (!match) {
    return null;
  }

  const month = Number(match[1]);
  const day = Number(match[2]);
  const year = Number(match[3]);
  let hours = Number(match[4]);
  const minutes = match[5];
  const meridiem = match[6].toLowerCase();

  if (Number.isNaN(month) || Number.isNaN(day) || Number.isNaN(year) || Number.isNaN(hours)) {
    return null;
  }

  if (meridiem === "pm" && hours !== 12) {
    hours += 12;
  }

  if (meridiem === "am" && hours === 12) {
    hours = 0;
  }

  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${String(hours).padStart(2, "0")}:${minutes}:00-05:00`;
}

function parseMuckyDuckListings(
  html: string,
  debug: MuckyDuckSourceDebug,
): MuckyDuckParsedListing[] {
  const eventDatesById = new Map<string, { eventDate: string; mainArtist: string[]; image?: string }>();
  const eventObjectPattern =
    /eventObjects\.push\(\{\s*"id":\s*(\d+),\s*"eventDate":\s*"([^"]+)"[\s\S]*?"mainArtist":\s*\[((?:[\s\S]*?)?)\][\s\S]*?"image":\s*"([^"]+)"/gi;

  let objectMatch: RegExpExecArray | null;
  while ((objectMatch = eventObjectPattern.exec(html)) !== null) {
    const mainArtistMatches = objectMatch[3].match(/"([^"]+)"/g) ?? [];
    eventDatesById.set(objectMatch[1], {
      eventDate: objectMatch[2],
      mainArtist: mainArtistMatches.map((value) => value.replace(/^"|"$/g, "")),
      image: objectMatch[4],
    });
  }

  const pageThemeTags = getSourceThemeTags(html);
  const listings: MuckyDuckParsedListing[] = [];
  const cardPattern =
    /<div class="card h-100 tessera-show-card" id="(\d+)"[^>]*data-tags="([^"]*)"[\s\S]*?<a href="([^"]+)"><img[^>]*>[\s\S]*?<span class="date">([^<]+)<\/span>[\s\S]*?<a href="([^"]+)"><h4 class="card-title">([\s\S]*?)<\/h4><\/a>[\s\S]*?<div class="tessera-showTimes">\s*([\s\S]*?)\s*<\/div>/gi;

  let match: RegExpExecArray | null;
  while ((match = cardPattern.exec(html)) !== null) {
    const eventDetails = eventDatesById.get(match[1]);

    if (!eventDetails) {
      continue;
    }

    const parsedTitle = parseTitleMetadata(match[6]);
    const dataTags = normalizeWhitespace(match[2]);
    const usePageThemeTags = parsedTitle.structured || splitTags(dataTags).length > 0;
    const sourceThemeTags = usePageThemeTags ? pageThemeTags : [];
    const dateTime = parseEventDate(eventDetails.eventDate);

    if (!dateTime) {
      continue;
    }

    listings.push({
      id: `mucky-duck-${match[1]}`,
      title: parsedTitle.displayTitle,
      dateTime,
      eventUrl: match[5] || match[3] || MUCKY_DUCK_SOURCE_URL,
      timeLabel: normalizeWhitespace(match[7]),
      dataTags,
      sourceThemeTags: sourceThemeTags,
      mainArtist: eventDetails.mainArtist,
      image: eventDetails.image,
      eventSubtype: parsedTitle.eventSubtype,
      supportActs: parsedTitle.supportActs,
      structured: parsedTitle.structured,
    });
  }

  debug.rawEventCandidates = eventDatesById.size;
  debug.parsedBeforeDedupe = listings.length;
  debug.showCardsFound = listings.length > 0;

  return listings;
}

function dedupeListings(listings: MuckyDuckParsedListing[], debug: MuckyDuckSourceDebug): MuckyDuckParsedListing[] {
  const byKey = new Map<string, MuckyDuckParsedListing>();

  for (const listing of listings) {
    const key = `${listing.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}|${listing.dateTime.slice(0, 10)}|${listing.eventUrl}`;

    if (!byKey.has(key)) {
      byKey.set(key, listing);
    }
  }

  debug.duplicateRowsRemoved = Math.max(0, listings.length - byKey.size);

  return [...byKey.values()].sort((left, right) => left.dateTime.localeCompare(right.dateTime));
}

function mapListingToEvent(listing: MuckyDuckParsedListing): EventItem {
  const sourceThemeTags = listing.structured ? (listing.sourceThemeTags ?? []) : [];
  const dataTags = splitTags(listing.dataTags);
  const genreTags = inferGenreTags(
    listing.title,
    dataTags,
    sourceThemeTags,
    listing.mainArtist,
  );
  const supportActs = [listing.supportActs, listing.mainArtist?.join(", ")].filter(Boolean).join(", ");
  const metadataConfidence = [
    listing.supportActs,
    listing.eventSubtype,
    dataTags.length > 0 ? dataTags.join(", ") : undefined,
    sourceThemeTags.length > 0 ? sourceThemeTags.join(", ") : undefined,
    listing.mainArtist?.length ? listing.mainArtist.join(", ") : undefined,
  ].filter(Boolean).length;
  const rarityScore = listing.structured || dataTags.length > 0 || sourceThemeTags.length > 0 ? 5 : 0;
  const eventSubtype = listing.eventSubtype ?? (listing.timeLabel?.toLowerCase().includes("showtime") ? "Showtime" : undefined);

  const seed: EventSeed = {
    id: listing.id,
    title: listing.title,
    dateTime: listing.dateTime,
    venue: MUCKY_DUCK_SOURCE_NAME,
    city: "Houston",
    category: "Music Performance",
    sectionCategory: "concert",
    eventSubtype,
    genreTags,
    sourceLinks: [
      {
        label: "Event page",
        url: listing.eventUrl,
      },
      {
        label: "Source page",
        url: MUCKY_DUCK_SOURCE_URL,
      },
    ],
    eventUrl: listing.eventUrl,
    eventUrlLabel: "Event page",
    supportActs: supportActs || undefined,
    subtitle: eventSubtype ?? listing.timeLabel,
    description: [
      "Official McGonigel’s Mucky Duck show listing.",
      dataTags.length > 0 ? `Page tags: ${dataTags.join(" | ")}` : null,
      sourceThemeTags.length > 0 ? `Homepage music context: ${sourceThemeTags.join(", ")}` : null,
    ]
      .filter(Boolean)
      .join(" · "),
    rawGenre: [dataTags.join(", "), sourceThemeTags.join(", ")].filter(Boolean).join(" | ") || undefined,
    metadataConfidence,
    isGreatLiveAct: false,
    liveReputationStatus: "unknown",
    liveReputationConfidence: 0,
    liveReputationReasons: [],
    liveReputationSources: [],
    venueFitScore: 0,
    knownLiveReputationScore: 0,
    rarityScore,
    distanceRelevanceScore: 0,
    feedbackHistoryPlaceholderScore: 0,
    similarArtists: listing.mainArtist?.length ? listing.mainArtist : undefined,
  };

  const scoredEvent = scoreEvent(seed);

  return {
    ...scoredEvent,
    sourceLabel: MUCKY_DUCK_SOURCE_NAME,
    timeLabel: listing.timeLabel,
  };
}

function buildSummary(debug: MuckyDuckSourceDebug): string {
  if (!debug.fetchSucceeded) {
    return "McGonigel’s Mucky Duck source could not be loaded.";
  }

  if (debug.parsedValidEvents === 0) {
    return `McGonigel’s Mucky Duck loaded, but parser found 0 valid events. Raw candidates: ${debug.rawEventCandidates}.`;
  }

  if (debug.todayHadEvents) {
    return `McGonigel’s Mucky Duck loaded from official homepage: ${debug.parsedValidEvents} events parsed, including ${debug.todayEventCount} today.`;
  }

  return `McGonigel’s Mucky Duck loaded from official homepage: ${debug.parsedValidEvents} events parsed, earliest ${debug.earliestEventDate ?? "unknown"}. No events found for today.`;
}

async function fetchPage(url: string): Promise<CacheAwareResponse> {
  return cachedFetch(url, {
    cache: "no-store",
    category: "music",
    refreshPolicy: "daily",
    headers: {
      "user-agent": MUCKY_DUCK_USER_AGENT,
    },
  }) as unknown as Promise<CacheAwareResponse>;
}

export async function fetchMuckyDuckSource(): Promise<MuckyDuckSourceResult> {
  installSourceCache();

  const debug: MuckyDuckSourceDebug = {
    urlsChecked: [MUCKY_DUCK_SOURCE_URL],
    fetchSucceeded: false,
    homepageReached: false,
    showCardsFound: false,
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
    todayChecked: false,
    todayEventCount: 0,
    todayHadEvents: false,
    todayCoverageVerified: false,
    warnings: [],
  };

  try {
    const response = await fetchPage(MUCKY_DUCK_SOURCE_URL);
    debug.responseStatus = response.status;
    debug.cacheStatus = response.mode;
    const html = await response.text();
    debug.cleanedLineCount = extractVisibleText(html).split("\n").filter(Boolean).length;
    debug.homepageReached = /tessera-show-card/i.test(html);

    const parsedListings = parseMuckyDuckListings(html, debug);
    const dedupedListings = dedupeListings(parsedListings, debug);
    const parsedEvents = dedupedListings.map(mapListingToEvent);
    const today = getHoustonTodayDate();
    const windowEnd = addDays(today, EVENT_DISPLAY_WINDOW_DAYS);
    const inWindowEvents = parsedEvents.filter((event) => {
      const eventDate = event.dateTime.slice(0, 10);
      return eventDate >= today && eventDate <= windowEnd;
    });
    const visibleUpcoming = inWindowEvents.filter((event) => !event.hiddenReason);
    const lowPriorityUpcoming = inWindowEvents.filter((event) => Boolean(event.hiddenReason));
    const todayEvents = parsedEvents.filter((event) => event.dateTime.slice(0, 10) === today);
    const dateSummary = summarizeDates(parsedEvents);

    debug.parsedValidEvents = parsedEvents.length;
    debug.hiddenPastShows = parsedEvents.filter((event) => event.dateTime.slice(0, 10) < today).length;
    debug.displayedInWindowShows = inWindowEvents.length;
    debug.visibleUpcomingShowsCount = visibleUpcoming.length;
    debug.lowPriorityUpcomingShowsCount = lowPriorityUpcoming.length;
    debug.visibleUpcomingTitles = visibleUpcoming.slice(0, 6).map((event) => event.title);
    debug.todayChecked = true;
    debug.todayEventCount = todayEvents.length;
    debug.todayHadEvents = todayEvents.length > 0;
    debug.todayCoverageVerified = true;
    debug.earliestEventDate = dateSummary.earliestEventDate;
    debug.latestEventDate = dateSummary.latestEventDate;
    debug.fetchSucceeded = true;

    return {
      events: inWindowEvents,
      sourceName: MUCKY_DUCK_SOURCE_NAME,
      sourceUrl: MUCKY_DUCK_SOURCE_URL,
      status: parsedEvents.length > 0 ? "success" : "unavailable",
      message: buildSummary(debug),
      debug,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "McGonigel’s Mucky Duck source failed to load.";

    debug.warnings.push(message);
    debug.fetchSucceeded = false;
    debug.cacheStatus = "failed";

    return {
      events: [],
      sourceName: MUCKY_DUCK_SOURCE_NAME,
      sourceUrl: MUCKY_DUCK_SOURCE_URL,
      status: "failed",
      message: "McGonigel’s Mucky Duck source failed to load.",
      debug,
    };
  }
}
