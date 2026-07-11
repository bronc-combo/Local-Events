import { scoreEvent, type EventSeed } from "@/lib/event-scoring";
import { EVENT_DISPLAY_WINDOW_DAYS } from "@/lib/event-window";
import { cachedFetch } from "@/lib/source-cache";
import type { EventItem } from "@/types/dashboard";

export const EQUAL_PARTS_SOURCE_NAME = "Equal Parts Brewing";
export const EQUAL_PARTS_SOURCE_URL = "https://equalpartsbrewing.com/";
export const EQUAL_PARTS_EVENTS_URL = "https://equalpartsbrewing.com/events/";
const EQUAL_PARTS_USER_AGENT = "DailyOverviewBot/1.0 (+https://localhost)";
const HOUSTON_TIME_ZONE = "America/Chicago";

export interface EqualPartsSourceDebug {
  urlsChecked: string[];
  responseStatuses: Record<string, number | null>;
  cacheStatus?: "live" | "cached" | "cached_fallback" | "failed";
  fetchedTextLength: number;
  homepageReached: boolean;
  eventsPageReached: boolean;
  eventsSectionFound: boolean;
  cleanedLineCount: number;
  rawEventCandidates: number;
  parsedBeforeDedupe: number;
  parsedValidEvents: number;
  duplicateRowsRemoved: number;
  skippedRows: number;
  skippedReasons: string[];
  hiddenPastEventsCount: number;
  displayedInWindowEventsCount: number;
  todayChecked: boolean;
  todayEventsCount: number;
  todayHadEvents: boolean;
  visibleMusicCount: number;
  lowPriorityMusicCount: number;
  visibleOtherCount: number;
  lowPriorityOtherCount: number;
  visibleTitles: string[];
  lowPriorityMusicTitles: string[];
  lowPriorityOtherTitles: string[];
  earliestEventDate?: string;
  latestEventDate?: string;
  warnings: string[];
}

export interface EqualPartsSourceResult {
  events: EventItem[];
  sourceName: string;
  sourceUrl: string;
  status: "success" | "unavailable" | "failed";
  message: string;
  debug: EqualPartsSourceDebug;
}

interface CacheAwareResponse {
  ok: boolean;
  status: number;
  mode?: "live" | "cached" | "cached_fallback" | "failed";
  text(): Promise<string>;
}

interface ParsedEqualPartsListing {
  title: string;
  dateTime: string;
  eventUrl?: string;
  timeLabel?: string;
  description?: string;
  category: string;
  eventSubtype?: string;
  genreTags: string[];
  sectionCategory: "concert" | "other";
  metadataConfidence: number;
  extraTasteReasons: string[];
}

