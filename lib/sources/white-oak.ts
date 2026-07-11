import {
  scoreEvent,
  type EventSeed,
} from "@/lib/event-scoring";
import type { EventItem } from "@/types/dashboard";

const WHITE_OAK_SOURCE_NAME = "White Oak Music Hall";
const WHITE_OAK_SOURCE_URL = "https://whiteoakmusichall.com/";
const WHITE_OAK_USER_AGENT = "DailyOverviewBot/1.0 (+https://localhost)";

export interface WhiteOakSourceDebug {
  urlsChecked: string[];
  fetchSucceeded: boolean;
  rawEventCandidates: number;
  parsedValidEvents: number;
  earliestEventDate?: string;
  latestEventDate?: string;
  todayChecked: boolean;
  todayHadEvents: boolean;
  todayCoverageVerified: boolean;
  warnings: string[];
}

export interface WhiteOakSourceResult {
  events: EventItem[];
  sourceName: string;
  sourceUrl: string;
  status: "success" | "unavailable" | "failed";
  message: string;
  debug: WhiteOakSourceDebug;
}

const MAX_DISCOVERED_SOURCE_FETCHES = 4;

interface WhiteOakParsedListing {
  title: string;
  supportActs?: string;
  venue: string;
  eventUrl: string;
  day: string;
  month: string;
  timeText?: string;
  year: number;
}

