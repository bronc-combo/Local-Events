import { scoreEvent, type EventSeed } from "@/lib/event-scoring";
import { EVENT_DISPLAY_WINDOW_DAYS } from "@/lib/event-window";
import { cachedFetch } from "@/lib/source-cache";
import type { EventItem, OtherEventsSourceDebug } from "@/types/dashboard";

export const THE_SECRET_GROUP_SOURCE_NAME = "The Secret Group";
export const THE_SECRET_GROUP_SOURCE_URL = "https://www.thesecretgrouphtx.com/";
const THE_SECRET_GROUP_USER_AGENT = "DailyOverviewBot/1.0 (+https://localhost)";
const HOUSTON_TIME_ZONE = "America/Chicago";

export type SecretGroupSourceDebug = OtherEventsSourceDebug;

export interface SecretGroupSourceResult {
  events: EventItem[];
  sourceName: string;
  sourceUrl: string;
  status: "success" | "working" | "limited" | "failed";
  message: string;
  debug: SecretGroupSourceDebug;
}

interface SecretGroupParsedListing {
  title: string;
  date: string;
  sourcePageUrl: string;
  sameSiteEventUrl?: string;
  category: string;
  sectionCategory: EventItem["sectionCategory"];
  eventSubtype?: string;
  genreTags: string[];
  venueFitScore: number;
  rarityScore: number;
  knownLiveReputationScore: number;
  feedbackHistoryPlaceholderScore: number;
  extraTasteReasons: string[];
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

function normalizeWhitespace(value: string): string {
  return decodeHtmlEntities(value).replace(/\s+/g, " ").trim();
}

function stripTags(value: string): string {
  return normalizeWhitespace(value.replace(/<[^>]+>/g, " "));
}

function extractVisibleText(html: string): string[] {
  return decodeHtmlEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<\/(p|div|li|section|article|h1|h2|h3|h4|h5|h6|a|time|span)>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function getHoustonTodayDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: HOUSTON_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function addDays(baseDate: string, days: number): string {
  const base = new Date(`${baseDate}T12:00:00-05:00`);
  base.setDate(base.getDate() + days);

  return new Intl.DateTimeFormat("en-CA", {
    timeZone: HOUSTON_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(base);
}

function parseMonthNumber(monthText: string): number | null {
  const months: Record<string, number> = {
    jan: 1,
    january: 1,
    feb: 2,
    february: 2,
    mar: 3,
    march: 3,
    apr: 4,
    april: 4,
    may: 5,
    jun: 6,
    june: 6,
    jul: 7,
    july: 7,
    aug: 8,
    august: 8,
    sep: 9,
    sept: 9,
    september: 9,
    oct: 10,
    october: 10,
    nov: 11,
    november: 11,
    dec: 12,
    december: 12,
  };

  return months[monthText.toLowerCase()] ?? null;
}

function inferEventYear(month: number, day: number): number {
  const [currentYear, currentMonth, currentDay] = getHoustonTodayDate().split("-").map(Number);

  if (month < currentMonth || (month === currentMonth && day < currentDay)) {
    return currentYear + 1;
  }

  return currentYear;
}

function normalizeComparableText(value: string): string {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function inferConcertGenreTags(title: string): string[] {
  const normalized = title.toLowerCase();
  const tags = new Set<string>();

  if (normalized.includes("goth")) {
    tags.add("goth");
    tags.add("post-punk");
  }

  if (normalized.includes("industrial")) {
    tags.add("industrial");
  }

  if (normalized.includes("emo")) {
    tags.add("emo");
    tags.add("punk");
  }

  if (normalized.includes("punk")) {
    tags.add("punk");
  }

  if (normalized.includes("metal")) {
    tags.add("metal");
  }

  if (normalized.includes("dj") || normalized.includes("dance")) {
    tags.add("electronic");
    tags.add("dance");
  }

  if (tags.size === 0) {
    tags.add("live music");
  }

  return [...tags];
}

function classifySecretGroupEvent(title: string): Omit<SecretGroupParsedListing, "title" | "date" | "sourcePageUrl" | "sameSiteEventUrl"> {
  const normalized = title.toLowerCase();

  if (normalized.includes("karaoke")) {
    const isTasteMatch =
      normalized.includes("emo") || normalized.includes("punk") || normalized.includes("metal");

    return {
      category: "Other Events / Karaoke",
      sectionCategory: "other",
      eventSubtype: "Karaoke",
      genreTags: isTasteMatch ? ["karaoke", "emo", "punk"] : ["karaoke", "nightlife"],
      venueFitScore: isTasteMatch ? 12 : 7,
      rarityScore: isTasteMatch ? 7 : 3,
      knownLiveReputationScore: 0,
      feedbackHistoryPlaceholderScore: 4,
      extraTasteReasons: isTasteMatch
        ? ["themed karaoke match", "emo/punk-adjacent nightlife"]
        : ["routine karaoke night"],
    };
  }

  if (
    normalized.includes("dj") ||
    normalized.includes("dance night") ||
    normalized.includes("dance party") ||
    normalized.includes("emo night") ||
    normalized.includes("goth night") ||
    normalized.includes("theme party") ||
    normalized.includes("90's") ||
    normalized.includes("2000's")
  ) {
    const isTasteMatch =
      normalized.includes("emo") || normalized.includes("goth") || normalized.includes("industrial") || normalized.includes("punk");

    return {
      category: "Other Events / DJ / nightlife",
      sectionCategory: "other",
      eventSubtype: "DJ / nightlife",
      genreTags: isTasteMatch ? ["nightlife", "post-punk", "industrial"] : ["nightlife", "dance"],
      venueFitScore: isTasteMatch ? 13 : 8,
      rarityScore: isTasteMatch ? 8 : 4,
      knownLiveReputationScore: 0,
      feedbackHistoryPlaceholderScore: 4,
      extraTasteReasons: isTasteMatch
        ? ["goth / emo nightlife match", "weird local night"]
        : ["nightlife event"],
    };
  }

  if (
    normalized.includes("comedy") ||
    normalized.includes("comic") ||
    normalized.includes("comedian") ||
    normalized.includes("headliner") ||
    normalized.includes("stand up") ||
    normalized.includes("open mic") ||
    normalized.includes("night court") ||
    normalized.includes("passing lane") ||
    normalized.includes("master debaters") ||
    normalized.includes("back of the bus") ||
    normalized.includes("c u next tuesday") ||
    normalized.includes("for the culture") ||
    normalized.includes("witchy wednesdays") ||
    normalized.includes("monday night comedy") ||
    normalized.includes("$2 bill")
  ) {
    return {
      category: "Other Events / Comedy",
      sectionCategory: "other",
      eventSubtype: "Comedy",
      genreTags: ["comedy"],
      venueFitScore: 11,
      rarityScore: normalized.includes("headliner") ? 7 : 5,
      knownLiveReputationScore: 0,
      feedbackHistoryPlaceholderScore: 5,
      extraTasteReasons: ["comedy fit", "local recurring scene event"],
    };
  }

  if (
    normalized.includes("trivia") ||
    normalized.includes("game night") ||
    normalized.includes("social") ||
    normalized.includes("party") ||
    normalized.includes("drag") ||
    normalized.includes("burlesque")
  ) {
    return {
      category: "Other Events / Social / weird local",
      sectionCategory: "other",
      eventSubtype: "Social / weird local",
      genreTags: ["social", "local"],
      venueFitScore: 10,
      rarityScore: 6,
      knownLiveReputationScore: 0,
      feedbackHistoryPlaceholderScore: 4,
      extraTasteReasons: ["unusual local event"],
    };
  }

  if (
    normalized.includes("concert") ||
    normalized.includes("live") ||
    normalized.includes("tour") ||
    normalized.includes("album release") ||
    normalized.includes("record release") ||
    normalized.includes("showcase") ||
    normalized.includes("special guests") ||
    /\bw\/\b/i.test(title) ||
    /[-/,&+]/.test(title)
  ) {
    return {
      category: "Concert",
      sectionCategory: "concert",
      eventSubtype: "Concert",
      genreTags: inferConcertGenreTags(title),
      venueFitScore: 14,
      rarityScore: 7,
      knownLiveReputationScore: 7,
      feedbackHistoryPlaceholderScore: 5,
      extraTasteReasons: ["mixed-room concert booking"],
    };
  }

  return {
    category: "Other Events / Social / weird local",
    sectionCategory: "other",
    eventSubtype: "Social / weird local",
    genreTags: ["local", "community"],
    venueFitScore: 9,
    rarityScore: 5,
    knownLiveReputationScore: 0,
    feedbackHistoryPlaceholderScore: 4,
    extraTasteReasons: ["official mixed-event listing", "kept as local catch-all"],
  };
}

function isSameSiteUrl(url: string): boolean {
  try {
    return new URL(url).hostname.includes("thesecretgrouphtx.com");
  } catch {
    return false;
  }
}

function parseSecretGroupListings(html: string, pageUrl: string): {
  listings: SecretGroupParsedListing[];
  eventListFound: boolean;
  cleanedLineCount: number;
  rawEventCandidates: number;
  dateMatches: number;
  timeMatches: number;
  titleCandidates: number;
  skippedRows: number;
  skippedReasons: string[];
} {
  const lines = extractVisibleText(html);
  const blocks = html.split('<div class="item eventColl-item').slice(1);
  const listings: SecretGroupParsedListing[] = [];
  const skippedReasons: string[] = [];
  let dateMatches = 0;
  let titleCandidates = 0;

  for (const block of blocks) {
    const monthText = block.match(/eventColl-month">([^<]+)/i)?.[1] ?? "";
    const dayText = block.match(/eventColl-date">([^<]+)/i)?.[1] ?? "";
    const titleMatch = block.match(/<h2 class="eventColl-eventInfo"><a href="([^"]+)">([\s\S]*?)<\/a>/i);
    const month = parseMonthNumber(monthText);
    const day = Number(dayText);
    const href = titleMatch?.[1] ?? "";
    const title = stripTags(titleMatch?.[2] ?? "");

    if (!month || !Number.isFinite(day) || !title) {
      skippedReasons.push("Skipped a homepage card with missing month/day/title.");
      continue;
    }

    titleCandidates += 1;
    dateMatches += 1;

    const year = inferEventYear(month, day);
    const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const classification = classifySecretGroupEvent(title);
    const absoluteHref = href.startsWith("http") ? href : new URL(href, pageUrl).toString();

    listings.push({
      title,
      date,
      sourcePageUrl: pageUrl,
      sameSiteEventUrl: isSameSiteUrl(absoluteHref) ? absoluteHref : undefined,
      ...classification,
    });
  }

  return {
    listings,
    eventListFound: blocks.length > 0,
    cleanedLineCount: lines.length,
    rawEventCandidates: blocks.length,
    dateMatches,
    timeMatches: 0,
    titleCandidates,
    skippedRows: blocks.length - listings.length,
    skippedReasons,
  };
}

function dedupeListings(listings: SecretGroupParsedListing[]): {
  deduped: SecretGroupParsedListing[];
  duplicateRowsRemoved: number;
} {
  const byKey = new Map<string, SecretGroupParsedListing>();

  for (const listing of listings) {
    const key = [
      normalizeComparableText(listing.title),
      listing.date,
      "time-not-listed",
      normalizeComparableText(THE_SECRET_GROUP_SOURCE_NAME),
    ].join("|");
    byKey.set(key, listing);
  }

  return {
    deduped: [...byKey.values()],
    duplicateRowsRemoved: Math.max(listings.length - byKey.size, 0),
  };
}

function getSubtypeCounts(events: EventItem[]): Record<string, number> {
  const counts: Record<string, number> = {};

  for (const event of events) {
    const key = event.eventSubtype ?? "Unspecified";
    counts[key] = (counts[key] ?? 0) + 1;
  }

  return counts;
}

function summarizeDates(events: EventItem[]): { earliestEventDate?: string; latestEventDate?: string } {
  if (events.length === 0) {
    return {};
  }

  const dates = events.map((event) => event.dateTime.slice(0, 10)).sort();

  return {
    earliestEventDate: dates[0],
    latestEventDate: dates[dates.length - 1],
  };
}

function getWindowedEvents(events: EventItem[]): EventItem[] {
  const today = getHoustonTodayDate();
  const windowEnd = addDays(today, EVENT_DISPLAY_WINDOW_DAYS);

  return events.filter((event) => {
    const eventDate = event.dateTime.slice(0, 10);
    return eventDate >= today && eventDate <= windowEnd;
  });
}

function mapListingToEvent(listing: SecretGroupParsedListing): EventItem {
  const sourceLinks = listing.sameSiteEventUrl
    ? [
        { label: "Event page", url: listing.sameSiteEventUrl },
        { label: "Source page", url: listing.sourcePageUrl },
      ]
    : [{ label: "Source page", url: listing.sourcePageUrl }];
  const seed: EventSeed = {
    id: `secret-group-${normalizeComparableText(listing.title).replace(/\s+/g, "-")}-${listing.date}`,
    title: listing.title,
    dateTime: `${listing.date}T12:00:00-05:00`,
    venue: THE_SECRET_GROUP_SOURCE_NAME,
    city: "Houston",
    category: listing.category,
    sectionCategory: listing.sectionCategory,
    eventSubtype: listing.eventSubtype,
    genreTags: listing.genreTags,
    sourceLinks,
    eventUrl: listing.sameSiteEventUrl ?? listing.sourcePageUrl,
    eventUrlLabel: listing.sameSiteEventUrl ? "Event page" : "Source page",
    isGreatLiveAct: false,
    liveReputationStatus: "unknown",
    liveReputationConfidence: 0,
    liveReputationReasons: [],
    liveReputationSources: [],
    venueFitScore: listing.venueFitScore,
    knownLiveReputationScore: listing.knownLiveReputationScore,
    rarityScore: listing.rarityScore,
    distanceRelevanceScore: 9,
    feedbackHistoryPlaceholderScore: listing.feedbackHistoryPlaceholderScore,
  };
  const scored = scoreEvent(seed);

  return {
    ...scored,
    sourceLabel: THE_SECRET_GROUP_SOURCE_NAME,
    sourceLinks,
    timeLabel: "Time not listed on source.",
    startDate: listing.date,
    endDate: listing.date,
    tasteReasons: [...scored.tasteReasons, ...listing.extraTasteReasons],
  };
}

function buildSummary(debug: SecretGroupSourceDebug): string {
  if (!debug.fetchSucceeded) {
    return "The Secret Group source could not be loaded.";
  }

  if (debug.parsedValidEvents === 0) {
    return `The Secret Group source loaded, but parser found 0 valid events. Raw candidates: ${debug.rawEventCandidates}, lines: ${debug.cleanedLineCount}, skipped: ${debug.skippedRows ?? 0}.`;
  }

  if (debug.todayHadEvents) {
    return `The Secret Group loaded from official homepage: ${debug.parsedValidEvents} events parsed, including ${debug.todayEventsCount} today.`;
  }

  return `The Secret Group loaded from official homepage: ${debug.parsedValidEvents} events parsed, with ${debug.concertRowsParsed} music events and ${debug.otherRowsParsed} other events in the current window.`;
}

async function fetchHtml(url: string): Promise<{ ok: boolean; status?: number; html?: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    const response = await cachedFetch(url, {
      category: "music",
      refreshPolicy: "daily",
      headers: {
        "User-Agent": THE_SECRET_GROUP_USER_AGENT,
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
      status: response.status,
      html: await response.text(),
    };
  } catch {
    return { ok: false, status: undefined };
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchSecretGroupSource(): Promise<SecretGroupSourceResult> {
  try {
    const response = await fetchHtml(THE_SECRET_GROUP_SOURCE_URL);

    if (!response.ok || response.html === undefined) {
      throw new Error(`The Secret Group request failed with ${response.status ?? "unknown status"}.`);
    }

    const parsed = parseSecretGroupListings(response.html, THE_SECRET_GROUP_SOURCE_URL);
    const { deduped, duplicateRowsRemoved } = dedupeListings(parsed.listings);
    const mappedEvents = deduped.map(mapListingToEvent).sort((left, right) => left.dateTime.localeCompare(right.dateTime));
    const visibleEvents = getWindowedEvents(mappedEvents);
    const today = getHoustonTodayDate();
    const todayEvents = visibleEvents.filter((event) => event.dateTime.slice(0, 10) === today);
    const dates = summarizeDates(visibleEvents);
    const concertRowsParsed = visibleEvents.filter((event) => event.sectionCategory === "concert").length;
    const otherRowsParsed = visibleEvents.filter((event) => event.sectionCategory === "other").length;
    const debug: SecretGroupSourceDebug = {
      urlsChecked: [THE_SECRET_GROUP_SOURCE_URL],
      responseStatus: response.status ?? 200,
      responseStatuses: { [THE_SECRET_GROUP_SOURCE_URL]: response.status ?? 200 },
      fetchSucceeded: true,
      calendarPageFound: true,
      eventListFound: parsed.eventListFound,
      fetchedTextLength: response.html.length,
      cleanedLineCount: parsed.cleanedLineCount,
      dateMatches: parsed.dateMatches,
      timeMatches: parsed.timeMatches,
      titleCandidates: parsed.titleCandidates,
      rawEventCandidates: parsed.rawEventCandidates,
      parsedBeforeDedupe: parsed.listings.length,
      parsedValidEvents: mappedEvents.length,
      concertRowsParsed,
      otherRowsParsed,
      duplicateRowsRemoved,
      skippedRows: parsed.skippedRows,
      skippedReasons: parsed.skippedReasons,
      subtypeCounts: getSubtypeCounts(visibleEvents),
      hiddenPastEventsCount: Math.max(mappedEvents.length - visibleEvents.length, 0),
      displayedInWindowEventsCount: visibleEvents.length,
      todayChecked: true,
      todayEventsCount: todayEvents.length,
      todayHadEvents: todayEvents.length > 0,
      earliestEventDate: dates.earliestEventDate,
      latestEventDate: dates.latestEventDate,
      warnings: parsed.eventListFound ? [] : ["Official homepage loaded but no event cards were found."],
    };

    return {
      events: visibleEvents,
      sourceName: THE_SECRET_GROUP_SOURCE_NAME,
      sourceUrl: THE_SECRET_GROUP_SOURCE_URL,
      status: visibleEvents.length > 0 ? "success" : "working",
      message: buildSummary(debug),
      debug,
    };
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : "The Secret Group source failed before current-window coverage could be verified.";

    return {
      events: [],
      sourceName: THE_SECRET_GROUP_SOURCE_NAME,
      sourceUrl: THE_SECRET_GROUP_SOURCE_URL,
      status: "failed",
      message,
      debug: {
        urlsChecked: [THE_SECRET_GROUP_SOURCE_URL],
        fetchSucceeded: false,
        calendarPageFound: false,
        eventListFound: false,
        cleanedLineCount: 0,
        dateMatches: 0,
        timeMatches: 0,
        titleCandidates: 0,
        rawEventCandidates: 0,
        parsedBeforeDedupe: 0,
        parsedValidEvents: 0,
        concertRowsParsed: 0,
        otherRowsParsed: 0,
        duplicateRowsRemoved: 0,
        skippedRows: 0,
        skippedReasons: [],
        hiddenPastEventsCount: 0,
        displayedInWindowEventsCount: 0,
        todayChecked: false,
        todayEventsCount: 0,
        todayHadEvents: false,
        warnings: [message],
      },
    };
  }
}
