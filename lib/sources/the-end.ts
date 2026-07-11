import { scoreEvent, type EventSeed } from "@/lib/event-scoring";
import { EVENT_DISPLAY_WINDOW_DAYS } from "@/lib/event-window";
import type { EventItem } from "@/types/dashboard";

export const THE_END_SOURCE_NAME = "The End";
export const THE_END_SOURCE_URL = "https://www.theendhtx.com/";
const THE_END_USER_AGENT = "DailyOverviewBot/1.0 (+https://localhost)";

export interface TheEndSourceDebug {
  urlsChecked: string[];
  fetchSucceeded: boolean;
  responseStatus?: number;
  homepageReached: boolean;
  upcomingShowsSectionFound: boolean;
  usefulEventTextFound: boolean;
  cleanedLineCount: number;
  rawEventCandidates: number;
  parsedBeforeDedupe: number;
  parsedValidEvents: number;
  duplicateRowsRemoved: number;
  hiddenPastShows: number;
  displayedInWindowShows: number;
  visibleUpcomingShowsCount: number;
  lowPriorityUpcomingShowsCount: number;
  todayChecked: boolean;
  todayEventCount: number;
  todayHadEvents: boolean;
  todayCoverageVerified: boolean;
  earliestEventDate?: string;
  latestEventDate?: string;
  warnings: string[];
}

export interface TheEndSourceResult {
  events: EventItem[];
  sourceName: string;
  sourceUrl: string;
  status: "success" | "unavailable" | "failed";
  message: string;
  debug: TheEndSourceDebug;
}

interface TheEndParsedListing {
  title: string;
  dateTime: string;
  eventUrl: string;
  supportActs?: string;
  subtitle?: string;
  description?: string;
  rawGenre?: string;
  price?: string;
  room?: string;
  metadataConfidence?: number;
}

