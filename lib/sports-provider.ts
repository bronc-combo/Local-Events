import { unstable_noStore as noStore } from "next/cache";
import { installSourceCache } from "@/lib/source-cache";
import { HOUSTON_SPORTS_REGISTRY } from "@/lib/sports-registry";
import {
  ASTROS_SCHEDULE_PAGE,
  fetchAstrosScheduleSource,
  type AstrosScheduleResult,
} from "@/lib/sports-sources/astros";
import {
  DASH_SCHEDULE_PAGE,
  fetchDashScheduleSource,
  type DashScheduleResult,
} from "@/lib/sports-sources/dash";
import {
  DYNAMO_SCHEDULE_DOWNLOAD_PAGE,
  fetchDynamoScheduleSource,
  type DynamoScheduleResult,
} from "@/lib/sports-sources/dynamo";
import type {
  SportsCoverageSummary,
  SportsProviderResult,
  SportsSourceStatus,
  SportsEvent,
} from "@/types/dashboard";

installSourceCache();

function cloneSportsEvent(event: SportsEvent): SportsEvent {
  return { ...event, sourceLinks: [...event.sourceLinks] };
}

function buildCoverageSummary(
  source: SportsCoverageSummary["source"],
  note: string,
  statuses: SportsSourceStatus[],
  astrosSource?: AstrosScheduleResult,
  dashSource?: DashScheduleResult,
  dynamoSource?: DynamoScheduleResult,
  liveGamesParsedCount = 0,
  homeGamesDisplayedCount = 0,
  awayGamesHiddenCount = 0,
  mockFallbackUsed = false,
  emptyStateReason?: string,
): SportsCoverageSummary {
  const astrosGamesParsedCount = astrosSource?.debug.astrosGamesParsed ?? 0;
  const dashFullScheduleRowsCount = dashSource?.debug.fullScheduleRowsParsed
    ?? dashSource?.debug.dashGamesParsed
    ?? 0;
  const dashFullGamesParsedCount = dashSource?.debug.fullDashGamesParsed
    ?? dashSource?.debug.dashGamesParsed
    ?? 0;
  const dashInWindowGamesCount = dashSource?.debug.inWindowGamesParsed
    ?? dashSource?.debug.dashGamesParsed
    ?? 0;
  const dashInWindowHomeGamesCount = dashSource?.debug.inWindowHomeGamesParsed
    ?? dashSource?.debug.dashHomeGamesParsed
    ?? 0;
  const dashGameToday = dashSource?.debug.gameToday ?? dashSource?.debug.dashGameToday ?? false;
  const dynamoFullScheduleRowsCount = dynamoSource?.debug.fullScheduleRowsParsed
    ?? dynamoSource?.debug.gamesParsed
    ?? 0;
  const dynamoFullGamesParsedCount = dynamoSource?.debug.fullDynamoGamesParsed
    ?? dynamoSource?.debug.gamesParsed
    ?? 0;
  const dynamoInWindowGamesCount = dynamoSource?.debug.inWindowGamesParsed
    ?? dynamoSource?.debug.gamesParsed
    ?? 0;
  const dynamoInWindowHomeGamesCount = dynamoSource?.debug.inWindowHomeGamesParsed
    ?? dynamoSource?.debug.homeGamesParsed
    ?? 0;
  const dynamoGameToday = dynamoSource?.debug.gameToday ?? false;
  const dynamoHomeGamesCount = dynamoInWindowHomeGamesCount;
  const homeGamesCount = (astrosSource?.debug.homeGamesParsed ?? 0)
    + dashInWindowHomeGamesCount
    + dynamoInWindowHomeGamesCount;
  const dashHomeGamesCount = dashInWindowHomeGamesCount;
  const todayGameCount = (astrosSource?.debug.astrosGameToday ? 1 : 0)
    + (dashGameToday ? 1 : 0)
    + (dynamoGameToday ? 1 : 0);
  const earliestParsedGameDate = [astrosSource?.debug.earliestParsedGameDate, dashSource?.debug.earliestInWindowGame ?? dashSource?.debug.earliestParsedGameDate]
    .filter((value): value is string => Boolean(value))
    .sort()[0];
  const latestParsedGameDate = [astrosSource?.debug.latestParsedGameDate, dashSource?.debug.latestInWindowGame ?? dashSource?.debug.latestParsedGameDate]
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1);
  const dynamoEarliestInWindowGame = dynamoSource?.debug.earliestInWindowGame ?? dynamoSource?.debug.earliestParsedGameDate;
  const dynamoLatestInWindowGame = dynamoSource?.debug.latestInWindowGame ?? dynamoSource?.debug.latestParsedGameDate;
  const combinedEarliestParsedGameDate = [earliestParsedGameDate, dynamoEarliestInWindowGame]
    .filter((value): value is string => Boolean(value))
    .sort()[0];
  const combinedLatestParsedGameDate = [latestParsedGameDate, dynamoLatestInWindowGame]
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1);

  return {
    source,
    trackedTeamsCount: HOUSTON_SPORTS_REGISTRY.length,
    activeLiveProvidersCount: statuses.filter(
      (status) => status.status === "success" || status.status === "working" || status.status === "limited",
    ).length,
    auditedLimitedTeamsCount: HOUSTON_SPORTS_REGISTRY.filter(
      (team) => team.providerStatus === "audited_limited",
    ).length,
    inactiveTeamsCount: HOUSTON_SPORTS_REGISTRY.filter(
      (team) => team.providerStatus === "inactive",
    ).length,
    notImplementedTeamsCount: HOUSTON_SPORTS_REGISTRY.filter(
      (team) => team.providerStatus === "not_implemented",
    ).length,
    parsedGamesCount: (astrosSource?.debug.astrosGamesParsed ?? 0)
      + dashFullGamesParsedCount
      + dynamoFullGamesParsedCount,
    liveGamesParsedCount,
    homeGamesDisplayedCount,
    awayGamesHiddenCount,
    mockFallbackUsed,
    emptyStateReason,
    astrosGamesParsedCount,
    dashGamesParsedCount: dashFullGamesParsedCount,
    dashFullScheduleRowsCount,
    dashFullGamesParsedCount,
    dashInWindowGamesCount,
    dashInWindowHomeGamesCount,
    dynamoGamesParsedCount: dynamoFullGamesParsedCount,
    dynamoFullScheduleRowsCount,
    dynamoFullGamesParsedCount,
    dynamoInWindowGamesCount,
    dynamoInWindowHomeGamesCount,
    homeGamesCount,
    todayChecked: Boolean(astrosSource?.debug.todayChecked || dashSource?.debug.todayChecked || dynamoSource?.debug.todayChecked),
    todayGameCount,
    dashHomeGamesCount,
    dashTodayGameCount: dashGameToday ? 1 : 0,
    dashNextHomeGameDate: dashSource?.debug.nextHomeGameDate,
    dashNextHomeGameLabel: dashSource?.debug.nextHomeGameLabel,
    dynamoHomeGamesCount,
    dynamoTodayGameCount: dynamoGameToday ? 1 : 0,
    dynamoNextHomeGameDate: dynamoSource?.debug.nextHomeGameDate,
    dynamoNextHomeGameLabel: dynamoSource?.debug.nextHomeGameLabel,
    earliestParsedGameDate: combinedEarliestParsedGameDate,
    latestParsedGameDate: combinedLatestParsedGameDate,
    fallbackNote: note,
    note,
  };
}

