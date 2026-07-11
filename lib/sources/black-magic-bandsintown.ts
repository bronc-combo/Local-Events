import { scoreEvent, type EventSeed } from "@/lib/event-scoring";
import { EVENT_DISPLAY_WINDOW_DAYS } from "@/lib/event-window";
import { cachedFetch } from "@/lib/source-cache";
import { HOUSTON_VENUE_REGISTRY } from "@/lib/venue-registry";
import type { EventItem } from "@/types/dashboard";

export const BLACK_MAGIC_BANDSINTOWN_SOURCE_NAME = "Black Magic Social Club";
export const BLACK_MAGIC_BANDSINTOWN_SOURCE_URL =
  "https://www.bandsintown.com/v/10281529-black-magic-social-club";
export const BLACK_MAGIC_BANDSINTOWN_SOURCE_KEY = "black-magic-bandsintown";
const HOUSTON_TIME_ZONE = "America/Chicago";
const BLACK_MAGIC_ADDRESS = "7036 Harrisburg Blvd, Houston, TX";
const BLACK_MAGIC_USER_AGENT = "DailyOverviewBot/1.0 (+https://localhost)";

export interface BlackMagicBandsintownSourceDebug {
  urlsChecked: string[];
  responseStatus?: number;
  homepageReached?: boolean;
  venuePageReached?: boolean;
  cleanedLineCount: number;
  rawEventCandidates: number;
  parsedBeforeDedupe: number;
  parsedValidEvents: number;
  duplicateRowsRemoved: number;
  skippedRows: number;
  skippedReasons: string[];
  hiddenPastEventsCount: number;
  displayedInWindowEventsCount: number;
  todayChecked: boolean;
  todayEventsCount: number;
  todayHadEvents: boolean;
  earliestEventDate?: string;
  latestEventDate?: string;
  visibleMusicCount: number;
  lowPriorityMusicCount: number;
  visibleOtherCount: number;
  lowPriorityOtherCount: number;
  visibleTitles: string[];
  lowPriorityMusicTitles: string[];
  lowPriorityOtherTitles: string[];
  warnings: string[];
  sourceTier: "third_party";
  thirdPartySourceName: string;
  sourceDisclosure: string;
  officialSourceStatus: "none" | "blocked" | "unparseable" | "disabled";
}

interface CacheAwareResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

interface ParsedListing {
  id: string;
  title: string;
  date: string;
  dateTime: string;
  timeLabel?: string;
  eventUrl?: string;
  sourceLinks: EventItem["sourceLinks"];
  sectionCategory: EventItem["sectionCategory"];
  category: string;
  eventSubtype?: string;
  genreTags: string[];
  subtitle?: string;
  description?: string;
  supportActs?: string;
  rawGenre?: string;
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

function extractVisibleLines(html: string): string[] {
  return decodeHtmlEntities(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(p|div|li|section|article|h1|h2|h3|h4|h5|h6|a|time|span|button)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
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

function parseDateBlock(month: string, day: string): string | null {
  const monthMap: Record<string, number> = {
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

  const monthNumber = monthMap[month.toLowerCase()];
  const dayNumber = Number(day);

  if (!monthNumber || !Number.isFinite(dayNumber)) {
    return null;
  }

  const today = new Date(getHoustonTodayDate());
  let year = today.getUTCFullYear();
  const candidate = new Date(Date.UTC(year, monthNumber - 1, dayNumber, 12, 0, 0));

  if (candidate < new Date(`${getHoustonTodayDate()}T00:00:00-05:00`)) {
    year += 1;
  }

  return `${year}-${String(monthNumber).padStart(2, "0")}-${String(dayNumber).padStart(2, "0")}`;
}

function parseTimeLabel(line: string): string | undefined {
  const normalized = normalizeWhitespace(line);
  const timeMatch = normalized.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);

  if (!timeMatch) {
    return undefined;
  }

  const endMatch = normalized.match(/\b\d{1,2}(?::\d{2})?\s*(?:-|–|—|to)\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm))\b/i);

  if (endMatch) {
    return `${timeMatch[0]} - ${endMatch[1]}`;
  }

  return timeMatch[0];
}

function classifyListing(title: string, description: string): {
  sectionCategory: EventItem["sectionCategory"];
  category: string;
  eventSubtype: string;
  genreTags: string[];
  rawGenre?: string;
  metadataConfidence: number;
} {
  const normalized = `${title} ${description}`.toLowerCase();
  const isMusic = /music|show|concert|band|dj|tour|punk|metal|rock|post-punk|hardcore|indie|noise|emo|jazz|blues/.test(normalized);

  if (isMusic) {
    const genreTags = new Set<string>();

    if (/punk/.test(normalized)) {
      genreTags.add("punk");
    }

    if (/metal/.test(normalized)) {
      genreTags.add("metal");
    }

    if (/rock/.test(normalized)) {
      genreTags.add("rock");
    }

    if (/jazz/.test(normalized)) {
      genreTags.add("jazz");
    }

    if (/blues/.test(normalized)) {
      genreTags.add("blues");
    }

    if (genreTags.size === 0) {
      genreTags.add("live music");
    }

    return {
      sectionCategory: "concert",
      category: "Music Performance",
      eventSubtype: "Concert",
      genreTags: [...genreTags],
      rawGenre: [...genreTags].join(" / "),
      metadataConfidence: 72,
    };
  }

  return {
    sectionCategory: "other",
    category: "Other Event",
    eventSubtype: "Other Event",
    genreTags: ["community"],
    rawGenre: "Community",
    metadataConfidence: 62,
  };
}

function parseBandsintownRows(lines: string[]): ParsedListing[] {
  const listings: ParsedListing[] = [];
  const monthPattern = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)$/i;

