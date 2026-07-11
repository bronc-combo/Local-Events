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

const MEOW_WOLF_SOURCE_NAME = "Meow Wolf";
const MEOW_WOLF_HOUSTON_URL = "https://meowwolf.com/visit/houston";
const MEOW_WOLF_TICKETS_URL = "https://tickets.meowwolf.com/events/houston/";
const MEOW_WOLF_USER_AGENT = "DailyOverviewBot/1.0 (+https://localhost)";

const RELEVANT_SAMPLE_PATTERNS = [
  "Houston Events",
  "Meow Wolf Style",
  "Live performances",
  "artist takeovers",
  "cosmic celebrations",
  "Don’t miss our events",
  "View All Shows",
  "Events Calendar",
  "Upcoming Houston Concerts",
  "Live shows at Meow Wolf Houston",
];

interface MeowWolfParsedEvent {
  title: string;
  dateTime: string;
  venue: string;
  city: string;
  category: string;
  sourceLabel: string;
  sourceUrl: string;
  sourceLinks: EventItem["sourceLinks"];
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
    .filter(Boolean);
}

function collectSampleLines(lines: string[]): string[] {
  return lines
    .filter((line) => {
      const lowered = line.toLowerCase();
      return RELEVANT_SAMPLE_PATTERNS.some((pattern) => lowered.includes(pattern.toLowerCase()));
    })
    .slice(0, 20);
}

function containsStructuredData(html: string): boolean {
  return /application\/ld\+json/i.test(html) && /event/i.test(html);
}

function parseMonthDayYear(text: string): string | null {
  const match = text.match(
    /(?:Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)?\s*,?\s*([A-Za-z]+)\s+(\d{1,2})(?:,\s*(\d{4}))?/,
  );

  if (!match) {
    return null;
  }

  const monthMap: Record<string, number> = {
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
  const month = monthMap[match[1].toLowerCase()];
  const day = Number(match[2]);
  const year = match[3] ? Number(match[3]) : Number(new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
  }).format(new Date()));

  if (!month || !Number.isFinite(day) || Number.isNaN(day)) {
    return null;
  }

  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseTimeToken(text: string): string | null {
  const match = normalizeWhitespace(text).replace(/[–—]/g, "-").match(
    /(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?))\s*(?:-\s*(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)))?/i,
  );

  if (!match) {
    return null;
  }

  const normalize = (value: string | undefined): string | null => {
    if (!value) {
      return null;
    }

    const cleaned = value.replace(/\./g, "").trim().toUpperCase();
    const normalized = cleaned.match(/^(\d{1,2})(?::(\d{2}))?\s*([AP]M)$/i);

    if (!normalized) {
      return null;
    }

    return `${Number(normalized[1])}:${normalized[2] ?? "00"} ${normalized[3].toUpperCase()}`;
  };

  const start = normalize(match[1]);
  const end = normalize(match[2]);

  if (!start) {
    return null;
  }

  return end ? `${start}–${end}` : start;
}

function parseTimeToIso(date: string, timeText: string): string {
  const token = timeText.split("–")[0]?.trim() ?? timeText;
  const match = token.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/i);

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

function inferCategory(title: string): string {
  const normalized = title.toLowerCase();

  if (normalized.includes("film") || normalized.includes("screening")) {
    return "Arts & Culture";
  }

  if (normalized.includes("performance") || normalized.includes("show") || normalized.includes("concert")) {
    return "Arts & Culture";
  }

  if (normalized.includes("artist takeover") || normalized.includes("takeover")) {
    return "Arts & Culture";
  }

  return "Community / Arts";
}

function inferScoringTags(title: string): string[] {
  const normalized = title.toLowerCase();
  const tags = ["arts", "culture"];

  if (normalized.includes("film") || normalized.includes("screening")) {
    tags.push("film");
  } else if (normalized.includes("performance") || normalized.includes("show")) {
    tags.push("performance");
  } else if (normalized.includes("takeover")) {
    tags.push("special event");
  } else {
    tags.push("community");
  }

  return tags;
}

function inferVenueFit(title: string): number {
  const normalized = title.toLowerCase();

  if (normalized.includes("takeover")) {
    return 13;
  }

  if (normalized.includes("film") || normalized.includes("screening")) {
    return 12;
  }

  if (normalized.includes("performance") || normalized.includes("show")) {
    return 12;
  }

  return 10;
}

function inferRarity(title: string): number {
  const normalized = title.toLowerCase();

  if (normalized.includes("takeover")) {
    return 9;
  }

  if (normalized.includes("film") || normalized.includes("screening")) {
    return 8;
  }

  if (normalized.includes("performance") || normalized.includes("show")) {
    return 7;
  }

  return 5;
}

