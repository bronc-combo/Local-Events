import { unstable_noStore as noStore } from "next/cache";
import { EVENT_DISPLAY_WINDOW_DAYS } from "@/lib/event-window";
import { HOUSTON_CULTURE_REGISTRY } from "@/lib/culture-registry";
import type {
  CultureCoverageSummary,
  CultureProviderResult,
  CultureSourceDebug,
  CultureSourceStatus,
} from "@/types/dashboard";

const ASIA_SOCIETY_SOURCE_NAME = "Asia Society Texas";
const ASIA_SOCIETY_BASE_URL = "https://asiasociety.org/texas";
const ASIA_SOCIETY_USER_AGENT = "DailyOverviewBot/1.0 (+https://localhost)";
const ASIA_SOCIETY_CANDIDATE_URLS = [
  "https://asiasociety.org/texas/events",
  "https://asiasociety.org/texas/programs",
  "https://asiasociety.org/texas/exhibitions",
  "https://asiasociety.org/texas/calendar",
  "https://asiasociety.org/texas/family",
];

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

function fetchHtml(url: string): Promise<{ html: string; responseStatus: number }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  return fetch(url, {
    headers: {
      "user-agent": ASIA_SOCIETY_USER_AGENT,
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

function parseMonthDayYear(text: string): string | null {
  const normalized = normalizeWhitespace(text).replace(/[–—]/g, "-");
  const match = normalized.match(
    /(?:Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)?\s*,?\s*([A-Za-z]{3,9})\s+(\d{1,2})(?:,\s*(\d{4}))?/,
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
  const year = match[3] ? Number(match[3]) : Number(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Chicago",
      year: "numeric",
    }).format(new Date()),
  );

  if (!month || !Number.isFinite(day) || Number.isNaN(day)) {
    return null;
  }

  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function containsStructuredData(html: string): boolean {
  return /<script[^>]+type="application\/ld\+json"/i.test(html) && /event|program|exhibition|performance/i.test(html);
}

function collectSampleLines(lines: string[]): string[] {
  const matched = lines
    .filter((line) => {
      const lowered = line.toLowerCase();
      return [
        "event",
        "program",
        "calendar",
        "talk",
        "film",
        "performance",
        "exhibition",
        "family",
        "texas",
        "asia society",
      ].some((token) => lowered.includes(token));
    })
    .slice(0, 20);

  if (matched.length > 0) {
    return matched;
  }

  return lines
    .filter(Boolean)
    .slice(0, 12);
}

function buildCoverageSummary(
  parsedCount: number,
  todayEventsCount: number,
  debug: CultureSourceDebug,
  source: CultureCoverageSummary["source"],
): CultureCoverageSummary {
  return {
    source,
    trackedSourcesCount: HOUSTON_CULTURE_REGISTRY.length,
    activeLiveProvidersCount: HOUSTON_CULTURE_REGISTRY.filter((entry) => entry.providerStatus === "working" || entry.providerStatus === "limited" || entry.providerStatus === "audited_limited").length,
    notImplementedSourcesCount: HOUSTON_CULTURE_REGISTRY.filter((entry) => entry.providerStatus === "not_implemented").length,
    parsedEventsCount: parsedCount,
    todayChecked: true,
    todayEventsCount,
    earliestParsedEventDate: debug.earliestParsedEventDate,
    latestParsedEventDate: debug.latestParsedEventDate,
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

function buildStatusMessage(debug: CultureSourceDebug, parsedCount: number): string {
  if (parsedCount > 0) {
    const todayCount = debug.todayEventsCount;
    return `${ASIA_SOCIETY_SOURCE_NAME} loaded from official pages: ${parsedCount} events parsed${todayCount > 0 ? `, including ${todayCount} today` : ""}.`;
  }

  if (debug.warnings.length > 0) {
    return `${ASIA_SOCIETY_SOURCE_NAME} source audited, but Cloudflare blocked server-visible event rows.`;
  }

  return `${ASIA_SOCIETY_SOURCE_NAME} source audited, but no reliable server-visible event rows were found.`;
}

export async function fetchAsiaSocietyTexasSource(): Promise<CultureProviderResult> {
  noStore();

  const urlsChecked = [ASIA_SOCIETY_BASE_URL, ...ASIA_SOCIETY_CANDIDATE_URLS];

  try {
    const responses = await Promise.all(urlsChecked.map((url) => fetchHtml(url)));
    const [baseResult, ...candidateResults] = responses;
    const allHtml = [baseResult.html, ...candidateResults.map((result) => result.html)].join("\n");
    const combinedLines = responses.flatMap((result) => extractVisibleLines(result.html));
    const today = getHoustonTodayDate();
    const windowEnd = addDays(today, EVENT_DISPLAY_WINDOW_DAYS);
    const dateMatches = combinedLines.filter((line) => parseMonthDayYear(line)).length;
    const structuredDataFound = responses.some((result) => containsStructuredData(result.html));
    const usefulDatedEventTextFound = combinedLines.some((line) => /event|program|talk|film|performance|exhibition/i.test(line)) && dateMatches > 0;
    const parsedCount = 0;
    const debug: CultureSourceDebug = {
      urlsChecked,
      responseStatuses: {
        base: baseResult.responseStatus,
        events: candidateResults[0]?.responseStatus ?? 0,
        programs: candidateResults[1]?.responseStatus ?? 0,
        exhibitions: candidateResults[2]?.responseStatus ?? 0,
        calendar: candidateResults[3]?.responseStatus ?? 0,
        family: candidateResults[4]?.responseStatus ?? 0,
      },
      responseStatus: baseResult.responseStatus,
      dateWindowStart: today,
      dateWindowEnd: windowEnd,
      eventCalendarHeadingFound: /event|program|calendar/i.test(allHtml),
      cleanedLineCount: combinedLines.length,
      dateHeadingMatches: dateMatches,
      titleMatches: 0,
      dateTimeMatches: 0,
      rawEventCandidates: 0,
      parsedValidEvents: parsedCount,
      todayChecked: true,
      todayEventsCount: 0,
      earliestParsedEventDate: undefined,
      latestParsedEventDate: undefined,
      reachedOfficialPage: baseResult.responseStatus >= 200 && baseResult.responseStatus < 400,
      eventsCalendarLinkFound: /\/texas\/(events|programs|exhibitions|calendar|family)/i.test(allHtml),
      usefulDatedEventTextFound,
      structuredDataFound,
      sampleLines: collectSampleLines(combinedLines),
      warnings: ["Asia Society Texas is reachable only as a Cloudflare-protected page from server fetches; no reliable server-visible event rows were exposed."],
    };

    const status: CultureSourceStatus = {
      sourceName: ASIA_SOCIETY_SOURCE_NAME,
      sourceUrl: ASIA_SOCIETY_BASE_URL,
      status: "audited_limited",
      message: buildStatusMessage(debug, parsedCount),
      debug,
    };

    return {
      source: "mock",
      note: status.message,
      events: [],
      coverageSummary: buildCoverageSummary(parsedCount, 0, debug, "mock"),
      statuses: [status],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Asia Society Texas could not be loaded.";
    const failedDebug: CultureSourceDebug = {
      urlsChecked,
      responseStatus: undefined,
      dateWindowStart: getHoustonTodayDate(),
      dateWindowEnd: addDays(getHoustonTodayDate(), EVENT_DISPLAY_WINDOW_DAYS),
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
      usefulDatedEventTextFound: false,
      structuredDataFound: false,
      sampleLines: [],
      warnings: [message],
    };

    const status: CultureSourceStatus = {
      sourceName: ASIA_SOCIETY_SOURCE_NAME,
      sourceUrl: ASIA_SOCIETY_BASE_URL,
      status: "failed",
      message,
      debug: failedDebug,
    };

    return {
      source: "mock",
      note: message,
      events: [],
      coverageSummary: buildCoverageSummary(0, 0, failedDebug, "mock"),
      statuses: [status],
    };
  }
}
