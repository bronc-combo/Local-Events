import { unstable_noStore as noStore } from "next/cache";
import { EVENT_DISPLAY_WINDOW_DAYS } from "@/lib/event-window";
import { scoreEvent, type EventSeed } from "@/lib/event-scoring";
import { HOUSTON_CULTURE_REGISTRY } from "@/lib/culture-registry";
import type {
  CultureCoverageSummary,
  CultureProviderResult,
  CultureSourceDebug,
  EventItem,
} from "@/types/dashboard";

const BUFFALO_BAYOU_SOURCE_NAME = "Buffalo Bayou Partnership";
const BUFFALO_BAYOU_DISPLAY_NAME = "Buffalo Bayou";
const BUFFALO_BAYOU_HOME_URL = "https://buffalobayou.org/";
const BUFFALO_BAYOU_CALENDAR_URL = "https://buffalobayou.org/calendar/";
const BUFFALO_BAYOU_USER_AGENT = "DailyOverviewBot/1.0 (+https://localhost)";

const MONTH_LOOKUP: Record<string, number> = {
  january: 1,
  jan: 1,
  february: 2,
  feb: 2,
  march: 3,
  mar: 3,
  april: 4,
  apr: 4,
  may: 5,
  june: 6,
  jun: 6,
  july: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sep: 9,
  sept: 9,
  october: 10,
  oct: 10,
  november: 11,
  nov: 11,
  december: 12,
  dec: 12,
};

