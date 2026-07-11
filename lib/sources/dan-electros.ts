import { scoreEvent, type EventSeed } from "@/lib/event-scoring";
import type { EventItem } from "@/types/dashboard";

const DAN_ELECTROS_SOURCE_NAME = "Dan Electro's";
const DAN_ELECTROS_SOURCE_URL = "https://danelectros.com/upcomingevents";
const DAN_ELECTROS_USER_AGENT = "DailyOverviewBot/1.0 (+https://localhost)";
const MAX_DISCOVERED_SOURCE_FETCHES = 4;

export interface DanElectrosSourceDebug {
  urlsChecked: string[];
  fetchSucceeded: boolean;
  responseStatus?: number;
  eventsArchiveFound?: boolean;
  cleanedLineCount?: number;
  dateMatches?: number;
  timeMatches?: number;
  titleCandidates?: number;
  parsedBeforeDedupe?: number;
  rawEventCandidates: number;
  parsedValidEvents: number;
  todayEventCount?: number;
  earliestEventDate?: string;
  latestEventDate?: string;
  todayChecked: boolean;
  todayHadEvents: boolean;
  todayCoverageVerified: boolean;
  warnings: string[];
}

export interface DanElectrosSourceResult {
  events: EventItem[];
  sourceName: string;
  sourceUrl: string;
  status: "success" | "unavailable" | "failed";
  message: string;
  debug: DanElectrosSourceDebug;
}

