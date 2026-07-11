import { unstable_noStore as noStore } from "next/cache";
import { scoreEvent, type EventSeed } from "@/lib/event-scoring";
import { HOUSTON_CULTURE_REGISTRY } from "@/lib/culture-registry";
import type {
  CultureCoverageSummary,
  CultureProviderResult,
  CultureSourceDebug,
  CultureSourceStatus,
  EventItem,
} from "@/types/dashboard";

const MENIL_SOURCE_NAME = "Menil";
const MENIL_SOURCE_URL = "https://www.menil.org/events";
const MENIL_USER_AGENT = "DailyOverviewBot/1.0 (+https://localhost)";

interface MenilParsedEvent {
  title: string;
  dateTime: string;
  venue: string;
  city: string;
  category: string;
  sourceLabel: string;
  sourceUrl: string;
  sourceLinks: EventItem["sourceLinks"];
  audience?: string;
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

function parseDateHeading(line: string): { date: string } | null {
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
  };
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
      "Apply Now",
      "Filter by location",
      "Filter by type",
      "All",
      "Today",
      "This Week",
      "Next 30 Days",
    ].includes(line));
}

function extractEventBlocks(html: string): string[] {
  const blocks: string[] = [];
  const pattern = /<li\b[^>]*data-list-item[^>]*>([\s\S]*?)<\/li>/gi;

  for (const match of html.matchAll(pattern)) {
    blocks.push(match[1]);
  }

  return blocks;
}

function normalizeMeridiem(value: string): "AM" | "PM" | null {
  const normalized = value.replace(/\./g, "").trim().toUpperCase();

  if (normalized === "AM" || normalized === "PM") {
    return normalized;
  }

  return null;
}

function normalizeTimeToken(token: string, fallbackMeridiem?: "AM" | "PM"): string | null {
  const normalized = token.replace(/\./g, "").trim().toUpperCase();

  if (normalized === "NOON") {
    return "12:00 PM";
  }

  if (normalized === "MIDNIGHT") {
    return "12:00 AM";
  }

  const match = normalized.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?$/i);

  if (!match) {
    return null;
  }

  const meridiem = normalizeMeridiem(match[3] ?? fallbackMeridiem ?? "");

  if (!meridiem) {
    return null;
  }

  const hours = Number(match[1]);
  const minutes = match[2] ?? "00";

  return `${hours}:${minutes} ${meridiem}`;
}

function parseReadableTimeRange(text: string): {
  displayTime: string;
  startDisplayTime: string;
  endDisplayTime?: string;
} | null {
  const normalized = normalizeWhitespace(text).replace(/[–—]/g, "-");

  const bothSidesMatch = normalized.match(
    /(\d{1,2}(?::\d{2})?\s*(?:A\.?M\.?|P\.?M\.?))\s*-\s*(\d{1,2}(?::\d{2})?\s*(?:A\.?M\.?|P\.?M\.?))/i,
  );

  if (bothSidesMatch) {
    const startDisplayTime = normalizeTimeToken(bothSidesMatch[1]);
    const endDisplayTime = normalizeTimeToken(bothSidesMatch[2]);

    if (startDisplayTime && endDisplayTime) {
      return {
        displayTime: `${startDisplayTime}–${endDisplayTime}`,
        startDisplayTime,
        endDisplayTime,
      };
    }
  }

  const singleMeridiemMatch = normalized.match(
    /(\d{1,2}(?::\d{2})?)\s*-\s*(\d{1,2}(?::\d{2})?)\s*((?:A\.?M\.?|P\.?M\.?))/i,
  );

  if (singleMeridiemMatch) {
    const meridiem = normalizeMeridiem(singleMeridiemMatch[3]);
    const startDisplayTime = normalizeTimeToken(singleMeridiemMatch[1], meridiem ?? undefined);
    const endDisplayTime = normalizeTimeToken(singleMeridiemMatch[2], meridiem ?? undefined);

    if (startDisplayTime && endDisplayTime) {
      return {
        displayTime: `${startDisplayTime}–${endDisplayTime}`,
        startDisplayTime,
        endDisplayTime,
      };
    }
  }

  const readableTokens = normalized.match(
    /(?:\d{1,2}(?::\d{2})?\s*(?:A\.?M\.?|P\.?M\.?)|\bNoon\b|\bMidnight\b)/gi,
  );

  if (!readableTokens || readableTokens.length === 0) {
    return null;
  }

  const startDisplayTime = normalizeTimeToken(readableTokens[0]);
  const endDisplayTime = readableTokens[1]
    ? normalizeTimeToken(
      readableTokens[1],
      startDisplayTime?.endsWith("AM")
        ? "AM"
        : startDisplayTime?.endsWith("PM")
          ? "PM"
          : undefined,
    )
    : undefined;

  if (!startDisplayTime) {
    return null;
  }

  return {
    displayTime: endDisplayTime ? `${startDisplayTime}–${endDisplayTime}` : startDisplayTime,
    startDisplayTime,
    endDisplayTime: endDisplayTime ?? undefined,
  };
}

