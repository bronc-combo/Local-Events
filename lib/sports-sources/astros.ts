import type {
  SportsEvent,
  SportsSourceDebug,
} from "@/types/dashboard";
import { EVENT_DISPLAY_WINDOW_DAYS } from "@/lib/event-window";

export const ASTROS_TEAM_ID = 117;
export const ASTROS_SPORT_ID = 1;
export const ASTROS_SCHEDULE_PAGE = "https://www.mlb.com/astros/schedule";

const ASTROS_SCHEDULE_API = "https://statsapi.mlb.com/api/v1/schedule";

interface MlbScheduleTeam {
  id: number;
  name?: string;
  locationName?: string;
  venue?: {
    name?: string;
  };
}

interface MlbScheduleGame {
  gamePk: number;
  gameDate?: string;
  officialDate?: string;
  status?: {
    abstractGameState?: string;
    detailedState?: string;
    statusCode?: string;
    startTimeTBD?: boolean;
  };
  teams?: {
    home?: {
      team?: MlbScheduleTeam;
    };
    away?: {
      team?: MlbScheduleTeam;
    };
  };
  venue?: {
    name?: string;
  };
  content?: {
    link?: string;
  };
}

interface MlbScheduleResponse {
  dates?: Array<{
    date?: string;
    games?: MlbScheduleGame[];
  }>;
}

export interface AstrosScheduleResult {
  source: "success" | "limited" | "failed";
  message: string;
  events: SportsEvent[];
  debug: SportsSourceDebug;
}