function buildRegistryStatuses(
  astrosStatus?: SportsSourceStatus,
  dashStatus?: SportsSourceStatus,
  dynamoStatus?: SportsSourceStatus,
): SportsSourceStatus[] {
  const astrosRow: SportsSourceStatus = astrosStatus ?? {
    teamId: "houston-astros",
    sourceName: "Houston Astros",
    sourceUrl: ASTROS_SCHEDULE_PAGE,
    status: "not_implemented",
    message: "Needs source audit before live provider implementation.",
  };

  const dashRow: SportsSourceStatus = dashStatus ?? {
    teamId: "houston-dash",
    sourceName: "Houston Dash",
    sourceUrl: DASH_SCHEDULE_PAGE,
    status: "limited",
    message: "Needs source audit before live provider implementation.",
  };

  const dynamoRow: SportsSourceStatus = dynamoStatus ?? {
    teamId: "houston-dynamo-fc",
    sourceName: "Houston Dynamo FC",
    sourceUrl: DYNAMO_SCHEDULE_DOWNLOAD_PAGE,
    status: "working",
    message: "Live provider uses the official downloadable calendar feed.",
  };

  return [
    astrosRow,
    dashRow,
    dynamoRow,
    ...HOUSTON_SPORTS_REGISTRY.filter((team) => team.id !== "houston-astros" && team.id !== "houston-dash" && team.id !== "houston-dynamo-fc").map((team) => ({
      teamId: team.id,
      sourceName: team.displayName,
      sourceUrl: team.scheduleUrl ?? team.officialUrl ?? "",
      status: team.providerStatus === "inactive"
        ? "not_implemented" as const
        : team.providerStatus === "audited_limited"
          ? "audited_limited" as const
          : "not_implemented" as const,
      isInactive: team.providerStatus === "inactive",
      message: team.providerStatus === "inactive"
        ? team.notes ?? "Not competing in 2026."
        : team.providerStatus === "audited_limited"
          ? team.notes ?? "Official schedule page reachable but no clean server-visible game rows yet."
          : team.notes ?? "Needs source audit before live provider implementation.",
    })),
  ];
}

