import type { SportsEvent, SportsSourceDebug } from "@/types/dashboard";
import { EVENT_DISPLAY_WINDOW_DAYS } from "@/lib/event-window";

export const DYNAMO_TEAM_ID = 101;
export const DYNAMO_SCHEDULE_PAGE = "https://www.houstondynamofc.com/schedule/";
export const DYNAMO_SCHEDULE_DOWNLOAD_PAGE = "https://www.houstondynamofc.com/schedule/download";
export const DYNAMO_ICS_FEED_URL = "https://calendar.google.com/calendar/ical/1e48336deaa4e899a146fd7344c0c2c6294fac1625fd3d77c632c9ff8645b013%40group.calendar.google.com/public/basic.ics";
const DYNAMO_TEAM_NAME = "Houston Dynamo FC";
const DYNAMO_HOME_VENUE = "Shell Energy Stadium";

export interface DynamoScheduleResult {
  source: "success" | "limited" | "failed";
  message: string;
  events: SportsEvent[];
  debug: SportsSourceDebug;
}

interface DynamoScheduleDebug extends SportsSourceDebug {
  icsCalendarRead: boolean;
  unfoldedLineCount: number;
  veventCount: number;
  candidateDynamoEventCount: number;
  fullScheduleRowsParsed: number;
  fullDynamoGamesParsed: number;
  inWindowGamesParsed: number;
  inWindowHomeGamesParsed: number;
  gameToday: boolean;
  earliestInWindowGame?: string;
  latestInWindowGame?: string;
  nextHomeGameDate?: string;
  nextHomeGameLabel?: string;
  parsedFeedTitle?: string;
}

interface IcsProperty {
  name: string;
  params: Record<string, string>;
  value: string;
}

interface IcsEvent {
  summary?: string;
  description?: string;
  location?: string;
  url?: string;
  uid?: string;
  status?: string;
  dtstart?: string;
  dtend?: string;
  dtstartParams?: Record<string, string>;
  dtendParams?: Record<string, string>;
}

type ParsedDateValue = {
  iso: string;
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  allDay: boolean;
};

function getChicagoDateParts(date: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(date);

  const getPart = (type: string): number => {
    const value = parts.find((part) => part.type === type)?.value;
    return value ? Number(value) : 0;
  };

  return {
    year: getPart("year"),
    month: getPart("month"),
    day: getPart("day"),
  };
}

function getChicagoToday(): string {
  const { year, month, day } = getChicagoDateParts(new Date());
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function addDays(baseDate: string, days: number): string {
  const base = new Date(`${baseDate}T12:00:00-05:00`);
  base.setDate(base.getDate() + days);

  const { year, month, day } = getChicagoDateParts(base);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function decodeIcsText(value: string): string {
  return value
    .replace(/\\\\/g, "\\")
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, " ");
}

function normalizeText(value: string): string {
  return stripHtml(decodeIcsText(value))
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function unfoldIcsLines(icsText: string): string[] {
  const lines = icsText.replace(/\r\n?/g, "\n").split("\n");
  const unfolded: string[] = [];

  for (const line of lines) {
    if (/^[ \t]/.test(line) && unfolded.length > 0) {
      unfolded[unfolded.length - 1] += line.slice(1);
      continue;
    }

    unfolded.push(line);
  }

  return unfolded.map((line) => line.trimEnd()).filter(Boolean);
}

function parseIcsProperty(line: string): IcsProperty | null {
  const separatorIndex = line.indexOf(":");

  if (separatorIndex === -1) {
    return null;
  }

  const head = line.slice(0, separatorIndex);
  const rawValue = line.slice(separatorIndex + 1);
  const [name, ...paramParts] = head.split(";");
  const params: Record<string, string> = {};

  for (const paramPart of paramParts) {
    const [rawKey, ...rawValues] = paramPart.split("=");
    const key = rawKey?.trim().toUpperCase();
    const value = rawValues.join("=").trim();

    if (key) {
      params[key] = value;
    }
  }

  return {
    name: name.trim().toUpperCase(),
    params,
    value: rawValue,
  };
}

function splitEvents(lines: string[]): IcsEvent[] {
  const events: IcsEvent[] = [];
  let current: Partial<IcsEvent> | null = null;

  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      current = {};
      continue;
    }

    if (line === "END:VEVENT") {
      if (current) {
        events.push(current as IcsEvent);
      }
      current = null;
      continue;
    }

    if (!current) {
      continue;
    }

    const property = parseIcsProperty(line);

    if (!property) {
      continue;
    }

    const value = normalizeText(property.value);

    switch (property.name) {
      case "SUMMARY":
        current.summary = value;
        break;
      case "DESCRIPTION":
        current.description = value;
        break;
      case "LOCATION":
        current.location = value;
        break;
      case "URL":
        current.url = value;
        break;
      case "UID":
        current.uid = value;
        break;
      case "STATUS":
        current.status = value.toUpperCase();
        break;
      case "DTSTART":
        current.dtstart = value;
        current.dtstartParams = property.params;
        break;
      case "DTEND":
        current.dtend = value;
        current.dtendParams = property.params;
        break;
      default:
        break;
    }
  }

  return events;
}

