import type { SportsEvent, SportsSourceDebug } from "@/types/dashboard";
import { EVENT_DISPLAY_WINDOW_DAYS } from "@/lib/event-window";

export const DASH_TEAM_ID = 99;
export const DASH_SCHEDULE_PAGE = "https://www.houstondynamofc.com/houstondash/schedule/";
const DASH_TEAM_NAME = "Houston Dash";

export interface DashScheduleResult {
  source: "success" | "limited" | "failed";
  message: string;
  events: SportsEvent[];
  debug: SportsSourceDebug;
}

interface DashScheduleDebug extends SportsSourceDebug {
  scheduleHeadingFound: boolean;
  cleanedLineCount: number;
  dateMatches: number;
  matchupCandidates: number;
  fullScheduleRowsParsed: number;
  fullDashGamesParsed: number;
  inWindowGamesParsed: number;
  inWindowHomeGamesParsed: number;
  gameToday: boolean;
  earliestInWindowGame?: string;
  latestInWindowGame?: string;
  nextHomeGameDate?: string;
  nextHomeGameLabel?: string;
}

interface DashScheduleRow {
  dateLine: string;
  matchupLine: string;
  venueLine: string;
  ticketUrl?: string;
  networkLine?: string;
  timeLine?: string;
  rowText: string;
}

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

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

function buildScheduleUrl(): string {
  return DASH_SCHEDULE_PAGE;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function normalizeWhitespace(value: string): string {
  return decodeEntities(value)
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function htmlToLines(html: string): string[] {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|td|th|h1|h2|h3|h4|h5|h6|li)>/gi, "\n")
    .replace(/<(p|div|tr|td|th|h1|h2|h3|h4|h5|h6|li)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .split(/\r?\n/)
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean);
}

function extractYearFromHeading(lines: string[]): number {
  const headingLine = lines.find((line) => /\b\d{4}\s+Dash Schedule\b/i.test(line));
  const year = headingLine?.match(/\b(\d{4})\s+Dash Schedule\b/i)?.[1];
  return year ? Number(year) : new Date().getFullYear();
}

