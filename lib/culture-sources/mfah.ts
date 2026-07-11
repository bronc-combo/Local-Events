import { unstable_noStore as noStore } from "next/cache";
import { EVENT_DISPLAY_WINDOW_DAYS } from "@/lib/event-window";
import { scoreEvent, type EventSeed } from "@/lib/event-scoring";
import { HOUSTON_CULTURE_REGISTRY } from "@/lib/culture-registry";
import type {
  CultureCoverageSummary,
  CultureProviderResult,
  CultureSourceDebug,
  CultureSourceStatus,
  EventItem,
} from "@/types/dashboard";

const MFAH_SOURCE_NAME = "MFAH";
const MFAH_SOURCE_URL = "https://www.mfah.org/events";
const MFAH_USER_AGENT = "DailyOverviewBot/1.0 (+https://localhost)";

interface MfahParsedEvent {
  title: string;
  dateTime: string;
  venue: string;
  city: string;
  category: string;
  sourceLabel: string;
  sourceUrl: string;
  sourceLinks: EventItem["sourceLinks"];
  location?: string;
  typeLine: string;
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#8217;/g, "'")
    .replace(/&#8216;/g, "'")
    .replace(/&#8212;/g, "-")
    .replace(/&#8211;/g, "-")
    .replace(/&ndash;/g, "-")
    .replace(/&mdash;/g, "-");
}

function normalizeWhitespace(value: string): string {
  return decodeHtmlEntities(value.replace(/\u00a0/g, " ")).replace(/\s+/g, " ").trim();
}

function stripTags(value: string): string {
  return normalizeWhitespace(value.replace(/<[^>]+>/g, " "));
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

function inferYear(month: number, day: number): number {
  const today = new Date();
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const [currentYear, currentMonth, currentDay] = formatter
    .format(today)
    .split("-")
    .map(Number);

  if (month < currentMonth || (month === currentMonth && day < currentDay)) {
    return currentYear + 1;
  }

  return currentYear;
}

function parseDateHeading(line: string): { date: string; month: number; day: number } | null {
  const match = line.match(
    /^(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday),\s+([A-Za-z]+)\s+(\d{1,2})(?:,\s*(\d{4}))?$/,
  );

  if (!match) {
    return null;
  }

  const month = getMonthNumber(match[2]);
  const day = Number(match[3]);
  const year = match[4] ? Number(match[4]) : inferYear(month ?? 1, day);

  if (!month || Number.isNaN(day) || !Number.isFinite(year)) {
    return null;
  }

  return {
    date: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    month,
    day,
  };
}

function isTimeLine(line: string): boolean {
  return /(?:\d{1,2}(?::\d{2})?\s*[AP]M|Noon|Midnight)(?:\s*[—–-]\s*(?:\d{1,2}(?::\d{2})?\s*[AP]M|Noon|Midnight))?/i.test(
    line,
  );
}

function normalizeTimeToken(token: string): string {
  const trimmed = token.trim();

  if (/^noon$/i.test(trimmed)) {
    return "12:00 PM";
  }

  if (/^midnight$/i.test(trimmed)) {
    return "12:00 AM";
  }

  const match = trimmed.match(/^(\d{1,2})(?::(\d{2}))?\s*([AP]M)$/i);

  if (!match) {
    return "7:00 PM";
  }

  const hours = Number(match[1]);
  const minutes = match[2] ?? "00";
  const meridiem = match[3].toUpperCase();

  return `${hours}:${minutes} ${meridiem}`;
}

function convertTimeToIso(date: string, timeText: string): string {
  const firstTime = timeText
    .replace(/\s*[—–-]\s*.*/, "")
    .trim()
    .match(/(?:\d{1,2}(?::\d{2})?\s*[AP]M|Noon|Midnight)/i)?.[0];

  const normalized = normalizeTimeToken(firstTime ?? timeText);
  const match = normalized.match(/^(\d{1,2})(?::(\d{2}))?\s*([AP]M)$/i);

  if (!match) {
    return `${date}T19:00:00-05:00`;
  }

  let hours = Number(match[1]);
  const minutes = match[2] ?? "00";
  const meridiem = match[3].toUpperCase();

  if (meridiem === "PM" && hours !== 12) {
    hours += 12;
  }

  if (meridiem === "AM" && hours === 12) {
    hours = 0;
  }

  return `${date}T${String(hours).padStart(2, "0")}:${minutes}:00-05:00`;
}

function isLikelyTitle(line: string): boolean {
  if (line.length < 4) {
    return false;
  }

  const normalized = line.toLowerCase();

  if (
    [
      "event calendar",
      "this week",
      "today",
      "selected",
      "apply now",
      "filter by location",
      "filter by type",
      "all",
      "main campus",
      "rienzi",
      "bayou bend",
      "glassell school of art",
    ].includes(normalized)
  ) {
    return false;
  }

  if (/^(sun|mon|tue|wed|thu|fri|sat)(?:day)?\s*,?\s+[a-z]+\s+\d{1,2}$/i.test(line)) {
    return false;
  }

  if (/^(activity|film|gallery talk\/tour|gallery experience|lecture\/talk|members|performance|special event|tour|workshop|university & professional school)$/i.test(normalized)) {
    return false;
  }

  return /[A-Za-z]{3,}/.test(line);
}

function inferCultureTags(typeLine: string, title: string): string[] {
  const normalized = `${typeLine} ${title}`.toLowerCase();
  const tags = ["arts", "culture"];

  if (normalized.includes("film")) {
    tags.push("film");
  } else if (normalized.includes("lecture") || normalized.includes("talk")) {
    tags.push("talk");
  } else if (normalized.includes("gallery")) {
    tags.push("gallery");
  } else if (normalized.includes("performance")) {
    tags.push("performance");
  } else if (normalized.includes("activity") || normalized.includes("workshop")) {
    tags.push("activity");
  } else {
    tags.push("special event");
  }

  return tags;
}

function inferCultureVenueFit(location?: string): number {
  if (!location) {
    return 10;
  }

  const normalized = location.toLowerCase();

  if (normalized.includes("main campus")) {
    return 12;
  }

  if (normalized.includes("rienzi")) {
    return 11;
  }

  return 10;
}

function inferCultureRarity(typeLine: string): number {
  const normalized = typeLine.toLowerCase();

  if (normalized.includes("film")) {
    return 9;
  }

  if (normalized.includes("lecture") || normalized.includes("talk")) {
    return 8;
  }

  if (normalized.includes("performance")) {
    return 7;
  }

  if (normalized.includes("gallery")) {
    return 6;
  }

  return 5;
}

function extractVisibleLines(html: string): string[] {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|li|ul|ol|h1|h2|h3|h4|h5|h6|section|article|header|footer|nav|main|aside|figure|figcaption|blockquote|tr|td|th)>/gi, "\n")
    .replace(/<[^>]+>/g, " ");

  return text
    .replace(/\r/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((line) => stripTags(line))
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean)
    .filter((line) => ![
      "Tickets",
      "Membership",
      "Donate",
      "Shop",
      "Login",
      "Welcome",
      "Search",
      "Selected",
      "Apply Now",
      "Filter by location",
      "Filter by type",
      "All",
      "Today",
      "This Week",
      "Next 30 Days",
    ].includes(line));
}

function extractDiscoverMoreLinks(html: string, baseUrl: string): string[] {
  const links: string[] = [];
  const base = new URL(baseUrl);
  const anchorPattern = /<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;

  for (const match of html.matchAll(anchorPattern)) {
    const href = match[1];
    const text = normalizeWhitespace(stripTags(match[2]));

    if (text.toLowerCase() !== "discover more") {
      continue;
    }

    try {
      const resolved = new URL(href, baseUrl);

      if (resolved.hostname !== base.hostname) {
        continue;
      }

      links.push(resolved.toString());
    } catch {
      continue;
    }
  }

  return links;
}

function parseEventBlock(
  blockLines: string[],
  date: string,
  discoverMoreUrl: string | undefined,
): MfahParsedEvent | null {
  const lines = blockLines
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean)
    .filter((line) => !line.startsWith("Image:"))
    .filter((line) => !/^(Tickets|Membership|Donate|Shop|Login|Welcome|Search|Selected|Apply Now)$/i.test(line));

  if (lines.length < 3) {
    return null;
  }

  const title = lines.at(-1);

  if (!title || !isLikelyTitle(title) || /^CANCELED\b/i.test(title)) {
    return null;
  }

  const timeIndex = lines.findIndex(isTimeLine);

  if (timeIndex === -1) {
    return null;
  }

  const timeLine = lines[timeIndex];
  const typeLine = lines[timeIndex + 1] && lines[timeIndex + 1] !== title ? lines[timeIndex + 1] : "Special Event";
  const location = lines.slice(0, timeIndex).find((line) => /main campus|rienzi|bayou bend|glassell school of art/i.test(line))
    ?? lines.slice(0, timeIndex).find((line) => /[A-Za-z]/.test(line))
    ?? "MFAH";

  const venue = location ? `MFAH - ${location}` : "MFAH";
  const eventUrl = discoverMoreUrl ?? MFAH_SOURCE_URL;

  return {
    title,
    dateTime: convertTimeToIso(date, timeLine),
    venue,
    city: "Houston",
    category: typeLine,
    sourceLabel: MFAH_SOURCE_NAME,
    sourceUrl: eventUrl,
    sourceLinks: [
      {
        label: MFAH_SOURCE_NAME,
        url: MFAH_SOURCE_URL,
      },
      {
        label: "Discover More",
        url: eventUrl,
      },
    ],
    location,
    typeLine,
  };
}

function parseMfahEvents(html: string): {
  events: MfahParsedEvent[];
  debug: Pick<CultureSourceDebug, "cleanedLineCount" | "dateHeadingMatches" | "rawEventCandidates" | "eventCalendarHeadingFound">;
} {
  const cleanedLines = extractVisibleLines(html);
  const eventCalendarHeadingFound = cleanedLines.some((line) => line === "Event Calendar");
  const dateHeadingMatches = cleanedLines.filter((line) => parseDateHeading(line) !== null).length;
  const discoverMoreUrls = extractDiscoverMoreLinks(html, MFAH_SOURCE_URL);
  const events: MfahParsedEvent[] = [];
  let currentDate = "";
  let blockLines: string[] = [];
  let discoverMoreIndex = 0;
  let rawEventCandidates = 0;

  for (const line of cleanedLines) {
    const dateHeading = parseDateHeading(line);

    if (dateHeading) {
      currentDate = dateHeading.date;
      blockLines = [];
      continue;
    }

    if (!currentDate) {
      continue;
    }

    if (/^Discover More$/i.test(line)) {
      rawEventCandidates += 1;
      const parsed = parseEventBlock(blockLines, currentDate, discoverMoreUrls[discoverMoreIndex]);

      if (parsed) {
        events.push(parsed);
      }

      if (discoverMoreIndex < discoverMoreUrls.length) {
        discoverMoreIndex += 1;
      }

      blockLines = [];
      continue;
    }

    blockLines.push(line);
  }

  if (blockLines.length > 0) {
    rawEventCandidates += 1;
    const parsed = parseEventBlock(blockLines, currentDate, discoverMoreUrls[discoverMoreIndex]);

    if (parsed) {
      events.push(parsed);
    }
  }

  return {
    events,
    debug: {
      cleanedLineCount: cleanedLines.length,
      dateHeadingMatches,
      rawEventCandidates,
      eventCalendarHeadingFound,
    },
  };
}

function mapEventToItem(listing: MfahParsedEvent): EventItem {
  const genreTags = inferCultureTags(listing.typeLine, listing.title);
  const seed: EventSeed = {
    id: `mfah-${listing.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${listing.dateTime.slice(0, 10)}`,
    title: listing.title,
    dateTime: listing.dateTime,
    venue: listing.venue,
    city: listing.city,
    category: listing.category,
    genreTags,
    sourceLinks: listing.sourceLinks,
    isGreatLiveAct: false,
    liveReputationStatus: "unknown",
    liveReputationConfidence: 0,
    liveReputationReasons: [],
    liveReputationSources: [],
    venueFitScore: inferCultureVenueFit(listing.location),
    knownLiveReputationScore: 0,
    rarityScore: inferCultureRarity(listing.typeLine),
    distanceRelevanceScore: 8,
    feedbackHistoryPlaceholderScore: 3,
  };

  const scoredEvent = scoreEvent(seed);

  return {
    ...scoredEvent,
    sourceLabel: listing.sourceLabel,
  };
}

function dedupeEvents(events: EventItem[]): EventItem[] {
  const byKey = new Map<string, EventItem>();

  for (const event of events) {
    const key = `${event.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}|${event.dateTime.slice(0, 10)}|${event.dateTime.slice(11, 16)}|${event.sourceLabel ?? ""}`;
    byKey.set(key, event);
  }

  return [...byKey.values()];
}

function buildStatusRecords(status: CultureSourceStatus): CultureSourceStatus[] {
  const statuses: CultureSourceStatus[] = [status];

  for (const entry of HOUSTON_CULTURE_REGISTRY) {
    if (entry.providerId === "mfah") {
      continue;
    }

    statuses.push({
      sourceName: entry.displayName,
      sourceUrl: entry.eventSourceUrl ?? entry.officialUrl ?? "",
      status: "not_implemented",
      message: entry.notes ?? "Needs source audit before provider implementation.",
    });
  }

  return statuses;
}

function buildCoverageSummary(
  status: CultureSourceStatus,
  events: EventItem[],
  sourceOverride?: CultureCoverageSummary["source"],
): CultureCoverageSummary {
  const today = getHoustonTodayDate();
  const todayEventsCount = events.filter((event) => event.dateTime.slice(0, 10) === today).length;

  return {
    source: sourceOverride ?? (status.status === "working" ? "live_provider" : "mixed"),
    trackedSourcesCount: HOUSTON_CULTURE_REGISTRY.length,
    activeLiveProvidersCount: status.status === "failed" ? 0 : 1,
    notImplementedSourcesCount: HOUSTON_CULTURE_REGISTRY.filter((entry) => entry.providerStatus === "not_implemented").length,
    parsedEventsCount: events.length,
    todayChecked: true,
    todayEventsCount,
    earliestParsedEventDate: events[0]?.dateTime.slice(0, 10),
    latestParsedEventDate: events.at(-1)?.dateTime.slice(0, 10),
    dateWindowStart: today,
    dateWindowEnd: addDays(today, EVENT_DISPLAY_WINDOW_DAYS),
    eventCalendarHeadingFound: status.debug?.eventCalendarHeadingFound,
    cleanedLineCount: status.debug?.cleanedLineCount,
    dateHeadingMatches: status.debug?.dateHeadingMatches,
    note: status.message,
  };
}

function buildStatusMessage(events: EventItem[], debug: CultureSourceDebug): string {
  if (events.length > 0) {
    const todayCount = events.filter((event) => event.dateTime.slice(0, 10) === getHoustonTodayDate()).length;
    return `${MFAH_SOURCE_NAME} loaded from official events calendar: ${events.length} events parsed${todayCount > 0 ? `, including ${todayCount} today` : ""}.`;
  }

  if (!debug.eventCalendarHeadingFound) {
    return `${MFAH_SOURCE_NAME} source loaded, but the Event Calendar heading was not found.`;
  }

  return `${MFAH_SOURCE_NAME} source loaded, but parser found 0 valid events.`;
}

async function fetchHtml(url: string): Promise<{ html: string; responseStatus: number }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    const response = await fetch(url, {
      headers: {
        "user-agent": MFAH_USER_AGENT,
        accept: "text/html,application/xhtml+xml",
      },
      signal: controller.signal,
      cache: "no-store",
    });

