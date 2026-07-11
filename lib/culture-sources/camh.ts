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

const CAMH_SOURCE_NAME = "CAMH";
const CAMH_OFFICIAL_URL = "https://camh.org/";
const CAMH_EVENT_CALENDAR_URL = "https://camh.org/event-calendar/";
const CAMH_EVENT_LIST_URL = "https://camh.org/event-calendar/list/?hide_subsequent_recurrences=1";
const CAMH_USER_AGENT = "DailyOverviewBot/1.0 (+https://localhost)";

interface CamhParsedEvent {
  title: string;
  dateTime: string;
  timeLabel?: string;
  venue: string;
  city: string;
  category: string;
  sourceLabel: string;
  sourceUrl: string;
  sourceLinks: EventItem["sourceLinks"];
  description?: string;
  locationName?: string;
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

function fetchHtml(url: string): Promise<{ html: string; responseStatus: number }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  return fetch(url, {
    headers: {
      "user-agent": CAMH_USER_AGENT,
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

function parseMonthDayHeading(line: string): boolean {
  return /^(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)?\,?\s+[A-Za-z]+\s+\d{1,2}(?:,\s*\d{4})?$/i.test(line)
    || /^[A-Za-z]+\s+\d{1,2}(?:,\s*\d{4})?$/.test(line);
}

function formatTimeLabel(dateTime: string, endDateTime?: string | null): string {
  const hasExplicitTime = /T\d{2}:\d{2}/.test(dateTime);
  if (!hasExplicitTime) {
    return "Time not listed on source.";
  }

  const formatTime = (value: string) => new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));

  if (endDateTime && /T\d{2}:\d{2}/.test(endDateTime) && dateTime.slice(0, 10) === endDateTime.slice(0, 10)) {
    return `${formatTime(dateTime)}–${formatTime(endDateTime)}`;
  }

  return formatTime(dateTime);
}

function inferCategory(title: string, description?: string): string {
  const normalized = `${title} ${description ?? ""}`.toLowerCase();

  if (normalized.includes("film") || normalized.includes("screening")) {
    return "Arts & Culture";
  }

  if (normalized.includes("talk") || normalized.includes("lecture") || normalized.includes("tour")) {
    return "Arts & Culture";
  }

  if (normalized.includes("exhibition") || normalized.includes("installation")) {
    return "Arts & Culture";
  }

  if (normalized.includes("performance") || normalized.includes("playlist") || normalized.includes("music")) {
    return "Arts & Culture";
  }

  return "Arts & Culture";
}

function inferScoringTags(title: string, description?: string): string[] {
  const normalized = `${title} ${description ?? ""}`.toLowerCase();
  const tags = ["arts", "culture"];

  if (normalized.includes("film") || normalized.includes("screening")) {
    tags.push("film");
  }

  if (normalized.includes("lecture") || normalized.includes("talk")) {
    tags.push("talk");
  }

  if (normalized.includes("tour")) {
    tags.push("tour");
  }

  if (normalized.includes("exhibition") || normalized.includes("installation")) {
    tags.push("exhibition");
  }

  if (normalized.includes("performance") || normalized.includes("music")) {
    tags.push("performance");
  }

  if (normalized.includes("open studio") || normalized.includes("drop-in") || normalized.includes("workshop")) {
    tags.push("community");
  }

  return tags;
}

function inferVenueFit(locationName?: string): number {
  if (!locationName) {
    return 10;
  }

  const normalized = locationName.toLowerCase();

  if (normalized.includes("camh") || normalized.includes("contemporary arts museum houston")) {
    return 12;
  }

  if (normalized.includes("museum district")) {
    return 11;
  }

  return 9;
}

function inferRarity(title: string, description?: string): number {
  const normalized = `${title} ${description ?? ""}`.toLowerCase();

  if (normalized.includes("film") || normalized.includes("screening")) {
    return 9;
  }

  if (normalized.includes("lecture") || normalized.includes("talk")) {
    return 8;
  }

  if (normalized.includes("tour") || normalized.includes("open studio")) {
    return 7;
  }

  if (normalized.includes("performance") || normalized.includes("playlist")) {
    return 7;
  }

  return 6;
}

function buildSourceLinks(eventUrl: string): EventItem["sourceLinks"] {
  return [
    { label: CAMH_SOURCE_NAME, url: CAMH_OFFICIAL_URL },
    { label: "CAMH Events", url: CAMH_EVENT_CALENDAR_URL },
    { label: "Event page", url: eventUrl },
  ];
}

function parseCamhJsonLd(html: string): { events: CamhParsedEvent[]; structuredDataFound: boolean; rawEventCandidates: number } {
  const scripts = [...html.matchAll(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)]
    .map((match) => match[1] ?? "");
  const events: CamhParsedEvent[] = [];
  let rawEventCandidates = 0;

  for (const script of scripts) {
    const trimmed = script.trim();

    if (!trimmed.includes('"@type":"Event"') && !trimmed.includes('"@type": "Event"')) {
      continue;
    }

    let parsed: unknown;

    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }

    const graphPayload = parsed as { "@graph"?: unknown[] };
    const items = Array.isArray(parsed)
      ? parsed
      : typeof parsed === "object" && parsed !== null && "@graph" in parsed && Array.isArray(graphPayload["@graph"])
        ? graphPayload["@graph"]
        : [parsed];

    for (const item of items) {
      if (!item || typeof item !== "object") {
        continue;
      }

      const event = item as Record<string, unknown>;

      if (event["@type"] !== "Event" || typeof event.name !== "string" || typeof event.startDate !== "string") {
        continue;
      }

      rawEventCandidates += 1;

      const location = typeof event.location === "object" && event.location !== null
        ? event.location as Record<string, unknown>
        : undefined;
      const endDate = typeof event.endDate === "string" ? event.endDate : null;
      const title = normalizeWhitespace(event.name);
      const description = typeof event.description === "string" ? normalizeWhitespace(stripTags(event.description)) : undefined;
      const locationName = typeof location?.name === "string" ? normalizeWhitespace(location.name) : undefined;
      const dateTime = event.startDate;

      events.push({
        title,
        dateTime,
        timeLabel: formatTimeLabel(dateTime, endDate),
        venue: locationName ?? "Contemporary Arts Museum Houston",
        city: "Houston",
        category: inferCategory(title, description),
        sourceLabel: CAMH_SOURCE_NAME,
        sourceUrl: typeof event.url === "string" ? event.url : CAMH_EVENT_CALENDAR_URL,
        sourceLinks: buildSourceLinks(typeof event.url === "string" ? event.url : CAMH_EVENT_CALENDAR_URL),
        description,
        locationName,
      });
    }
  }

  return {
    events,
    structuredDataFound: scripts.some((script) => script.includes('"@type":"Event"') || script.includes('"@type": "Event"')),
    rawEventCandidates,
  };
}

function dedupeEvents(events: EventItem[]): EventItem[] {
  const byKey = new Map<string, EventItem>();

  for (const event of events) {
    const key = [
      event.title.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      event.dateTime.slice(0, 10),
      event.dateTime.slice(11, 16),
      event.venue.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    ].join("|");

    if (!byKey.has(key)) {
      byKey.set(key, event);
    }
  }

  return [...byKey.values()];
}

function mapEventToItem(event: CamhParsedEvent): EventItem {
  const seed: EventSeed = {
    id: `camh-${event.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${event.dateTime.slice(0, 10)}`,
    title: event.title,
    dateTime: event.dateTime,
    venue: event.venue,
    city: event.city,
    category: event.category,
    genreTags: inferScoringTags(event.title, event.description),
    sourceLinks: event.sourceLinks,
    isGreatLiveAct: false,
    liveReputationStatus: "unknown",
    liveReputationConfidence: 0,
    liveReputationReasons: [],
    liveReputationSources: [],
    venueFitScore: inferVenueFit(event.locationName),
    knownLiveReputationScore: 0,
    rarityScore: inferRarity(event.title, event.description),
    distanceRelevanceScore: 8,
    feedbackHistoryPlaceholderScore: 3,
  };

  const scoredEvent = scoreEvent(seed);

  return {
    ...scoredEvent,
    sourceLabel: event.sourceLabel,
    timeLabel: event.timeLabel,
  };
}

function buildCoverageSummary(events: EventItem[], debug: CultureSourceDebug): CultureCoverageSummary {
  const today = getHoustonTodayDate();

  return {
    source: events.length > 0 ? "live_provider" : "mixed",
    trackedSourcesCount: HOUSTON_CULTURE_REGISTRY.length,
    activeLiveProvidersCount: 1,
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
    const todayCount = events.filter((event) => event.dateTime.slice(0, 10) === getHoustonTodayDate()).length;
    return `${CAMH_SOURCE_NAME} loaded from official events page: ${events.length} events parsed${todayCount > 0 ? `, including ${todayCount} today` : ""}.`;
  }

  if (!debug.eventCalendarHeadingFound) {
    return `${CAMH_SOURCE_NAME} source loaded, but the Events Calendar section was not found.`;
  }

  return `${CAMH_SOURCE_NAME} source loaded, but parser found 0 valid events.`;
}

function buildSampleLines(html: string, events: CamhParsedEvent[]): string[] {
  if (events.length > 0) {
    return events.slice(0, 8).map((event) => `${event.title} — ${event.dateTime.slice(0, 10)}`);
  }

  return extractVisibleLines(html)
    .filter((line) =>
      /events|exhibition|program|special event|tour|film|lecture|talk|performance/i.test(line),
    )
    .slice(0, 12);
}

export async function fetchCamhSource(): Promise<CultureProviderResult> {
  noStore();

  const urlsChecked = [CAMH_OFFICIAL_URL, CAMH_EVENT_CALENDAR_URL, CAMH_EVENT_LIST_URL];

  try {
    const [officialResult, calendarResult, listResult] = await Promise.all([
      fetchHtml(CAMH_OFFICIAL_URL),
      fetchHtml(CAMH_EVENT_CALENDAR_URL),
      fetchHtml(CAMH_EVENT_LIST_URL),
    ]);

    const calendarParsed = parseCamhJsonLd(calendarResult.html);
    const listParsed = parseCamhJsonLd(listResult.html);
    const combinedEvents = dedupeEvents([
      ...calendarParsed.events.map(mapEventToItem),
      ...listParsed.events.map(mapEventToItem),
    ]).sort((left, right) => left.dateTime.localeCompare(right.dateTime) || right.tasteScore - left.tasteScore);

    const cleanedLines = extractVisibleLines(calendarResult.html);
    const debug: CultureSourceDebug = {
      urlsChecked,
      responseStatuses: {
        homepage: officialResult.responseStatus,
        eventCalendar: calendarResult.responseStatus,
        listPage: listResult.responseStatus,
      },
      responseStatus: calendarResult.responseStatus,
      dateWindowStart: getHoustonTodayDate(),
      dateWindowEnd: addDays(getHoustonTodayDate(), 14),
      eventCalendarHeadingFound: cleanedLines.some((line) => line === "Events" || /events \| contemporary arts museum houston/i.test(line)),
      cleanedLineCount: cleanedLines.length,
      dateHeadingMatches: cleanedLines.filter((line) => parseMonthDayHeading(line)).length,
      titleMatches: calendarParsed.rawEventCandidates,
      dateTimeMatches: calendarParsed.rawEventCandidates,
      rawEventCandidates: calendarParsed.rawEventCandidates + listParsed.rawEventCandidates,
      parsedValidEvents: combinedEvents.length,
      todayChecked: true,
      todayEventsCount: combinedEvents.filter((event) => event.dateTime.slice(0, 10) === getHoustonTodayDate()).length,
      earliestParsedEventDate: combinedEvents[0]?.dateTime.slice(0, 10),
      latestParsedEventDate: combinedEvents.at(-1)?.dateTime.slice(0, 10),
      reachedOfficialPage: officialResult.responseStatus >= 200 && officialResult.responseStatus < 400,
      eventsCalendarLinkFound: /event-calendar/i.test(officialResult.html),
      structuredDataFound: calendarParsed.structuredDataFound || listParsed.structuredDataFound,
      sampleLines: buildSampleLines(calendarResult.html, calendarParsed.events),
      warnings: combinedEvents.length > 0 ? [] : ["CAMH source loaded, but parser found 0 valid events."],
    };
    const status: CultureSourceStatus = {
      sourceName: CAMH_SOURCE_NAME,
      sourceUrl: CAMH_EVENT_CALENDAR_URL,
      status: combinedEvents.length > 0 ? "working" : "limited",
      message: buildStatusMessage(combinedEvents, debug),
      debug,
    };

    return {
      source: combinedEvents.length > 0 ? "live_provider" : "mixed",
      note: status.message,
      events: combinedEvents,
      coverageSummary: buildCoverageSummary(combinedEvents, debug),
      statuses: [status],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "CAMH events page could not be loaded.";
    const failedDebug: CultureSourceDebug = {
      urlsChecked,
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
      structuredDataFound: false,
      sampleLines: [],
      warnings: [message],
    };

    const status: CultureSourceStatus = {
      sourceName: CAMH_SOURCE_NAME,
      sourceUrl: CAMH_EVENT_CALENDAR_URL,
      status: "failed",
      message,
      debug: failedDebug,
    };

    return {
      source: "mock",
      note: message,
      events: [],
      coverageSummary: buildCoverageSummary([], failedDebug),
      statuses: [status],
    };
  }
}
