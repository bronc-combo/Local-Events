import { scoreEvent, type EventSeed } from "@/lib/event-scoring";
import type { EventItem, SourceLink } from "@/types/dashboard";

export const BAD_ASTRONAUT_SOURCE_NAME = "Bad Astronaut Brewing";
export const BAD_ASTRONAUT_SOURCE_URL = "https://badastronautbeer.com/";
const BAD_ASTRONAUT_USER_AGENT = "DailyOverviewBot/1.0 (+https://localhost)";
const MAX_DISCOVERED_SOURCE_FETCHES = 3;
const BAD_ASTRONAUT_TIMEZONE = "America/Chicago";
const WINDOW_DAYS = 14;

export interface BadAstronautSourceDebug {
  urlsChecked: string[];
  responseStatus?: number;
  responseStatuses?: Record<string, number>;
  fetchSucceeded: boolean;
  calendarPageFound: boolean;
  cleanedLineCount: number;
  dateMatches: number;
  timeMatches: number;
  titleCandidates: number;
  rawEventCandidates: number;
  parsedBeforeDedupe: number;
  parsedValidEvents: number;
  concertRowsParsed: number;
  otherRowsParsed: number;
  duplicateRowsRemoved: number;
  hiddenPastEventsCount: number;
  displayedInWindowEventsCount: number;
  todayChecked: boolean;
  todayEventsCount: number;
  todayHadEvents: boolean;
  earliestEventDate?: string;
  latestEventDate?: string;
  warnings: string[];
}

export interface BadAstronautSourceResult {
  events: EventItem[];
  sourceName: string;
  sourceUrl: string;
  status: "success" | "working" | "limited" | "failed";
  message: string;
  debug: BadAstronautSourceDebug;
}