function parseCandidateEvents(html: string, sourceUrl: string): MeowWolfParsedEvent[] {
  const events: MeowWolfParsedEvent[] = [];
  const cleanedLines = extractVisibleLines(html);
  const titles: string[] = [];

  for (const line of cleanedLines) {
    if (
      /Houston Events, Meow Wolf Style/i.test(line) ||
      /Live performances, artist takeovers & cosmic celebrations/i.test(line) ||
      /View All Shows/i.test(line) ||
      /Don.?t miss our events/i.test(line)
    ) {
      continue;
    }

    if (line.length < 5) {
      continue;
    }

    if (/^\d{1,2}[:.]?\d{0,2}\s*(?:am|pm|a\.m\.|p\.m\.)/i.test(line)) {
      continue;
    }

    if (/\b(?:today|tomorrow|upcoming|events calendar)\b/i.test(line)) {
      continue;
    }

    if (/^[A-Za-z0-9 ,:'"’&-]{6,}$/i.test(line) && /[A-Za-z]{4,}/.test(line)) {
      titles.push(line);
    }
  }

  const uniqueTitles = [...new Set(titles)];

  for (const title of uniqueTitles) {
    const date = parseMonthDayYear(title);
    if (!date) {
      continue;
    }

    const time = parseTimeToken(title) ?? "7:00 PM";

    events.push({
      title: normalizeWhitespace(title),
      dateTime: parseTimeToIso(date, time),
      venue: "Meow Wolf Houston / Radio Tave",
      city: "Houston",
      category: inferCategory(title),
      sourceLabel: MEOW_WOLF_SOURCE_NAME,
      sourceUrl,
      sourceLinks: [
        { label: MEOW_WOLF_SOURCE_NAME, url: MEOW_WOLF_HOUSTON_URL },
        { label: "Events Calendar", url: MEOW_WOLF_TICKETS_URL },
      ],
    });
  }

  return events;
}

function mapEventToItem(listing: MeowWolfParsedEvent): EventItem {
  const seed: EventSeed = {
    id: `meow-wolf-${listing.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${listing.dateTime.slice(0, 10)}`,
    title: listing.title,
    dateTime: listing.dateTime,
    venue: listing.venue,
    city: listing.city,
    category: listing.category,
    genreTags: inferScoringTags(listing.title),
    sourceLinks: listing.sourceLinks,
    isGreatLiveAct: false,
    liveReputationStatus: "unknown",
    liveReputationConfidence: 0,
    liveReputationReasons: [],
    liveReputationSources: [],
    venueFitScore: inferVenueFit(listing.title),
    knownLiveReputationScore: 0,
    rarityScore: inferRarity(listing.title),
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
  return HOUSTON_CULTURE_REGISTRY.filter((entry) => entry.priority === "candidate").map((entry) => ({
    sourceName: entry.displayName,
    sourceUrl: entry.eventSourceUrl ?? entry.officialUrl ?? "",
    status: "not_implemented" as const,
    message: entry.notes ?? "Needs source audit before provider implementation.",
  }));
}

function buildCoverageSummary(
  events: EventItem[],
  status: CultureSourceStatus,
  debug: CultureSourceDebug,
): CultureCoverageSummary {
  const today = getHoustonTodayDate();

  return {
    source: events.length > 0 ? "live_provider" : "mixed",
    trackedSourcesCount: HOUSTON_CULTURE_REGISTRY.length,
    activeLiveProvidersCount: HOUSTON_CULTURE_REGISTRY.filter((entry) => entry.providerStatus !== "not_implemented").length,
    notImplementedSourcesCount: HOUSTON_CULTURE_REGISTRY.filter((entry) => entry.providerStatus === "not_implemented").length,
    parsedEventsCount: events.length,
    todayChecked: true,
    todayEventsCount: events.filter((event) => event.dateTime.slice(0, 10) === today).length,
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

function buildStatusMessage(status: CultureSourceStatus): string {
  if (status.status === "working") {
    return `${MEOW_WOLF_SOURCE_NAME} loaded live events from official Houston sources.`;
  }

  if (status.status === "limited") {
    return `${MEOW_WOLF_SOURCE_NAME} sources are reachable, but no events are in the current window.`;
  }

  return `${MEOW_WOLF_SOURCE_NAME} audited limited: official pages are reachable, but no reliable server-visible dated event rows were found.`;
}

function buildSampleLines(officialLines: string[], ticketLines: string[]): string[] {
  const combined = [...officialLines, ...ticketLines];
  return combined.slice(0, 20);
}

async function fetchHtml(url: string): Promise<{ html: string; responseStatus: number }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    const response = await fetch(url, {
      headers: {
        "user-agent": MEOW_WOLF_USER_AGENT,
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

function hasVisibleEventText(lines: string[]): boolean {
  return lines.some((line) => /events|show|performance|takeover|concert/i.test(line));
}

export async function fetchMeowWolfSource(): Promise<CultureProviderResult> {
  noStore();

  const urlsChecked = [MEOW_WOLF_HOUSTON_URL, MEOW_WOLF_TICKETS_URL];

  try {
    const [officialResult, ticketResult] = await Promise.all([
      fetchHtml(MEOW_WOLF_HOUSTON_URL),
      fetchHtml(MEOW_WOLF_TICKETS_URL),
    ]);

    const officialLines = extractVisibleLines(officialResult.html);
    const ticketLines = extractVisibleLines(ticketResult.html);
    const eventsCalendarLinkFound = /tickets\.meowwolf\.com\/events\/houston\//i.test(officialResult.html);
    const usefulDatedEventTextFound = hasVisibleEventText(ticketLines) && hasVisibleEventText(officialLines);
    const structuredDataFound = containsStructuredData(officialResult.html) || containsStructuredData(ticketResult.html);
    const parsedEvents = dedupeEvents([
      ...parseCandidateEvents(officialResult.html, MEOW_WOLF_HOUSTON_URL).map(mapEventToItem),
      ...parseCandidateEvents(ticketResult.html, MEOW_WOLF_TICKETS_URL).map(mapEventToItem),
    ]);
    const sampleLines = buildSampleLines(collectSampleLines(officialLines), collectSampleLines(ticketLines));
    const cleanedLineCount = officialLines.length + ticketLines.length;
    const rawCandidateCount = parsedEvents.length;
    const debug: CultureSourceDebug = {
      urlsChecked,
      responseStatuses: {
        [MEOW_WOLF_HOUSTON_URL]: officialResult.responseStatus,
        [MEOW_WOLF_TICKETS_URL]: ticketResult.responseStatus,
      },
      responseStatus: ticketResult.responseStatus,
      dateWindowStart: getHoustonTodayDate(),
      dateWindowEnd: addDays(getHoustonTodayDate(), 14),
      eventCalendarHeadingFound: eventsCalendarLinkFound,
      cleanedLineCount,
      dateHeadingMatches: 0,
      titleMatches: sampleLines.length,
      dateTimeMatches: parsedEvents.length,
      rawEventCandidates: rawCandidateCount,
      parsedValidEvents: parsedEvents.length,
      todayChecked: true,
      todayEventsCount: parsedEvents.filter((event) => event.dateTime.slice(0, 10) === getHoustonTodayDate()).length,
      earliestParsedEventDate: parsedEvents[0]?.dateTime.slice(0, 10),
      latestParsedEventDate: parsedEvents.at(-1)?.dateTime.slice(0, 10),
      reachedOfficialPage: officialResult.responseStatus >= 200 && officialResult.responseStatus < 400,
      eventsCalendarLinkFound,
      ticketingPageReached: ticketResult.responseStatus >= 200 && ticketResult.responseStatus < 400,
      usefulDatedEventTextFound,
      structuredDataFound,
      sampleLines: parsedEvents.length > 0 ? [] : sampleLines,
      warnings: parsedEvents.length > 0
        ? []
        : [
            "Official Houston page reached, but no reliable server-visible dated event rows were found on the ticketing page.",
          ],
    };

    if (parsedEvents.length > 0) {
      const status: CultureSourceStatus = {
        sourceName: MEOW_WOLF_SOURCE_NAME,
        sourceUrl: MEOW_WOLF_TICKETS_URL,
        status: "working",
        message: buildStatusMessage({ sourceName: MEOW_WOLF_SOURCE_NAME, sourceUrl: MEOW_WOLF_TICKETS_URL, status: "working", message: "", debug }),
        debug,
      };

      return {
        source: "live_provider",
        note: status.message,
        events: parsedEvents,
        coverageSummary: buildCoverageSummary(parsedEvents, status, debug),
        statuses: [status, ...buildCandidateStatuses()],
      };
    }

    const status: CultureSourceStatus = {
      sourceName: MEOW_WOLF_SOURCE_NAME,
      sourceUrl: MEOW_WOLF_TICKETS_URL,
      status: "audited_limited",
      message: buildStatusMessage({
        sourceName: MEOW_WOLF_SOURCE_NAME,
        sourceUrl: MEOW_WOLF_TICKETS_URL,
        status: "audited_limited",
        message: "",
        debug,
      }),
      debug,
    };

    return {
      source: "mixed",
      note: status.message,
      events: [],
      coverageSummary: buildCoverageSummary([], status, debug),
      statuses: [status, ...buildCandidateStatuses()],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Meow Wolf events could not be audited.";
    const failedDebug: CultureSourceDebug = {
      urlsChecked,
      responseStatuses: {},
      responseStatus: undefined,
      dateWindowStart: getHoustonTodayDate(),
      dateWindowEnd: addDays(getHoustonTodayDate(), 14),
      eventCalendarHeadingFound: false,
      cleanedLineCount: 0,
      dateHeadingMatches: 0,
      titleMatches: 0,
      dateTimeMatches: 0,
      rawEventCandidates: 0,
      parsedValidEvents: 0,
      todayChecked: true,
      todayEventsCount: 0,
      reachedOfficialPage: false,
      eventsCalendarLinkFound: false,
      ticketingPageReached: false,
      usefulDatedEventTextFound: false,
      structuredDataFound: false,
      sampleLines: [],
      warnings: [message],
    };
    const status: CultureSourceStatus = {
      sourceName: MEOW_WOLF_SOURCE_NAME,
      sourceUrl: MEOW_WOLF_TICKETS_URL,
      status: "failed",
      message,
      debug: failedDebug,
    };

    return {
      source: "mock",
      note: message,
      events: [],
      coverageSummary: buildCoverageSummary([], status, failedDebug),
      statuses: [status, ...buildCandidateStatuses()],
    };
  }
}
