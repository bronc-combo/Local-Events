import { scoreEvent, type EventSeed } from "@/lib/event-scoring";
import { EVENT_DISPLAY_WINDOW_DAYS } from "@/lib/event-window";
import { cachedFetch } from "@/lib/source-cache";
import type { AxelradSourceDebug as AxelradSourceDebugType, EventItem } from "@/types/dashboard";

export const AXELRAD_SOURCE_NAME = "Axelrad";
export const AXELRAD_SOURCE_URL = "https://www.axelradhouston.com/calendar";
export const AXELRAD_HOME_URL = "https://www.axelradhouston.com/";
const AXELRAD_USER_AGENT = "DailyOverviewBot/1.0 (+https://localhost)";
const HOUSTON_TIME_ZONE = "America/Chicago";

export interface AxelradSourceResult {
  events: EventItem[];
  sourceName: string;
  sourceUrl: string;
  status: "success" | "unavailable" | "failed";
  message: string;
  debug: AxelradSourceDebug;
}

export type AxelradSourceDebug = AxelradSourceDebugType;

interface CacheAwareResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

interface AxelradParsedListing {
  id: string;
  title: string;
  date: string;
  dateTime: string;
  timeLabel?: string;
  sourcePageUrl: string;
  sectionCategory: EventItem["sectionCategory"];
  category: string;
  eventSubtype?: string;
  genreTags: string[];
  subtitle?: string;
  description?: string;
  supportActs?: string;
  rawGenre?: string;
  price?: string;
  ageRestriction?: string;
  room?: string;
  metadataConfidence: number;
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

function extractVisibleLines(html: string): string[] {
  return normalizeMultilineText(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<\/(p|div|li|section|article|h1|h2|h3|h4|h5|h6|a|time|span|button)>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
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

function normalizeComparableText(value: string): string {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseDateHeading(value: string): string | null {
  const match = value.trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);

  if (!match) {
    return null;
  }

  const month = Number(match[1]);
  const day = Number(match[2]);
  const year = Number(match[3]);

  if (!Number.isFinite(month) || !Number.isFinite(day) || !Number.isFinite(year)) {
    return null;
  }

  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function isWithinWindow(date: string, today: string, windowEnd: string): boolean {
  return date >= today && date <= windowEnd;
}

function stripLeadingRoomPrefix(title: string): { title: string; room?: string } {
  const withColon = title.match(/^\(([^)]+)\):\s*(.+)$/);
  if (withColon) {
    return {
      room: normalizeWhitespace(withColon[1]),
      title: normalizeWhitespace(withColon[2]),
    };
  }

  const withoutColon = title.match(/^\(([^)]+)\)\s*(.+)$/);
  if (withoutColon) {
    return {
      room: normalizeWhitespace(withoutColon[1]),
      title: normalizeWhitespace(withoutColon[2]),
    };
  }

  return { title: normalizeWhitespace(title) };
}

function isIgnoredCalendarLine(line: string): boolean {
  const normalized = normalizeWhitespace(line);

  return (
    normalized === "This WeekConcert SeriesResidencies" ||
    normalized === "Concert series" ||
    normalized === "Monthly Residencies" ||
    normalized === "Residencies" ||
    normalized === "Concert Series" ||
    normalized === "Book a party!" ||
    normalized === "Interested in booking?" ||
    normalized === "Check out our MUSIC page for upcoming concerts!" ||
    normalized === "info" ||
    normalized === "Hours" ||
    normalized === "Social" ||
    normalized === "Sitemap" ||
    normalized === "AXELRAD" ||
    normalized === "close" ||
    normalized === "Close FAQX" ||
    normalized === "FAQ" ||
    normalized === "FAQX" ||
    normalized === "Calender" ||
    normalized === "Calendar" ||
    normalized === "Home" ||
    normalized === "About" ||
    normalized === "Reservations" ||
    normalized === "Drinks" ||
    normalized === "Community" ||
    normalized === "Music" ||
    normalized === "Shop" ||
    normalized === "We host local, regional, and international artists representing music of many genres including jazz, soul, blues, Latin, indie, electronic, experimental, world, ska, punk, pop, rock, classical, etc." ||
    normalized === "Want to stay up to date with our events? Sign up for our text list and receive exclusive discounts and stay up to date with our concerts and events!"
  );
}

function isDayHeader(line: string): boolean {
  return /^(today|monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/i.test(normalizeWhitespace(line));
}

function isTimeLine(line: string): boolean {
  const normalized = normalizeWhitespace(line).toLowerCase();

  if (!/\d|am|pm|noon|sundown|close|doors|show|music|-\s*\w/.test(normalized)) {
    return false;
  }

  return (
    /\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/i.test(normalized) ||
    /\b\d{1,2}(?::\d{2})?\s*-\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)?\b/i.test(normalized) ||
    /\bdoors?\b/i.test(normalized) ||
    /\bshow\b/i.test(normalized) ||
    /\bmusic\b/i.test(normalized) ||
    /\bsundown\b/i.test(normalized) ||
    /\bclose\b/i.test(normalized)
  );
}

function normalizeTimeLabel(value: string): string {
  return normalizeWhitespace(value).replace(/[–—]/g, "-").replace(/\s*-\s*/g, " - ");
}

function parseStartDateTime(date: string, timeLabel?: string): string {
  if (!timeLabel || /^time not listed on source\.?$/i.test(timeLabel)) {
    return `${date}T12:00:00-05:00`;
  }

  const normalized = normalizeWhitespace(timeLabel).replace(/[–—]/g, "-");
  const matches = [...normalized.matchAll(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/gi)];

  if (matches.length === 0) {
    return `${date}T12:00:00-05:00`;
  }

  const preferred = /show|music/i.test(normalized) ? matches.at(-1) ?? matches[0] : matches[0];
  const hourRaw = Number(preferred[1]);
  const minuteRaw = Number(preferred[2] ?? "0");
  const meridiem = preferred[3].toLowerCase();

  if (!Number.isFinite(hourRaw) || !Number.isFinite(minuteRaw)) {
    return `${date}T12:00:00-05:00`;
  }

  let hour = hourRaw % 12;
  if (meridiem === "pm") {
    hour += 12;
  }

  return `${date}T${String(hour).padStart(2, "0")}:${String(minuteRaw).padStart(2, "0")}:00-05:00`;
}

function parseMetaLine(line: string): { price?: string; room?: string; ageRestriction?: string } {
  const parts = normalizeWhitespace(line)
    .split("|")
    .map((part) => normalizeWhitespace(part))
    .filter(Boolean);

  const meta: { price?: string; room?: string; ageRestriction?: string } = {};

  for (const part of parts) {
    if (/^free/i.test(part)) {
      meta.price = "Free";
    } else if (/^ticketed/i.test(part)) {
      meta.price = "Ticketed";
    }

    if (/\b\+?21\b/i.test(part) || /all ages/i.test(part)) {
      meta.ageRestriction = part;
    }

    if (
      /main stage/i.test(part) ||
      /fest stage/i.test(part) ||
      /the attic/i.test(part) ||
      /lobby/i.test(part) ||
      /sidewing/i.test(part) ||
      /all axel/i.test(part) ||
      /all of axelrad/i.test(part)
    ) {
      meta.room = part;
    }
  }

  return meta;
}

function extractMusicGenreTags(title: string, description: string, room?: string): string[] {
  const normalized = `${title} ${description} ${room ?? ""}`.toLowerCase();
  const tags = new Set<string>();

  if (/emo/.test(normalized)) {
    tags.add("emo");
    tags.add("punk");
  }

  if (/punk/.test(normalized)) {
    tags.add("punk");
  }

  if (/cumbia/.test(normalized)) {
    tags.add("cumbia");
    tags.add("latin");
  }

  if (/latin-core|latin core|reggaeton|dembow|bachata/.test(normalized)) {
    tags.add("latin");
    tags.add("dance");
  }

  if (/jazz/.test(normalized)) {
    tags.add("jazz");
  }

  if (/glitch|electronic|digital sounds/.test(normalized)) {
    tags.add("experimental electronic");
    tags.add("ambient");
  }

  if (/drum|drumming|jamming/.test(normalized)) {
    tags.add("live music");
  }

  if (/live music|bands?|concert|showcase|session|music night/.test(normalized)) {
    tags.add("live music");
  }

  if (/rock/.test(normalized)) {
    tags.add("rock");
  }

  if (tags.size === 0) {
    tags.add("live music");
  }

  return [...tags];
}

function classifyAxelradEvent(title: string, description: string, room?: string): {
  category: string;
  sectionCategory: EventItem["sectionCategory"];
  eventSubtype?: string;
  genreTags: string[];
  rawGenre?: string;
  metadataConfidence: number;
  supportActs?: string;
} {
  const normalized = `${title} ${description} ${room ?? ""}`.toLowerCase();
  const isComedy =
    /comedy|punchline|stand up|open mic|laugh/.test(normalized) &&
    !/music|band|bands|jazz|cumbia|emo|dj|concert|live music|song|session/.test(normalized);
  const isMovie = /movie|film|screening/.test(normalized);
  const isWatchParty = /watch party|world cup|football|soccer/.test(normalized);
  const isMarket = /market|swap/.test(normalized);
  const isLecture = /lecture|talk|poetry/.test(normalized);
  const isRunClub = /run club|fitness/.test(normalized);
  const isSocial = /party|post-party/.test(normalized) && !/music|band|dj/.test(normalized);
  const isMusic =
    !isComedy &&
    !isMovie &&
    !isWatchParty &&
    !isMarket &&
    !isLecture &&
    !isRunClub &&
    !isSocial &&
    /music|band|bands|jazz|cumbia|emo|dj|concert|live music|song|session|glitch|electronic|latin-core|latin core|reggaeton|dembow|bachata|drum|drumming|jamming/.test(normalized);

  if (isComedy) {
    return {
      category: "Comedy",
      sectionCategory: "other",
      eventSubtype: "Comedy",
      genreTags: ["comedy"],
      rawGenre: "Comedy",
      metadataConfidence: 72,
    };
  }

  if (isMovie) {
    return {
      category: "Movie Night",
      sectionCategory: "other",
      eventSubtype: "Movie Night",
      genreTags: ["film"],
      rawGenre: "Film",
      metadataConfidence: 68,
    };
  }

  if (isWatchParty) {
    return {
      category: "Watch Party",
      sectionCategory: "other",
      eventSubtype: "Watch Party",
      genreTags: ["watch party", "social"],
      rawGenre: "Watch party",
      metadataConfidence: 70,
    };
  }

  if (isMarket) {
    return {
      category: "Market",
      sectionCategory: "other",
      eventSubtype: "Market",
      genreTags: ["market", "community"],
      rawGenre: "Market",
      metadataConfidence: 70,
    };
  }

  if (isLecture) {
    return {
      category: "Lecture",
      sectionCategory: "other",
      eventSubtype: "Lecture",
      genreTags: ["talk", "community"],
      rawGenre: "Talk",
      metadataConfidence: 68,
    };
  }

  if (isRunClub) {
    return {
      category: "Run Club",
      sectionCategory: "other",
      eventSubtype: "Run Club",
      genreTags: ["run club", "social"],
      rawGenre: "Run club",
      metadataConfidence: 66,
    };
  }

  if (isSocial) {
    return {
      category: "Social / Party",
      sectionCategory: "other",
      eventSubtype: "Social / Party",
      genreTags: ["social", "nightlife"],
      rawGenre: "Social",
      metadataConfidence: 64,
    };
  }

  if (isMusic) {
    const musicGenreTags = extractMusicGenreTags(title, description, room);
    const eventSubtype = /jazz/.test(normalized)
      ? "Jazz"
      : /emo/.test(normalized)
        ? "Emo Night"
        : /cumbia/.test(normalized)
          ? "Cumbia Night"
          : /latin-core|latin core|reggaeton|dembow|bachata/.test(normalized)
            ? "Latin Dance Night"
            : /glitch|electronic/.test(normalized)
              ? "Electronic Music"
              : /live music/.test(normalized)
                ? "Live Music"
                : /session/.test(normalized)
                  ? "Session"
                  : "Concert";

    return {
      category: "Music Performance",
      sectionCategory: "concert",
      eventSubtype,
      genreTags: musicGenreTags,
      rawGenre: musicGenreTags.join(" / "),
      metadataConfidence: 84,
    };
  }

  return {
    category: "Community / Local",
    sectionCategory: "other",
    eventSubtype: "Social",
    genreTags: ["community"],
    rawGenre: "Community",
    metadataConfidence: 58,
  };
}

function parseHomepageShows(lines: string[], pageUrl: string): {
  listings: AxelradParsedListing[];
  rawEventCandidates: number;
  dateHeadingMatches: number;
  timeMatches: number;
  titleMatches: number;
  skippedRows: number;
  skippedReasons: string[];
  cleanedLineCount: number;
} {
  const start = lines.findIndex((line) => line.includes("Shows at Axelrad"));
  const end = lines.findIndex((line, index) => index > start && (line.includes("Book a party!") || line.includes("Interested in booking?")));
  const relevantLines = lines.slice(start >= 0 ? start : 0, end > start ? end : lines.length);
  const listings: AxelradParsedListing[] = [];
  const skippedReasons: string[] = [];
  let currentDate: string | null = null;
  let pendingTimeLabel: string | undefined;
  let currentTitle: string | null = null;
  let currentDescriptionLines: string[] = [];
  let currentSupportActs: string[] = [];
  let currentMeta: { price?: string; room?: string; ageRestriction?: string } = {};
  let dateHeadingMatches = 0;
  let timeMatches = 0;
  let titleMatches = 0;
  let rawEventCandidates = 0;

  const flush = (): void => {
    if (!currentDate || !currentTitle) {
      currentTitle = null;
      currentDescriptionLines = [];
      currentSupportActs = [];
      currentMeta = {};
      pendingTimeLabel = undefined;
      return;
    }

    rawEventCandidates += 1;
    const strippedTitle = stripLeadingRoomPrefix(currentTitle);
    const description = currentDescriptionLines.map((line) => normalizeWhitespace(line)).filter(Boolean).join(" ");
    const classification = classifyAxelradEvent(strippedTitle.title, description, currentMeta.room ?? strippedTitle.room);

    listings.push({
      id: `axelrad-${normalizeComparableText(strippedTitle.title).replace(/\s+/g, "-")}-${currentDate}-${listings.length + 1}`,
      title: strippedTitle.title,
      date: currentDate,
      dateTime: parseStartDateTime(currentDate, pendingTimeLabel),
      timeLabel: pendingTimeLabel ? normalizeTimeLabel(pendingTimeLabel) : undefined,
      sourcePageUrl: pageUrl,
      ...classification,
      subtitle: [currentMeta.price, currentMeta.room, currentMeta.ageRestriction]
        .map((value) => normalizeWhitespace(value ?? ""))
        .filter(Boolean)
        .join(" | ") || undefined,
      description: description || undefined,
      supportActs: currentSupportActs.length > 0 ? [...new Set(currentSupportActs)].join("; ") : undefined,
      room: currentMeta.room ?? strippedTitle.room,
      price: currentMeta.price,
      ageRestriction: currentMeta.ageRestriction,
    });

    currentTitle = null;
    currentDescriptionLines = [];
    currentSupportActs = [];
    currentMeta = {};
    pendingTimeLabel = undefined;
  };

  for (const line of relevantLines) {
    const normalized = normalizeWhitespace(line);

    if (!normalized) {
      continue;
    }

    if (parseDateHeading(normalized)) {
      flush();
      currentDate = parseDateHeading(normalized);
      dateHeadingMatches += 1;
      continue;
    }

    if (!currentDate || isIgnoredCalendarLine(normalized) || isDayHeader(normalized)) {
      continue;
    }

    if (/^food:\s*/i.test(normalized)) {
      continue;
    }

    if (/^get tickets$/i.test(normalized)) {
      continue;
    }

    if (isTimeLine(normalized)) {
      pendingTimeLabel = normalized;
      timeMatches += 1;
      continue;
    }

    if (
      /^(get tickets|more info here on dice|more info here|tickets|free entry|free event|ticketed|all ages)/i.test(normalized) ||
      /^\+\d+/i.test(normalized) ||
      (currentTitle !== null &&
        /\|/.test(normalized) &&
        /free|ticketed|all ages|\+?\d+\+?|main stage|the attic|lobby|fest stage|sidewing|all of axelrad|all axel/i.test(normalized))
    ) {
      currentMeta = {
        ...currentMeta,
        ...parseMetaLine(normalized),
      };
      continue;
    }

    if (/^(bands?|live bands?|dj's?|djs?|dj):/i.test(normalized)) {
      currentSupportActs.push(normalized.replace(/^(bands?|live bands?|dj's?|djs?|dj):\s*/i, ""));
      currentDescriptionLines.push(normalized);
      continue;
    }

    if (!currentTitle) {
      currentTitle = normalized;
      titleMatches += 1;
      continue;
    }

    if (/^[*•-]\s*/.test(normalized)) {
      currentSupportActs.push(normalized.replace(/^[*•-]\s*/, ""));
      currentDescriptionLines.push(normalized);
      continue;
    }

    currentDescriptionLines.push(normalized);
  }

  flush();

  return {
    listings,
    rawEventCandidates,
    dateHeadingMatches,
    timeMatches,
    titleMatches,
    skippedRows: 0,
    skippedReasons,
    cleanedLineCount: relevantLines.length,
  };
}

function parseCalendarThisWeek(lines: string[], pageUrl: string): {
  listings: AxelradParsedListing[];
  rawEventCandidates: number;
  dateHeadingMatches: number;
  timeMatches: number;
  titleMatches: number;
  skippedRows: number;
  skippedReasons: string[];
  cleanedLineCount: number;
} {
  const start = lines.findIndex((line) => line.includes("This Week"));
  const end = lines.findIndex((line, index) => index > start && line.includes("Concert series"));
  const relevantLines = lines.slice(start >= 0 ? start : 0, end > start ? end : lines.length);
  const listings: AxelradParsedListing[] = [];
  const skippedReasons: string[] = [];
  let currentDate: string | null = null;
  let rawEventCandidates = 0;
  let dateHeadingMatches = 0;
  let timeMatches = 0;
  let titleMatches = 0;

  for (const line of relevantLines) {
    const normalized = normalizeWhitespace(line);

    if (!normalized) {
      continue;
    }

    if (parseDateHeading(normalized)) {
      currentDate = parseDateHeading(normalized);
      dateHeadingMatches += 1;
      continue;
    }

    if (!currentDate || isIgnoredCalendarLine(normalized) || isDayHeader(normalized)) {
      continue;
    }

    if (/^food:\s*/i.test(normalized)) {
      continue;
    }

    if (isTimeLine(normalized)) {
      timeMatches += 1;
      continue;
    }

    rawEventCandidates += 1;
    const strippedTitle = stripLeadingRoomPrefix(normalized);
    const inlineTimeMatch = strippedTitle.title.match(/\((\d{1,2}(?::\d{2})?\s*(?:am|pm))\)/i);
    const timeLabel = inlineTimeMatch ? normalizeTimeLabel(inlineTimeMatch[1]) : undefined;
    const title = inlineTimeMatch
      ? normalizeWhitespace(strippedTitle.title.replace(inlineTimeMatch[0], "").replace(/\s{2,}/g, " "))
      : strippedTitle.title;
    const classification = classifyAxelradEvent(title, "", strippedTitle.room);
    titleMatches += 1;

    listings.push({
      id: `axelrad-week-${normalizeComparableText(title).replace(/\s+/g, "-")}-${currentDate}-${listings.length + 1}`,
      title,
      date: currentDate,
      dateTime: parseStartDateTime(currentDate, timeLabel),
      timeLabel: timeLabel ?? "Time not listed on source.",
      sourcePageUrl: pageUrl,
      ...classification,
      room: strippedTitle.room,
      subtitle: strippedTitle.room ? strippedTitle.room : undefined,
      metadataConfidence: Math.max(classification.metadataConfidence, 66),
    });
  }

  return {
    listings,
    rawEventCandidates,
    dateHeadingMatches,
    timeMatches,
    titleMatches,
    skippedRows: 0,
    skippedReasons,
    cleanedLineCount: relevantLines.length,
  };
}

function dedupeListings(listings: AxelradParsedListing[]): {
  deduped: AxelradParsedListing[];
  duplicateRowsRemoved: number;
} {
  const byKey = new Map<string, AxelradParsedListing>();

  for (const listing of listings) {
    const key = [
      normalizeComparableText(listing.title),
      listing.date,
      normalizeComparableText(listing.sourcePageUrl),
      listing.timeLabel ? normalizeComparableText(listing.timeLabel) : "time-not-listed",
    ].join("|");
    const existing = byKey.get(key);

    if (!existing || listing.metadataConfidence > existing.metadataConfidence) {
      byKey.set(key, listing);
    }
  }

  return {
    deduped: [...byKey.values()],
    duplicateRowsRemoved: Math.max(listings.length - byKey.size, 0),
  };
}

function mapListingToEvent(listing: AxelradParsedListing): EventItem {
  const sourceLinks = [{ label: "Source page", url: listing.sourcePageUrl }];
  const seed: EventSeed = {
    id: listing.id,
    title: listing.title,
    dateTime: listing.dateTime,
    venue: AXELRAD_SOURCE_NAME,
    city: "Houston",
    category: listing.category,
    sectionCategory: listing.sectionCategory,
    eventSubtype: listing.eventSubtype,
    genreTags: listing.genreTags,
    sourceLinks,
    eventUrl: listing.sourcePageUrl,
    eventUrlLabel: "Source page",
    subtitle: listing.subtitle,
    description: listing.description,
    supportActs: listing.supportActs,
    rawGenre: listing.rawGenre,
    price: listing.price,
    ageRestriction: listing.ageRestriction,
    room: listing.room,
    metadataConfidence: listing.metadataConfidence,
    isGreatLiveAct: false,
    liveReputationStatus: "unknown",
    liveReputationConfidence: 0,
    liveReputationReasons: [],
    liveReputationSources: [],
    venueFitScore: 0,
    knownLiveReputationScore: 0,
    rarityScore: listing.sectionCategory === "concert" ? 7 : 5,
    distanceRelevanceScore: 9,
    feedbackHistoryPlaceholderScore: 5,
  };

  const scored = scoreEvent(seed);

  return {
    ...scored,
    sourceLabel: AXELRAD_SOURCE_NAME,
    sourceLinks,
    eventUrl: listing.sourcePageUrl,
    eventUrlLabel: "Source page",
    timeLabel: listing.timeLabel ?? "Time not listed on source.",
    startDate: listing.date,
    endDate: listing.date,
  };
}

function buildSummary(debug: AxelradSourceDebug): string {
  if (!debug.homepageReached && !debug.calendarPageReached) {
    return "Axelrad official pages could not be loaded.";
  }

  if (debug.parsedValidEvents === 0) {
    return `Axelrad official pages loaded, but parser found 0 valid events. Raw candidates: ${debug.rawEventCandidates}, lines: ${debug.cleanedLineCount}, skipped: ${debug.skippedRows}.`;
  }

  if (debug.todayHadEvents) {
    return `Axelrad loaded from official pages: ${debug.parsedValidEvents} events parsed, including ${debug.todayEventsCount} today.`;
  }

  return `Axelrad loaded from official pages: ${debug.parsedValidEvents} events parsed, with ${debug.visibleMusicCount ?? 0} music events and ${debug.visibleOtherCount ?? 0} other events in the current window.`;
}

async function fetchHtml(url: string): Promise<{ ok: boolean; status?: number; html?: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    const response = await cachedFetch(url, {
      category: "music",
      refreshPolicy: "daily",
      headers: {
        "User-Agent": AXELRAD_USER_AGENT,
        Accept: "text/html,application/xhtml+xml",
      },
      signal: controller.signal,
      next: { revalidate: 900 },
    }) as unknown as CacheAwareResponse;

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

export async function fetchAxelradSource(): Promise<AxelradSourceResult> {
  const urlsChecked = [AXELRAD_HOME_URL, AXELRAD_SOURCE_URL];

  try {
    const [homeResponse, calendarResponse] = await Promise.all(
      urlsChecked.map(async (url) => ({ url, response: await fetchHtml(url) })),
    );

    const responseStatuses: Record<string, number> = {};
    for (const entry of [homeResponse, calendarResponse]) {
      if (entry.response.status) {
        responseStatuses[entry.url] = entry.response.status;
      }
    }

    const homepageReached = Boolean(homeResponse.response.ok && homeResponse.response.html);
    const calendarPageReached = Boolean(calendarResponse.response.ok && calendarResponse.response.html);

    const homepageLines = homeResponse.response.html ? extractVisibleLines(homeResponse.response.html) : [];
    const calendarLines = calendarResponse.response.html ? extractVisibleLines(calendarResponse.response.html) : [];

    const homepageParsed = homeResponse.response.html
      ? parseHomepageShows(homepageLines, AXELRAD_HOME_URL)
      : {
          listings: [],
          rawEventCandidates: 0,
          dateHeadingMatches: 0,
          timeMatches: 0,
          titleMatches: 0,
          skippedRows: 0,
          skippedReasons: ["Homepage could not be loaded."],
          cleanedLineCount: 0,
        };
    const calendarParsed = calendarResponse.response.html
      ? parseCalendarThisWeek(calendarLines, AXELRAD_SOURCE_URL)
      : {
          listings: [],
          rawEventCandidates: 0,
          dateHeadingMatches: 0,
          timeMatches: 0,
          titleMatches: 0,
          skippedRows: 0,
          skippedReasons: ["Calendar page could not be loaded."],
          cleanedLineCount: 0,
        };

    const parsedListings = [...homepageParsed.listings, ...calendarParsed.listings];
    const parsedBeforeDedupe = parsedListings.length;
    const { deduped, duplicateRowsRemoved } = dedupeListings(parsedListings);
    const mappedEvents = deduped.map(mapListingToEvent).sort((left, right) => left.dateTime.localeCompare(right.dateTime));
    const today = getHoustonTodayDate();
    const windowEnd = addDays(today, EVENT_DISPLAY_WINDOW_DAYS);
    const inWindowEvents = mappedEvents.filter((event) => isWithinWindow(event.dateTime.slice(0, 10), today, windowEnd));
    const visibleEvents = inWindowEvents.filter((event) => !event.hiddenReason);
    const todayEvents = visibleEvents.filter((event) => event.dateTime.slice(0, 10) === today);
    const visibleMusicCount = visibleEvents.filter((event) => event.sectionCategory === "concert").length;
    const visibleOtherCount = visibleEvents.filter((event) => event.sectionCategory === "other").length;
    const lowPriorityMusicCount = inWindowEvents.filter(
      (event) => event.sectionCategory === "concert" && Boolean(event.hiddenReason),
    ).length;
    const lowPriorityOtherCount = inWindowEvents.filter(
      (event) => event.sectionCategory === "other" && Boolean(event.hiddenReason),
    ).length;
    const dates = visibleEvents.length > 0
      ? {
          earliestEventDate: visibleEvents[0]?.dateTime.slice(0, 10),
          latestEventDate: visibleEvents.at(-1)?.dateTime.slice(0, 10),
        }
      : {};

    const debug: AxelradSourceDebug = {
      urlsChecked,
      responseStatus: homeResponse.response.status ?? calendarResponse.response.status,
      responseStatuses,
      homepageReached,
      calendarPageReached,
      fetchedTextLength:
        (homeResponse.response.html?.length ?? 0) + (calendarResponse.response.html?.length ?? 0),
      cleanedLineCount: homepageParsed.cleanedLineCount + calendarParsed.cleanedLineCount,
      dateHeadingMatches:
        homepageParsed.dateHeadingMatches + calendarParsed.dateHeadingMatches,
      timeMatches: homepageParsed.timeMatches + calendarParsed.timeMatches,
      titleMatches: homepageParsed.titleMatches + calendarParsed.titleMatches,
      rawEventCandidates:
        homepageParsed.rawEventCandidates + calendarParsed.rawEventCandidates,
      parsedBeforeDedupe,
      parsedValidEvents: mappedEvents.length,
      duplicateRowsRemoved,
      skippedRows:
        homepageParsed.skippedRows + calendarParsed.skippedRows,
      skippedReasons: [
        ...homepageParsed.skippedReasons,
        ...calendarParsed.skippedReasons,
      ],
      hiddenPastEventsCount: Math.max(mappedEvents.length - inWindowEvents.length, 0),
      displayedInWindowEventsCount: visibleEvents.length,
      todayChecked: true,
      todayEventsCount: todayEvents.length,
      todayHadEvents: todayEvents.length > 0,
      earliestEventDate: dates.earliestEventDate,
      latestEventDate: dates.latestEventDate,
      visibleMusicCount,
      lowPriorityMusicCount,
      visibleOtherCount,
      lowPriorityOtherCount,
      warnings: [],
    };

    const hasAnyUsablePage = homepageReached || calendarPageReached;
    const hasAnyEvents = visibleEvents.length > 0;

    return {
      events: visibleEvents,
      sourceName: AXELRAD_SOURCE_NAME,
      sourceUrl: AXELRAD_SOURCE_URL,
      status: hasAnyEvents ? "success" : hasAnyUsablePage ? "unavailable" : "failed",
      message: buildSummary(debug),
      debug,
    };
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : "Axelrad source failed before current-window coverage could be verified.";

    return {
      events: [],
      sourceName: AXELRAD_SOURCE_NAME,
      sourceUrl: AXELRAD_SOURCE_URL,
      status: "failed",
      message,
      debug: {
        urlsChecked: [AXELRAD_HOME_URL, AXELRAD_SOURCE_URL],
        responseStatus: undefined,
        responseStatuses: {},
        homepageReached: false,
        calendarPageReached: false,
        fetchedTextLength: 0,
        cleanedLineCount: 0,
        dateHeadingMatches: 0,
        timeMatches: 0,
        titleMatches: 0,
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
        warnings: [message],
      },
    };
  }
}