  for (let index = 0; index < lines.length; index += 1) {
    const monthLine = normalizeWhitespace(lines[index] ?? "");

    if (!monthPattern.test(monthLine)) {
      continue;
    }

    const dayLine = normalizeWhitespace(lines[index + 1] ?? "");
    if (!/^\d{1,2}$/.test(dayLine)) {
      continue;
    }

    const date = parseDateBlock(monthLine, dayLine);
    if (!date) {
      continue;
    }

    const title = normalizeWhitespace(lines[index + 2] ?? "");
    if (!title || /tickets|set reminder|follow venue|show more dates/i.test(title)) {
      continue;
    }

    const timeLabel = parseTimeLabel(lines.slice(Math.max(0, index - 2), index + 5).join(" "));
    const description = normalizeWhitespace(lines[index + 3] ?? "");
    const classification = classifyListing(title, description);
    const dateTime = `${date}T${timeLabel ? "19:00:00-05:00" : "12:00:00-05:00"}`;

    listings.push({
      id: `black-magic-bandsintown-${date}-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      title,
      date,
      dateTime,
      timeLabel: timeLabel ?? "Time not listed on source.",
      eventUrl: BLACK_MAGIC_BANDSINTOWN_SOURCE_URL,
      sourceLinks: [{ label: "Source page", url: BLACK_MAGIC_BANDSINTOWN_SOURCE_URL }],
      sectionCategory: classification.sectionCategory,
      category: classification.category,
      eventSubtype: classification.eventSubtype,
      genreTags: classification.genreTags,
      subtitle: description || undefined,
      description: description || undefined,
      supportActs: undefined,
      rawGenre: classification.rawGenre,
      metadataConfidence: classification.metadataConfidence,
    });
  }

  return listings;
}

function dedupeListings(listings: ParsedListing[]): { deduped: ParsedListing[]; duplicateRowsRemoved: number } {
  const byKey = new Map<string, ParsedListing>();
  let duplicateRowsRemoved = 0;

  for (const listing of listings) {
    const key = `${listing.eventUrl ?? listing.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}|${listing.date}|${listing.title}`;
    if (!byKey.has(key)) {
      byKey.set(key, listing);
      continue;
    }

    duplicateRowsRemoved += 1;
  }

  return { deduped: [...byKey.values()], duplicateRowsRemoved };
}

function mapListingToEvent(listing: ParsedListing): EventItem {
  const seed: EventSeed = {
    id: listing.id,
    title: listing.title,
    dateTime: listing.dateTime,
    venue: BLACK_MAGIC_ADDRESS,
    city: "Houston",
    category: listing.category,
    sectionCategory: listing.sectionCategory,
    eventSubtype: listing.eventSubtype,
    sourceLinks: listing.sourceLinks,
    genreTags: listing.genreTags,
    subtitle: listing.subtitle,
    description: listing.description,
    rawGenre: listing.rawGenre,
    metadataConfidence: listing.metadataConfidence,
    price: undefined,
    ageRestriction: undefined,
    supportActs: listing.supportActs,
    isGreatLiveAct: false,
    liveReputationStatus: "unknown",
    liveReputationConfidence: 0,
    liveReputationReasons: [],
    liveReputationSources: [],
    venueFitScore: 0,
    knownLiveReputationScore: 0,
    rarityScore: listing.sectionCategory === "concert" ? 7 : 3,
    distanceRelevanceScore: 6,
    feedbackHistoryPlaceholderScore: 4,
  };

  const scored = scoreEvent(seed);

  return {
    ...scored,
    sourceLabel: BLACK_MAGIC_BANDSINTOWN_SOURCE_NAME,
    sourceLinks: listing.sourceLinks,
    eventUrl: listing.eventUrl,
    eventUrlLabel: "Source page",
    sourceTier: "third_party",
    sourceTrustLabel: "Third-party listing",
    sourceDisclosure: "Third-party listing: Bandsintown, not official venue site",
    thirdPartySourceName: "Bandsintown",
    timeLabel: listing.timeLabel,
    startDate: listing.date,
    endDate: listing.date,
  };
}

function buildSummary(debug: BlackMagicBandsintownSourceDebug): string {
  if (debug.parsedValidEvents === 0) {
    return "Black Magic Social Club third-party listing loaded, but no valid events were parsed.";
  }

  if (debug.todayHadEvents) {
    return `Black Magic Social Club third-party listing parsed ${debug.parsedValidEvents} events, including ${debug.todayEventsCount} today.`;
  }

  return `Black Magic Social Club third-party listing parsed ${debug.parsedValidEvents} events in the current window.`;
}

async function fetchHtml(url: string): Promise<{ ok: boolean; status?: number; html?: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    const response = (await cachedFetch(url, {
      category: "music",
      refreshPolicy: "daily",
      headers: {
        "User-Agent": BLACK_MAGIC_USER_AGENT,
        Accept: "text/html,application/xhtml+xml",
      },
      signal: controller.signal,
      next: { revalidate: 900 },
    })) as unknown as CacheAwareResponse;

    if (!response.ok) {
      return { ok: false, status: response.status };
    }

    return {
      ok: true,
      status: response.status,
      html: await response.text(),
    };
  } catch {
    return { ok: false, status: undefined };
  } finally {
    clearTimeout(timeout);
  }
}

function hasWorkingOfficialBlackMagicProvider(): boolean {
  return HOUSTON_VENUE_REGISTRY.some(
    (venue) =>
      venue.displayName === BLACK_MAGIC_BANDSINTOWN_SOURCE_NAME &&
      venue.parserStatus !== "not_implemented" &&
      venue.providerId !== null,
  );
}

export async function fetchBlackMagicBandsintownSource(): Promise<{
  events: EventItem[];
  sourceName: string;
  sourceUrl: string;
  status: "success" | "unavailable" | "failed";
  message: string;
  debug: BlackMagicBandsintownSourceDebug;
}> {
  const urlsChecked = [BLACK_MAGIC_BANDSINTOWN_SOURCE_URL];

  try {
    if (hasWorkingOfficialBlackMagicProvider()) {
      return {
        events: [],
        sourceName: BLACK_MAGIC_BANDSINTOWN_SOURCE_NAME,
        sourceUrl: BLACK_MAGIC_BANDSINTOWN_SOURCE_URL,
        status: "unavailable",
        message: "Official Black Magic Social Club source is available, so the third-party fallback stayed disabled.",
        debug: {
          urlsChecked,
          responseStatus: undefined,
          homepageReached: false,
          venuePageReached: false,
          cleanedLineCount: 0,
          rawEventCandidates: 0,
          parsedBeforeDedupe: 0,
          parsedValidEvents: 0,
          duplicateRowsRemoved: 0,
          skippedRows: 0,
          skippedReasons: ["Official provider available; third-party fallback skipped."],
          hiddenPastEventsCount: 0,
          displayedInWindowEventsCount: 0,
          todayChecked: false,
          todayEventsCount: 0,
          todayHadEvents: false,
          earliestEventDate: undefined,
          latestEventDate: undefined,
          visibleMusicCount: 0,
          lowPriorityMusicCount: 0,
          visibleOtherCount: 0,
          lowPriorityOtherCount: 0,
          visibleTitles: [],
          lowPriorityMusicTitles: [],
          lowPriorityOtherTitles: [],
          warnings: ["Official provider available; third-party fallback skipped."],
          sourceTier: "third_party",
          thirdPartySourceName: "Bandsintown",
          sourceDisclosure: "Third-party listing: Bandsintown, not official venue site",
          officialSourceStatus: "disabled",
        },
      };
    }

    const venueResponse = await fetchHtml(BLACK_MAGIC_BANDSINTOWN_SOURCE_URL);
    const venuePageReached = Boolean(venueResponse.ok && venueResponse.html);
    const lines = venueResponse.html ? extractVisibleLines(venueResponse.html) : [];
    const listings = venueResponse.html ? parseBandsintownRows(lines) : [];
    const parsedBeforeDedupe = listings.length;
    const { deduped, duplicateRowsRemoved } = dedupeListings(listings);
    const mappedEvents = deduped.map(mapListingToEvent).sort((left, right) => left.dateTime.localeCompare(right.dateTime));
    const today = getHoustonTodayDate();
    const windowEnd = addDays(today, EVENT_DISPLAY_WINDOW_DAYS);
    const inWindowEvents = mappedEvents.filter((event) => event.dateTime.slice(0, 10) >= today && event.dateTime.slice(0, 10) <= windowEnd);
    const visibleEvents = inWindowEvents.filter((event) => !event.hiddenReason);
    const todayEvents = visibleEvents.filter((event) => event.dateTime.slice(0, 10) === today);
    const visibleMusicEvents = visibleEvents.filter((event) => event.sectionCategory === "concert");
    const lowPriorityMusicEvents = inWindowEvents.filter((event) => event.sectionCategory === "concert" && Boolean(event.hiddenReason));
    const visibleOtherEvents = visibleEvents.filter((event) => event.sectionCategory === "other");
    const lowPriorityOtherEvents = inWindowEvents.filter((event) => event.sectionCategory === "other" && Boolean(event.hiddenReason));
    const dates = visibleEvents.length > 0
      ? {
          earliestEventDate: visibleEvents[0]?.dateTime.slice(0, 10),
          latestEventDate: visibleEvents.at(-1)?.dateTime.slice(0, 10),
        }
      : {};

    const debug: BlackMagicBandsintownSourceDebug = {
      urlsChecked,
      responseStatus: venueResponse.status,
      homepageReached: false,
      venuePageReached,
      cleanedLineCount: lines.length,
      rawEventCandidates: listings.length,
      parsedBeforeDedupe,
      parsedValidEvents: mappedEvents.length,
      duplicateRowsRemoved,
      skippedRows: 0,
      skippedReasons: [],
      hiddenPastEventsCount: Math.max(mappedEvents.length - inWindowEvents.length, 0),
      displayedInWindowEventsCount: visibleEvents.length,
      todayChecked: true,
      todayEventsCount: todayEvents.length,
      todayHadEvents: todayEvents.length > 0,
      earliestEventDate: dates.earliestEventDate,
      latestEventDate: dates.latestEventDate,
      visibleMusicCount: visibleMusicEvents.length,
      lowPriorityMusicCount: lowPriorityMusicEvents.length,
      visibleOtherCount: visibleOtherEvents.length,
      lowPriorityOtherCount: lowPriorityOtherEvents.length,
      visibleTitles: visibleEvents.slice(0, 6).map((event) => event.title),
      lowPriorityMusicTitles: lowPriorityMusicEvents.slice(0, 4).map((event) => event.title),
      lowPriorityOtherTitles: lowPriorityOtherEvents.slice(0, 4).map((event) => event.title),
      warnings: [],
      sourceTier: "third_party",
      thirdPartySourceName: "Bandsintown",
      sourceDisclosure: "Third-party listing: Bandsintown, not official venue site",
      officialSourceStatus: "unparseable",
    };

    const hasEvents = visibleEvents.length > 0;

    return {
      events: visibleEvents,
      sourceName: BLACK_MAGIC_BANDSINTOWN_SOURCE_NAME,
      sourceUrl: BLACK_MAGIC_BANDSINTOWN_SOURCE_URL,
      status: hasEvents ? "success" : "unavailable",
      message: buildSummary(debug),
      debug,
    };
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : "Black Magic Social Club Bandsintown fallback failed.";

    return {
      events: [],
      sourceName: BLACK_MAGIC_BANDSINTOWN_SOURCE_NAME,
      sourceUrl: BLACK_MAGIC_BANDSINTOWN_SOURCE_URL,
      status: "failed",
      message,
      debug: {
        urlsChecked,
        responseStatus: undefined,
        homepageReached: false,
        venuePageReached: false,
        cleanedLineCount: 0,
        rawEventCandidates: 0,
        parsedBeforeDedupe: 0,
        parsedValidEvents: 0,
        duplicateRowsRemoved: 0,
        skippedRows: 0,
        skippedReasons: [message],
        hiddenPastEventsCount: 0,
        displayedInWindowEventsCount: 0,
        todayChecked: false,
        todayEventsCount: 0,
        todayHadEvents: false,
        visibleMusicCount: 0,
        lowPriorityMusicCount: 0,
        visibleOtherCount: 0,
        lowPriorityOtherCount: 0,
        visibleTitles: [],
        lowPriorityMusicTitles: [],
        lowPriorityOtherTitles: [],
        warnings: [message],
        sourceTier: "third_party",
        thirdPartySourceName: "Bandsintown",
        sourceDisclosure: "Third-party listing: Bandsintown, not official venue site",
        officialSourceStatus: "unparseable",
      },
    };
  }
}