function getChicagoToday(): string {
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

function buildScheduleUrl(startDate: string, endDate: string): string {
  const params = new URLSearchParams({
    sportId: String(ASTROS_SPORT_ID),
    teamId: String(ASTROS_TEAM_ID),
    startDate,
    endDate,
    hydrate: "team,venue",
  });

  return `${ASTROS_SCHEDULE_API}?${params.toString()}`;
}

function getTeamName(team?: MlbScheduleTeam): string {
  return team?.name?.trim() || "Houston Astros";
}

function getOpposingTeamName(game: MlbScheduleGame, astrosAreHome: boolean): string {
  return astrosAreHome
    ? getTeamName(game.teams?.away?.team)
    : getTeamName(game.teams?.home?.team);
}

function getVenueName(game: MlbScheduleGame, astrosAreHome: boolean): string {
  if (game.venue?.name?.trim()) {
    return game.venue.name.trim();
  }

  if (astrosAreHome) {
    return "Daikin Park";
  }

  const opponentVenue = astrosAreHome
    ? game.teams?.away?.team?.venue?.name
    : game.teams?.home?.team?.venue?.name;

  return opponentVenue?.trim() || "Venue not listed on source";
}

function getStatusLabel(game: MlbScheduleGame): SportsEvent["status"] {
  const detailedState = game.status?.detailedState?.toLowerCase() || "";

  if (detailedState.includes("postpon")) {
    return "postponed";
  }

  if (detailedState.includes("final")) {
    return "final";
  }

  if (detailedState.includes("progress") || detailedState.includes("live")) {
    return "unknown";
  }

  if (detailedState.includes("scheduled") || detailedState.includes("preview")) {
    return "scheduled";
  }

  return "unknown";
}

function formatGameDateTime(gameDate?: string, officialDate?: string): string {
  if (gameDate) {
    return gameDate;
  }

  if (officialDate) {
    return `${officialDate}T12:00:00-05:00`;
  }

  return new Date().toISOString();
}

function getGameTimeLabel(game: MlbScheduleGame): string | undefined {
  if (game.status?.startTimeTBD || !game.gameDate) {
    return "Time not listed on source.";
  }

  return undefined;
}

function mapGameToSportsEvent(game: MlbScheduleGame): SportsEvent | null {
  const awayTeam = game.teams?.away?.team;
  const homeTeam = game.teams?.home?.team;

  if (!awayTeam || !homeTeam) {
    return null;
  }

  const astrosAreHome = homeTeam.id === ASTROS_TEAM_ID;
  const astrosAreAway = awayTeam.id === ASTROS_TEAM_ID;

  if (!astrosAreHome && !astrosAreAway) {
    return null;
  }

  const opponent = getOpposingTeamName(game, astrosAreHome);
  const venueName = getVenueName(game, astrosAreHome);
  const sourceUrl = game.content?.link
    ? `https://statsapi.mlb.com${game.content.link}`
    : ASTROS_SCHEDULE_PAGE;
  const gameDate = formatGameDateTime(game.gameDate, game.officialDate);

  return {
    id: `astros-${game.gamePk}`,
    league: "MLB",
    homeTeam: astrosAreHome ? "Houston Astros" : opponent,
    awayTeam: astrosAreHome ? opponent : "Houston Astros",
    dateTime: gameDate,
    venue: venueName,
    city: astrosAreHome ? "Houston" : (homeTeam.locationName?.trim() || "Away"),
    note: astrosAreHome ? "Home game" : "Away game",
    isHomeOrLocal: astrosAreHome,
    sourceLabel: "MLB / Astros schedule",
    status: getStatusLabel(game),
    confidence: 1,
    sourceStatus: game.status?.detailedState,
    timeLabel: getGameTimeLabel(game),
    sourceLinks: [
      {
        label: "Astros schedule",
        url: ASTROS_SCHEDULE_PAGE,
      },
      {
        label: "MLB game page",
        url: sourceUrl,
      },
    ],
  };
}

export async function fetchAstrosScheduleSource(): Promise<AstrosScheduleResult> {
  const today = getChicagoToday();
  const endDate = addDays(today, EVENT_DISPLAY_WINDOW_DAYS);
  const url = buildScheduleUrl(today, endDate);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
      },
    });

    const debugBase: SportsSourceDebug = {
      urlChecked: url,
      responseStatus: response.status,
      dateWindowStart: today,
      dateWindowEnd: endDate,
      datesReturned: 0,
      gamesParsed: 0,
      astrosGamesParsed: 0,
      homeGamesParsed: 0,
      todayChecked: true,
      astrosGameToday: false,
    };

    if (!response.ok) {
      return {
        source: "failed",
        message: "Astros live schedule could not be read.",
        events: [],
        debug: {
          ...debugBase,
          warning: `Schedule endpoint returned ${response.status}.`,
        },
      };
    }

    const parsed = (await response.json()) as MlbScheduleResponse;
    const dates = Array.isArray(parsed.dates) ? parsed.dates : [];
    const allGames = dates.flatMap((dateGroup) =>
      Array.isArray(dateGroup.games) ? dateGroup.games : [],
    );
    const sportsEvents = allGames
      .map((game) => mapGameToSportsEvent(game))
      .filter((event): event is SportsEvent => event !== null);
    const astrosGames = sportsEvents.filter((event) => event.homeTeam === "Houston Astros" || event.awayTeam === "Houston Astros");
    const homeGames = astrosGames.filter((event) => event.isHomeOrLocal);
    const todayGames = astrosGames.filter((event) => event.dateTime.slice(0, 10) === today);
    const earliestParsedGameDate = astrosGames.length > 0
      ? astrosGames.reduce((earliest, event) => (
          event.dateTime < earliest ? event.dateTime : earliest
        ), astrosGames[0].dateTime)
      : undefined;
    const latestParsedGameDate = astrosGames.length > 0
      ? astrosGames.reduce((latest, event) => (
          event.dateTime > latest ? event.dateTime : latest
        ), astrosGames[0].dateTime)
      : undefined;

    if (astrosGames.length === 0) {
      return {
        source: "limited",
        message: "Astros live schedule endpoint loaded, but no games were found in the window.",
        events: [],
        debug: {
          ...debugBase,
          datesReturned: dates.length,
          gamesParsed: allGames.length,
          astrosGamesParsed: 0,
          homeGamesParsed: 0,
          astrosGameToday: false,
          warning: "No Astros games returned in the requested date window.",
        },
      };
    }

    return {
      source: "success",
      message: `Astros live schedule loaded: ${astrosGames.length} games parsed, including ${todayGames.length} today.`,
      events: astrosGames,
      debug: {
        ...debugBase,
        datesReturned: dates.length,
        gamesParsed: allGames.length,
        astrosGamesParsed: astrosGames.length,
        homeGamesParsed: homeGames.length,
        astrosGameToday: todayGames.length > 0,
        earliestParsedGameDate,
        latestParsedGameDate,
      },
    };
  } catch (error) {
    return {
      source: "failed",
      message: "Astros live schedule could not be read.",
      events: [],
      debug: {
        urlChecked: url,
        dateWindowStart: today,
        dateWindowEnd: endDate,
        datesReturned: 0,
        gamesParsed: 0,
        astrosGamesParsed: 0,
        homeGamesParsed: 0,
        todayChecked: true,
        astrosGameToday: false,
        warning:
          error instanceof Error && error.name === "AbortError"
            ? "Request timed out."
            : "The schedule endpoint could not be fetched.",
      },
    };
  } finally {
    clearTimeout(timeout);
  }
}