function convertTimeToIso(date: string, startDisplayTime: string): string {
  const match = startDisplayTime.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/i);

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
      "events",
      "events archive",
      "full calendar",
      "no results found",
      "load more",
      "previous",
      "next",
    ].includes(normalized)
  ) {
    return false;
  }

  if (/^(sun|mon|tue|wed|thu|fri|sat)(?:day)?\s*,?\s+[a-z]+\s+\d{1,2}$/i.test(line)) {
    return false;
  }

  return /[A-Za-z]{3,}/.test(line);
}

function inferCultureTags(title: string, audience?: string): string[] {
  const normalized = `${title} ${audience ?? ""}`.toLowerCase();
  const tags = ["arts", "culture"];

  if (normalized.includes("film")) {
    tags.push("film");
  } else if (normalized.includes("lecture") || normalized.includes("talk")) {
    tags.push("talk");
  } else if (normalized.includes("panel")) {
    tags.push("panel");
  } else if (normalized.includes("tour")) {
    tags.push("tour");
  } else if (normalized.includes("performance")) {
    tags.push("performance");
  } else {
    tags.push("special event");
  }

  return tags;
}

function inferVenueFit(audience?: string): number {
  if (audience?.toLowerCase() === "public") {
    return 12;
  }

  if (audience?.toLowerCase() === "member") {
    return 10;
  }

  return 11;
}

function inferRarity(title: string, audience?: string): number {
  const normalized = `${title} ${audience ?? ""}`.toLowerCase();

  if (normalized.includes("film")) {
    return 9;
  }

  if (normalized.includes("lecture") || normalized.includes("talk")) {
    return 8;
  }

  if (normalized.includes("panel")) {
    return 7;
  }

  if (normalized.includes("tour")) {
    return 6;
  }

  return 5;
}

function inferLocationTone(audience?: string): string {
  if (audience?.toLowerCase() === "member") {
    return "Member";
  }

  if (audience?.toLowerCase() === "public") {
    return "Public";
  }

  return "Menil";
}

function parseMenilBlock(block: string, pageUrl: string): MenilParsedEvent | null {
  const lines = extractVisibleLines(block);
  const title = normalizeWhitespace(
    stripTags(block.match(/<h3\b[^>]*>([\s\S]*?)<\/h3>/i)?.[1] ?? lines.find(isLikelyTitle) ?? ""),
  );
  const dateLine = lines.find((line) => parseDateHeading(line) !== null);
  const timeLine = lines.find((line) => parseReadableTimeRange(line) !== null);
  const dateHeading = dateLine ? parseDateHeading(dateLine) : null;

  if (!title || !dateHeading || !timeLine || !isLikelyTitle(title)) {
    return null;
  }

  const parsedTime = parseReadableTimeRange(timeLine);

  if (!parsedTime) {
    return null;
  }

  const link = block.match(/<a\b[^>]*href="([^"]+)"/i)?.[1];
  const audience = block.match(/aria-label="([^"]+)"/i)?.[1].trim().toLowerCase();

  let eventUrl = pageUrl;

  if (link) {
    try {
      eventUrl = new URL(link, pageUrl).toString();
    } catch {
      eventUrl = pageUrl;
    }
  }

  return {
    title,
    dateTime: convertTimeToIso(dateHeading.date, parsedTime.startDisplayTime),
    venue: "Menil Collection",
    city: "Houston",
    category: inferLocationTone(audience),
    sourceLabel: MENIL_SOURCE_NAME,
    sourceUrl: eventUrl,
    sourceLinks: [
      {
        label: MENIL_SOURCE_NAME,
        url: MENIL_SOURCE_URL,
      },
      {
        label: title,
        url: eventUrl,
      },
    ],
    audience,
  };
}