interface TheEndEmbeddedDateInfo {
  startDateISOFormatNotUTC: string;
  startTime?: string;
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

function inferGenreTags(title: string, supportActs?: string): string[] {
  const normalized = `${title} ${supportActs ?? ""}`.toLowerCase();
  const tags = new Set<string>();

  if (/post[-\s]?hardcore/.test(normalized)) {
    tags.add("post-hardcore");
    tags.add("hardcore");
  }

  if (/hardcore|punk/.test(normalized)) {
    tags.add("punk");
    tags.add("hardcore");
  }

  if (/metal|sludge|doom|death|black/.test(normalized)) {
    tags.add("metal");
    tags.add("doom metal");
  }

  if (/noise/.test(normalized)) {
    tags.add("noise rock");
  }

  if (/math/.test(normalized)) {
    tags.add("math rock");
  }

  if (/emo/.test(normalized)) {
    tags.add("emo");
  }

  if (/indie|alt|alternative/.test(normalized)) {
    tags.add("indie rock");
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

function mapListingToEvent(listing: TheEndParsedListing): EventItem {
  const genreTags = inferGenreTags(listing.title, listing.supportActs);
  const seed: EventSeed = {
    id: `the-end-${listing.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${listing.dateTime.slice(0, 10)}`,
    title: listing.title,
    dateTime: listing.dateTime,
    venue: THE_END_SOURCE_NAME,
    city: "Houston",
    category: "Concert",
    genreTags,
    sourceLinks: [
      {
        label: THE_END_SOURCE_NAME,
        url: listing.eventUrl || THE_END_SOURCE_URL,
      },
    ],
    supportActs: listing.supportActs,
    subtitle: listing.subtitle,
    description: listing.description,
    rawGenre: listing.rawGenre,
    price: listing.price,
    room: listing.room,
    metadataConfidence: listing.metadataConfidence,
    isGreatLiveAct: false,
    liveReputationStatus: "unknown",
    liveReputationConfidence: 0,
    liveReputationReasons: [],
    liveReputationSources: [],
    venueFitScore: 18,
    knownLiveReputationScore: 12,
    rarityScore: 9,
    distanceRelevanceScore: 9,
    feedbackHistoryPlaceholderScore: 5,
  };

  const scoredEvent = scoreEvent(seed);
  const supportActsNote = listing.supportActs
    ? [`support acts: ${listing.supportActs}`]
    : [];

  return {
    ...scoredEvent,
    sourceLabel: THE_END_SOURCE_NAME,
    tasteReasons: [...scoredEvent.tasteReasons, ...supportActsNote],
  };
}

function extractEmbeddedDateMap(html: string): Map<string, TheEndEmbeddedDateInfo> {
  const dateMap = new Map<string, TheEndEmbeddedDateInfo>();
  const pattern =
    /"([a-f0-9-]{36})":\{"utcOffset":-300,"startDateISOFormatNotUTC":"([^"]+)","endDateISOFormatNotUTC":"([^"]+)","monthDay":"([^"]+)","weekDay":"([^"]+)","month":"([^"]+)","fullDate":"([^"]+)","shortStartDate":"([^"]+)","shortStartDateTime":"([^"]+)","startDate":"([^"]+)","startTime":"([^"]+)"/g;

  for (const match of html.matchAll(pattern)) {
    dateMap.set(match[1], {
      startDateISOFormatNotUTC: match[2],
      startTime: match[11],
    });
  }

  return dateMap;
}

function parseTheEndCards(html: string): {
  listings: TheEndParsedListing[];
  homepageReached: boolean;
  upcomingShowsSectionFound: boolean;
  usefulEventTextFound: boolean;
  cleanedLineCount: number;
} {
  const visibleText = extractVisibleText(html);
  const cleanedLines = visibleText
    .split(/\n+/)
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean);
  const cards = html.match(/<li class="qElViY" data-hook="events-card">[\s\S]*?<\/li>/g) ?? [];
  const dateMap = extractEmbeddedDateMap(html);

  const listings = cards.flatMap((cardHtml) => {
    const titleMatch = cardHtml.match(
      /<a[^>]*data-hook="title"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i,
    );
    const shortDateMatch = cardHtml.match(/data-hook="short-date">([\s\S]*?)<\/div>/i);
    const moreInfoMatch = cardHtml.match(/data-hook="more-info-link-([a-f0-9-]+)"/i);

    if (!titleMatch || !shortDateMatch || !moreInfoMatch) {
      return [];
    }

    const title = normalizeWhitespace(titleMatch[2]);
    const eventId = moreInfoMatch[1];
    const embeddedDate = dateMap.get(eventId);
    const dateTime = embeddedDate?.startDateISOFormatNotUTC;

    if (!dateTime) {
      return [];
    }

    const supportMatch = title.match(/\s(?:w\/|with)\s+(.+)$/i);
    const supportActs = supportMatch ? supportMatch[1].trim() : undefined;
    const cleanedTitle = supportActs ? title.replace(/\s(?:w\/|with)\s+(.+)$/i, "").trim() : title;

    return [
      {
        title: cleanedTitle,
        dateTime,
        eventUrl: titleMatch[1],
        supportActs,
        metadataConfidence: [supportActs].filter(Boolean).length,
      },
    ];
  });

  return {
    listings,
    homepageReached: /The End/i.test(html),
    upcomingShowsSectionFound: /Upcoming shows/i.test(html),
    usefulEventTextFound: cards.length > 0,
    cleanedLineCount: cleanedLines.length,
  };
}

function dedupeListings(listings: TheEndParsedListing[]): {
  listings: TheEndParsedListing[];
  duplicateRowsRemoved: number;
} {
  const byKey = new Map<string, TheEndParsedListing>();

  for (const listing of listings) {
    const key = `${listing.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}|${listing.dateTime}|${listing.eventUrl}`;
    byKey.set(key, listing);
  }

  return {
    listings: [...byKey.values()],
    duplicateRowsRemoved: listings.length - byKey.size,
  };
}

function buildTheEndSummary(debug: TheEndSourceDebug): string {
  if (!debug.fetchSucceeded) {
    return "The End source could not be loaded.";
  }

  if (!debug.todayCoverageVerified) {
    return "The End source loaded, but today-specific coverage could not be verified.";
  }

  if (debug.parsedValidEvents === 0) {
    return `The End source loaded, but parser found 0 valid events. Lines: ${debug.cleanedLineCount}.`;
  }

  const visibleUpcomingText = debug.visibleUpcomingShowsCount > 0
    ? `${debug.visibleUpcomingShowsCount} visible upcoming`
    : "no visible upcoming";
  const lowPriorityText = debug.lowPriorityUpcomingShowsCount > 0
    ? `${debug.lowPriorityUpcomingShowsCount} low-priority upcoming`
    : "no low-priority upcoming";
  const todayText = debug.todayEventCount > 0
    ? `${debug.todayEventCount} today`
    : "no events today";

  return `The End loaded from official homepage: ${debug.parsedValidEvents} events parsed, ${visibleUpcomingText}, ${lowPriorityText}, ${todayText}.`;
}

export async function fetchTheEndSource(): Promise<TheEndSourceResult> {
  const urlsChecked = [THE_END_SOURCE_URL];
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  const warnings: string[] = [];
  let responseStatus: number | undefined;

  try {
    const response = await fetch(THE_END_SOURCE_URL, {
      headers: {
        "user-agent": THE_END_USER_AGENT,
        accept: "text/html,application/xhtml+xml",
      },
      cache: "no-store",
      signal: controller.signal,
    });
    responseStatus = response.status;

    if (!response.ok) {
      warnings.push(`Unexpected response status ${response.status}.`);
      const debug: TheEndSourceDebug = {
        urlsChecked,
        fetchSucceeded: false,
        responseStatus,
        homepageReached: false,
        upcomingShowsSectionFound: false,
        usefulEventTextFound: false,
        cleanedLineCount: 0,
        rawEventCandidates: 0,
        parsedBeforeDedupe: 0,
        parsedValidEvents: 0,
        duplicateRowsRemoved: 0,
        hiddenPastShows: 0,
        displayedInWindowShows: 0,
        visibleUpcomingShowsCount: 0,
        lowPriorityUpcomingShowsCount: 0,
        todayChecked: true,
        todayEventCount: 0,
        todayHadEvents: false,
        todayCoverageVerified: false,
        earliestEventDate: undefined,
        latestEventDate: undefined,
        warnings,
      };

      return {
        events: [],
        sourceName: THE_END_SOURCE_NAME,
        sourceUrl: THE_END_SOURCE_URL,
        status: "unavailable",
        message: buildTheEndSummary(debug),
        debug,
      };
    }

    const html = await response.text();
    const parsed = parseTheEndCards(html);
    const deduped = dedupeListings(parsed.listings);
    const events = deduped.listings.map(mapListingToEvent);
    const today = getHoustonTodayDate();
    const upcomingEnd = addDays(today, EVENT_DISPLAY_WINDOW_DAYS);
    const todayEvents = events.filter((event) => event.dateTime.slice(0, 10) === today);
    const inWindowEvents = events.filter((event) => {
      const eventDate = event.dateTime.slice(0, 10);

      return eventDate > today && eventDate <= upcomingEnd;
    });
    const visibleUpcomingEvents = inWindowEvents.filter((event) => !event.hiddenReason);
    const lowPriorityUpcomingEvents = inWindowEvents.filter((event) => Boolean(event.hiddenReason));
    const hiddenPastShows = events.filter((event) => event.dateTime.slice(0, 10) < today).length;
    const { earliestEventDate, latestEventDate } = summarizeDates(events);
    const debug: TheEndSourceDebug = {
      urlsChecked,
      fetchSucceeded: true,
      responseStatus,
      homepageReached: parsed.homepageReached,
      upcomingShowsSectionFound: parsed.upcomingShowsSectionFound,
      usefulEventTextFound: parsed.usefulEventTextFound,
      cleanedLineCount: parsed.cleanedLineCount,
      rawEventCandidates: parsed.listings.length,
      parsedBeforeDedupe: parsed.listings.length,
      parsedValidEvents: events.length,
      duplicateRowsRemoved: deduped.duplicateRowsRemoved,
      hiddenPastShows,
      displayedInWindowShows: visibleUpcomingEvents.length,
      visibleUpcomingShowsCount: visibleUpcomingEvents.length,
      lowPriorityUpcomingShowsCount: lowPriorityUpcomingEvents.length,
      todayChecked: true,
      todayEventCount: todayEvents.length,
      todayHadEvents: todayEvents.length > 0,
      todayCoverageVerified: true,
      earliestEventDate,
      latestEventDate,
      warnings,
    };

    const status = events.length > 0 ? "success" : "unavailable";

    return {
      events,
      sourceName: THE_END_SOURCE_NAME,
      sourceUrl: THE_END_SOURCE_URL,
      status,
      message: buildTheEndSummary(debug),
      debug,
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "The End source failed before today-specific coverage could be verified.";
    warnings.push(message);
    const debug: TheEndSourceDebug = {
      urlsChecked,
      fetchSucceeded: false,
      responseStatus,
      homepageReached: false,
      upcomingShowsSectionFound: false,
      usefulEventTextFound: false,
      cleanedLineCount: 0,
      rawEventCandidates: 0,
      parsedBeforeDedupe: 0,
      parsedValidEvents: 0,
      duplicateRowsRemoved: 0,
      hiddenPastShows: 0,
      displayedInWindowShows: 0,
      visibleUpcomingShowsCount: 0,
      lowPriorityUpcomingShowsCount: 0,
      todayChecked: true,
      todayEventCount: 0,
      todayHadEvents: false,
      todayCoverageVerified: false,
      earliestEventDate: undefined,
      latestEventDate: undefined,
      warnings,
    };

    return {
      events: [],
      sourceName: THE_END_SOURCE_NAME,
      sourceUrl: THE_END_SOURCE_URL,
      status: "failed",
      message: buildTheEndSummary(debug),
      debug,
    };
  } finally {
    clearTimeout(timeout);
  }
}