interface BadAstronautParsedListing {
  title: string;
  dateTime: string;
  eventUrl: string;
  sourcePageUrl: string;
  description?: string;
  price?: string;
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

function normalizeMultilineText(value: string): string {
  return decodeHtmlEntities(value)
    .replace(/\r/g, "")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((line) => line.trim())
    .join("\n");
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

function getHoustonTodayDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: BAD_ASTRONAUT_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function addDays(baseDate: string, days: number): string {
  const base = new Date(`${baseDate}T12:00:00-05:00`);
  base.setDate(base.getDate() + days);

  return new Intl.DateTimeFormat("en-CA", {
    timeZone: BAD_ASTRONAUT_TIMEZONE,
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

function parseMonthNumber(monthName: string): number | null {
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

function inferEventYear(month: number, day: number): number {
  const current = getHoustonTodayDate().split("-").map(Number);
  const [currentYear, currentMonth, currentDay] = current;

  if (month < currentMonth || (month === currentMonth && day < currentDay)) {
    return currentYear + 1;
  }

  return currentYear;
}

function convertTimeTo24Hour(timeText: string): string {
  const match = timeText.match(/(\d{1,2}):(\d{2})\s*([AP]M)/i);

  if (!match) {
    return "19:00:00";
  }

  let hours = Number(match[1]);
  const minutes = match[2];
  const meridiem = match[3].toUpperCase();

  if (meridiem === "PM" && hours !== 12) {
    hours += 12;
  }

  if (meridiem === "AM" && hours === 12) {
    hours = 0;
  }

  return `${String(hours).padStart(2, "0")}:${minutes}:00`;
}

function extractVisibleText(html: string): string {
  return normalizeMultilineText(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<\/(p|div|li|section|article|h1|h2|h3|h4|h5|h6|a|time|span)>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  );
}

function isLikelyEventTitle(text: string): boolean {
  const normalized = normalizeWhitespace(text).replace(/^#+\s*/, "");

  if (normalized.length < 4) {
    return false;
  }

  if (
    [
      "events",
      "calendar of events",
      "event calendar",
      "subscribe to calendar",
      "no events on this day",
      "there are no events on this day",
      "free",
    ].includes(normalized.toLowerCase())
  ) {
    return false;
  }

  if (/^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+\d{1,2}$/i.test(normalized)) {
    return false;
  }

  if (/^(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}$/i.test(normalized)) {
    return false;
  }

  return /[A-Za-z]{3,}/.test(normalized);
}

function extractEventTitleAnchors(html: string, pageUrl: string): Map<string, string> {
  const anchors = html.match(/<a [^>]*href="[^"]+"[^>]*>[\s\S]*?<\/a>/g) ?? [];
  const byTitle = new Map<string, string>();

  for (const anchor of anchors) {
    const hrefMatch = anchor.match(/href="([^"]+)"/);
    const title = stripTags(anchor).replace(/^#+\s*/, "");

    if (!hrefMatch || !isLikelyEventTitle(title)) {
      continue;
    }

    const url = hrefMatch[1].startsWith("http")
      ? hrefMatch[1]
      : new URL(hrefMatch[1], pageUrl).toString();

    const key = normalizeComparableText(title);

    if (!byTitle.has(key)) {
      byTitle.set(key, url);
    }
  }

  return byTitle;
}

function discoverBadAstronautSourceUrls(homepageHtml: string, pageUrl: string): string[] {
  const urls = new Set<string>([BAD_ASTRONAUT_SOURCE_URL]);
  const hrefMatches = homepageHtml.match(/href="[^"]+"/g) ?? [];

  for (const match of hrefMatches) {
    const href = match.replace(/^href="/, "").replace(/"$/, "");

    if (!href) {
      continue;
    }

    const absoluteUrl = href.startsWith("http")
      ? href
      : new URL(href, pageUrl).toString();

    if (!absoluteUrl.includes("badastronautbeer.com")) {
      continue;
    }

    if (
      /events?|calendar|shows?|event-calendar|month|tribe/i.test(absoluteUrl) &&
      absoluteUrl !== BAD_ASTRONAUT_SOURCE_URL
    ) {
      urls.add(absoluteUrl);
    }
  }

  return [...urls];
}

function extractArticleBlocks(html: string): string[] {
  return html.match(/<article[^>]*class="[^"]*tribe-events-calendar-month__calendar-event[^"]*"[\s\S]*?<\/article>/g) ?? [];
}

function extractAnchors(html: string): string[] {
  return html.match(/<a\b[\s\S]*?<\/a>/g) ?? [];
}

function extractFirstMatch(value: string, pattern: RegExp): string | null {
  const match = value.match(pattern);

  return match?.[1] ?? null;
}

function stripKnownNoise(text: string): string {
  return normalizeWhitespace(
    text
      .replace(/\+ \d+ More for [^<\n]+/gi, " ")
      .replace(/There are no events on this day\./gi, " ")
      .replace(/There are no events on this day/gi, " ")
      .replace(/No events on this day/gi, " ")
      .replace(/Free Entry/gi, " ")
      .replace(/^Notice:?/gi, " ")
      .replace(/Subscribe to Calendar/gi, " ")
      .replace(/Export Events/gi, " "),
  );
}

function extractJsonLdBlocks(html: string): string[] {
  return html.match(/<script[^>]*type="application\/ld\+json"[^>]*>[\s\S]*?<\/script>/g) ?? [];
}

function parseJsonLdEventObjects(html: string): Array<Record<string, unknown>> {
  const blocks = extractJsonLdBlocks(html);
  const events: Array<Record<string, unknown>> = [];

  for (const block of blocks) {
    const content = block
      .replace(/^<script[^>]*>/i, "")
      .replace(/<\/script>$/i, "")
      .trim();

    if (!content.includes("\"@type\":\"Event\"") && !content.includes('"@type":"Event"')) {
      continue;
    }

    try {
      const parsed = JSON.parse(content);

      const values = Array.isArray(parsed)
        ? parsed
        : parsed && typeof parsed === "object" && Array.isArray((parsed as { "@graph"?: unknown[] })["@graph"])
          ? (parsed as { "@graph": Array<Record<string, unknown>> })["@graph"]
          : [parsed];

      for (const value of values) {
        if (!value || typeof value !== "object") {
          continue;
        }

        const eventType = value["@type"];

        if (eventType === "Event" || (Array.isArray(eventType) && eventType.includes("Event"))) {
          events.push(value);
        }
      }
    } catch {
      continue;
    }
  }

  return events;
}

function parseMonthGridArticles(html: string, pageUrl: string): {
  listings: BadAstronautParsedListing[];
  calendarPageFound: boolean;
  cleanedLineCount: number;
  dateMatches: number;
  timeMatches: number;
  titleCandidates: number;
  sampleLines: string[];
} {
  const articles = extractArticleBlocks(html);
  const listings: BadAstronautParsedListing[] = [];
  const sampleLines: string[] = [];
  let dateMatches = 0;
  let timeMatches = 0;
  let titleCandidates = 0;

  for (const article of articles) {
    const articleAnchors = extractAnchors(article);
    const titleAnchor = articleAnchors.find((anchor) =>
      /class="[^"]*tribe-events-calendar-month__calendar-event-(?:title-link|tooltip-title-link)[^"]*"/i.test(anchor),
    ) ?? null;
    const rawText = stripKnownNoise(stripTags(article));
    const dateStartText = extractFirstMatch(
      article,
      /<span class="tribe-event-date-start">\s*([^<]+?)\s*<\/span>/i,
    );
    const endTimeText = extractFirstMatch(
      article,
      /<span class="tribe-event-time">\s*([^<]+?)\s*<\/span>/i,
    );
    const dateLabel = extractFirstMatch(article, /<time datetime="(\d{4}-\d{2}-\d{2})"/i);
    const titleText = titleAnchor ? extractFirstMatch(titleAnchor, />\s*([\s\S]*?)\s*<\/a>/i) : null;
    const titleLinkUrl = titleAnchor ? extractFirstMatch(titleAnchor, /href="([^"]+)"/i) : null;
    const description = extractFirstMatch(
      article,
      /class="tribe-events-calendar-month__calendar-event-tooltip-description[^"]*">\s*<p>([\s\S]*?)<\/p>/i,
    );
    const price = extractFirstMatch(
      article,
      /class="tribe-events-c-small-cta__price">\s*([^<]+)\s*<\/span>/i,
    );

    if (!dateStartText || !endTimeText || !titleText) {
      continue;
    }

    const dateTimeMatch = dateStartText.match(/([A-Za-z]+)\s+(\d{1,2})\s*@\s*(\d{1,2}:\d{2}\s*[ap]m)/i);

    if (!dateTimeMatch) {
      continue;
    }

    const monthName = dateTimeMatch[1];
    const dayText = dateTimeMatch[2];
    const startTimeText = dateTimeMatch[3];
    const title = normalizeWhitespace(stripTags(titleText));
    const descriptionText = description ? normalizeWhitespace(stripTags(description)) : undefined;
    const priceText = price ? normalizeWhitespace(price) : undefined;
    const classification = classifyEvent(title, descriptionText, priceText);
    const year = dateLabel ? Number(dateLabel.slice(0, 4)) : inferEventYear(parseMonthNumber(monthName) ?? 1, Number(dayText));
    const startDate = `${year}-${String(parseMonthNumber(monthName) ?? 1).padStart(2, "0")}-${String(Number(dayText)).padStart(2, "0")}`;
    const eventUrl = titleLinkUrl
      ? (titleLinkUrl.startsWith("http") ? titleLinkUrl : new URL(titleLinkUrl, pageUrl).toString())
      : pageUrl;

    dateMatches += 1;
    timeMatches += 1;
    titleCandidates += 1;

    if (sampleLines.length < 12) {
      sampleLines.push(rawText);
    }

    listings.push({
      title,
      dateTime: `${startDate}T${convertTimeTo24Hour(startTimeText)}-05:00`,
      eventUrl,
      sourcePageUrl: pageUrl,
      description: descriptionText,
      price: priceText,
      category: classification.category,
      sectionCategory: classification.sectionCategory,
      eventSubtype: classification.eventSubtype,
      genreTags: classification.genreTags,
      venueFitScore: classification.venueFitScore,
      rarityScore: classification.rarityScore,
      knownLiveReputationScore: classification.knownLiveReputationScore,
      feedbackHistoryPlaceholderScore: classification.feedbackHistoryPlaceholderScore,
      extraTasteReasons: classification.extraTasteReasons,
    });
  }

  return {
    listings,
    calendarPageFound: articles.length > 0 || /calendar of events|event calendar|events archive/i.test(html),
    cleanedLineCount: articles.length,
    dateMatches,
    timeMatches,
    titleCandidates,
    sampleLines,
  };
}

function formatDateTimeFromParts(monthName: string, dayText: string, timeText?: string): string {
  const month = parseMonthNumber(monthName) ?? 1;
  const day = Number(dayText);
  const year = inferEventYear(month, day);
  const startTime = timeText ? convertTimeTo24Hour(timeText) : "19:00:00";

  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${startTime}-05:00`;
}

function classifyEvent(title: string, description?: string, price?: string): Pick<
  BadAstronautParsedListing,
  "category" | "sectionCategory" | "eventSubtype" | "genreTags" | "venueFitScore" | "rarityScore" | "knownLiveReputationScore" | "feedbackHistoryPlaceholderScore" | "extraTasteReasons"
> {
  const normalized = `${title} ${description ?? ""} ${price ?? ""}`.toLowerCase();

  if (
    normalized.includes("happy hour")
  ) {
    return {
      category: "Other Events / Happy hour",
      sectionCategory: "other",
      eventSubtype: "Happy hour",
      genreTags: ["social"],
      venueFitScore: 6,
      rarityScore: 0,
      knownLiveReputationScore: 0,
      feedbackHistoryPlaceholderScore: 3,
      extraTasteReasons: ["routine happy hour"],
    };
  }

  if (normalized.includes("run club")) {
    return {
      category: "Other Events / Run club",
      sectionCategory: "other",
      eventSubtype: "Run club",
      genreTags: ["fitness", "social"],
      venueFitScore: 8,
      rarityScore: 2,
      knownLiveReputationScore: 0,
      feedbackHistoryPlaceholderScore: 3,
      extraTasteReasons: ["run club", "routine recurring social event"],
    };
  }

  if (
    normalized.includes("air hockey") ||
    normalized.includes("virtua fighter") ||
    normalized.includes("tekken") ||
    normalized.includes("tournament") ||
    normalized.includes("games night") ||
    normalized.includes("game night")
  ) {
    return {
      category: normalized.includes("air hockey")
        ? "Other Events / Air hockey tournament"
        : "Other Events / Games / tournament",
      sectionCategory: "other",
      eventSubtype: normalized.includes("air hockey") ? "Air hockey tournament" : "Games / tournament",
      genreTags: normalized.includes("air hockey")
        ? ["air hockey", "competition", "games"]
        : ["games", "tournament"],
      venueFitScore: normalized.includes("air hockey") ? 15 : 10,
      rarityScore: normalized.includes("air hockey")
        ? 14
        : normalized.includes("virtua fighter") || normalized.includes("tekken")
          ? 9
          : 5,
      knownLiveReputationScore: 0,
      feedbackHistoryPlaceholderScore: normalized.includes("air hockey") ? 7 : 4,
      extraTasteReasons: normalized.includes("air hockey")
        ? ["air hockey tournament match", "high-interest social competition"]
        : ["games / tournament"],
    };
  }

  if (
    normalized.includes("market") ||
    normalized.includes("garage sale") ||
    normalized.includes("pop up") ||
    normalized.includes("popup")
  ) {
    return {
      category: "Other Events / Market",
      sectionCategory: "other",
      eventSubtype: "Market",
      genreTags: ["market", "community"],
      venueFitScore: 11,
      rarityScore: normalized.includes("punk rock garage sale") ? 9 : 7,
      knownLiveReputationScore: 0,
      feedbackHistoryPlaceholderScore: 5,
      extraTasteReasons: ["market / community event"],
    };
  }

  if (normalized.includes("workshop") || normalized.includes("writers room") || normalized.includes("class")) {
    return {
      category: "Other Events / Workshop",
      sectionCategory: "other",
      eventSubtype: "Workshop",
      genreTags: ["workshop", "community"],
      venueFitScore: 10,
      rarityScore: 6,
      knownLiveReputationScore: 0,
      feedbackHistoryPlaceholderScore: 4,
      extraTasteReasons: ["workshop / writers room"],
    };
  }

  if (normalized.includes("comedy") || normalized.includes("comedian") || normalized.includes("comic") || normalized.includes("shelly belly")) {
    return {
      category: "Other Events / Comedy",
      sectionCategory: "other",
      eventSubtype: "Comedy",
      genreTags: ["comedy"],
      venueFitScore: 11,
      rarityScore: normalized.includes("shelly belly") ? 6 : 8,
      knownLiveReputationScore: 0,
      feedbackHistoryPlaceholderScore: 5,
      extraTasteReasons: ["comedy"],
    };
  }

  if (
    normalized.includes("graffiti") ||
    normalized.includes("art market") ||
    normalized.includes("art battle") ||
    normalized.includes("community art")
  ) {
    return {
      category: "Other Events / Community art",
      sectionCategory: "other",
      eventSubtype: "Community art",
      genreTags: ["community art", "art"],
      venueFitScore: 11,
      rarityScore: 8,
      knownLiveReputationScore: 0,
      feedbackHistoryPlaceholderScore: 5,
      extraTasteReasons: ["community art"],
    };
  }

  if (
    normalized.includes("concert") ||
    normalized.includes("live music") ||
    normalized.includes("band") ||
    normalized.includes("tour") ||
    normalized.includes("showcase")
  ) {
    return {
      category: "Concert",
      sectionCategory: "concert",
      eventSubtype: "Concert",
      genreTags: ["punk", "rock", "live music"],
      venueFitScore: 13,
      rarityScore: 7,
      knownLiveReputationScore: 8,
      feedbackHistoryPlaceholderScore: 5,
      extraTasteReasons: ["live music"],
    };
  }

  return {
    category: "Other Events / Community",
    sectionCategory: "other",
    eventSubtype: "Community",
    genreTags: ["community"],
    venueFitScore: 9,
    rarityScore: 4,
    knownLiveReputationScore: 0,
    feedbackHistoryPlaceholderScore: 4,
    extraTasteReasons: ["local community event"],
  };
}

function parseBadAstronautListings(html: string, pageUrl: string): {
  listings: BadAstronautParsedListing[];
  calendarPageFound: boolean;
  cleanedLineCount: number;
  dateMatches: number;
  timeMatches: number;
  titleCandidates: number;
} {
  const visibleText = extractVisibleText(html);
  const lines = visibleText
    .split(/\n+/)
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean);
  const jsonLdEvents = parseJsonLdEventObjects(html);
  if (jsonLdEvents.length > 0) {
    const listings = jsonLdEvents
      .map((event) => {
        const title = typeof event.name === "string" ? normalizeWhitespace(stripTags(event.name)) : "";
        const startDate = typeof event.startDate === "string" ? event.startDate : null;
        const description = typeof event.description === "string" ? normalizeWhitespace(stripTags(event.description)) : undefined;
        const eventUrl = typeof event.url === "string" ? event.url : pageUrl;

        if (!title || !startDate) {
          return null;
        }

        const classification = classifyEvent(title, description);

        return {
          title,
          dateTime: startDate,
          eventUrl,
          sourcePageUrl: pageUrl,
          description,
          price: typeof event.offers === "object" && event.offers && typeof (event.offers as { price?: unknown }).price === "string"
            ? String((event.offers as { price?: unknown }).price)
            : undefined,
          category: classification.category,
          sectionCategory: classification.sectionCategory,
          eventSubtype: classification.eventSubtype,
          genreTags: classification.genreTags,
          venueFitScore: classification.venueFitScore,
          rarityScore: classification.rarityScore,
          knownLiveReputationScore: classification.knownLiveReputationScore,
          feedbackHistoryPlaceholderScore: classification.feedbackHistoryPlaceholderScore,
          extraTasteReasons: classification.extraTasteReasons,
        };
      })
      .filter(Boolean) as BadAstronautParsedListing[];

    return {
      listings: listings.map((listing) => ({
        title: listing.title,
        dateTime: listing.dateTime,
        eventUrl: listing.eventUrl,
        sourcePageUrl: listing.sourcePageUrl,
        description: listing.description,
        price: listing.price,
        category: listing.category,
        sectionCategory: listing.sectionCategory,
        eventSubtype: listing.eventSubtype,
        genreTags: listing.genreTags,
        venueFitScore: listing.venueFitScore,
        rarityScore: listing.rarityScore,
        knownLiveReputationScore: listing.knownLiveReputationScore,
        feedbackHistoryPlaceholderScore: listing.feedbackHistoryPlaceholderScore,
        extraTasteReasons: listing.extraTasteReasons,
      })),
      calendarPageFound: true,
      cleanedLineCount: lines.length,
      dateMatches: jsonLdEvents.length,
      timeMatches: jsonLdEvents.length,
      titleCandidates: jsonLdEvents.length,
    };
  }

  const articleParse = parseMonthGridArticles(html, pageUrl);
  if (articleParse.listings.length > 0) {
    return {
      listings: articleParse.listings,
      calendarPageFound: articleParse.calendarPageFound,
      cleanedLineCount: lines.length,
      dateMatches: articleParse.dateMatches,
      timeMatches: articleParse.timeMatches,
      titleCandidates: articleParse.titleCandidates,
    };
  }

  const calendarPageFound = articleParse.calendarPageFound || /calendar of events|event calendar|events archive/i.test(visibleText);
  const startIndex = lines.findIndex((line) => /^(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}$/i.test(line));
  const archiveLines = startIndex >= 0 ? lines.slice(startIndex) : lines;
  const titleAnchors = extractEventTitleAnchors(html, pageUrl);
  const dateHeadingPattern = /^(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})$/i;
  const dateTimePattern = /^(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:,\s*\d{4})?\s*@\s*(\d{1,2}:\d{2}\s*[ap]m)\s*[–-]\s*(\d{1,2}:\d{2}\s*[ap]m)/i;
  const listings: BadAstronautParsedListing[] = [];
  let dateMatches = 0;
  let timeMatches = 0;

  for (let index = 0; index < archiveLines.length; index += 1) {
    const line = archiveLines[index];

    if (dateHeadingPattern.test(line)) {
      dateMatches += 1;
      continue;
    }

    const dateTimeMatch = line.match(dateTimePattern);

    if (!dateTimeMatch) {
      continue;
    }

    const monthName = dateTimeMatch[1];
    const dayText = dateTimeMatch[2];
    const startTimeText = dateTimeMatch[3];
    const dateTime = formatDateTimeFromParts(monthName, dayText, startTimeText);
    timeMatches += 1;

    let title: string | null = null;
    let description: string | undefined;
    let price: string | undefined;

    for (let lookAhead = index + 1; lookAhead < Math.min(archiveLines.length, index + 8); lookAhead += 1) {
      const candidate = archiveLines[lookAhead];

      if (dateHeadingPattern.test(candidate) || dateTimePattern.test(candidate)) {
        break;
      }

      const normalizedCandidate = candidate.replace(/^#+\s*/, "");

      if (!title && isLikelyEventTitle(normalizedCandidate)) {
        title = normalizedCandidate;
        continue;
      }

      if (!title) {
        continue;
      }

      if (/^free$/i.test(normalizedCandidate) || /^\$\d/.test(normalizedCandidate)) {
        price = normalizedCandidate;
        break;
      }

      if (!description && normalizedCandidate && normalizedCandidate !== title) {
        description = normalizedCandidate;
        continue;
      }

      if (description && normalizedCandidate && normalizedCandidate !== title) {
        description = `${description} ${normalizedCandidate}`.trim();
      }
    }

    if (!title) {
      continue;
    }

    const normalizedTitleKey = normalizeComparableText(title);
    const eventUrl = titleAnchors.get(normalizedTitleKey) ?? pageUrl;
    const classification = classifyEvent(title, description, price);

    listings.push({
      title,
      dateTime: `${dateTime.slice(0, 10)}T${convertTimeTo24Hour(startTimeText)}-05:00`,
      eventUrl,
      sourcePageUrl: pageUrl,
      description,
      price,
      category: classification.category,
      sectionCategory: classification.sectionCategory,
      eventSubtype: classification.eventSubtype,
      genreTags: classification.genreTags,
      venueFitScore: classification.venueFitScore,
      rarityScore: classification.rarityScore,
      knownLiveReputationScore: classification.knownLiveReputationScore,
      feedbackHistoryPlaceholderScore: classification.feedbackHistoryPlaceholderScore,
      extraTasteReasons: classification.extraTasteReasons,
    });
  }

  return {
    listings,
    calendarPageFound,
    cleanedLineCount: archiveLines.length,
    dateMatches,
    timeMatches,
    titleCandidates: titleAnchors.size,
  };
}

function mapListingToEvent(listing: BadAstronautParsedListing): EventItem {
  const sourceLinks: SourceLink[] = [];
  const sourcePageLink = {
    label: "Source page",
    url: listing.sourcePageUrl,
  };

  if (listing.eventUrl && listing.eventUrl !== listing.sourcePageUrl) {
    sourceLinks.push({ label: "Event page", url: listing.eventUrl });
    sourceLinks.push(sourcePageLink);
  } else {
    sourceLinks.push(sourcePageLink);
  }

  const seed: EventSeed = {
    id: `bad-astronaut-${normalizeComparableText(listing.title).replace(/\s+/g, "-")}-${listing.dateTime.slice(0, 10)}-${listing.dateTime.slice(11, 16).replace(":", "")}`,
    title: listing.title,
    dateTime: listing.dateTime,
    venue: BAD_ASTRONAUT_SOURCE_NAME,
    city: "Houston",
    category: listing.category,
    sectionCategory: listing.sectionCategory,
    eventSubtype: listing.eventSubtype,
    genreTags: listing.genreTags,
    sourceLinks,
    eventUrl: listing.eventUrl,
    eventUrlLabel: listing.eventUrl && listing.eventUrl !== listing.sourcePageUrl ? "Event page" : "Source page",
    isGreatLiveAct: false,
    liveReputationStatus: "unknown",
    liveReputationConfidence: 0,
    liveReputationReasons: [],
    liveReputationSources: [],
    venueFitScore: listing.venueFitScore,
    knownLiveReputationScore: listing.knownLiveReputationScore,
    rarityScore: listing.rarityScore,
    distanceRelevanceScore: 8,
    feedbackHistoryPlaceholderScore: listing.feedbackHistoryPlaceholderScore,
  };

  const scored = scoreEvent(seed);
  const tasteReasons = [...scored.tasteReasons];

  if (listing.description) {
    tasteReasons.push(listing.description);
  }

  if (listing.price) {
    tasteReasons.push(`price: ${listing.price}`);
  }

  if (listing.extraTasteReasons.length > 0) {
    tasteReasons.push(...listing.extraTasteReasons);
  }

  return {
    ...scored,
    sourceLabel: BAD_ASTRONAUT_SOURCE_NAME,
    sourceLinks,
    tasteReasons,
  };
}

function getWindowedEvents(events: EventItem[]): EventItem[] {
  const today = getHoustonTodayDate();
  const windowEnd = addDays(today, WINDOW_DAYS);

  return events.filter((event) => {
    const eventDate = event.dateTime.slice(0, 10);
    return eventDate >= today && eventDate <= windowEnd;
  });
}

function buildSummary(debug: BadAstronautSourceDebug): string {
  if (!debug.fetchSucceeded) {
    return "Bad Astronaut source could not be loaded.";
  }

  if (debug.parsedValidEvents === 0) {
    return `Bad Astronaut source loaded, but parser found 0 valid events. Lines: ${debug.cleanedLineCount}, dates: ${debug.dateMatches}, times: ${debug.timeMatches}, titles: ${debug.titleCandidates}.`;
  }

  if (debug.todayHadEvents) {
    return `Bad Astronaut loaded from official event calendar: ${debug.parsedValidEvents} events parsed, including ${debug.todayEventsCount} today.`;
  }

  return `Bad Astronaut loaded from official event calendar: ${debug.parsedValidEvents} events parsed, including ${debug.otherRowsParsed} other events and ${debug.concertRowsParsed} concerts.`;
}

async function fetchHtml(url: string): Promise<{ ok: boolean; status?: number | null; html?: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": BAD_ASTRONAUT_USER_AGENT,
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

export async function fetchBadAstronautSource(): Promise<BadAstronautSourceResult> {
  const warnings: string[] = [];
  const responseStatuses: Record<string, number> = {};

  try {
    const homepageResponse = await fetchHtml(BAD_ASTRONAUT_SOURCE_URL);

    if (!homepageResponse.ok || homepageResponse.html === undefined) {
      throw new Error(
        `Bad Astronaut request failed with ${homepageResponse.status ?? "unknown status"}.`,
      );
    }

    const homepageHtml = homepageResponse.html;
    const discoveredUrls = discoverBadAstronautSourceUrls(homepageHtml, BAD_ASTRONAUT_SOURCE_URL);
    const fetchableUrls = discoveredUrls
      .filter((url) => url !== BAD_ASTRONAUT_SOURCE_URL)
      .slice(0, MAX_DISCOVERED_SOURCE_FETCHES);
    const checkedUrls = [BAD_ASTRONAUT_SOURCE_URL];

    responseStatuses[BAD_ASTRONAUT_SOURCE_URL] = homepageResponse.status ?? 200;

    const homepageParse = parseBadAstronautListings(homepageHtml, BAD_ASTRONAUT_SOURCE_URL);
    let calendarPageFound = homepageParse.calendarPageFound;
    let cleanedLineCount = homepageParse.cleanedLineCount;
    let dateMatches = homepageParse.dateMatches;
    let timeMatches = homepageParse.timeMatches;
    let titleCandidates = homepageParse.titleCandidates;
    let parsedBeforeDedupe = homepageParse.listings.length;
    let rawEventCandidates = homepageParse.listings.length;
    let concertRowsParsed = homepageParse.listings.filter((listing) => listing.sectionCategory === "concert").length;
    let otherRowsParsed = homepageParse.listings.filter((listing) => listing.sectionCategory === "other").length;
    const eventMap = new Map<string, EventItem>();

    for (const listing of homepageParse.listings) {
      const event = mapListingToEvent(listing);
      eventMap.set(event.id, event);
    }

    for (const url of fetchableUrls) {
      checkedUrls.push(url);
      const response = await fetchHtml(url);

      if (!response.ok || response.html === undefined) {
        warnings.push(`${url} returned ${response.status ?? "an unknown error"}.`);
        continue;
      }

      responseStatuses[url] = response.status ?? 200;
      const pageParse = parseBadAstronautListings(response.html, url);
      calendarPageFound = calendarPageFound || pageParse.calendarPageFound;
      cleanedLineCount += pageParse.cleanedLineCount;
      dateMatches += pageParse.dateMatches;
      timeMatches += pageParse.timeMatches;
      titleCandidates += pageParse.titleCandidates;
      parsedBeforeDedupe += pageParse.listings.length;
      rawEventCandidates += pageParse.listings.length;
      concertRowsParsed += pageParse.listings.filter((listing) => listing.sectionCategory === "concert").length;
      otherRowsParsed += pageParse.listings.filter((listing) => listing.sectionCategory === "other").length;

      for (const listing of pageParse.listings) {
        const event = mapListingToEvent(listing);
        eventMap.set(event.id, event);
      }
    }

    if (!calendarPageFound) {
      warnings.push("Calendar content was not clearly identified on the official homepage.");
    }

    const dedupedEvents = [...eventMap.values()].sort((left, right) => left.dateTime.localeCompare(right.dateTime));
    const visibleEvents = getWindowedEvents(dedupedEvents);
    const today = getHoustonTodayDate();
    const todayEvents = visibleEvents.filter((event) => event.dateTime.slice(0, 10) === today);
    const dates = summarizeDates(visibleEvents);
    const duplicateRowsRemoved = Math.max(parsedBeforeDedupe - dedupedEvents.length, 0);

    const debug: BadAstronautSourceDebug = {
      urlsChecked: checkedUrls,
      responseStatus: homepageResponse.status ?? 200,
      responseStatuses,
      fetchSucceeded: true,
      calendarPageFound,
      cleanedLineCount,
      dateMatches,
      timeMatches,
      titleCandidates,
      rawEventCandidates,
      parsedBeforeDedupe,
      parsedValidEvents: dedupedEvents.length,
      concertRowsParsed,
      otherRowsParsed,
      duplicateRowsRemoved,
      hiddenPastEventsCount: dedupedEvents.length - visibleEvents.length,
      displayedInWindowEventsCount: visibleEvents.length,
      todayChecked: true,
      todayEventsCount: todayEvents.length,
      todayHadEvents: todayEvents.length > 0,
      earliestEventDate: dates.earliestEventDate,
      latestEventDate: dates.latestEventDate,
      warnings,
    };

    return {
      events: visibleEvents,
      sourceName: BAD_ASTRONAUT_SOURCE_NAME,
      sourceUrl: BAD_ASTRONAUT_SOURCE_URL,
      status: visibleEvents.length > 0 ? "success" : "working",
      message: buildSummary(debug),
      debug,
    };
  } catch (error) {
    const debug: BadAstronautSourceDebug = {
      urlsChecked: [BAD_ASTRONAUT_SOURCE_URL],
      responseStatus: undefined,
      fetchSucceeded: false,
      calendarPageFound: false,
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
      hiddenPastEventsCount: 0,
      displayedInWindowEventsCount: 0,
      todayChecked: false,
      todayEventsCount: 0,
      todayHadEvents: false,
      warnings: [
        error instanceof Error ? error.message : "Bad Astronaut source failed to load.",
      ],
    };

    return {
      events: [],
      sourceName: BAD_ASTRONAUT_SOURCE_NAME,
      sourceUrl: BAD_ASTRONAUT_SOURCE_URL,
      status: "failed",
      message: error instanceof Error ? error.message : "Bad Astronaut source failed to load.",
      debug,
    };
  }
}