function parseFeedTitle(lines: string[]): string | undefined {
  const titleLine = lines.find((line) => line.startsWith("X-WR-CALNAME:"));
  return titleLine?.slice("X-WR-CALNAME:".length).trim();
}

function parseLocalDateParts(dateTime: string): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  const match = dateTime.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2}))?$/);

  if (!match) {
    throw new Error(`Invalid ICS date value: ${dateTime}`);
  }

  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4] ?? "0"),
    minute: Number(match[5] ?? "0"),
    second: Number(match[6] ?? "0"),
  };
}

function partsToLocalPseudoTimestamp(parts: { year: number; month: number; day: number; hour: number; minute: number; second: number }): number {
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
}

function getChicagoPartsForDate(date: Date): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hour12: false,
  }).formatToParts(date);

  const getPart = (type: string): number => {
    const value = parts.find((part) => part.type === type)?.value;
    return value ? Number(value) : 0;
  };

  return {
    year: getPart("year"),
    month: getPart("month"),
    day: getPart("day"),
    hour: getPart("hour"),
    minute: getPart("minute"),
    second: getPart("second"),
  };
}

function localChicagoDateTimeToIso(parts: { year: number; month: number; day: number; hour: number; minute: number; second: number }): string {
  let guess = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const actual = getChicagoPartsForDate(new Date(guess));
    const targetPseudo = partsToLocalPseudoTimestamp(parts);
    const actualPseudo = partsToLocalPseudoTimestamp(actual);
    const differenceMinutes = Math.round((targetPseudo - actualPseudo) / 60000);

    if (differenceMinutes === 0) {
      return new Date(guess).toISOString();
    }

    guess += differenceMinutes * 60000;
  }

  return new Date(guess).toISOString();
}

function parseIcsDateValue(value: string, params: Record<string, string>, feedTimezone?: string): ParsedDateValue {
  const trimmed = value.trim();

  if (/^\d{8}$/.test(trimmed)) {
    const year = Number(trimmed.slice(0, 4));
    const month = Number(trimmed.slice(4, 6));
    const day = Number(trimmed.slice(6, 8));
    const iso = localChicagoDateTimeToIso({
      year,
      month,
      day,
      hour: 12,
      minute: 0,
      second: 0,
    });

    return {
      iso,
      year,
      month,
      day,
      hour: 12,
      minute: 0,
      allDay: true,
    };
  }

  if (trimmed.endsWith("Z")) {
    const date = new Date(`${trimmed.slice(0, 4)}-${trimmed.slice(4, 6)}-${trimmed.slice(6, 8)}T${trimmed.slice(9, 11)}:${trimmed.slice(11, 13)}:${trimmed.slice(13, 15)}Z`);
    const { year, month, day, hour, minute } = getChicagoPartsForDate(date);

    return {
      iso: date.toISOString(),
      year,
      month,
      day,
      hour,
      minute,
      allDay: false,
    };
  }

  const parsed = parseLocalDateParts(trimmed);
  const timezone = params.TZID || feedTimezone || "America/Chicago";

  if (timezone === "UTC" || timezone === "Z") {
    const iso = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day, parsed.hour, parsed.minute, parsed.second)).toISOString();

    return {
      iso,
      year: parsed.year,
      month: parsed.month,
      day: parsed.day,
      hour: parsed.hour,
      minute: parsed.minute,
      allDay: false,
    };
  }

  const iso = localChicagoDateTimeToIso(parsed);

  return {
    iso,
    year: parsed.year,
    month: parsed.month,
    day: parsed.day,
    hour: parsed.hour,
    minute: parsed.minute,
    allDay: false,
  };
}