function mapEventToItem(listing: MenilParsedEvent): EventItem {
  const genreTags = inferCultureTags(listing.title, listing.audience);
  const seed: EventSeed = {
    id: `menil-${listing.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${listing.dateTime.slice(0, 10)}`,
    title: listing.title,
    dateTime: listing.dateTime,
    venue: listing.venue,
    city: listing.city,
    category: "Arts & Culture",
    genreTags,
    sourceLinks: listing.sourceLinks,
    isGreatLiveAct: false,
    liveReputationStatus: "unknown",
    liveReputationConfidence: 0,
    liveReputationReasons: [],
    liveReputationSources: [],
    venueFitScore: inferVenueFit(listing.audience),
    knownLiveReputationScore: 0,
    rarityScore: inferRarity(listing.title, listing.audience),
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

function buildCandidateStatuses(): CultureSourceStatus[] {
  return HOUSTON_CULTURE_REGISTRY.filter((entry) => entry.providerStatus === "not_implemented").map(
    (entry) => ({
      sourceName: entry.displayName,
      sourceUrl: entry.eventSourceUrl ?? entry.officialUrl ?? "",
      status: "not_implemented" as const,
      message: entry.notes ?? "Needs source audit before provider implementation.",
    }),
  );
}

function buildCoverageSummary(
  status: CultureSourceStatus,
  events: EventItem[],
  debug: CultureSourceDebug,
): CultureCoverageSummary {
  const today = getHoustonTodayDate();
  const todayEventsCount = events.filter((event) => event.dateTime.slice(0, 10) === today).length;

  return {
    source: status.status === "failed" ? "mixed" : "live_provider",
    trackedSourcesCount: HOUSTON_CULTURE_REGISTRY.length,
    activeLiveProvidersCount: 1,
    notImplementedSourcesCount: HOUSTON_CULTURE_REGISTRY.filter((entry) => entry.providerStatus === "not_implemented").length,
    parsedEventsCount: events.length,
    todayChecked: true,
    todayEventsCount,
    earliestParsedEventDate: events[0]?.dateTime.slice(0, 10),
    latestParsedEventDate: events.at(-1)?.dateTime.slice(0, 10),
    dateWindowStart: debug.dateWindowStart,
    dateWindowEnd: debug.dateWindowEnd,
    eventCalendarHeadingFound: debug.eventCalendarHeadingFound,
    cleanedLineCount: debug.cleanedLineCount,
    dateHeadingMatches: debug.dateHeadingMatches,
    titleMatches: debug.titleMatches,
    dateTimeMatches: debug.dateTimeMatches,
    note: status.message,
  };
}

function buildStatusMessage(events: EventItem[], debug: CultureSourceDebug): string {
  if (events.length > 0) {
    const todayCount = events.filter((event) => event.dateTime.slice(0, 10) === getHoustonTodayDate()).length;
    return `${MENIL_SOURCE_NAME} loaded from official events page: ${events.length} events parsed${todayCount > 0 ? `, including ${todayCount} today` : ""}.`;
  }

  if (!debug.eventCalendarHeadingFound) {
    return `${MENIL_SOURCE_NAME} source loaded, but the Events Archive section was not found.`;
  }

  return `${MENIL_SOURCE_NAME} source loaded, but parser found 0 valid events.`;
}

async function fetchHtml(url: string): Promise<{ html: string; responseStatus: number }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    const response = await fetch(url, {
      headers: {
        "user-agent": MENIL_USER_AGENT,
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

function collectParseStats(blocks: string[]): Pick<CultureSourceDebug, "titleMatches" | "dateTimeMatches" | "rawEventCandidates"> {
  let titleMatches = 0;
  let dateTimeMatches = 0;
  let rawEventCandidates = 0;

  for (const block of blocks) {
    const lines = extractVisibleLines(block);
    const title = normalizeWhitespace(stripTags(block.match(/<h3\b[^>]*>([\s\S]*?)<\/h3>/i)?.[1] ?? ""));
    const dateLine = lines.find((line) => parseDateHeading(line) !== null);
    const timeLine = lines.find((line) => parseReadableTimeRange(line) !== null);

    if (title && isLikelyTitle(title)) {
      titleMatches += 1;
    }

    if (dateLine && timeLine) {
      dateTimeMatches += 1;
    }

    if (title || dateLine || timeLine) {
      rawEventCandidates += 1;
    }
  }

  return {
    titleMatches,
    dateTimeMatches,
    rawEventCandidates,
  };
}

function extractEventsFromHtml(html: string, pageUrl: string): {
  events: MenilParsedEvent[];
  debug: Pick<
    CultureSourceDebug,
    | "cleanedLineCount"
    | "dateHeadingMatches"
    | "eventCalendarHeadingFound"
    | "rawEventCandidates"
    | "titleMatches"
    | "dateTimeMatches"
  >;
} {
  const cleanedLines = extractVisibleLines(html);
  const eventBlocks = extractEventBlocks(html);
  const candidateStats = collectParseStats(eventBlocks);
  const eventCalendarHeadingFound = cleanedLines.some((line) => /events archive/i.test(line));
  const dateHeadingMatches = cleanedLines.filter((line) => parseDateHeading(line) !== null).length;
  const events: MenilParsedEvent[] = [];

  for (const block of eventBlocks) {
    const parsed = parseMenilBlock(block, pageUrl);

    if (parsed) {
      events.push(parsed);
    }
  }

  return {
    events,
    debug: {
      cleanedLineCount: cleanedLines.length,
      dateHeadingMatches,
      eventCalendarHeadingFound,
      rawEventCandidates: candidateStats.rawEventCandidates,
      titleMatches: candidateStats.titleMatches,
      dateTimeMatches: candidateStats.dateTimeMatches,
    },
  };
}

export async function fetchMenilSource(): Promise<CultureProviderResult> {
  noStore();

  const urlsChecked = [MENIL_SOURCE_URL];

  try {
    const { html, responseStatus } = await fetchHtml(MENIL_SOURCE_URL);
    const parsed = extractEventsFromHtml(html, MENIL_SOURCE_URL);
    const events = dedupeEvents(parsed.events.map(mapEventToItem));
    const debug: CultureSourceDebug = {
      urlsChecked,
      responseStatus,
      dateWindowStart: getHoustonTodayDate(),
      dateWindowEnd: addDays(getHoustonTodayDate(), 14),
      eventCalendarHeadingFound: parsed.debug.eventCalendarHeadingFound,
      cleanedLineCount: parsed.debug.cleanedLineCount,
      dateHeadingMatches: parsed.debug.dateHeadingMatches,
      titleMatches: parsed.debug.titleMatches,
      dateTimeMatches: parsed.debug.dateTimeMatches,
      rawEventCandidates: parsed.debug.rawEventCandidates,
      parsedValidEvents: events.length,
      todayChecked: true,
      todayEventsCount: events.filter((event) => event.dateTime.slice(0, 10) === getHoustonTodayDate()).length,
      earliestParsedEventDate: events[0]?.dateTime.slice(0, 10),
      latestParsedEventDate: events.at(-1)?.dateTime.slice(0, 10),
      warnings: events.length > 0 ? [] : ["No parseable Menil events found in the current window."],
    };
    const status: CultureSourceStatus = {
      sourceName: MENIL_SOURCE_NAME,
      sourceUrl: MENIL_SOURCE_URL,
      status: events.length > 0 ? "working" : "limited",
      message: buildStatusMessage(events, debug),
      debug,
    };

    return {
      source: events.length > 0 ? "live_provider" : "mixed",
      note: status.message,
      events,
      coverageSummary: buildCoverageSummary(status, events, debug),
      statuses: [status, ...buildCandidateStatuses()],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Menil events page could not be loaded.";
    const failedDebug: CultureSourceDebug = {
      urlsChecked,
      responseStatus: undefined,
      dateWindowStart: getHoustonTodayDate(),
      dateWindowEnd: addDays(getHoustonTodayDate(), 14),
      eventCalendarHeadingFound: false,
      cleanedLineCount: 0,
      dateHeadingMatches: 0,
      rawEventCandidates: 0,
      titleMatches: 0,
      dateTimeMatches: 0,
      parsedValidEvents: 0,
      todayChecked: true,
      todayEventsCount: 0,
      warnings: [message],
    };
    const status: CultureSourceStatus = {
      sourceName: MENIL_SOURCE_NAME,
      sourceUrl: MENIL_SOURCE_URL,
      status: "failed",
      message,
      debug: failedDebug,
    };

    return {
      source: "mock",
      note: message,
      events: [],
      coverageSummary: buildCoverageSummary(status, [], failedDebug),
      statuses: [status, ...buildCandidateStatuses()],
    };
  }
}