function buildMockSportsResult(note: string): SportsProviderResult {
  const primarySports: SportsEvent[] = [];
  const lowerPrioritySports: SportsEvent[] = [];
  const statuses = buildRegistryStatuses();

  // Future sports work should be added one league or team at a time after a
  // source audit, starting with the mandatory Houston teams.
  return {
    source: "mock_fallback",
    note,
    primarySports,
    lowerPrioritySports,
    coverageSummary: buildCoverageSummary(
      "mock_fallback",
      note,
      statuses,
      undefined,
      undefined,
      undefined,
      0,
      0,
      0,
      true,
      "No live local home games found in the current window.",
    ),
    statuses,
  };
}

function buildSportsSourceNote(
  astrosResult: Awaited<ReturnType<typeof fetchAstrosScheduleSource>>,
  dashResult: Awaited<ReturnType<typeof fetchDashScheduleSource>>,
  dynamoResult: Awaited<ReturnType<typeof fetchDynamoScheduleSource>>,
): string {
  const liveTeams = [
    astrosResult.source === "success" ? "Astros" : null,
    dashResult.source === "success" ? "Dash" : null,
    dynamoResult.source === "success" ? "Dynamo" : null,
  ].filter((team): team is string => Boolean(team));

  if (liveTeams.length === 3) {
    return "Showing live local home games from supported providers. Astros, Dash, and Dynamo are live; Rockets and Texans are audited limited.";
  }

  if (liveTeams.length === 2) {
    return `Showing live local home games from supported providers. ${liveTeams[0]} and ${liveTeams[1]} are live; Rockets and Texans are audited limited.`;
  }

  if (liveTeams.length === 1) {
    return `Showing live local home games from supported providers. ${liveTeams[0]} is live; Rockets and Texans are audited limited.`;
  }

  if (astrosResult.source === "limited" && dashResult.source === "limited" && dynamoResult.source === "limited") {
    return "No live local home games found in the current window. Astros, Dash, and Dynamo returned no home games; Rockets and Texans are audited limited.";
  }

  if (astrosResult.source === "limited" && dashResult.source === "limited") {
    return "No live local home games found in the current window. Astros and Dash returned no home games; Rockets and Texans are audited limited.";
  }

  if (astrosResult.source === "limited") {
    return "No live local home games found in the current window. Astros returned no home games; Rockets and Texans are audited limited.";
  }

  if (dashResult.source === "limited") {
    return "No live local home games found in the current window. Dash returned no home games; Rockets and Texans are audited limited.";
  }

  if (dynamoResult.source === "limited") {
    return "No live local home games found in the current window. Dynamo returned no home games; Rockets and Texans are audited limited.";
  }

  return "No live local home games found in the current window. Astros, Dash, and Dynamo could not be read; Rockets and Texans are audited limited.";
}