function getStatusLabel(event: { status?: string }): SportsEvent["status"] {
  if (!event.status) {
    return "unknown";
  }

  if (event.status === "CANCELLED") {
    return "postponed";
  }

  return "scheduled";
}

function isLikelyDynamoMatch(summary: string): boolean {
  const normalized = summary.toLowerCase();

  if (normalized.includes("dynamo 2") || normalized.includes("watch party") || normalized.includes("academy")) {
    return false;
  }

  return /houston dynamo|dynamo fc|\bdynamo\b/.test(normalized) && !/dash/.test(normalized);
}

function parseMatchSummary(summary: string): { opponent: string; isHome: boolean } | null {
  const homeMatch =
    summary.match(/^(?:Houston\s+Dynamo(?:\s+FC)?|Dynamo(?:\s+FC)?)\s+vs\.\s+(.+)$/i)
    ?? summary.match(/^(?:Houston\s+Dynamo(?:\s+FC)?|Dynamo(?:\s+FC)?)\s+v\.\s+(.+)$/i);
  if (homeMatch) {
    return {
      opponent: homeMatch[1].trim(),
      isHome: true,
    };
  }

  const awayMatch =
    summary.match(/^(.+)\s+vs\.\s+(?:Houston\s+Dynamo(?:\s+FC)?|Dynamo(?:\s+FC)?)$/i)
    ?? summary.match(/^(.+)\s+v\.\s+(?:Houston\s+Dynamo(?:\s+FC)?|Dynamo(?:\s+FC)?)$/i);
  if (awayMatch) {
    return {
      opponent: awayMatch[1].trim(),
      isHome: false,
    };
  }

  const atHome = summary.match(/^(?:Houston\s+Dynamo(?:\s+FC)?|Dynamo(?:\s+FC)?)\s+at\s+(.+)$/i);
  if (atHome) {
    return {
      opponent: atHome[1].trim(),
      isHome: false,
    };
  }

  const atAway = summary.match(/^(.+)\s+at\s+(?:Houston\s+Dynamo(?:\s+FC)?|Dynamo(?:\s+FC)?)$/i);
  if (atAway) {
    return {
      opponent: atAway[1].trim(),
      isHome: true,
    };
  }

  return null;
}

function formatSourceDate(dateTime: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(dateTime));
}

function getEventTimeLabel(parsedDate: ParsedDateValue, event: IcsEvent): string | undefined {
  if (parsedDate.allDay) {
    return "All day";
  }

  return event.dtstart ? undefined : "Time not listed on source.";
}