    const html = await response.text();

    return {
      html,
      responseStatus: response.status,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchMfahSource(): Promise<CultureProviderResult> {
  noStore();

  const urlsChecked = [MFAH_SOURCE_URL];

  try {
    const { html, responseStatus } = await fetchHtml(MFAH_SOURCE_URL);
    const parsed = parseMfahEvents(html);
    const events = dedupeEvents(parsed.events.map(mapEventToItem));
    const status: CultureSourceStatus = {
      sourceName: MFAH_SOURCE_NAME,
      sourceUrl: MFAH_SOURCE_URL,
      status: events.length > 0 ? "working" : "limited",
      message: buildStatusMessage(events, {
        urlsChecked,
        responseStatus,
        dateWindowStart: getHoustonTodayDate(),
        dateWindowEnd: addDays(getHoustonTodayDate(), EVENT_DISPLAY_WINDOW_DAYS),
        eventCalendarHeadingFound: parsed.debug.eventCalendarHeadingFound,
        cleanedLineCount: parsed.debug.cleanedLineCount,
        dateHeadingMatches: parsed.debug.dateHeadingMatches,
        rawEventCandidates: parsed.debug.rawEventCandidates,
        parsedValidEvents: events.length,
        todayChecked: true,
        todayEventsCount: events.filter((event) => event.dateTime.slice(0, 10) === getHoustonTodayDate()).length,
        warnings: events.length > 0 ? [] : ["No parseable MFAH events found in the current window."],
      }),
      debug: {
        urlsChecked,
        responseStatus,
        dateWindowStart: getHoustonTodayDate(),
        dateWindowEnd: addDays(getHoustonTodayDate(), EVENT_DISPLAY_WINDOW_DAYS),
        eventCalendarHeadingFound: parsed.debug.eventCalendarHeadingFound,
        cleanedLineCount: parsed.debug.cleanedLineCount,
        dateHeadingMatches: parsed.debug.dateHeadingMatches,
        rawEventCandidates: parsed.debug.rawEventCandidates,
        parsedValidEvents: events.length,
        todayChecked: true,
        todayEventsCount: events.filter((event) => event.dateTime.slice(0, 10) === getHoustonTodayDate()).length,
        earliestParsedEventDate: events[0]?.dateTime.slice(0, 10),
        latestParsedEventDate: events.at(-1)?.dateTime.slice(0, 10),
        warnings: events.length > 0 ? [] : ["No parseable MFAH events found in the current window."],
      },
    };

    const statuses = buildStatusRecords(status);

    return {
      source: events.length > 0 ? "live_provider" : "mixed",
      note: status.message,
      events,
      coverageSummary: buildCoverageSummary(status, events),
      statuses,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "MFAH calendar could not be loaded.";
    const failedStatus: CultureSourceStatus = {
      sourceName: MFAH_SOURCE_NAME,
      sourceUrl: MFAH_SOURCE_URL,
      status: "failed",
      message,
      debug: {
        urlsChecked,
        responseStatus: undefined,
        dateWindowStart: getHoustonTodayDate(),
        dateWindowEnd: addDays(getHoustonTodayDate(), EVENT_DISPLAY_WINDOW_DAYS),
        eventCalendarHeadingFound: false,
        cleanedLineCount: 0,
        dateHeadingMatches: 0,
        rawEventCandidates: 0,
        parsedValidEvents: 0,
        todayChecked: true,
        todayEventsCount: 0,
        warnings: [message],
      },
    };

    const statuses = buildStatusRecords(failedStatus);

    return {
      source: "mock",
      note: message,
      events: [],
      coverageSummary: buildCoverageSummary(failedStatus, [], "mock"),
      statuses,
    };
  }
}
