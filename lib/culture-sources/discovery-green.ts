import { unstable_noStore as noStore } from "next/cache";
import { EVENT_DISPLAY_WINDOW_DAYS } from "@/lib/event-window";
import { scoreEvent, type EventSeed } from "@/lib/event-scoring";
import { HOUSTON_CULTURE_REGISTRY } from "@/lib/culture-registry";
import { getHoustonTodayDate as getHoustonTodayDateBase } from "@/lib/culture-date-filter";
import type {
  CultureCoverageSummary,
  CultureProviderResult,
  CultureSourceDebug,
  CultureSourceStatus,
  EventItem,
} from "@/types/dashboard";

const DISCOVERY_GREEN_SOURCE_NAME = "Discovery Green";
const DISCOVERY_GREEN_HOME_URL = "https://www.discoverygreen.com/";
const DISCOVERY_GREEN_EVENTS_URL = "https://www.discoverygreen.com/events/";
const DISCOVERY_GREEN_SIGNATURE_URL = "https://www.discoverygreen.com/signature-events/";
const DISCOVERY_GREEN_USER_AGENT = "DailyOverviewBot/1.0 (+https://localhost)";

interface DiscoveryGreenParsedEvent {
  title: string;
  startDate: string;
  endDate: string;
  isRange: boolean;
  timeLabel?: string;
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
    .replace(/&mdash;/g, "-");
}

function normalizeWhitespace(value: string): string {
  return decodeHtmlEntities(value.replace(/\u00a0/g, " ")).replace(/\s+/g, " ").trim();
}