function extractTableRows(html: string): string[] {
  return [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((match) => match[1]);
}

function extractCellBlocks(rowHtml: string): string[] {
  return [...rowHtml.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((match) => match[1]);
}

function getDateLine(value: string): string | undefined {
  const lines = htmlToLines(value);
  return lines.find((line) => new RegExp(`^(?:${DAY_NAMES.join("|")}),\\s+[A-Z][a-z]+\\s+\\d{1,2}$`).test(line));
}

function parseDateLineToIso(dateLine: string, year: number): string | null {
  const match = dateLine.match(
    /^(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday),\s+([A-Za-z]+)\s+(\d{1,2})$/i,
  );

  if (!match) {
    return null;
  }

  const monthIndex = MONTH_NAMES.findIndex(
    (month) => month.toLowerCase() === match[2].toLowerCase(),
  );

  if (monthIndex === -1) {
    return null;
  }

  const day = Number(match[3]);

  if (!Number.isFinite(day)) {
    return null;
  }

  return `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseTimeToIso(dateIso: string, timeLine?: string): string {
  if (!timeLine) {
    return `${dateIso}T12:00:00-05:00`;
  }

  const timeMatch = timeLine.match(/(\d{1,2}):(\d{2})\s*([ap])\.m\.\s*CT/i);

  if (!timeMatch) {
    return `${dateIso}T12:00:00-05:00`;
  }

  let hours = Number(timeMatch[1]);
  const minutes = Number(timeMatch[2]);
  const period = timeMatch[3].toLowerCase();

  if (period === "p" && hours !== 12) {
    hours += 12;
  }

  if (period === "a" && hours === 12) {
    hours = 0;
  }

  return `${dateIso}T${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:00-05:00`;
}

function formatDashDateLabel(dateTime: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    month: "short",
    day: "numeric",
  }).format(new Date(dateTime));
}

function getStatusLabel(row: DashScheduleRow): SportsEvent["status"] {
  if (/\bfinal\b/i.test(row.rowText) || /\b\d+\s*-\s*\d+\b/.test(row.rowText)) {
    return "final";
  }

  if (/\bpostponed\b/i.test(row.rowText)) {
    return "postponed";
  }

  if (row.timeLine || /tbd/i.test(row.rowText)) {
    return "scheduled";
  }

  return "unknown";
}

function getOpponent(matchupLine: string): { opponent: string; isHome: boolean } | null {
  if (/^Dash\s+vs\.\s+/i.test(matchupLine)) {
    return {
      opponent: matchupLine.replace(/^Dash\s+vs\.\s+/i, "").trim(),
      isHome: true,
    };
  }

  if (/\s+vs\.\s+Dash$/i.test(matchupLine)) {
    return {
      opponent: matchupLine.replace(/\s+vs\.\s+Dash$/i, "").trim(),
      isHome: false,
    };
  }

  return null;
}

function parseRow(rowHtml: string, year: number): { event: SportsEvent | null; matchupCandidate: boolean; dateMatched: boolean } {
  const cells = extractCellBlocks(rowHtml).map((cell) => htmlToLines(cell));
  const dateText = cells[0]?.[0];
  const matchupLine = cells[1]?.[0];
  const venueLine = cells[2]?.[0];
  const networkLine = cells[5]?.[0];
  const timeLine = cells[6]?.[0];
  const rowText = htmlToLines(rowHtml).join(" ");
  const matchupCandidate = Boolean(matchupLine && /Dash/i.test(matchupLine));
  const dateMatched = Boolean(dateText && getDateLine(dateText));

  if (!dateText || !matchupLine) {
    return { event: null, matchupCandidate, dateMatched };
  }

  const parsedDateLine = getDateLine(dateText);
  if (!parsedDateLine) {
    return { event: null, matchupCandidate, dateMatched };
  }

  const dateIso = parseDateLineToIso(parsedDateLine, year);
  if (!dateIso) {
    return { event: null, matchupCandidate, dateMatched };
  }

  const opponentResult = getOpponent(matchupLine);
  if (!opponentResult) {
    return { event: null, matchupCandidate, dateMatched };
  }

  const ticketUrlMatch = rowHtml.match(/href="([^"]*tixr[^"]*)"/i);
  const ticketUrl = ticketUrlMatch?.[1]?.replace(/&amp;/g, "&");
  const sourceLinks = [
    {
      label: "Dash schedule",
      url: DASH_SCHEDULE_PAGE,
    },
    ...(ticketUrl
      ? [{
          label: "Tickets",
          url: ticketUrl,
        }]
      : []),
  ];

  const isHome = opponentResult.isHome || /Shell Energy Stadium/i.test(venueLine ?? "");
  const warning =
    opponentResult.isHome !== /Shell Energy Stadium/i.test(venueLine ?? "")
      ? "Venue text did not exactly match the home/away pattern."
      : undefined;

  const event: SportsEvent = {
    id: `dash-${dateIso}-${opponentResult.opponent.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    league: "NWSL",
    homeTeam: isHome ? DASH_TEAM_NAME : opponentResult.opponent,
    awayTeam: isHome ? opponentResult.opponent : DASH_TEAM_NAME,
    dateTime: parseTimeToIso(dateIso, timeLine),
    venue: venueLine || "Venue not listed on source",
    city: isHome ? "Houston" : "Away",
    note: isHome ? "Home game" : "Away game",
    isHomeOrLocal: isHome,
    sourceLabel: "Houston Dash official schedule",
    status: getStatusLabel({ dateLine: parsedDateLine, matchupLine, venueLine: venueLine ?? "", ticketUrl, networkLine, timeLine, rowText }),
    confidence: 1,
    sourceStatus: networkLine,
    timeLabel: timeLine ? undefined : "Time not listed on source.",
    sourceLinks,
    hiddenReason: warning,
  };

  return { event, matchupCandidate, dateMatched };
}

function withinWindow(dateIso: string, start: string, end: string): boolean {
  return dateIso >= start && dateIso <= end;
}

export async function fetchDashScheduleSource(): Promise<DashScheduleResult> {
  const startDate = getChicagoToday();
  const endDate = addDays(startDate, EVENT_DISPLAY_WINDOW_DAYS);
  const url = buildScheduleUrl();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "text/html,application/xhtml+xml",
      },
    });

    const debugBase: DashScheduleDebug = {
      urlChecked: url,
      responseStatus: response.status,
      dateWindowStart: startDate,
      dateWindowEnd: endDate,
      datesReturned: 0,
      gamesParsed: 0,
      astrosGamesParsed: 0,
      dashGamesParsed: 0,
      homeGamesParsed: 0,
      dashHomeGamesParsed: 0,
      todayChecked: true,
      astrosGameToday: false,
      dashGameToday: false,
      fullScheduleRowsParsed: 0,
      fullDashGamesParsed: 0,
      inWindowGamesParsed: 0,
      inWindowHomeGamesParsed: 0,
      gameToday: false,
      scheduleHeadingFound: false,
      cleanedLineCount: 0,
      dateMatches: 0,
      matchupCandidates: 0,
    };

    if (!response.ok) {
      return {
        source: "failed",
        message: "Dash live schedule could not be read.",
        events: [],
        debug: {
          ...debugBase,
          warning: `Schedule page returned ${response.status}.`,
        },
      };
    }

    const html = await response.text();
    const allLines = htmlToLines(html);
    const headingFound = allLines.some((line) => /\b\d{4}\s+Dash Schedule\b/i.test(line));
    const year = extractYearFromHeading(allLines);
    const relevantHtmlStart = html.search(/\b\d{4}\s+Dash Schedule\b/i);
    const relevantHtml = relevantHtmlStart >= 0 ? html.slice(relevantHtmlStart) : html;
    const rowHtmlList = extractTableRows(relevantHtml);

    const parsedRows = rowHtmlList.map((rowHtml) => parseRow(rowHtml, year));
    const dateMatches = parsedRows.filter((row) => row.dateMatched).length;
    const matchupCandidates = parsedRows.filter((row) => row.matchupCandidate).length;
    const parsedEvents = parsedRows
      .map((row) => row.event)
      .filter((event): event is SportsEvent => event !== null);
    const inWindowEvents = parsedEvents.filter((event) => {
      const dateIso = event.dateTime.slice(0, 10);
      return withinWindow(dateIso, startDate, endDate);
    });
    const fullScheduleRowsParsed = parsedRows.filter((row) => row.event !== null).length;
    const fullDashGamesParsed = parsedEvents.length;
    const inWindowGamesParsed = inWindowEvents.length;
    const inWindowHomeGamesParsed = inWindowEvents.filter((event) => event.isHomeOrLocal).length;
    const todayGames = inWindowEvents.filter((event) => event.dateTime.slice(0, 10) === startDate);
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
    const futureHomeGames = parsedEvents
      .filter((event) => event.isHomeOrLocal && event.dateTime.slice(0, 10) > endDate)
      .sort((left, right) => left.dateTime.localeCompare(right.dateTime));
    const nextHomeGame = futureHomeGames[0];
    const nextHomeGameDate = nextHomeGame?.dateTime;
    const nextHomeGameLabel = nextHomeGame
      ? `${nextHomeGame.homeTeam} vs. ${nextHomeGame.awayTeam} (${formatDashDateLabel(nextHomeGame.dateTime)})`
      : undefined;
    const nextHomeSummary = nextHomeGameDate && nextHomeGameLabel
      ? `Next home ${formatDashDateLabel(nextHomeGameDate)} — ${nextHomeGameLabel}.`
      : "";

    if (inWindowEvents.length === 0) {
      return {
        source: "limited",
        message: nextHomeSummary
          ? `Dash official schedule parsed, but no games were found in the current date window. ${nextHomeSummary}`
          : "Dash official schedule parsed, but no games were found in the current date window.",
        events: [],
        debug: {
          ...debugBase,
          scheduleHeadingFound: headingFound,
          cleanedLineCount: allLines.length,
          dateMatches,
          matchupCandidates,
          gamesParsed: fullDashGamesParsed,
          dashGamesParsed: fullDashGamesParsed,
          homeGamesParsed: inWindowHomeGamesParsed,
          dashHomeGamesParsed: inWindowHomeGamesParsed,
          dashGameToday: false,
          fullScheduleRowsParsed,
          fullDashGamesParsed,
          inWindowGamesParsed,
          inWindowHomeGamesParsed,
          gameToday: false,
          earliestParsedGameDate: earliestInWindowGame,
          latestParsedGameDate: latestInWindowGame,
          earliestInWindowGame,
          latestInWindowGame,
          nextHomeGameDate,
          nextHomeGameLabel,
          warning: "No Dash games returned in the current date window.",
        },
      };
    }

    return {
      source: "success",
      message: nextHomeSummary
        ? `Dash official schedule parsed: ${inWindowGamesParsed} game${inWindowGamesParsed === 1 ? "" : "s"} in window; ${inWindowHomeGamesParsed} home; including ${todayGames.length} today. ${nextHomeSummary}`
        : `Dash official schedule parsed: ${inWindowGamesParsed} game${inWindowGamesParsed === 1 ? "" : "s"} in window; ${inWindowHomeGamesParsed} home; including ${todayGames.length} today.`,
      events: inWindowEvents,
      debug: {
        ...debugBase,
        scheduleHeadingFound: headingFound,
        cleanedLineCount: allLines.length,
        dateMatches,
        matchupCandidates,
        gamesParsed: fullDashGamesParsed,
        dashGamesParsed: fullDashGamesParsed,
        homeGamesParsed: inWindowHomeGamesParsed,
        dashHomeGamesParsed: inWindowHomeGamesParsed,
        dashGameToday: todayGames.length > 0,
        fullScheduleRowsParsed,
        fullDashGamesParsed,
        inWindowGamesParsed,
        inWindowHomeGamesParsed,
        gameToday: todayGames.length > 0,
        earliestParsedGameDate: earliestInWindowGame,
        latestParsedGameDate: latestInWindowGame,
        earliestInWindowGame,
        latestInWindowGame,
        nextHomeGameDate,
        nextHomeGameLabel,
      },
    };
  } catch (error) {
    return {
      source: "failed",
      message: "Dash live schedule could not be read.",
      events: [],
      debug: {
        urlChecked: url,
        dateWindowStart: startDate,
        dateWindowEnd: endDate,
        datesReturned: 0,
        gamesParsed: 0,
        astrosGamesParsed: 0,
        dashGamesParsed: 0,
        homeGamesParsed: 0,
        dashHomeGamesParsed: 0,
        todayChecked: true,
        astrosGameToday: false,
        dashGameToday: false,
        fullScheduleRowsParsed: 0,
        fullDashGamesParsed: 0,
        inWindowGamesParsed: 0,
        inWindowHomeGamesParsed: 0,
        gameToday: false,
        scheduleHeadingFound: false,
        cleanedLineCount: 0,
        dateMatches: 0,
        matchupCandidates: 0,
        warning:
          error instanceof Error && error.name === "AbortError"
            ? "Request timed out."
            : "The schedule page could not be fetched.",
      },
    };
  } finally {
    clearTimeout(timeout);
  }
}