function mapEventToSportsEvent(
  event: IcsEvent,
  parsedDate: ParsedDateValue,
): SportsEvent | null {
  if (!event.summary || !isLikelyDynamoMatch(event.summary)) {
    return null;
  }

  const matchup = parseMatchSummary(event.summary);
  const location = event.location?.trim();
  const locationSuggestsHome = Boolean(location && /shell energy stadium/i.test(location));
  const isHome = matchup?.isHome ?? locationSuggestsHome;
  const opponent = matchup?.opponent
    ?? (isHome ? "Opponent not listed" : "Opponent not listed");
  const sourceUrl = event.url || DYNAMO_SCHEDULE_DOWNLOAD_PAGE;
  const sourceLinks = [
    {
      label: "Dynamo schedule",
      url: DYNAMO_SCHEDULE_PAGE,
    },
    {
      label: "Schedule download",
      url: DYNAMO_SCHEDULE_DOWNLOAD_PAGE,
    },
    {
      label: "ICS feed",
      url: DYNAMO_ICS_FEED_URL,
    },
    ...(sourceUrl
      ? [{
          label: "Source event",
          url: sourceUrl,
        }]
      : []),
  ];

  const warnings: string[] = [];
  if (matchup && locationSuggestsHome !== matchup.isHome) {
    warnings.push("Summary and location do not fully agree on home/away.");
  }

  return {
    id: event.uid || `dynamo-${parsedDate.iso}-${opponent.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    league: "MLS",
    homeTeam: isHome ? DYNAMO_TEAM_NAME : opponent,
    awayTeam: isHome ? opponent : DYNAMO_TEAM_NAME,
    dateTime: parsedDate.iso,
    venue: location || DYNAMO_HOME_VENUE,
    city: isHome ? "Houston" : "Away",
    note: isHome ? "Home game" : "Away game",
    isHomeOrLocal: isHome,
    sourceLabel: "Houston Dynamo official calendar",
    status: getStatusLabel(event),
    confidence: 1,
    sourceStatus: event.status,
    timeLabel: getEventTimeLabel(parsedDate, event),
    sourceLinks,
    hiddenReason: warnings.length > 0 ? warnings.join(" ") : undefined,
  };
}

function withinWindow(dateIso: string, start: string, end: string): boolean {
  return dateIso >= start && dateIso <= end;
}

function getSafeDateIso(value: string): string {
  return value.slice(0, 10);
}

export async function fetchDynamoScheduleSource(): Promise<DynamoScheduleResult> {
  const startDate = getChicagoToday();
  const endDate = addDays(startDate, EVENT_DISPLAY_WINDOW_DAYS);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(DYNAMO_ICS_FEED_URL, {
      signal: controller.signal,
      headers: {
        Accept: "text/calendar,text/plain,*/*",
      },
    });

    const debugBase: DynamoScheduleDebug = {
      urlChecked: DYNAMO_ICS_FEED_URL,
      responseStatus: response.status,
      dateWindowStart: startDate,
      dateWindowEnd: endDate,
      datesReturned: 0,
      gamesParsed: 0,
      astrosGamesParsed: 0,
      homeGamesParsed: 0,
      todayChecked: true,
      astrosGameToday: false,
      scheduleHeadingFound: true,
      cleanedLineCount: 0,
      dateMatches: 0,
      matchupCandidates: 0,
      icsCalendarRead: false,
      unfoldedLineCount: 0,
      veventCount: 0,
      candidateDynamoEventCount: 0,
      fullScheduleRowsParsed: 0,
      fullDynamoGamesParsed: 0,
      inWindowGamesParsed: 0,
      inWindowHomeGamesParsed: 0,
      gameToday: false,
    };

    if (!response.ok) {
      return {
        source: "failed",
        message: "Dynamo live schedule could not be read.",
        events: [],
        debug: {
          ...debugBase,
          warning: `ICS feed returned ${response.status}.`,
        },
      };
    }

    const icsText = await response.text();
    const unfoldedLines = unfoldIcsLines(icsText);
    const feedTitle = parseFeedTitle(unfoldedLines);
    const calendarRead = unfoldedLines.some((line) => line === "BEGIN:VCALENDAR");
    const veventBlocks: IcsEvent[] = splitEvents(unfoldedLines);
    const feedTimezone = unfoldedLines
      .find((line) => line.startsWith("X-WR-TIMEZONE:"))
      ?.slice("X-WR-TIMEZONE:".length)
      .trim();

    const parsedEvents = veventBlocks
      .map((event) => {
        if (!event.dtstart) {
          return null;
        }

        const parsedDate = parseIcsDateValue(event.dtstart, event.dtstartParams ?? {}, feedTimezone);
        return mapEventToSportsEvent(event, parsedDate);
      })
      .filter((event): event is SportsEvent => event !== null);

    const candidateDynamoEvents = parsedEvents;
    const inWindowEvents = candidateDynamoEvents.filter((event) => {
      const dateIso = getSafeDateIso(event.dateTime);
      return withinWindow(dateIso, startDate, endDate);
    });
    const homeInWindowEvents = inWindowEvents.filter((event) => event.isHomeOrLocal);
    const todayGames = inWindowEvents.filter((event) => getSafeDateIso(event.dateTime) === startDate);
    const nextHomeGame = candidateDynamoEvents
      .filter((event) => event.isHomeOrLocal && getSafeDateIso(event.dateTime) > endDate)
      .sort((left, right) => left.dateTime.localeCompare(right.dateTime))[0];

    const earliestInWindowGame = inWindowEvents.length > 0
      ? inWindowEvents.reduce((earliest, event) => (
          event.dateTime < earliest ? event.dateTime : earliest
        ), inWindowEvents[0].dateTime)
      : undefined;
    const latestInWindowGame = inWindowEvents.length > 0
      ? inWindowEvents.reduce((latest, event) => (
          event.dateTime > latest ? event.dateTime : latest
        ), inWindowEvents[0].dateTime)
      : undefined;

    const nextHomeGameDate = nextHomeGame?.dateTime;
    const nextHomeGameLabel = nextHomeGame
      ? `${nextHomeGame.homeTeam} vs. ${nextHomeGame.awayTeam} (${formatSourceDate(nextHomeGame.dateTime)})`
      : undefined;

    if (candidateDynamoEvents.length === 0) {
      return {
        source: "limited",
        message: "Dynamo official calendar loaded, but no parseable Dynamo matches were found.",
        events: [],
        debug: {
          ...debugBase,
          icsCalendarRead: calendarRead,
          unfoldedLineCount: unfoldedLines.length,
          veventCount: veventBlocks.length,
          candidateDynamoEventCount: 0,
          fullScheduleRowsParsed: 0,
          fullDynamoGamesParsed: 0,
          inWindowGamesParsed: 0,
          inWindowHomeGamesParsed: 0,
          gameToday: false,
          scheduleHeadingFound: calendarRead,
          parsedFeedTitle: feedTitle,
          warning: "No Dynamo match entries were parsed from the ICS feed.",
        },
      };
    }

    if (inWindowEvents.length === 0) {
      return {
        source: "limited",
        message: nextHomeGameLabel
          ? `Dynamo official calendar parsed, but no games were found in the current date window. Next home: ${nextHomeGameLabel}.`
          : "Dynamo official calendar parsed, but no games were found in the current date window.",
        events: [],
        debug: {
          ...debugBase,
          icsCalendarRead: calendarRead,
          unfoldedLineCount: unfoldedLines.length,
          veventCount: veventBlocks.length,
          candidateDynamoEventCount: candidateDynamoEvents.length,
          fullScheduleRowsParsed: candidateDynamoEvents.length,
          fullDynamoGamesParsed: candidateDynamoEvents.length,
          inWindowGamesParsed: 0,
          inWindowHomeGamesParsed: 0,
          gameToday: false,
          earliestInWindowGame,
          latestInWindowGame,
          nextHomeGameDate,
          nextHomeGameLabel,
          scheduleHeadingFound: calendarRead,
          parsedFeedTitle: feedTitle,
          warning: "No Dynamo games returned in the current date window.",
        },
      };
    }

    return {
      source: "success",
      message: nextHomeGameLabel
        ? `Dynamo official calendar parsed: ${inWindowEvents.length} games in window; ${homeInWindowEvents.length} home; including ${todayGames.length} today. Next home: ${nextHomeGameLabel}.`
        : `Dynamo official calendar parsed: ${inWindowEvents.length} games in window; ${homeInWindowEvents.length} home; including ${todayGames.length} today.`,
      events: inWindowEvents,
      debug: {
        ...debugBase,
        icsCalendarRead: calendarRead,
        unfoldedLineCount: unfoldedLines.length,
        veventCount: veventBlocks.length,
        candidateDynamoEventCount: candidateDynamoEvents.length,
        fullScheduleRowsParsed: candidateDynamoEvents.length,
        fullDynamoGamesParsed: candidateDynamoEvents.length,
        inWindowGamesParsed: inWindowEvents.length,
        inWindowHomeGamesParsed: homeInWindowEvents.length,
        gameToday: todayGames.length > 0,
        earliestInWindowGame,
        latestInWindowGame,
        nextHomeGameDate,
        nextHomeGameLabel,
        scheduleHeadingFound: calendarRead,
        parsedFeedTitle: feedTitle,
      },
    };
  } catch (error) {
    return {
      source: "failed",
      message: "Dynamo live schedule could not be read.",
      events: [],
      debug: {
        urlChecked: DYNAMO_ICS_FEED_URL,
        dateWindowStart: startDate,
        dateWindowEnd: endDate,
        datesReturned: 0,
        gamesParsed: 0,
        astrosGamesParsed: 0,
        homeGamesParsed: 0,
        todayChecked: true,
        astrosGameToday: false,
        scheduleHeadingFound: false,
        cleanedLineCount: 0,
        dateMatches: 0,
        matchupCandidates: 0,
        icsCalendarRead: false,
        unfoldedLineCount: 0,
        veventCount: 0,
        candidateDynamoEventCount: 0,
        fullScheduleRowsParsed: 0,
        fullDynamoGamesParsed: 0,
        inWindowGamesParsed: 0,
        inWindowHomeGamesParsed: 0,
        gameToday: false,
        warning:
          error instanceof Error && error.name === "AbortError"
            ? "Request timed out."
            : "The ICS feed could not be fetched.",
      },
    };
  } finally {
    clearTimeout(timeout);
  }
}