interface BuffaloBayouParsedEvent {
  title: string;
  date: string;
  timeLabel: string;
  startDate: string;
  endDate: string;
  isOngoing: boolean;
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
    .replace(/&#8211;/g, "-")
    .replace(/&#8212;/g, "-")
    .replace(/&ndash;/g, "-")
    .replace(/&mdash;/g, "-")
    .replace(/&#038;/g, "&");
}

function normalizeWhitespace(value: string): string {
  return decodeHtmlEntities(value.replace(/\u00a0/g, " ")).replace(/\s+/g, " ").trim();
}

function stripTags(value: string): string {
  return normalizeWhitespace(value.replace(/<[^>]+>/g, " "));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractVisibleLines(html: string): string[] {
  const text = html
    .replace(/<!--[\s\S]*?-->/g, " ")
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

function fetchHtml(url: string): Promise<{ html: string; responseStatus: number }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  return fetch(url, {
    headers: {
      "user-agent": BUFFALO_BAYOU_USER_AGENT,
      accept: "text/html,application/xhtml+xml",
    },
    signal: controller.signal,
    cache: "no-store",
  })
    .then(async (response) => ({
      html: await response.text(),
      responseStatus: response.status,
    }))
    .finally(() => {
      clearTimeout(timeout);
    });
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
  return MONTH_LOOKUP[monthName.toLowerCase()] ?? null;
}

function inferYear(month: number, day: number): number {
  const today = new Date();
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const [currentYear, currentMonth, currentDay] = formatter.format(today).split("-").map(Number);

  if (month < currentMonth || (month === currentMonth && day < currentDay)) {
    return currentYear + 1;
  }

  return currentYear;
}

function parseMonthDay(monthToken: string, dayToken: string): string | null {
  const month = getMonthNumber(monthToken);
  const day = Number(dayToken);
  const year = month ? inferYear(month, day) : NaN;

  if (!month || !Number.isFinite(day) || Number.isNaN(day) || !Number.isFinite(year)) {
    return null;
  }

  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function isMonthLine(line: string): boolean {
  return /^(jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december)$/i.test(
    line,
  );
}

function isDayLine(line: string): boolean {
  return /^\d{1,2}$/.test(line);
}

function isLikelyTitle(line: string): boolean {
  const normalized = line.toLowerCase();

  if (
    [
      "upcoming events & tours",
      "all events & tours",
      "events & tours",
      "calendar",
      "tours",
      "special events",
      "planning for the future",
      "plans and projects",
      "add to calendar",
      "view calendar",
      "view all",
      "buy tickets",
      "learn more",
    ].includes(normalized)
  ) {
    return false;
  }

  return /[a-z]/i.test(line);
}

function isTimeLine(line: string): boolean {
  return /\d{1,2}(?::\d{2})?\s*[–-]\s*\d{1,2}(?::\d{2})?\s*(?:[ap]m)?/i.test(line);
}

function titleCaseLocation(value: string): string {
  const normalized = normalizeWhitespace(value).toLowerCase();

  if (normalized.includes("allen")) {
    return "Allen's Landing";
  }

  if (normalized.includes("cistern")) {
    return "Buffalo Bayou Park Cistern";
  }

  return normalized
    .split(" ")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function parseTimeLabel(timeText: string): string | null {
  const [rawTime] = normalizeWhitespace(timeText).split(",");
  const normalized = rawTime.replace(/[–—]/g, "-");
  const match = normalized.match(
    /^(\d{1,2}(?::\d{2})?\s*(?:[ap]m)?)\s*-\s*(\d{1,2}(?::\d{2})?\s*(?:[ap]m)?)$/i,
  );

  if (!match) {
    return null;
  }

  const start = match[1].trim();
  const end = match[2].trim();
  const meridiem = (end.match(/[ap]m$/i)?.[0] ?? start.match(/[ap]m$/i)?.[0] ?? "").toUpperCase();

  if (!meridiem) {
    return `${start.replace(/\s*[ap]m$/i, "")}–${end.replace(/\s*[ap]m$/i, "")}`;
  }

  return `${start.replace(/\s*[ap]m$/i, "")}–${end.replace(/\s*[ap]m$/i, "")} ${meridiem}`;
}

function parseTimeToIso(date: string, timeLabel: string): string {
  const normalized = timeLabel.replace(/[–—]/g, "-");
  const match = normalized.match(
    /^(\d{1,2})(?::(\d{2}))?\s*(?:([ap]m))?\s*-\s*(\d{1,2})(?::(\d{2}))?\s*(?:([ap]m))?\s*([AP]M)?$/i,
  );

  if (!match) {
    return `${date}T12:00:00-05:00`;
  }

  const startHour = Number(match[1]);
  const startMinute = match[2] ?? "00";
  const endMeridiem = (match[6] ?? match[7] ?? match[3] ?? "PM").toUpperCase();
  const startMeridiem = (match[3] ?? endMeridiem).toUpperCase();
  let hours = startHour;

  if (startMeridiem === "PM" && hours !== 12) {
    hours += 12;
  }

  if (startMeridiem === "AM" && hours === 12) {
    hours = 0;
  }

  return `${date}T${String(hours).padStart(2, "0")}:${startMinute}:00-05:00`;
}

function inferCategory(title: string): string {
  const normalized = title.toLowerCase();

  if (normalized.includes("walk") || normalized.includes("cruise") || normalized.includes("tour")) {
    return "Community / Outdoors";
  }

  if (normalized.includes("meditation") || normalized.includes("sound") || normalized.includes("cistern")) {
    return "Arts & Culture";
  }

  return "Arts & Culture";
}

function inferScoringTags(title: string): string[] {
  const normalized = title.toLowerCase();
  const tags = ["arts", "culture"];

  if (normalized.includes("meditation") || normalized.includes("sound")) {
    tags.push("wellness");
  }

  if (normalized.includes("walk") || normalized.includes("cruise") || normalized.includes("tour")) {
    tags.push("community", "outdoors");
  }

  return tags;
}

function inferVenueFit(title: string): number {
  const normalized = title.toLowerCase();

  if (normalized.includes("cistern") || normalized.includes("meditation")) {
    return 13;
  }

  if (normalized.includes("walk") || normalized.includes("cruise")) {
    return 11;
  }

  return 10;
}

function inferRarity(title: string): number {
  const normalized = title.toLowerCase();

  if (normalized.includes("meditation")) {
    return 9;
  }

  if (normalized.includes("walk")) {
    return 7;
  }

  if (normalized.includes("cruise")) {
    return 6;
  }

  return 6;
}

function buildSourceLinks(eventUrl: string): EventItem["sourceLinks"] {
  const links = [
    { label: BUFFALO_BAYOU_DISPLAY_NAME, url: BUFFALO_BAYOU_HOME_URL },
    { label: "Calendar", url: BUFFALO_BAYOU_CALENDAR_URL },
    { label: "Event page", url: eventUrl },
  ];
  const seen = new Set<string>();

  return links.filter((link) => {
    if (seen.has(link.url)) {
      return false;
    }

    seen.add(link.url);
    return true;
  });
}

function findEventUrl(html: string, title: string): string | null {
  const escapedTitle = escapeRegExp(title);
  const patterns = [
    new RegExp(`<a[^>]+href="([^"]+)"[^>]*alt="${escapedTitle}"`, "i"),
    new RegExp(`<a[^>]+alt="${escapedTitle}"[^>]*href="([^"]+)"`, "i"),
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);

    if (match?.[1]) {
      return normalizeWhitespace(match[1]);
    }
  }

  return null;
}

function parseHtmlEvents(html: string, sourcePageUrl: string): BuffaloBayouParsedEvent[] {
  const lines = extractVisibleLines(html);
  const startIndex = lines.findIndex((line) => /upcoming events\s*&\s*tours/i.test(line));
  const scopedLines = startIndex >= 0 ? lines.slice(startIndex) : lines;
  const events: BuffaloBayouParsedEvent[] = [];

  for (let index = 0; index < scopedLines.length - 3; index += 1) {
    const monthLine = scopedLines[index];
    const dayLine = scopedLines[index + 1];
    const titleLine = scopedLines[index + 2];
    const timeLine = scopedLines[index + 3];

    if (!isMonthLine(monthLine) || !isDayLine(dayLine)) {
      continue;
    }

    if (!isLikelyTitle(titleLine) || !isTimeLine(timeLine)) {
      continue;
    }

    const date = parseMonthDay(monthLine, dayLine);
    const timeLabel = parseTimeLabel(timeLine);
    const normalizedTitle = normalizeWhitespace(titleLine);

    if (!date || !timeLabel || !normalizedTitle) {
      continue;
    }

    const locationText = normalizeWhitespace(timeLine.split(",").slice(1).join(","));
    const eventUrl = findEventUrl(html, normalizedTitle) ?? sourcePageUrl;
    const sourceLinks = buildSourceLinks(eventUrl);

    events.push({
      title: normalizedTitle,
      date,
      timeLabel,
      venue: titleCaseLocation(locationText) || BUFFALO_BAYOU_SOURCE_NAME,
      city: "Houston",
      category: inferCategory(normalizedTitle),
      sourceLabel: BUFFALO_BAYOU_DISPLAY_NAME,
      sourceUrl: eventUrl,
      sourceLinks,
      startDate: date,
      endDate: date,
      isOngoing: false,
    });
  }

  return events;
}

function toEventItem(event: BuffaloBayouParsedEvent): EventItem {
  const dateTime = parseTimeToIso(event.date, event.timeLabel);
  const seed: EventSeed = {
    id: `buffalo-bayou-${event.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${event.date}`,
    title: event.title,
    dateTime,
    venue: event.venue,
    city: event.city,
    category: event.category,
    genreTags: inferScoringTags(event.title),
    sourceLinks: event.sourceLinks,
    isGreatLiveAct: false,
    liveReputationStatus: "unknown",
    liveReputationConfidence: 0,
    liveReputationReasons: [],
    liveReputationSources: [],
    venueFitScore: inferVenueFit(event.title),
    knownLiveReputationScore: 0,
    rarityScore: inferRarity(event.title),
    distanceRelevanceScore: 7,
    feedbackHistoryPlaceholderScore: 3,
  };

  const scoredEvent = scoreEvent(seed);

  return {
    ...scoredEvent,
    sourceLabel: event.sourceLabel,
    timeLabel: event.timeLabel,
    startDate: event.date,
    endDate: event.date,
    isOngoing: false,
  };
}

function dedupeEvents(events: EventItem[]): { events: EventItem[]; removedCount: number } {
  const byKey = new Map<string, EventItem>();
  let removedCount = 0;

  for (const event of events) {
    const key = [
      event.title.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      event.dateTime.slice(0, 10),
      event.timeLabel ?? event.dateTime.slice(11, 16),
      event.venue.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    ].join("|");

    if (byKey.has(key)) {
      removedCount += 1;
      continue;
    }

    byKey.set(key, event);
  }

  return { events: [...byKey.values()], removedCount };
}

function buildCoverageSummary(
  events: EventItem[],
  debug: CultureSourceDebug,
  source: CultureCoverageSummary["source"],
): CultureCoverageSummary {
  const today = getHoustonTodayDate();

  return {
    source,
    trackedSourcesCount: HOUSTON_CULTURE_REGISTRY.length,
    activeLiveProvidersCount: HOUSTON_CULTURE_REGISTRY.filter((entry) => entry.providerStatus === "working" || entry.providerStatus === "limited" || entry.providerStatus === "audited_limited").length,
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
    note: "",
  };
}

function buildStatusMessage(parsedCount: number, todayCount: number, debug: CultureSourceDebug): string {
  if (parsedCount > 0) {
    return `${BUFFALO_BAYOU_SOURCE_NAME} loaded from official events pages: ${parsedCount} events parsed${todayCount > 0 ? `, including ${todayCount} today` : ""}.`;
  }

  if (debug.warnings.length > 0) {
    return `${BUFFALO_BAYOU_SOURCE_NAME} source loaded, but parser found 0 valid events.`;
  }

  return `${BUFFALO_BAYOU_SOURCE_NAME} official pages were reachable, but no parseable event rows were found.`;
}

export async function fetchBuffaloBayouSource(): Promise<CultureProviderResult> {
  noStore();

  const urlsChecked = [BUFFALO_BAYOU_HOME_URL, BUFFALO_BAYOU_CALENDAR_URL];

  try {
    const [homeResult, calendarResult] = await Promise.all(urlsChecked.map((url) => fetchHtml(url)));
    const combinedHtml = `${homeResult.html}\n${calendarResult.html}`;
    const combinedLines = [
      ...extractVisibleLines(homeResult.html),
      ...extractVisibleLines(calendarResult.html),
    ];
    const parsedFromHome = parseHtmlEvents(homeResult.html, BUFFALO_BAYOU_HOME_URL);
    const parsedFromCalendar = parseHtmlEvents(calendarResult.html, BUFFALO_BAYOU_CALENDAR_URL);
    const rawEvents = [
      ...parsedFromHome.map(toEventItem),
      ...parsedFromCalendar.map(toEventItem),
    ];
    const deduped = dedupeEvents(rawEvents);
    const parsedValidEvents = deduped.events.sort((left, right) => left.dateTime.localeCompare(right.dateTime));
    const today = getHoustonTodayDate();
    const todayCount = parsedValidEvents.filter((event) => event.dateTime.slice(0, 10) === today).length;
    const rawEventCandidates = parsedFromHome.length + parsedFromCalendar.length;
    const titleMatches = combinedLines.filter((line) => isLikelyTitle(line)).length;
    const timeMatches = combinedLines.filter((line) => isTimeLine(line)).length;
    const dateMatches = combinedLines.filter((line) => isMonthLine(line) || isDayLine(line)).length;
    const structuredDataFound = /application\/ld\+json/i.test(combinedHtml);
    const eventsNavigationFound = /Upcoming Events\s*&\s*Tours/i.test(combinedHtml) || /Events\s*&\s*Tours/i.test(combinedHtml);
    const usefulDatedEventTextFound = rawEventCandidates > 0;
    const debug: CultureSourceDebug = {
      urlsChecked,
      responseStatuses: {
        home: homeResult.responseStatus,
        calendar: calendarResult.responseStatus,
      },
      responseStatus: homeResult.responseStatus,
      homepageReached: homeResult.responseStatus >= 200 && homeResult.responseStatus < 400,
      calendarPageReached: calendarResult.responseStatus >= 200 && calendarResult.responseStatus < 400,
      dateWindowStart: today,
      dateWindowEnd: addDays(today, EVENT_DISPLAY_WINDOW_DAYS),
      eventCalendarHeadingFound: eventsNavigationFound,
      eventsNavigationFound,
      cleanedLineCount: combinedLines.length,
      dateHeadingMatches: dateMatches,
      titleMatches,
      dateTimeMatches: timeMatches,
      rawEventCandidates,
      parsedValidEvents: parsedValidEvents.length,
      todayChecked: true,
      todayEventsCount: todayCount,
      earliestParsedEventDate: parsedValidEvents[0]?.dateTime.slice(0, 10),
      latestParsedEventDate: parsedValidEvents.at(-1)?.dateTime.slice(0, 10),
      reachedOfficialPage: homeResult.responseStatus >= 200 && homeResult.responseStatus < 400,
      eventsCalendarLinkFound: /\/calendar\//i.test(combinedHtml),
      usefulDatedEventTextFound,
      structuredDataFound,
      dateRangeEventCount: 0,
      duplicateEventsRemoved: deduped.removedCount,
      sampleLines: rawEventCandidates > 0 ? undefined : combinedLines.slice(0, 16),
      warnings: deduped.removedCount > 0 ? ["Repeated homepage and calendar cards were deduplicated."] : [],
    };

    const parsedCount = parsedValidEvents.length;
    const todayEventsCount = todayCount;
    const source = parsedCount > 0 ? "live_provider" : "mock";
    const note = buildStatusMessage(parsedCount, todayEventsCount, debug);

    return {
      source,
      note,
      events: parsedValidEvents,
      coverageSummary: buildCoverageSummary(parsedValidEvents, debug, source),
      statuses: [
        {
          sourceName: BUFFALO_BAYOU_SOURCE_NAME,
          sourceUrl: BUFFALO_BAYOU_CALENDAR_URL,
          status: parsedCount > 0 ? "working" : "audited_limited",
          message: note,
          debug,
        },
      ],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Buffalo Bayou source fetch failed.";

    return {
      source: "mock",
      note: "Buffalo Bayou source could not be loaded, so mock fallback is in use.",
      events: [],
      coverageSummary: {
        source: "mock",
        trackedSourcesCount: HOUSTON_CULTURE_REGISTRY.length,
        activeLiveProvidersCount: HOUSTON_CULTURE_REGISTRY.filter((entry) => entry.providerStatus === "working" || entry.providerStatus === "limited" || entry.providerStatus === "audited_limited").length,
        notImplementedSourcesCount: HOUSTON_CULTURE_REGISTRY.filter((entry) => entry.providerStatus === "not_implemented").length,
        parsedEventsCount: 0,
        todayChecked: false,
        todayEventsCount: 0,
        note: "Buffalo Bayou source could not be loaded, so mock fallback is in use.",
      },
      statuses: [
        {
          sourceName: BUFFALO_BAYOU_SOURCE_NAME,
          sourceUrl: BUFFALO_BAYOU_CALENDAR_URL,
          status: "failed",
          message,
          debug: {
            urlsChecked,
            dateWindowStart: getHoustonTodayDate(),
            dateWindowEnd: addDays(getHoustonTodayDate(), 14),
            eventCalendarHeadingFound: false,
            cleanedLineCount: 0,
            dateHeadingMatches: 0,
            rawEventCandidates: 0,
            parsedValidEvents: 0,
            todayChecked: false,
            todayEventsCount: 0,
            warnings: [message],
          },
        },
      ],
    };
  }
}
