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

const BLAFFER_SOURCE_NAME = "Blaffer Art Museum";
const BLAFFER_SHORT_NAME = "Blaffer";
const BLAFFER_HOME_URL = "https://blafferartmuseum.org/";
const BLAFFER_EVENTS_URL = "https://blafferartmuseum.org/events/";
const BLAFFER_USER_AGENT = "DailyOverviewBot/1.0 (+https://localhost)";

interface BlafferParsedEvent {
  title: string;
  date: string;
  timeLabel: string;
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

function fetchHtml(url: string): Promise<{ html: string; responseStatus: number }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  return fetch(url, {
    headers: {
      "user-agent": BLAFFER_USER_AGENT,
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

function parseDateCell(cell: string): string | null {
  const match = cell.match(/^(\d{4})(\d{2})(\d{2})$/);

  if (!match) {
    return null;
  }

  return `${match[1]}-${match[2]}-${match[3]}`;
}

function resolveUrl(url: string, baseUrl: string): string {
  try {
    return new URL(url, baseUrl).toString();
  } catch {
    return baseUrl;
  }
}

function parseTimeLabel(timeText: string): string | null {
  const normalized = normalizeWhitespace(timeText).replace(/[–—]/g, "-");

  if (!normalized) {
    return null;
  }

  if (/^all day$/i.test(normalized)) {
    return "All day";
  }

  const rangeMatch = normalized.match(
    /(\d{1,2}(?::\d{2})?\s*[ap]m)\s*-\s*(\d{1,2}(?::\d{2})?\s*[ap]m)/i,
  );

  if (rangeMatch) {
    return `${normalizeClockTime(rangeMatch[1])} - ${normalizeClockTime(rangeMatch[2])}`;
  }

  const singleMatch = normalized.match(/(\d{1,2}(?::\d{2})?\s*[ap]m)/i);

  if (singleMatch) {
    return normalizeClockTime(singleMatch[1]);
  }

  return null;
}

function normalizeClockTime(value: string): string {
  const match = value.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*([ap]m)$/i);

  if (!match) {
    return value.trim();
  }

  const hours = Number(match[1]);
  const minutes = match[2] ?? "00";
  const meridiem = match[3].toUpperCase();

  return `${hours}:${minutes} ${meridiem}`;
}

function convertTimeToIso(date: string, timeLabel: string): string {
  if (/^all day$/i.test(timeLabel) || /^time not listed on source\.?$/i.test(timeLabel)) {
    return `${date}T12:00:00-05:00`;
  }

  const firstTime = timeLabel.match(/(\d{1,2})(?::(\d{2}))?\s*([ap]m)/i);

  if (!firstTime) {
    return `${date}T12:00:00-05:00`;
  }

  let hours = Number(firstTime[1]);
  const minutes = firstTime[2] ?? "00";
  const meridiem = firstTime[3].toUpperCase();

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

  if (normalized.includes("film") || normalized.includes("movie")) {
    return "Arts & Culture";
  }

  if (normalized.includes("lecture") || normalized.includes("talk") || normalized.includes("tea")) {
    return "Arts & Culture";
  }

  return "Arts & Culture";
}

function inferScoringTags(title: string): string[] {
  const normalized = title.toLowerCase();
  const tags = ["arts", "culture"];

  if (normalized.includes("film") || normalized.includes("movie")) {
    tags.push("film");
  }

  if (normalized.includes("lecture") || normalized.includes("talk")) {
    tags.push("talk");
  }

  return tags;
}

function inferVenueFit(title: string): number {
  const normalized = title.toLowerCase();

  if (normalized.includes("film") || normalized.includes("movie")) {
    return 11;
  }

  if (normalized.includes("tea")) {
    return 10;
  }

  return 10;
}

function inferRarity(title: string): number {
  const normalized = title.toLowerCase();

  if (normalized.includes("film") || normalized.includes("movie")) {
    return 8;
  }

  if (normalized.includes("lecture") || normalized.includes("talk")) {
    return 7;
  }

  return 6;
}

function buildSourceLinks(eventUrl: string): EventItem["sourceLinks"] {
  const links = [
    { label: BLAFFER_SOURCE_NAME, url: BLAFFER_HOME_URL },
    { label: "Events archive", url: BLAFFER_EVENTS_URL },
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

function extractSections(html: string): Array<{ date: string; html: string }> {
  const sections: Array<{ date: string; html: string }> = [];
  const pattern = /<div class="mec-calendar-events-sec" data-mec-cell="(\d{8})"[^>]*>/g;
  const matches = [...html.matchAll(pattern)];

  for (let index = 0; index < matches.length; index += 1) {
    const current = matches[index];
    const next = matches[index + 1];
    const date = parseDateCell(current[1]);

    if (!date || current.index === undefined) {
      continue;
    }

    const start = current.index + current[0].length;
    const end = next?.index ?? html.length;
    sections.push({
      date,
      html: html.slice(start, end),
    });
  }

  return sections;
}

function extractEventTitle(articleHtml: string): { title: string; href: string } | null {
  const match = articleHtml.match(
    /<h4[^>]*class="[^"]*mec-event-title[^"]*"[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i,
  );

  if (!match?.[1] || !match[2]) {
    return null;
  }

  const title = normalizeWhitespace(stripTags(match[2]));

  if (!title) {
    return null;
  }

  return {
    title,
    href: match[1],
  };
}

function extractEventTime(articleHtml: string): string {
  const match = articleHtml.match(
    /<div[^>]*class="[^"]*mec-event-time[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
  );

  if (!match?.[1]) {
    return "Time not listed on source.";
  }

  const timeText = normalizeWhitespace(stripTags(match[1]));
  return parseTimeLabel(timeText) ?? "Time not listed on source.";
}

function extractVenue(articleHtml: string): string {
  const match = articleHtml.match(
    /<div[^>]*class="[^"]*mec-event-loc-place[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
  );

  const venue = normalizeWhitespace(stripTags(match?.[1] ?? ""));
  return venue || BLAFFER_SOURCE_NAME;
}

function parseHtmlEvents(html: string, sourcePageUrl: string): {
  events: BlafferParsedEvent[];
  removedCount: number;
  debug: Pick<
    CultureSourceDebug,
    | "cleanedLineCount"
    | "dateHeadingMatches"
    | "rawEventCandidates"
    | "titleMatches"
    | "dateTimeMatches"
    | "eventCalendarHeadingFound"
    | "eventsArchiveHeadingFound"
    | "closureRowsSkipped"
    | "noEventsRowsSkipped"
    | "usefulDatedEventTextFound"
    | "structuredDataFound"
  >;
} {
  const cleanedLines = extractVisibleLines(html);
  const sections = extractSections(html);
  const events: BlafferParsedEvent[] = [];
  let rawEventCandidates = 0;
  let titleMatches = 0;
  let dateTimeMatches = 0;
  let closureRowsSkipped = 0;
  let noEventsRowsSkipped = 0;

  for (const section of sections) {
    const articlePattern = /<article[^>]*class="([^"]*mec-event-article[^"]*)"[^>]*>([\s\S]*?)<\/article>/gi;

    for (const articleMatch of section.html.matchAll(articlePattern)) {
      const articleHtml = articleMatch[2] ?? "";

      if (/No Events/i.test(articleHtml)) {
        noEventsRowsSkipped += 1;
        continue;
      }

      const titleInfo = extractEventTitle(articleHtml);

      if (!titleInfo) {
        continue;
      }

      rawEventCandidates += 1;
      titleMatches += 1;

      if (/^closed\b/i.test(titleInfo.title)) {
        closureRowsSkipped += 1;
        continue;
      }

      const timeLabel = extractEventTime(articleHtml);
      if (timeLabel && !/^Time not listed on source\.?$/i.test(timeLabel)) {
        dateTimeMatches += 1;
      }

      const sourceUrl = resolveUrl(titleInfo.href, sourcePageUrl);
      events.push({
        title: titleInfo.title,
        date: section.date,
        timeLabel,
        venue: extractVenue(articleHtml),
        city: "Houston",
        category: inferCategory(titleInfo.title),
        sourceLabel: BLAFFER_SHORT_NAME,
        sourceUrl,
        sourceLinks: buildSourceLinks(sourceUrl),
      });
    }
  }

  const deduped = dedupeEvents(events);
  const combinedHtml = html;

  return {
    events: deduped.events,
    removedCount: deduped.removedCount,
    debug: {
      cleanedLineCount: cleanedLines.length,
      dateHeadingMatches: sections.length,
      rawEventCandidates,
      titleMatches,
      dateTimeMatches,
      eventCalendarHeadingFound: /Events Calendar/i.test(combinedHtml) || /Events Archive/i.test(combinedHtml),
      eventsArchiveHeadingFound: /Events Archive/i.test(combinedHtml),
      closureRowsSkipped,
      noEventsRowsSkipped,
      usefulDatedEventTextFound: deduped.events.length > 0,
      structuredDataFound: /application\/ld\+json/i.test(combinedHtml),
    },
  };
}

function dedupeEvents(events: BlafferParsedEvent[]): { events: BlafferParsedEvent[]; removedCount: number } {
  const byKey = new Map<string, BlafferParsedEvent>();
  let removedCount = 0;

  for (const event of events) {
    const key = [
      event.title.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      event.date,
      event.timeLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      event.sourceUrl,
    ].join("|");

    if (byKey.has(key)) {
      removedCount += 1;
      continue;
    }

    byKey.set(key, event);
  }

  return { events: [...byKey.values()], removedCount };
}

function toEventItem(event: BlafferParsedEvent): EventItem {
  const dateTime = convertTimeToIso(event.date, event.timeLabel);
  const seed: EventSeed = {
    id: `blaffer-${event.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${event.date}`,
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
    timeLabel: event.timeLabel,
  };
}

function buildCoverageSummary(
  events: EventItem[],
  debug: Pick<
    CultureSourceDebug,
    | "cleanedLineCount"
    | "dateHeadingMatches"
    | "titleMatches"
    | "dateTimeMatches"
    | "eventCalendarHeadingFound"
  >,
  source: CultureCoverageSummary["source"],
): CultureCoverageSummary {
  const today = getHoustonTodayDate();

  return {
    source,
    trackedSourcesCount: HOUSTON_CULTURE_REGISTRY.length,
    activeLiveProvidersCount: HOUSTON_CULTURE_REGISTRY.filter(
      (entry) => entry.providerStatus === "working" || entry.providerStatus === "limited" || entry.providerStatus === "audited_limited",
    ).length,
    notImplementedSourcesCount: HOUSTON_CULTURE_REGISTRY.filter((entry) => entry.providerStatus === "not_implemented").length,
    parsedEventsCount: events.length,
    todayChecked: true,
    todayEventsCount: events.filter((event) => event.dateTime.slice(0, 10) === today).length,
    earliestParsedEventDate: events[0]?.dateTime.slice(0, 10),
    latestParsedEventDate: events.at(-1)?.dateTime.slice(0, 10),
    dateWindowStart: today,
    dateWindowEnd: addDays(today, EVENT_DISPLAY_WINDOW_DAYS),
    eventCalendarHeadingFound: debug.eventCalendarHeadingFound,
    cleanedLineCount: debug.cleanedLineCount,
    dateHeadingMatches: debug.dateHeadingMatches,
    titleMatches: debug.titleMatches,
    dateTimeMatches: debug.dateTimeMatches,
    note: "",
  };
}

function buildStatusMessage(parsedCount: number, todayCount: number): string {
  if (parsedCount > 0) {
    return `${BLAFFER_SOURCE_NAME} loaded from official events archive: ${parsedCount} events parsed${todayCount > 0 ? `, including ${todayCount} today` : ", no events today"}.`;
  }

  return `${BLAFFER_SOURCE_NAME} source loaded, but parser found 0 valid events.`;
}

export async function fetchBlafferSource(): Promise<CultureProviderResult> {
  noStore();

  const urlsChecked = [BLAFFER_EVENTS_URL];

  try {
    const result = await fetchHtml(BLAFFER_EVENTS_URL);
    const parsed = parseHtmlEvents(result.html, BLAFFER_EVENTS_URL);
    const parsedEvents = parsed.events
      .map((event) => toEventItem(event))
      .sort((left, right) => left.dateTime.localeCompare(right.dateTime) || right.tasteScore - left.tasteScore);
    const today = getHoustonTodayDate();
    const todayCount = parsedEvents.filter((event) => event.dateTime.slice(0, 10) === today).length;
    const note = buildStatusMessage(parsedEvents.length, todayCount);
    const debug: CultureSourceDebug = {
      urlsChecked,
      responseStatuses: {
        eventsPage: result.responseStatus,
      },
      responseStatus: result.responseStatus,
      dateWindowStart: today,
      dateWindowEnd: addDays(today, EVENT_DISPLAY_WINDOW_DAYS),
      eventCalendarHeadingFound: parsed.debug.eventCalendarHeadingFound,
      eventsArchiveHeadingFound: parsed.debug.eventsArchiveHeadingFound,
      cleanedLineCount: parsed.debug.cleanedLineCount,
      dateHeadingMatches: parsed.debug.dateHeadingMatches,
      titleMatches: parsed.debug.titleMatches,
      dateTimeMatches: parsed.debug.dateTimeMatches,
      rawEventCandidates: parsed.debug.rawEventCandidates,
      parsedValidEvents: parsedEvents.length,
      closureRowsSkipped: parsed.debug.closureRowsSkipped,
      noEventsRowsSkipped: parsed.debug.noEventsRowsSkipped,
      todayChecked: true,
      todayEventsCount: todayCount,
      earliestParsedEventDate: parsedEvents[0]?.dateTime.slice(0, 10),
      latestParsedEventDate: parsedEvents.at(-1)?.dateTime.slice(0, 10),
      reachedOfficialPage: result.responseStatus >= 200 && result.responseStatus < 400,
      eventsCalendarLinkFound: /\/events\//i.test(result.html),
      usefulDatedEventTextFound: parsed.debug.usefulDatedEventTextFound,
      structuredDataFound: parsed.debug.structuredDataFound,
      dateRangeEventCount: 0,
      duplicateEventsRemoved: parsed.removedCount,
      sampleLines: parsedEvents.length > 0
        ? parsedEvents.slice(0, 8).map((event) => `${event.title} — ${event.dateTime.slice(0, 10)}`)
        : extractVisibleLines(result.html).slice(0, 16),
      warnings: parsed.debug.closureRowsSkipped && parsed.debug.closureRowsSkipped > 0
        ? ["Closed archive entries were skipped."]
        : [],
    };

    const status: CultureSourceStatus = {
      sourceName: BLAFFER_SOURCE_NAME,
      sourceUrl: BLAFFER_EVENTS_URL,
      status: parsedEvents.length > 0 ? "working" : "limited",
      message: note,
      debug,
    };

    const source: CultureProviderResult["source"] = "live_provider";

    return {
      source,
      note,
      events: parsedEvents,
      coverageSummary: buildCoverageSummary(parsedEvents, parsed.debug, source),
      statuses: [status],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Blaffer events could not be loaded.";
    const today = getHoustonTodayDate();
    const failedDebug: CultureSourceDebug = {
      urlsChecked,
      responseStatus: undefined,
      dateWindowStart: today,
      dateWindowEnd: addDays(today, EVENT_DISPLAY_WINDOW_DAYS),
      eventCalendarHeadingFound: false,
      eventsArchiveHeadingFound: false,
      cleanedLineCount: 0,
      dateHeadingMatches: 0,
      titleMatches: 0,
      dateTimeMatches: 0,
      rawEventCandidates: 0,
      parsedValidEvents: 0,
      closureRowsSkipped: 0,
      noEventsRowsSkipped: 0,
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

    return {
      source: "mock",
      note: "Blaffer Art Museum source could not be loaded, so mock fallback is in use.",
      events: [],
      coverageSummary: buildCoverageSummary([], failedDebug, "mock"),
      statuses: [
        {
          sourceName: BLAFFER_SOURCE_NAME,
          sourceUrl: BLAFFER_EVENTS_URL,
          status: "failed",
          message,
          debug: failedDebug,
        },
      ],
    };
  }
}