interface DateContext {
  month: number;
  year: number;
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

function normalizeComparableText(value: string): string {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractVisibleTextLines(html: string): string[] {
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

function extractAnchors(html: string, pageUrl: string): Array<{ text: string; url: string }> {
  const anchors = html.match(/<a\b[\s\S]*?<\/a>/gi) ?? [];

  return anchors
    .map((anchor) => {
      const hrefMatch = anchor.match(/href="([^"]+)"/i);
      const text = stripTags(anchor);

      if (!hrefMatch || !text) {
        return null;
      }

      const href = hrefMatch[1];
      const url = href.startsWith("http") ? href : new URL(href, pageUrl).toString();

      return { text, url };
    })
    .filter((value): value is { text: string; url: string } => value !== null);
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

function isMonthHeading(line: string): boolean {
  return /^(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}$/i.test(
    line,
  );
}

function isDayHeading(line: string): boolean {
  return /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat)\s+\d{1,2}$/i.test(line);
}

function isGenericLine(line: string): boolean {
  const normalized = normalizeComparableText(line);

  return [
    "skip to content",
    "equal parts brewing",
    "home",
    "about",
    "beer",
    "taproom",
    "events",
    "contact",
    "shop",
    "views navigation",
    "event views navigation",
    "list",
    "today",
    "previous events",
    "next events",
    "google calendar",
    "icalendar",
    "outlook 365",
    "outlook live",
    "export .ics file",
    "export outlook .ics file",
    "select date",
    "load more",
    "now",
    "september 2022 - november 2024",
    "all events",
    "featured events",
    "more events",
    "no items found",
    "no events on sale at this time check back soon",
  ].some((value) => normalized === value || normalized.includes(value));
}

function isLikelyTimeLine(line: string): boolean {
  return /\b\d{1,2}:\d{2}\s*[AP]M\b/i.test(line) && /\b\d{1,2}:\d{2}\s*[AP]M\s*[-–—]\s*\d{1,2}:\d{2}\s*[AP]M\b/i.test(line);
}

function parseDateTime(context: DateContext, dayLine: string, timeLine?: string): { dateTime: string; timeLabel?: string } | null {
  const dayMatch = dayLine.match(/^(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat)\s+(\d{1,2})$/i);

  if (!dayMatch) {
    return null;
  }

  const day = Number(dayMatch[1]);
  const month = context.month;
  const year = context.year;
  const timeMatch = timeLine?.match(/(\d{1,2}):(\d{2})\s*([AP]M)\s*[-–—]\s*(\d{1,2}):(\d{2})\s*([AP]M)/i)
    ?? timeLine?.match(/(\d{1,2}):(\d{2})\s*([AP]M)/i);

  if (!month || Number.isNaN(day)) {
    return null;
  }

  const to24 = (hoursText: string, minutes: string, meridiemText: string): string => {
    let hours = Number(hoursText);
    const meridiem = meridiemText.toUpperCase();

    if (meridiem === "PM" && hours !== 12) {
      hours += 12;
    }

    if (meridiem === "AM" && hours === 12) {
      hours = 0;
    }

    return `${String(hours).padStart(2, "0")}:${minutes}:00`;
  };

  const startTime = timeMatch ? to24(timeMatch[1], timeMatch[2], timeMatch[3]) : "19:00:00";
  const timeLabel = timeMatch
    ? timeMatch.length >= 7
      ? `${timeMatch[1]}:${timeMatch[2]} ${timeMatch[3].toUpperCase()} – ${timeMatch[4]}:${timeMatch[5]} ${timeMatch[6].toUpperCase()}`
      : `${timeMatch[1]}:${timeMatch[2]} ${timeMatch[3].toUpperCase()}`
    : undefined;

  return {
    dateTime: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${startTime}-05:00`,
    timeLabel,
  };
}

function classifyListing(title: string, description?: string): {
  category: string;
  sectionCategory: "concert" | "other";
  eventSubtype?: string;
  genreTags: string[];
  extraTasteReasons: string[];
} {
  const normalized = `${title} ${description ?? ""}`.toLowerCase();
  const genreTags = new Set<string>();
  const extraTasteReasons: string[] = [];

  if (/\b(live music|music|band|dj|concert|showcase|songwriter|singer-songwriter|set)\b/.test(normalized)) {
    if (/\b(dj|electronic|dance)\b/.test(normalized)) {
      genreTags.add("electronic");
    }

    if (/\b(blues|roots|americana|folk|country|bluegrass)\b/.test(normalized)) {
      genreTags.add("americana");
    }

    if (/\b(rock|punk|hardcore|metal)\b/.test(normalized)) {
      genreTags.add("rock");
    }

    extraTasteReasons.push("official music listing");

    return {
      category: "Concert",
      sectionCategory: "concert",
      eventSubtype: /\b(dj|electronic|dance)\b/.test(normalized) ? "DJ night" : "Live music",
      genreTags: genreTags.size > 0 ? [...genreTags] : ["live music"],
      extraTasteReasons,
    };
  }

  if (/run club/.test(normalized)) {
    genreTags.add("fitness");
    genreTags.add("social");
    extraTasteReasons.push("run club");

    return {
      category: "Run Club",
      sectionCategory: "other",
      eventSubtype: "Run Club",
      genreTags: [...genreTags],
      extraTasteReasons,
    };
  }

  if (/happy hour/.test(normalized)) {
    genreTags.add("social");
    extraTasteReasons.push("happy hour");

    return {
      category: "Happy Hour",
      sectionCategory: "other",
      eventSubtype: "Happy Hour",
      genreTags: [...genreTags],
      extraTasteReasons,
    };
  }

  if (/book club/.test(normalized)) {
    genreTags.add("social");
    genreTags.add("literary");
    extraTasteReasons.push("book club");

    return {
      category: "Book Club",
      sectionCategory: "other",
      eventSubtype: "Book Club",
      genreTags: [...genreTags],
      extraTasteReasons,
    };
  }

  genreTags.add("social");

  return {
    category: "Social",
    sectionCategory: "other",
    eventSubtype: "Community event",
    genreTags: [...genreTags],
    extraTasteReasons: ["community event"],
  };
}

function dedupeByKey(listings: ParsedEqualPartsListing[]): ParsedEqualPartsListing[] {
  const byKey = new Map<string, ParsedEqualPartsListing>();

  for (const listing of listings) {
    const key = `${normalizeComparableText(listing.title)}|${listing.dateTime}|${listing.sectionCategory}`;

    if (!byKey.has(key)) {
      byKey.set(key, listing);
    }
  }

  return [...byKey.values()];
}

function mapListingToEvent(listing: ParsedEqualPartsListing): EventItem {
  const primaryUrl = listing.eventUrl ?? EQUAL_PARTS_EVENTS_URL;
  const sourceLinks = [
    {
      label: listing.eventUrl ? "Event page" : "Source page",
      url: primaryUrl,
    },
  ];

  if (listing.eventUrl && listing.eventUrl !== EQUAL_PARTS_EVENTS_URL) {
    sourceLinks.push({
      label: "Source page",
      url: EQUAL_PARTS_EVENTS_URL,
    });
  }

  const seed: EventSeed = {
    id: `equal-parts-${normalizeComparableText(listing.title).replace(/[^a-z0-9]+/g, "-")}-${listing.dateTime.slice(0, 10)}`,
    title: listing.title,
    dateTime: listing.dateTime,
    venue: EQUAL_PARTS_SOURCE_NAME,
    city: "Houston",
    category: listing.category,
    sectionCategory: listing.sectionCategory,
    eventSubtype: listing.eventSubtype,
    genreTags: listing.genreTags,
    sourceLinks,
    eventUrl: listing.eventUrl,
    eventUrlLabel: listing.eventUrl ? "Event page" : "Source page",
    description: listing.description,
    metadataConfidence: listing.metadataConfidence,
    isGreatLiveAct: false,
    liveReputationStatus: "unknown",
    liveReputationConfidence: 0,
    liveReputationReasons: [],
    liveReputationSources: [],
    venueFitScore: 0,
    knownLiveReputationScore: 0,
    rarityScore: 3,
    distanceRelevanceScore: 6,
    feedbackHistoryPlaceholderScore: 5,
  };

  const scoredEvent = scoreEvent(seed);

  return {
    ...scoredEvent,
    sourceLabel: EQUAL_PARTS_SOURCE_NAME,
    tasteReasons: [...scoredEvent.tasteReasons, ...listing.extraTasteReasons],
  };
}

function buildEventUrlQueues(anchors: Array<{ text: string; url: string }>): Map<string, string[]> {
  const queues = new Map<string, string[]>();

  for (const anchor of anchors) {
    const normalized = normalizeComparableText(anchor.text);

    if (!normalized || isGenericLine(anchor.text)) {
      continue;
    }

    const queue = queues.get(normalized) ?? [];
    queue.push(anchor.url);
    queues.set(normalized, queue);
  }

  return queues;
}

function takeEventUrl(queues: Map<string, string[]>, title: string): string | undefined {
  const normalized = normalizeComparableText(title);
  const queue = queues.get(normalized);

  if (!queue || queue.length === 0) {
    return undefined;
  }

  const [nextUrl] = queue;
  queue.shift();

  return nextUrl;
}

function parseListings(html: string, pageUrl: string): { listings: ParsedEqualPartsListing[]; eventsSectionFound: boolean; cleanedLineCount: number } {
  const lines = extractVisibleTextLines(html);
  const anchors = extractAnchors(html, pageUrl);
  const eventUrlQueues = buildEventUrlQueues(anchors);
  const listings: ParsedEqualPartsListing[] = [];
  let currentContext: DateContext | null = null;
  let eventsSectionFound = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    if (isMonthHeading(line)) {
      const [, monthText, yearText] = line.match(/^([A-Za-z]+)\s+(\d{4})$/i) ?? [];
      const month = monthText ? parseMonthNumber(monthText) : null;
      const year = yearText ? Number(yearText) : null;

      if (month && year) {
        currentContext = { month, year };
      }
      continue;
    }

    if (line === "Events") {
      eventsSectionFound = true;
    }

    if (!currentContext || !isDayHeading(line)) {
      continue;
    }

    const dayLine = line;
    const nextLines: string[] = [];
    for (let cursor = index + 1; cursor < Math.min(lines.length, index + 8); cursor += 1) {
      const nextLine = lines[cursor];

      if (isMonthHeading(nextLine) || isDayHeading(nextLine)) {
        break;
      }

      if (!isGenericLine(nextLine)) {
        nextLines.push(nextLine);
      }
    }

    const title = nextLines.find((candidate) => !isLikelyTimeLine(candidate) && !isMonthHeading(candidate) && !isDayHeading(candidate));
    if (!title) {
      continue;
    }

    const timeLine = nextLines.find((candidate) => isLikelyTimeLine(candidate));
    const dateInfo = parseDateTime(currentContext, dayLine, timeLine);
    if (!dateInfo) {
      continue;
    }

    const descriptionLines = nextLines.filter((candidate) => candidate !== title && candidate !== timeLine);
    const description = descriptionLines.join(" ").trim() || undefined;
    const classification = classifyListing(title, description);
    const eventUrl = takeEventUrl(eventUrlQueues, title) ?? EQUAL_PARTS_EVENTS_URL;
    const metadataConfidence = [title, timeLine, description, eventUrl !== EQUAL_PARTS_EVENTS_URL ? eventUrl : undefined].filter(Boolean).length;

    listings.push({
      title,
      dateTime: dateInfo.dateTime,
      eventUrl,
      timeLabel: dateInfo.timeLabel,
      description,
      category: classification.category,
      eventSubtype: classification.eventSubtype,
      genreTags: classification.genreTags,
      sectionCategory: classification.sectionCategory,
      metadataConfidence,
      extraTasteReasons: classification.extraTasteReasons,
    });
  }

  return {
    listings,
    eventsSectionFound,
    cleanedLineCount: lines.length,
  };
}

function buildMessage(debug: EqualPartsSourceDebug): string {
  if (debug.parsedValidEvents === 0) {
    return "Equal Parts Brewing official calendar loaded, but no parseable current/future event rows were found.";
  }

  if (debug.todayHadEvents) {
    return `Equal Parts Brewing loaded from official events page: ${debug.parsedValidEvents} events parsed, including ${debug.todayEventsCount} today.`;
  }

  return `Equal Parts Brewing loaded from official events page: ${debug.parsedValidEvents} events parsed.`;
}

function parseSourcePageText(html: string): string {
  return normalizeWhitespace(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  );
}

export async function fetchEqualPartsSource(): Promise<EqualPartsSourceResult> {
  const urlsChecked = [EQUAL_PARTS_SOURCE_URL, EQUAL_PARTS_EVENTS_URL];
  const responseStatuses: Record<string, number | null> = {
    [EQUAL_PARTS_SOURCE_URL]: null,
    [EQUAL_PARTS_EVENTS_URL]: null,
  };
  const warnings: string[] = [];
  let homepageReached = false;
  let eventsPageReached = false;
  let homepageHtml = "";
  let eventsHtml = "";
  let cacheStatus: EqualPartsSourceDebug["cacheStatus"];

  try {
    const homepageResponse = (await cachedFetch(EQUAL_PARTS_SOURCE_URL, {
      headers: { "user-agent": EQUAL_PARTS_USER_AGENT },
      cacheKey: "equal-parts-homepage",
      category: "music",
      refreshPolicy: "daily",
    })) as CacheAwareResponse;
    responseStatuses[EQUAL_PARTS_SOURCE_URL] = homepageResponse.status;
    homepageReached = homepageResponse.ok;
    cacheStatus = homepageResponse.mode;
    homepageHtml = await homepageResponse.text();

    const eventsResponse = (await cachedFetch(EQUAL_PARTS_EVENTS_URL, {
      headers: { "user-agent": EQUAL_PARTS_USER_AGENT },
      cacheKey: "equal-parts-events",
      category: "music",
      refreshPolicy: "daily",
    })) as CacheAwareResponse;
    responseStatuses[EQUAL_PARTS_EVENTS_URL] = eventsResponse.status;
    eventsPageReached = eventsResponse.ok;
    cacheStatus = eventsResponse.mode ?? cacheStatus;
    eventsHtml = await eventsResponse.text();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    warnings.push(message);

    return {
      events: [],
      sourceName: EQUAL_PARTS_SOURCE_NAME,
      sourceUrl: EQUAL_PARTS_EVENTS_URL,
      status: "failed",
      message: "Equal Parts Brewing source failed before current/future coverage could be verified.",
      debug: {
        urlsChecked,
        responseStatuses,
        cacheStatus,
        fetchedTextLength: homepageHtml.length + eventsHtml.length,
        homepageReached,
        eventsPageReached,
        eventsSectionFound: false,
        cleanedLineCount: 0,
        rawEventCandidates: 0,
        parsedBeforeDedupe: 0,
        parsedValidEvents: 0,
        duplicateRowsRemoved: 0,
        skippedRows: 0,
        skippedReasons: [message],
        hiddenPastEventsCount: 0,
        displayedInWindowEventsCount: 0,
        todayChecked: false,
        todayEventsCount: 0,
        todayHadEvents: false,
        visibleMusicCount: 0,
        lowPriorityMusicCount: 0,
        visibleOtherCount: 0,
        lowPriorityOtherCount: 0,
        visibleTitles: [],
        lowPriorityMusicTitles: [],
        lowPriorityOtherTitles: [],
        warnings,
      },
    };
  }

  const sourceText = `${parseSourcePageText(homepageHtml)} ${parseSourcePageText(eventsHtml)}`;
  const { listings, eventsSectionFound, cleanedLineCount } = parseListings(eventsHtml, EQUAL_PARTS_EVENTS_URL);
  const today = getHoustonTodayDate();
  const upcomingEnd = addDays(today, EVENT_DISPLAY_WINDOW_DAYS);
  const parsedBeforeDedupe = listings.length;
  const dedupedListings = dedupeByKey(listings);
  const events = dedupedListings.map(mapListingToEvent);
  const hiddenPastEventsCount = events.filter((event) => event.dateTime.slice(0, 10) < today).length;
  const inWindowEvents = events.filter((event) => {
    const eventDate = event.dateTime.slice(0, 10);
    return eventDate >= today && eventDate <= upcomingEnd;
  });
  const todayEvents = inWindowEvents.filter((event) => event.dateTime.slice(0, 10) === today);
  const visibleMusic = inWindowEvents.filter((event) => event.sectionCategory === "concert" && !event.hiddenReason);
  const lowPriorityMusic = inWindowEvents.filter((event) => event.sectionCategory === "concert" && Boolean(event.hiddenReason));
  const visibleOther = inWindowEvents.filter((event) => event.sectionCategory === "other" && !event.hiddenReason);
  const lowPriorityOther = inWindowEvents.filter((event) => event.sectionCategory === "other" && Boolean(event.hiddenReason));
  const visibleTitles = [...visibleMusic, ...visibleOther].map((event) => event.title);
  const lowPriorityMusicTitles = lowPriorityMusic.map((event) => event.title);
  const lowPriorityOtherTitles = lowPriorityOther.map((event) => event.title);

  const debug: EqualPartsSourceDebug = {
    urlsChecked,
    responseStatuses,
    cacheStatus,
    fetchedTextLength: sourceText.length,
    homepageReached,
    eventsPageReached,
    eventsSectionFound,
    cleanedLineCount,
    rawEventCandidates: parsedBeforeDedupe,
    parsedBeforeDedupe,
    parsedValidEvents: events.length,
    duplicateRowsRemoved: parsedBeforeDedupe - dedupedListings.length,
    skippedRows: 0,
    skippedReasons: [],
    hiddenPastEventsCount,
    displayedInWindowEventsCount: inWindowEvents.length,
    todayChecked: true,
    todayEventsCount: todayEvents.length,
    todayHadEvents: todayEvents.length > 0,
    visibleMusicCount: visibleMusic.length,
    lowPriorityMusicCount: lowPriorityMusic.length,
    visibleOtherCount: visibleOther.length,
    lowPriorityOtherCount: lowPriorityOther.length,
    visibleTitles,
    lowPriorityMusicTitles,
    lowPriorityOtherTitles,
    earliestEventDate: summarizeDates(events).earliestEventDate,
    latestEventDate: summarizeDates(events).latestEventDate,
    warnings,
  };

  const status: EqualPartsSourceResult["status"] = events.length > 0 ? "success" : "unavailable";

  return {
    events,
    sourceName: EQUAL_PARTS_SOURCE_NAME,
    sourceUrl: EQUAL_PARTS_EVENTS_URL,
    status,
    message: buildMessage(debug),
    debug,
  };
}