function buildLiveAstrosResult(
  astrosResult: Awaited<ReturnType<typeof fetchAstrosScheduleSource>>,
  dashResult: Awaited<ReturnType<typeof fetchDashScheduleSource>>,
  dynamoResult: Awaited<ReturnType<typeof fetchDynamoScheduleSource>>,
): SportsProviderResult {
  const liveAstrosPrimary = astrosResult.events
    .filter((event) => event.isHomeOrLocal)
    .map(cloneSportsEvent);
  const liveAstrosLowerPriority = astrosResult.events
    .filter((event) => !event.isHomeOrLocal)
    .map(cloneSportsEvent);
  const liveDashPrimary = dashResult.events
    .filter((event) => event.isHomeOrLocal)
    .map(cloneSportsEvent);
  const liveDashLowerPriority = dashResult.events
    .filter((event) => !event.isHomeOrLocal)
    .map(cloneSportsEvent);
  const liveDynamoPrimary = dynamoResult.events
    .filter((event) => event.isHomeOrLocal)
    .map(cloneSportsEvent);
  const liveDynamoLowerPriority = dynamoResult.events
    .filter((event) => !event.isHomeOrLocal)
    .map(cloneSportsEvent);
  const primarySports = [
    ...liveAstrosPrimary,
    ...liveDashPrimary,
    ...liveDynamoPrimary,
  ];
  const lowerPrioritySports = [
    ...liveAstrosLowerPriority,
    ...liveDashLowerPriority,
    ...liveDynamoLowerPriority,
  ];
  const astrosStatus: SportsSourceStatus = {
    teamId: "houston-astros",
    sourceName: "Houston Astros",
    sourceUrl: ASTROS_SCHEDULE_PAGE,
    status: astrosResult.source === "success" ? "success" : "limited",
    message: astrosResult.message,
    debug: astrosResult.debug,
  };
  const dashStatus: SportsSourceStatus = {
    teamId: "houston-dash",
    sourceName: "Houston Dash",
    sourceUrl: DASH_SCHEDULE_PAGE,
    status: dashResult.source === "success" ? "success" : dashResult.source === "limited" ? "limited" : "failed",
    message: dashResult.message,
    debug: dashResult.debug,
  };
  const dynamoStatus: SportsSourceStatus = {
    teamId: "houston-dynamo-fc",
    sourceName: "Houston Dynamo FC",
    sourceUrl: DYNAMO_SCHEDULE_DOWNLOAD_PAGE,
    status: dynamoResult.source === "success" ? "success" : dynamoResult.source === "limited" ? "limited" : "failed",
    message: dynamoResult.message,
    debug: dynamoResult.debug,
  };
  const statuses = buildRegistryStatuses(astrosStatus, dashStatus, dynamoStatus);
  const liveTeams = [
    astrosResult.source === "success" ? "Astros" : null,
    dashResult.source === "success" ? "Dash" : null,
    dynamoResult.source === "success" ? "Dynamo" : null,
  ].filter((team): team is string => Boolean(team));
  const source: SportsCoverageSummary["source"] = liveTeams.length > 0 ? "mixed" : "mock_fallback";
  const note = buildSportsSourceNote(astrosResult, dashResult, dynamoResult);
  const liveGamesParsedCount = astrosResult.debug.astrosGamesParsed
    + (dashResult.debug.fullDashGamesParsed ?? dashResult.debug.dashGamesParsed ?? 0)
    + (dynamoResult.debug.fullDynamoGamesParsed ?? dynamoResult.debug.gamesParsed ?? 0);
  const homeGamesDisplayedCount = primarySports.length;
  const awayGamesHiddenCount = lowerPrioritySports.length;

  return {
    source,
    note,
    primarySports,
    lowerPrioritySports,
    coverageSummary: buildCoverageSummary(
      source,
      note,
      statuses,
      astrosResult,
      dashResult,
      dynamoResult,
      liveGamesParsedCount,
      homeGamesDisplayedCount,
      awayGamesHiddenCount,
      false,
      primarySports.length === 0 ? "No live local home games found in the current window." : undefined,
    ),
    statuses,
  };
}

export async function getSportsData(): Promise<SportsProviderResult> {
  noStore();

  try {
    const [astrosResult, dashResult, dynamoResult] = await Promise.all([
      fetchAstrosScheduleSource(),
      fetchDashScheduleSource(),
      fetchDynamoScheduleSource(),
    ]);

  if (astrosResult.source === "success" || dashResult.source === "success" || dynamoResult.source === "success") {
      return buildLiveAstrosResult(astrosResult, dashResult, dynamoResult);
    }

    return buildMockSportsResult(
      buildSportsSourceNote(astrosResult, dashResult, dynamoResult),
    );
  } catch (error) {
    void error;
    return buildMockSportsResult(
      "Using mock sports data because the Astros, Dash, and Dynamo live schedules could not be read.",
    );
  }
}