function stripTags(value: string): string {
  return normalizeWhitespace(value.replace(/<[^>]+>/g, " "));
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

function fetchHtml(url: string): Promise<{ html: string; responseStatus: number }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  return fetch(url, {
    headers: {
      "user-agent": DISCOVERY_GREEN_USER_AGENT,
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

function getMonthNumber(monthName: string): number | null {
  const months: Record<string, number> = {
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
  const [currentYear, currentMonth, currentDay] = formatter.format(today).split("-").map(Number);

  if (month < currentMonth || (month === currentMonth && day < currentDay)) {
    return currentYear + 1;
  }

  return currentYear;
}

function parseSingleDateToken(text: string): { date: string; displayDate: string } | null {
  const normalized = normalizeWhitespace(text).replace(/[–—]/g, "-");
  const match = normalized.match(
    /^(?:Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)?\s*,?\s*([A-Za-z]{3,9})\s+(\d{1,2})(?:,\s*(\d{4}))?$/,
  );

  if (!match) {
    return null;
  }

  const month = getMonthNumber(match[1]);
  const day = Number(match[2]);
  const year = match[3] ? Number(match[3]) : inferYear(month ?? 1, day);

  if (!month || Number.isNaN(day) || !Number.isFinite(year)) {
    return null;
  }

  const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const displayDate = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    month: "short",
    day: "numeric",
  }).format(new Date(`${date}T12:00:00-05:00`));

  return { date, displayDate };
}

function parseDateRangeLabel(text: string): {
  startDate: string;
  endDate: string;
  startDisplay: string;
  endDisplay: string;
  isRange: boolean;
} | null {
  const normalized = normalizeWhitespace(text).replace(/[–—]/g, "-");
  const parts = normalized.split(/\s+-\s+/);

  if (parts.length === 1) {
    const single = parseSingleDateToken(parts[0]);

    if (!single) {
      return null;
    }

    return {
      startDate: single.date,
      endDate: single.date,
      startDisplay: single.displayDate,
      endDisplay: single.displayDate,
      isRange: false,
    };
  }

  if (parts.length !== 2) {
    return null;
  }

  const start = parseSingleDateToken(parts[0]);
  const end = parseSingleDateToken(parts[1]);

  if (!start || !end) {
    return null;
  }

  return {
    startDate: start.date,
    endDate: end.date,
    startDisplay: start.displayDate,
    endDisplay: end.displayDate,
    isRange: start.date !== end.date,
  };
}

function isWithinWindow(date: string, windowStart: string, windowEnd: string): boolean {
  return date >= windowStart && date <= windowEnd;
}

function isDateRangeActiveToday(startDate: string, endDate: string, today: string): boolean {
  return startDate <= today && endDate >= today;
}

function inferCategory(title: string): string {
  const normalized = title.toLowerCase();

  if (
    normalized.includes("fitness") ||
    normalized.includes("boats") ||
    normalized.includes("soccer") ||
    normalized.includes("run") ||
    normalized.includes("walk") ||
    normalized.includes("yoga")
  ) {
    return "Community / Outdoors";
  }

  if (
    normalized.includes("flea") ||
    normalized.includes("market") ||
    normalized.includes("family") ||
    normalized.includes("kids")
  ) {
    return "Community / Family";
  }

  if (
    normalized.includes("film") ||
    normalized.includes("screen") ||
    normalized.includes("concert") ||
    normalized.includes("music") ||
    normalized.includes("performance")
  ) {
    return "Arts & Culture";
  }

  return "Arts & Culture";
}

function inferScoringTags(title: string): string[] {
  const normalized = title.toLowerCase();
  const tags = ["arts", "culture"];

  if (normalized.includes("film") || normalized.includes("screen")) {
    tags.push("film");
  }

  if (normalized.includes("concert") || normalized.includes("music") || normalized.includes("performance")) {
    tags.push("performance");
  }

  if (normalized.includes("fitness") || normalized.includes("boats") || normalized.includes("soccer") || normalized.includes("yoga")) {
    tags.push("community");
  }

  if (normalized.includes("flea") || normalized.includes("market") || normalized.includes("family") || normalized.includes("kids")) {
    tags.push("community");
  }

  return tags;
}

function inferVenueFit(title: string): number {
  const normalized = title.toLowerCase();

  if (normalized.includes("concert") || normalized.includes("screen") || normalized.includes("film")) {
    return 13;
  }

  if (normalized.includes("fitness") || normalized.includes("soccer") || normalized.includes("boats")) {
    return 11;
  }

  if (normalized.includes("flea") || normalized.includes("market") || normalized.includes("family")) {
    return 10;
  }

  return 10;
}

function inferRarity(title: string): number {
  const normalized = title.toLowerCase();

  if (normalized.includes("concert") || normalized.includes("screen") || normalized.includes("film")) {
    return 9;
  }

  if (normalized.includes("flea") || normalized.includes("market")) {
    return 8;
  }

  if (normalized.includes("fitness") || normalized.includes("boats") || normalized.includes("soccer")) {
    return 7;
  }

  return 6;
}

function buildSourceLinks(eventUrl: string): EventItem["sourceLinks"] {
  const links = [
    { label: DISCOVERY_GREEN_SOURCE_NAME, url: DISCOVERY_GREEN_HOME_URL },
    { label: "Events", url: DISCOVERY_GREEN_EVENTS_URL },
    { label: "Signature events", url: DISCOVERY_GREEN_SIGNATURE_URL },
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

function parseCardMatches(html: string, sourcePageUrl: string): DiscoveryGreenParsedEvent[] {
  const events: DiscoveryGreenParsedEvent[] = [];
  const cardPattern = /<h3[^>]*class="[^"]*elementor-heading-title[^"]*"[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>\s*<\/h3>[\s\S]{0,1200}?<h6[^>]*class="[^"]*elementor-heading-title[^"]*"[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>\s*<\/h6>/gi;

  for (const match of html.matchAll(cardPattern)) {
    const title = stripTags(match[2] ?? "");
    const dateText = stripTags(match[4] ?? "");
    const eventUrl = normalizeWhitespace(match[1] ?? match[3] ?? sourcePageUrl) || sourcePageUrl;

    if (!title || !dateText) {
      continue;
    }

    if (/^(view all|learn more|event page|tickets?)$/i.test(title)) {
      continue;
    }

    const dateRange = parseDateRangeLabel(dateText);

    if (!dateRange) {
      continue;
    }

    events.push({
      title,
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
      isRange: dateRange.isRange,
      timeLabel: dateRange.isRange ? `Runs ${dateRange.startDisplay}–${dateRange.endDisplay}` : undefined,
      venue: DISCOVERY_GREEN_SOURCE_NAME,
      city: "Houston",
      category: inferCategory(title),
      sourceLabel: DISCOVERY_GREEN_SOURCE_NAME,
      sourceUrl: eventUrl,
      sourceLinks: buildSourceLinks(eventUrl),
    });
  }

  return events;
}

function parseHtmlEvents(html: string, sourcePageUrl: string): DiscoveryGreenParsedEvent[] {
  const cardEvents = parseCardMatches(html, sourcePageUrl);

  if (cardEvents.length > 0) {
    return cardEvents;
  }

  const lines = extractVisibleLines(html);
  const events: DiscoveryGreenParsedEvent[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const dateRange = parseDateRangeLabel(line);

    if (!dateRange) {
      continue;
    }

    const title = lines[index + 1] ?? lines[index - 1] ?? "";

    if (!title || /^(events|signature experiences|happening @ discovery green|view all)$/i.test(title)) {
      continue;
    }

    events.push({
      title,
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
      isRange: dateRange.isRange,
      timeLabel: dateRange.isRange ? `Runs ${dateRange.startDisplay}–${dateRange.endDisplay}` : undefined,
      venue: DISCOVERY_GREEN_SOURCE_NAME,
      city: "Houston",
      category: inferCategory(title),
      sourceLabel: DISCOVERY_GREEN_SOURCE_NAME,
      sourceUrl: sourcePageUrl,
      sourceLinks: buildSourceLinks(sourcePageUrl),
    });
  }

  return events;
}

function dedupeEvents(events: EventItem[]): EventItem[] {
  const byKey = new Map<string, EventItem>();

  for (const event of events) {
    const key = [
      event.title.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      event.dateTime.slice(0, 10),
      event.venue.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      event.sourceLabel ?? "",
    ].join("|");

    if (!byKey.has(key)) {
      byKey.set(key, event);
    }
  }

  return [...byKey.values()];
}

function mapEventToItem(event: DiscoveryGreenParsedEvent, today: string): EventItem {
  const isOngoing = isDateRangeActiveToday(event.startDate, event.endDate, today);
  const dateTime = isOngoing
    ? `${today}T12:00:00-05:00`
    : `${event.startDate}T12:00:00-05:00`;

  const seed: EventSeed = {
    id: `discovery-green-${event.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${dateTime.slice(0, 10)}`,
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
    distanceRelevanceScore: 8,
    feedbackHistoryPlaceholderScore: 3,
  };

  const scoredEvent = scoreEvent(seed);

  return {
    ...scoredEvent,
    sourceLabel: event.sourceLabel,
    startDate: event.startDate,
    endDate: event.endDate,
    isOngoing,
    timeLabel: event.timeLabel,
  };
}

function buildCoverageSummary(events: EventItem[], debug: CultureSourceDebug, source: CultureCoverageSummary["source"]): CultureCoverageSummary {
  const today = getHoustonTodayDateBase();

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

function buildStatusMessage(events: EventItem[], debug: CultureSourceDebug): string {
  if (events.length > 0) {
    const todayCount = events.filter((event) => event.dateTime.slice(0, 10) === getHoustonTodayDateBase()).length;
    return `${DISCOVERY_GREEN_SOURCE_NAME} loaded from official events pages: ${events.length} events parsed${todayCount > 0 ? `, including ${todayCount} today` : ""}.`;
  }

  if (!debug.eventsNavigationFound && !debug.happeningSectionFound) {
    return `${DISCOVERY_GREEN_SOURCE_NAME} source loaded, but the official events sections were not found.`;
  }

  return `${DISCOVERY_GREEN_SOURCE_NAME} source loaded, but parser found 0 valid events.`;
}

function buildSampleLines(events: EventItem[], lines: string[]): string[] {
  if (events.length > 0) {
    return events.slice(0, 8).map((event) => `${event.title} — ${event.dateTime.slice(0, 10)}`);
  }

  return lines
    .filter((line) => /events|happening|signature|concert|screen|film|fitness|boats|soccer|market|family/i.test(line))
    .slice(0, 12);
}

function hasStructuredData(html: string): boolean {
  return /<script[^>]+type="application\/ld\+json"/i.test(html) && /event/i.test(html);
}

function extractRelevantLineCount(lines: string[]): number {
  return lines.filter((line) => /\b(?:[A-Za-z]{3,9})\s+\d{1,2}(?:,\s*\d{4})?\b/.test(line)).length;
}

export async function fetchDiscoveryGreenSource(): Promise<CultureProviderResult> {
  noStore();

  const urlsChecked = [
    DISCOVERY_GREEN_HOME_URL,
    DISCOVERY_GREEN_EVENTS_URL,
    DISCOVERY_GREEN_SIGNATURE_URL,
  ];

  try {
    const [homeResult, eventsResult, signatureResult] = await Promise.all([
      fetchHtml(DISCOVERY_GREEN_HOME_URL),
      fetchHtml(DISCOVERY_GREEN_EVENTS_URL),
      fetchHtml(DISCOVERY_GREEN_SIGNATURE_URL),
    ]);

    const homeLines = extractVisibleLines(homeResult.html);
    const eventsLines = extractVisibleLines(eventsResult.html);
    const signatureLines = extractVisibleLines(signatureResult.html);

    const today = getHoustonTodayDateBase();
    const windowEnd = addDays(today, EVENT_DISPLAY_WINDOW_DAYS);

    const parsedEvents = dedupeEvents([
      ...parseHtmlEvents(homeResult.html, DISCOVERY_GREEN_HOME_URL).map((event) => mapEventToItem(event, today)),
      ...parseHtmlEvents(eventsResult.html, DISCOVERY_GREEN_EVENTS_URL).map((event) => mapEventToItem(event, today)),
      ...parseHtmlEvents(signatureResult.html, DISCOVERY_GREEN_SIGNATURE_URL).map((event) => mapEventToItem(event, today)),
    ])
      .filter((event) => isWithinWindow(event.dateTime.slice(0, 10), today, windowEnd))
      .sort((left, right) => left.dateTime.localeCompare(right.dateTime) || right.tasteScore - left.tasteScore);

    const combinedLines = [...homeLines, ...eventsLines, ...signatureLines];
    const eventsNavigationFound = /\/events\/?\?f=(today|week|month)/i.test(homeResult.html) || /full calendar/i.test(homeResult.html);
    const happeningSectionFound = /happening\s*@\s*discovery green/i.test(homeResult.html) || /signature experiences/i.test(homeResult.html);
    const usefulDatedEventTextFound = extractRelevantLineCount(combinedLines) > 0;
    const dateRangeEventCount = parsedEvents.filter((event) => typeof event.timeLabel === "string" && event.timeLabel.startsWith("Runs ")).length;
    const debug: CultureSourceDebug = {
      urlsChecked,
      responseStatuses: {
        homepage: homeResult.responseStatus,
        eventsPage: eventsResult.responseStatus,
        signatureEvents: signatureResult.responseStatus,
      },
      responseStatus: signatureResult.responseStatus,
      dateWindowStart: today,
      dateWindowEnd: windowEnd,
      eventCalendarHeadingFound: eventsNavigationFound || happeningSectionFound,
      eventsNavigationFound,
      happeningSectionFound,
      cleanedLineCount: combinedLines.length,
      dateHeadingMatches: combinedLines.filter((line) => /\b(?:[A-Za-z]{3,9})\s+\d{1,2}(?:,\s*\d{4})?\b/.test(line)).length,
      titleMatches: parsedEvents.length,
      dateTimeMatches: parsedEvents.length,
      rawEventCandidates: parsedEvents.length,
      parsedValidEvents: parsedEvents.length,
      todayChecked: true,
      todayEventsCount: parsedEvents.filter((event) => event.dateTime.slice(0, 10) === today).length,
      earliestParsedEventDate: parsedEvents[0]?.dateTime.slice(0, 10),
      latestParsedEventDate: parsedEvents.at(-1)?.dateTime.slice(0, 10),
      reachedOfficialPage: homeResult.responseStatus >= 200 && homeResult.responseStatus < 400,
      eventsCalendarLinkFound: /\/events\//i.test(homeResult.html),
      usefulDatedEventTextFound,
      structuredDataFound: hasStructuredData(homeResult.html) || hasStructuredData(eventsResult.html) || hasStructuredData(signatureResult.html),
      dateRangeEventCount,
      sampleLines: buildSampleLines(parsedEvents, combinedLines),
      warnings: parsedEvents.length > 0 ? [] : ["Discovery Green source loaded, but parser found 0 valid events."],
    };

    const status: CultureSourceStatus = {
      sourceName: DISCOVERY_GREEN_SOURCE_NAME,
      sourceUrl: DISCOVERY_GREEN_EVENTS_URL,
      status: parsedEvents.length > 0 ? "working" : "limited",
      message: buildStatusMessage(parsedEvents, debug),
      debug,
    };

    return {
      source: parsedEvents.length > 0 ? "live_provider" : "mixed",
      note: status.message,
      events: parsedEvents,
      coverageSummary: buildCoverageSummary(parsedEvents, debug, parsedEvents.length > 0 ? "live_provider" : "mixed"),
      statuses: [status],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Discovery Green events could not be loaded.";
    const failedDebug: CultureSourceDebug = {
      urlsChecked,
      responseStatus: undefined,
      dateWindowStart: getHoustonTodayDateBase(),
      dateWindowEnd: addDays(getHoustonTodayDateBase(), EVENT_DISPLAY_WINDOW_DAYS),
      eventCalendarHeadingFound: false,
      eventsNavigationFound: false,
      happeningSectionFound: false,
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
      usefulDatedEventTextFound: false,
      structuredDataFound: false,
      dateRangeEventCount: 0,
      sampleLines: [],
      warnings: [message],
    };

    const status: CultureSourceStatus = {
      sourceName: DISCOVERY_GREEN_SOURCE_NAME,
      sourceUrl: DISCOVERY_GREEN_EVENTS_URL,
      status: "failed",
      message,
      debug: failedDebug,
    };

    return {
      source: "mock",
      note: message,
      events: [],
      coverageSummary: buildCoverageSummary([], failedDebug, "mock"),
      statuses: [status],
    };
  }
}