function isWhiteOakParsedListing(
  listing: WhiteOakParsedListing | null,
): listing is WhiteOakParsedListing {
  return listing !== null;
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#8217;/g, "'")
    .replace(/&#8216;/g, "'")
    .replace(/&#8211;/g, "-")
    .replace(/&#8212;/g, "-")
    .replace(/&#038;/g, "&")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'");
}

function stripTags(value: string): string {
  return decodeHtmlEntities(value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function getMonthNumber(monthName: string): number | null {
  const months: Record<string, number> = {
    january: 1,
    february: 2,
    march: 3,
    april: 4,
    may: 5,
    june: 6,
    july: 7,
    august: 8,
    september: 9,
    october: 10,
    november: 11,
    december: 12,
  };

  return months[monthName.toLowerCase()] ?? null;
}

function parseTimeFromSection(sectionHtml: string): string | undefined {
  const titleMatch = sectionHtml.match(
    /title="Event Name - .*?\|\s*\d{1,2}\s+[A-Za-z]+\s+(\d{1,2}:\d{2}\s+[AP]M)"/,
  );

  return titleMatch?.[1];
}

function extractSupportActsFromTitle(title: string): { title: string; supportActs?: string } {
  const supportMatch = title.match(/\s(?:w\/|with)\s+(.+)$/i);

  if (!supportMatch) {
    return { title };
  }

  const cleanedTitle = stripTags(title.replace(/\s(?:w\/|with)\s+(.+)$/i, "").trim());
  const supportActs = stripTags(supportMatch[1]);

  return {
    title: cleanedTitle || title,
    supportActs: supportActs || undefined,
  };
}

function parseYearFromUrl(eventUrl: string): number | null {
  const urlYearMatch = eventUrl.match(/-(\d{2})-(\d{2})-(\d{4})\/event\//);

  if (urlYearMatch?.[3]) {
    return Number(urlYearMatch[3]);
  }

  return null;
}

function inferEventYear(month: number, day: number, parsedYear: number | null): number {
  if (parsedYear) {
    return parsedYear;
  }

  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const [currentYear, currentMonth, currentDay] = formatter
    .format(now)
    .split("-")
    .map(Number);

  // If the page only exposes month/day, assume the next chronological occurrence
  // relative to Houston's current date so year rollover near New Year's stays sensible.
  if (month < currentMonth || (month === currentMonth && day < currentDay)) {
    return currentYear + 1;
  }

  return currentYear;
}

function toIsoDateTime(listing: WhiteOakParsedListing): string {
  const month = getMonthNumber(listing.month) ?? 1;
  const day = Number(listing.day);
  const year = listing.year;

  if (!listing.timeText) {
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T19:00:00-05:00`;
  }

  const timeMatch = listing.timeText.match(/(\d{1,2}):(\d{2})\s*([AP]M)/i);

  if (!timeMatch) {
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T19:00:00-05:00`;
  }

  let hours = Number(timeMatch[1]);
  const minutes = timeMatch[2];
  const meridiem = timeMatch[3].toUpperCase();

  if (meridiem === "PM" && hours !== 12) {
    hours += 12;
  }

  if (meridiem === "AM" && hours === 12) {
    hours = 0;
  }

  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${String(hours).padStart(2, "0")}:${minutes}:00-05:00`;
}

function inferGenreTags(title: string, venue: string, supportActs?: string): string[] {
  const normalized = `${title} ${venue} ${supportActs ?? ""}`.toLowerCase();
  const tags: string[] = [];

  if (normalized.includes("rave") || normalized.includes("dj")) {
    tags.push("electronic", "dance");
  }

  if (normalized.includes("metal")) {
    tags.push("metal");
  }

  if (normalized.includes("indie") || normalized.includes("tour")) {
    tags.push("indie rock");
  }

  if (normalized.includes("upstairs") || normalized.includes("downstairs")) {
    tags.push("smaller room");
  }

  if (tags.length === 0) {
    tags.push("live music");
  }

  return tags;
}

function mapListingToEvent(listing: WhiteOakParsedListing): EventItem {
  const genreTags = inferGenreTags(listing.title, listing.venue, listing.supportActs);
  const venueFitScore = listing.venue.toLowerCase().includes("upstairs")
    ? 15
    : listing.venue.toLowerCase().includes("downstairs")
      ? 14
      : listing.venue.toLowerCase().includes("lawn")
        ? 10
        : 12;
  const timeNote = listing.timeText
    ? []
    : ["time not listed on source"];

  const seed: EventSeed = {
    id: `white-oak-${listing.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${listing.day}`,
    title: listing.title,
    dateTime: toIsoDateTime(listing),
    venue: listing.venue,
    city: "Houston",
    category: "Concert",
    genreTags,
    sourceLinks: [
      {
        label: WHITE_OAK_SOURCE_NAME,
        url: listing.eventUrl,
      },
    ],
    supportActs: listing.supportActs,
    room: /upstairs|downstairs|lawn/i.test(listing.venue) ? listing.venue : undefined,
    metadataConfidence: [listing.supportActs, listing.timeText, /upstairs|downstairs|lawn/i.test(listing.venue) ? listing.venue : undefined].filter(Boolean).length,
    similarArtists: undefined,
    isGreatLiveAct: false,
    liveReputationStatus: "unknown",
    liveReputationConfidence: 0,
    liveReputationReasons: [],
    liveReputationSources: [],
    venueFitScore,
    knownLiveReputationScore: venueFitScore >= 14 ? 10 : 7,
    rarityScore: 7,
    distanceRelevanceScore: 10,
    feedbackHistoryPlaceholderScore: 5,
  };

  const scoredEvent = scoreEvent(seed);

  return {
    ...scoredEvent,
    sourceLabel: WHITE_OAK_SOURCE_NAME,
    tasteReasons: [...scoredEvent.tasteReasons, ...timeNote],
  };
}

function parseWhiteOakListings(html: string): WhiteOakParsedListing[] {
  const sections = html.match(/<div class="tw-section">[\s\S]*?<\/div><!-- END \.tw-section -->/g) ?? [];

  const listings: Array<WhiteOakParsedListing | null> = sections
    .map((sectionHtml) => {
      const titleMatch = sectionHtml.match(/<div class="tw-name">[\s\S]*?<a [^>]*>([\s\S]*?)<\/a>/);
      const venueMatch = sectionHtml.match(/<span class="tw-venue-name">([\s\S]*?)<\/span>/);
      const dayMatch = sectionHtml.match(/<span class="tw-event-date">\s*([0-9]{1,2})\s*<\/span>/);
      const monthMatch = sectionHtml.match(/<span class="tw-event-month">\s*([A-Za-z]+)\s*<\/span>/);
      const urlMatch = sectionHtml.match(/<a href="(https:\/\/www\.ticketmaster\.com\/[^"]+)"/);

      if (!titleMatch || !venueMatch || !dayMatch || !monthMatch || !urlMatch) {
        return null;
      }

      const monthNumber = getMonthNumber(monthMatch[1]);

      if (!monthNumber) {
        return null;
      }

      const day = Number(dayMatch[1]);
      const parsedYear = parseYearFromUrl(urlMatch[1]);
      const titleText = stripTags(titleMatch[1]);
      const supportSplit = extractSupportActsFromTitle(titleText);

      return {
        title: supportSplit.title,
        supportActs: supportSplit.supportActs,
        venue: stripTags(venueMatch[1]),
        eventUrl: urlMatch[1],
        day: String(day),
        month: monthMatch[1],
        timeText: parseTimeFromSection(sectionHtml),
        year: inferEventYear(monthNumber, day, parsedYear),
      };
    });

  return listings.filter(isWhiteOakParsedListing);
}

function getHoustonTodayDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
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

function buildWhiteOakSummary(
  debug: WhiteOakSourceDebug,
): string {
  if (!debug.fetchSucceeded) {
    return "White Oak source could not be loaded.";
  }

  if (!debug.todayCoverageVerified) {
    return "White Oak source loaded, but today-specific coverage could not be verified.";
  }

  if (debug.todayHadEvents) {
    return `White Oak loaded: ${debug.parsedValidEvents} events parsed. Found ${debug.rawEventCandidates} raw candidates and at least one event dated today.`;
  }

  return `White Oak loaded: ${debug.parsedValidEvents} events parsed, earliest ${debug.earliestEventDate ?? "unknown"}. No events found for today.`;
}

export function discoverWhiteOakSourceUrls(homepageHtml: string): string[] {
  const urls = new Set<string>([WHITE_OAK_SOURCE_URL]);
  const linkMatches =
    homepageHtml.match(/href="https:\/\/whiteoakmusichall\.com\/[^"]*"/g) ?? [];

  for (const match of linkMatches) {
    const url = match.replace(/^href="/, "").replace(/"$/, "");

    if (
      url.includes("#event-listing") ||
      url.includes("/tw-location/") ||
      url.toLowerCase().includes("show") ||
      url.toLowerCase().includes("event")
    ) {
      urls.add(url);
    }
  }

  return [...urls];
}

async function fetchHtml(url: string): Promise<{ ok: boolean; status?: number; html?: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": WHITE_OAK_USER_AGENT,
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
      html: await response.text(),
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function parseWhiteOakEventsFromHtml(html: string): EventItem[] {
  return parseWhiteOakListings(html).map(mapListingToEvent);
}

export async function fetchWhiteOakSource(): Promise<WhiteOakSourceResult> {
  const warnings: string[] = [];

  try {
    const homepageResponse = await fetchHtml(WHITE_OAK_SOURCE_URL);

    if (!homepageResponse.ok || !homepageResponse.html) {
      throw new Error(
        `White Oak request failed with ${homepageResponse.status ?? "unknown status"}.`,
      );
    }

    const html = homepageResponse.html;
    const discoveredUrls = discoverWhiteOakSourceUrls(html);
    const fetchableDiscoveredUrls = discoveredUrls
      .filter((url) => url !== WHITE_OAK_SOURCE_URL)
      .filter((url) => !url.includes("#event-listing"))
      .slice(0, MAX_DISCOVERED_SOURCE_FETCHES);
    const checkedUrls = [WHITE_OAK_SOURCE_URL];
    let rawCandidates = (html.match(/<div class="tw-section">/g) ?? []).length;
    const parsedEventMap = new Map<string, EventItem>();

    for (const event of parseWhiteOakEventsFromHtml(html)) {
      parsedEventMap.set(event.id, event);
    }

    for (const discoveredUrl of fetchableDiscoveredUrls) {
      checkedUrls.push(discoveredUrl);
      const discoveredResponse = await fetchHtml(discoveredUrl);

      if (!discoveredResponse.ok || !discoveredResponse.html) {
        warnings.push(
          `${discoveredUrl} returned ${discoveredResponse.status ?? "an unknown error"}.`,
        );
        continue;
      }

      rawCandidates +=
        (discoveredResponse.html.match(/<div class="tw-section">/g) ?? []).length;

      for (const event of parseWhiteOakEventsFromHtml(discoveredResponse.html)) {
        parsedEventMap.set(event.id, event);
      }
    }

    const events = [...parsedEventMap.values()];
    const today = getHoustonTodayDate();
    const todayEvents = events.filter((event) => event.dateTime.slice(0, 10) === today);
    const dates = summarizeDates(events);

    if (!discoveredUrls.some((url) => url.includes("#event-listing"))) {
      warnings.push("No same-site Event Listing link was discovered on the homepage.");
    }

    if (fetchableDiscoveredUrls.length === 0) {
      warnings.push("No same-site calendar endpoint found beyond the homepage listing.");
    }

    if (todayEvents.length === 0) {
      warnings.push("White Oak checked: no events dated today were found in the parsed official source.");
    }

    const debug: WhiteOakSourceDebug = {
      urlsChecked: checkedUrls,
      fetchSucceeded: true,
      rawEventCandidates: rawCandidates,
      parsedValidEvents: events.length,
      earliestEventDate: dates.earliestEventDate,
      latestEventDate: dates.latestEventDate,
      todayChecked: true,
      todayHadEvents: todayEvents.length > 0,
      todayCoverageVerified: true,
      warnings,
    };

    return {
      events,
      sourceName: WHITE_OAK_SOURCE_NAME,
      sourceUrl: WHITE_OAK_SOURCE_URL,
      status: "success",
      message: buildWhiteOakSummary(debug),
      debug,
    };
  } catch (error) {
    const debug: WhiteOakSourceDebug = {
      urlsChecked: [WHITE_OAK_SOURCE_URL],
      fetchSucceeded: false,
      rawEventCandidates: 0,
      parsedValidEvents: 0,
      todayChecked: false,
      todayHadEvents: false,
      todayCoverageVerified: false,
      warnings:
        error instanceof Error ? [error.message] : ["White Oak source failed to load."],
    };

    return {
      events: [],
      sourceName: WHITE_OAK_SOURCE_NAME,
      sourceUrl: WHITE_OAK_SOURCE_URL,
      status: "failed",
      message:
        error instanceof Error
          ? error.message
          : "White Oak Music Hall source failed to load.",
      debug,
    };
  }
}

export { WHITE_OAK_SOURCE_NAME, WHITE_OAK_SOURCE_URL };