interface DanElectrosParsedListing {
  title: string;
  eventUrl: string;
  dateTime: string;
  startTimeKey: string;
  supportActs?: string;
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

function stripTags(value: string): string {
  return decodeHtmlEntities(
    value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
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

function inferDateTime(localDate?: string, localTime?: string): string | null {
  if (!localDate) {
    return null;
  }

  return `${localDate}T${localTime ?? "19:00:00"}-05:00`;
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

function buildDanElectrosSummary(debug: DanElectrosSourceDebug): string {
  if (!debug.fetchSucceeded) {
    return "Dan Electro's source could not be loaded.";
  }

  if (!debug.todayCoverageVerified) {
    return "Dan Electro's source loaded, but today-specific coverage could not be verified.";
  }

  if (debug.parsedValidEvents === 0) {
    return `Dan Electro's source loaded, but parser found 0 valid events. Lines: ${debug.cleanedLineCount ?? 0}, date matches: ${debug.dateMatches ?? 0}, time matches: ${debug.timeMatches ?? 0}, title candidates: ${debug.titleCandidates ?? 0}.`;
  }

  if (debug.todayHadEvents) {
    return `Dan Electro's loaded from official events page: ${debug.parsedValidEvents} events parsed, including ${debug.todayEventCount ?? 0} today.`;
  }

  return `Dan Electro's loaded: ${debug.parsedValidEvents} events parsed, earliest ${debug.earliestEventDate ?? "unknown"}. No events found for today.`;
}

function inferGenreTags(title: string, supportActs?: string): string[] {
  const normalized = `${title} ${supportActs ?? ""}`.toLowerCase();
  const tags: string[] = [];

  if (normalized.includes("hardcore") || normalized.includes("punk")) {
    tags.push("punk", "hardcore");
  }

  if (normalized.includes("noise") || normalized.includes("metal")) {
    tags.push("noise rock", "metal");
  }

  if (normalized.includes("dj") || normalized.includes("dance")) {
    tags.push("electronic", "dance");
  }

  if (tags.length === 0) {
    tags.push("live music");
  }

  return tags;
}

function mapListingToEvent(listing: DanElectrosParsedListing): EventItem {
  const seed: EventSeed = {
    id: `dan-electros-${listing.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${listing.dateTime.slice(0, 10)}`,
    title: listing.title,
    dateTime: listing.dateTime,
    venue: DAN_ELECTROS_SOURCE_NAME,
    city: "Houston",
    category: "Concert",
    sectionCategory: "concert",
    genreTags: inferGenreTags(listing.title, listing.supportActs),
    sourceLinks: [
      {
        label: DAN_ELECTROS_SOURCE_NAME,
        url: listing.eventUrl || DAN_ELECTROS_SOURCE_URL,
      },
    ],
    supportActs: listing.supportActs,
    metadataConfidence: listing.metadataConfidence,
    isGreatLiveAct: false,
    liveReputationStatus: "unknown",
    liveReputationConfidence: 0,
    liveReputationReasons: [],
    liveReputationSources: [],
    venueFitScore: 15,
    knownLiveReputationScore: 9,
    rarityScore: 7,
    distanceRelevanceScore: 10,
    feedbackHistoryPlaceholderScore: 6,
  };

  const scoredEvent = scoreEvent(seed);
  const extraReasons = listing.supportActs ? [`support acts: ${listing.supportActs}`] : [];

  return {
    ...scoredEvent,
    sourceLabel: DAN_ELECTROS_SOURCE_NAME,
    tasteReasons: [...scoredEvent.tasteReasons, ...extraReasons].filter(
      (reason, index, reasons) => reasons.indexOf(reason) === index,
    ),
  };
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

function convertTimeTo24Hour(timeText: string): string {
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

function isShortDateLabel(text: string): boolean {
  return /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+\d{1,2}$/i.test(
    text,
  );
}

function isLikelyEventTitle(text: string): boolean {
  if (text.length < 8) {
    return false;
  }

  if (
    [
      "events",
      "full calendar",
      "events archive",
      "no results found",
    ].includes(text.toLowerCase())
  ) {
    return false;
  }

  if (isShortDateLabel(text)) {
    return false;
  }

  return /[A-Za-z]{4}/.test(text);
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

function parseEventsArchiveSegment(html: string): string {
  const visibleText = extractVisibleText(html);
  const lines = visibleText
    .split(/\n+/)
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean);
  const startIndex = lines.findIndex((line) => line === "Events Archive");

  if (startIndex === -1) {
    return lines.join("\n");
  }

  return lines.slice(startIndex, startIndex + 250).join("\n");
}

function extractTitleAnchors(
  html: string,
  pageUrl: string,
): Array<{ title: string; url: string }> {
  const anchors =
    html.match(/<a [^>]*href="[^"]+"[^>]*>[\s\S]*?<\/a>/g) ?? [];

  return anchors
    .map((anchor) => {
      const hrefMatch = anchor.match(/href="([^"]+)"/);
      const text = normalizeWhitespace(stripTags(anchor));

      if (!hrefMatch || !isLikelyEventTitle(text)) {
        return null;
      }

      return {
        title: text,
        url: hrefMatch[1].startsWith("http")
          ? hrefMatch[1]
          : new URL(hrefMatch[1], pageUrl).toString(),
      };
    })
    .filter((value): value is { title: string; url: string } => value !== null);
}

function extractPrimaryTimeRange(line: string): string | null {
  const match = line.match(
    /(\d{1,2}:\d{2}\s*[AP]M)(?:\s*[–-]\s*(\d{1,2}:\d{2}\s*[AP]M))?/i,
  );

  if (!match) {
    return null;
  }

  return match[2] ? `${match[1]} – ${match[2]}` : match[1];
}

function parseSequenceEvents(
  html: string,
  pageUrl: string,
): {
  listings: DanElectrosParsedListing[];
  eventsArchiveFound: boolean;
  cleanedLineCount: number;
  dateMatches: number;
  timeMatches: number;
  titleCandidates: number;
} {
  const archiveFound = html.includes("Events Archive");
  const archiveText = parseEventsArchiveSegment(html);
  const lines = archiveText
    .split(/\n+/)
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean);
  const titleAnchors = extractTitleAnchors(html, pageUrl);
  const datePattern =
    /^(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(\d{4})$/i;
  const listings: DanElectrosParsedListing[] = [];

  let dateMatches = 0;
  let timeMatches = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const dateMatch = lines[index].match(datePattern);

    if (!dateMatch) {
      continue;
    }

    dateMatches += 1;
    const monthName = dateMatch[1];
    const day = dateMatch[2];
    const year = dateMatch[3];
    const monthNumber = new Date(`${monthName} 1, ${year}`).getMonth() + 1;

    let timeLine: string | undefined;
    let titleLine: string | undefined;

    for (let lookAhead = index + 1; lookAhead < Math.min(lines.length, index + 8); lookAhead += 1) {
      if (datePattern.test(lines[lookAhead])) {
        break;
      }

      const extractedTime = extractPrimaryTimeRange(lines[lookAhead]);

      if (!timeLine && extractedTime) {
        timeLine = extractedTime;
        timeMatches += 1;
        continue;
      }

      if (
        !titleLine &&
        isLikelyEventTitle(lines[lookAhead]) &&
        !datePattern.test(lines[lookAhead]) &&
        !extractPrimaryTimeRange(lines[lookAhead])
      ) {
        titleLine = lines[lookAhead];
        break;
      }
    }

    if (!titleLine) {
      continue;
    }

    const matchingAnchor = titleAnchors.find((anchor) => anchor.title === titleLine);
    const dateTime = inferDateTime(
      `${year}-${String(monthNumber).padStart(2, "0")}-${String(Number(day)).padStart(2, "0")}`,
      timeLine ? convertTimeTo24Hour(timeLine.split(/[–-]/)[0].trim()) : undefined,
    );

    if (!dateTime) {
      continue;
    }

    const supportMatch = titleLine.match(/\s(?:w\/|with)\s+(.+)$/i);
    const supportActs = supportMatch ? supportMatch[1].trim() : undefined;
    const cleanedTitle = supportActs ? titleLine.replace(/\s(?:w\/|with)\s+(.+)$/i, "").trim() : titleLine;

    listings.push({
      title: cleanedTitle,
      eventUrl: matchingAnchor?.url ?? DAN_ELECTROS_SOURCE_URL,
      dateTime,
      startTimeKey: timeLine ? convertTimeTo24Hour(timeLine.split(/[–-]/)[0].trim()).slice(0, 5) : "time-not-listed",
      supportActs,
      metadataConfidence: [supportActs].filter(Boolean).length,
    });
  }

  return {
    listings,
    eventsArchiveFound: archiveFound,
    cleanedLineCount: lines.length,
    dateMatches,
    timeMatches,
    titleCandidates: titleAnchors.length,
  };
}

function dedupeListings(listings: DanElectrosParsedListing[]): DanElectrosParsedListing[] {
  const byKey = new Map<string, DanElectrosParsedListing>();

  for (const listing of listings) {
    const normalizedTitle = listing.title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    byKey.set(
      `${normalizedTitle}|${listing.dateTime.slice(0, 10)}|${listing.startTimeKey}`,
      listing,
    );
  }

  return [...byKey.values()];
}

export function discoverDanElectrosSourceUrls(homepageHtml: string): string[] {
  const urls = new Set<string>([
    DAN_ELECTROS_SOURCE_URL,
  ]);
  const linkMatches =
    homepageHtml.match(/href="https?:\/\/[^"]+"/g) ?? [];

  for (const match of linkMatches) {
    const url = match.replace(/^href="/, "").replace(/"$/, "");

    if (!url.includes("danelectros.com")) {
      continue;
    }

    if (
      url.toLowerCase().includes("upcomingevents") ||
      url.toLowerCase().includes("calendar") ||
      url.toLowerCase().includes("event") ||
      url.toLowerCase().includes("show")
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
        "User-Agent": DAN_ELECTROS_USER_AGENT,
        Accept: "text/html,application/xhtml+xml",
      },
      cache: "no-store",
      signal: controller.signal,
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

function parseDanElectrosEventsFromHtml(
  html: string,
  pageUrl: string,
): {
  events: EventItem[];
  eventsArchiveFound: boolean;
  cleanedLineCount: number;
  dateMatches: number;
  timeMatches: number;
  titleCandidates: number;
  parsedBeforeDedupe: number;
} {
  const sequenceResult = parseSequenceEvents(html, pageUrl);
  const dedupedListings = dedupeListings(sequenceResult.listings);

  return {
    events: dedupedListings.map(mapListingToEvent),
    eventsArchiveFound: sequenceResult.eventsArchiveFound,
    cleanedLineCount: sequenceResult.cleanedLineCount,
    dateMatches: sequenceResult.dateMatches,
    timeMatches: sequenceResult.timeMatches,
    titleCandidates: sequenceResult.titleCandidates,
    parsedBeforeDedupe: sequenceResult.listings.length,
  };
}

export async function fetchDanElectrosSource(): Promise<DanElectrosSourceResult> {
  const warnings: string[] = [];

  try {
    const homepageResponse = await fetchHtml(DAN_ELECTROS_SOURCE_URL);

    if (!homepageResponse.ok || homepageResponse.html === undefined) {
      throw new Error(
        `Dan Electro's request failed with ${homepageResponse.status ?? "unknown status"}.`,
      );
    }

    const homepageHtml = homepageResponse.html;
    const discoveredUrls = discoverDanElectrosSourceUrls(homepageHtml);
    const fetchableUrls = discoveredUrls
      .filter((url) => url !== DAN_ELECTROS_SOURCE_URL)
      .slice(0, MAX_DISCOVERED_SOURCE_FETCHES);
    const checkedUrls = [DAN_ELECTROS_SOURCE_URL];
    let rawCandidates = 0;
    const eventMap = new Map<string, EventItem>();

    const homepageParse = parseDanElectrosEventsFromHtml(
      homepageHtml,
      DAN_ELECTROS_SOURCE_URL,
    );
    rawCandidates += homepageParse.parsedBeforeDedupe;
    let eventsArchiveFound = homepageParse.eventsArchiveFound;
    let cleanedLineCount = homepageParse.cleanedLineCount;
    let dateMatches = homepageParse.dateMatches;
    let timeMatches = homepageParse.timeMatches;
    let titleCandidates = homepageParse.titleCandidates;
    let parsedBeforeDedupe = homepageParse.parsedBeforeDedupe;

    for (const event of homepageParse.events) {
      eventMap.set(event.id, event);
    }

    for (const url of fetchableUrls) {
      checkedUrls.push(url);
      const response = await fetchHtml(url);

      if (!response.ok || response.html === undefined) {
        warnings.push(
          `${url} returned ${response.status ?? "an unknown error"}.`,
        );
        continue;
      }

      const pageParse = parseDanElectrosEventsFromHtml(response.html, url);
      rawCandidates += pageParse.parsedBeforeDedupe;
      eventsArchiveFound = eventsArchiveFound || pageParse.eventsArchiveFound;
      cleanedLineCount += pageParse.cleanedLineCount;
      dateMatches += pageParse.dateMatches;
      timeMatches += pageParse.timeMatches;
      titleCandidates += pageParse.titleCandidates;
      parsedBeforeDedupe += pageParse.parsedBeforeDedupe;

      for (const event of pageParse.events) {
        eventMap.set(event.id, event);
      }
    }

    if (fetchableUrls.length === 0) {
      warnings.push("No additional same-site event page was discovered beyond the official upcoming events page.");
    }

    const events = [...eventMap.values()];
    const today = getHoustonTodayDate();
    const todayEvents = events.filter((event) => event.dateTime.slice(0, 10) === today);
    const dates = summarizeDates(events);

    if (events.length === 0) {
      warnings.push("Source loaded but no parseable event dates found.");
    }

    const debug: DanElectrosSourceDebug = {
      urlsChecked: checkedUrls,
      fetchSucceeded: true,
      responseStatus: homepageResponse.status ?? 200,
      eventsArchiveFound,
      cleanedLineCount,
      dateMatches,
      timeMatches,
      titleCandidates,
      parsedBeforeDedupe,
      rawEventCandidates: rawCandidates,
      parsedValidEvents: events.length,
      todayEventCount: todayEvents.length,
      earliestEventDate: dates.earliestEventDate,
      latestEventDate: dates.latestEventDate,
      todayChecked: true,
      todayHadEvents: todayEvents.length > 0,
      todayCoverageVerified: true,
      warnings,
    };

    return {
      events,
      sourceName: DAN_ELECTROS_SOURCE_NAME,
      sourceUrl: DAN_ELECTROS_SOURCE_URL,
      status: events.length > 0 ? "success" : "unavailable",
      message: buildDanElectrosSummary(debug),
      debug,
    };
  } catch (error) {
    const debug: DanElectrosSourceDebug = {
      urlsChecked: [DAN_ELECTROS_SOURCE_URL],
      fetchSucceeded: false,
      rawEventCandidates: 0,
      parsedValidEvents: 0,
      todayChecked: false,
      todayHadEvents: false,
      todayCoverageVerified: false,
      warnings:
        error instanceof Error
          ? [error.message]
          : ["Dan Electro's source failed to load."],
    };

    return {
      events: [],
      sourceName: DAN_ELECTROS_SOURCE_NAME,
      sourceUrl: DAN_ELECTROS_SOURCE_URL,
      status: "failed",
      message:
        error instanceof Error
          ? error.message
          : "Dan Electro's source failed to load.",
      debug,
    };
  }
}

export { DAN_ELECTROS_SOURCE_NAME, DAN_ELECTROS_SOURCE_URL };
