import { installSourceCache } from "@/lib/source-cache";
import { EVENT_DISPLAY_WINDOW_DAYS } from "@/lib/event-window";
import { HOUSTON_CULTURE_REGISTRY } from "@/lib/culture-registry";
import { addDaysToHoustonDate, filterCultureEvents, getHoustonTodayDate } from "@/lib/culture-date-filter";
import { fetchBlafferSource } from "@/lib/culture-sources/blaffer";
import { fetchBuffaloBayouSource } from "@/lib/culture-sources/buffalo-bayou";
import { fetchCamhSource } from "@/lib/culture-sources/camh";
import { fetchDiscoveryGreenSource } from "@/lib/culture-sources/discovery-green";
import { fetchLawndaleSource } from "@/lib/culture-sources/lawndale";
import { fetchOrangeShowSource } from "@/lib/culture-sources/orange-show";
import { fetchProjectRowHousesSource } from "@/lib/culture-sources/project-row-houses";
import { fetchMenilSource } from "@/lib/culture-sources/menil";
import { fetchMeowWolfSource } from "@/lib/culture-sources/meow-wolf";
import type {
  CultureCoverageSummary,
  CultureProviderResult,
  CultureSourceStatus,
  EventItem,
} from "@/types/dashboard";

installSourceCache();

function dedupeEvents(events: EventItem[]): EventItem[] {
  const byKey = new Map<string, EventItem>();

  for (const event of events) {
    const key = `${event.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}|${event.dateTime.slice(0, 10)}|${event.dateTime.slice(11, 16)}|${event.sourceLabel ?? ""}`;
    byKey.set(key, event);
  }

  return [...byKey.values()];
}

function buildCoverageSummary(
  events: EventItem[],
  statuses: CultureSourceStatus[],
  source: CultureProviderResult["source"],
  sourceSummary: string,
  mergedCoverage?: Partial<CultureCoverageSummary>,
): CultureCoverageSummary {
  const today = getHoustonTodayDate();
  const todayEventsCount = events.filter((event) => event.dateTime.slice(0, 10) === today).length;

  return {
    source,
    trackedSourcesCount: HOUSTON_CULTURE_REGISTRY.filter((entry) => entry.priority !== "candidate").length,
    activeLiveProvidersCount: statuses.filter((status) =>
      status.status === "working" || status.status === "limited" || status.status === "audited_limited"
    ).length,
    notImplementedSourcesCount: HOUSTON_CULTURE_REGISTRY.filter((entry) => entry.providerStatus === "not_implemented").length,
    parsedEventsCount: events.length,
    todayChecked: true,
    todayEventsCount,
    earliestParsedEventDate: events[0]?.dateTime.slice(0, 10),
    latestParsedEventDate: events.at(-1)?.dateTime.slice(0, 10),
    dateWindowStart: mergedCoverage?.dateWindowStart ?? today,
    dateWindowEnd: mergedCoverage?.dateWindowEnd ?? addDaysToHoustonDate(today, EVENT_DISPLAY_WINDOW_DAYS),
    eventCalendarHeadingFound: mergedCoverage?.eventCalendarHeadingFound,
    cleanedLineCount: mergedCoverage?.cleanedLineCount,
    dateHeadingMatches: mergedCoverage?.dateHeadingMatches,
    titleMatches: mergedCoverage?.titleMatches,
    dateTimeMatches: mergedCoverage?.dateTimeMatches,
    hiddenPastEventsCount: mergedCoverage?.hiddenPastEventsCount,
    ongoingEventsDisplayedCount: mergedCoverage?.ongoingEventsDisplayedCount,
    inWindowEventsDisplayedCount: mergedCoverage?.inWindowEventsDisplayedCount,
    note: sourceSummary,
  };
}

function buildNote(statuses: CultureSourceStatus[], results: CultureProviderResult[]): string {
  const workingSources = statuses
    .filter((status) => status.status === "working" || status.status === "limited")
    .map((status) => status.sourceName);
  const auditedLimitedSources = statuses
    .filter((status) => status.status === "audited_limited")
    .map((status) => status.sourceName);
  const sourceNotes = results.map((result) => result.note).filter(Boolean);
  const parts: string[] = ["Using official venue and culture sources where available."];

  if (workingSources.length > 0) {
    parts.push(`Working: ${workingSources.join(", ")}.`);
  }

  if (auditedLimitedSources.length > 0) {
    parts.push(`Audited limited: ${auditedLimitedSources.join(", ")}.`);
  }

  if (workingSources.length === 0 && auditedLimitedSources.length === 0) {
    parts.push("Mock fallback is filling gaps where live events were not found.");
  }

  return [...parts, ...sourceNotes].join(" ");
}

export async function getCultureEvents(): Promise<CultureProviderResult> {
  const [menilResult, camhResult, meowWolfResult, discoveryGreenResult, buffaloBayouResult, blafferResult, lawndaleResult, projectRowHousesResult, orangeShowResult] = await Promise.all([
    fetchMenilSource(),
    fetchCamhSource(),
    fetchMeowWolfSource(),
    fetchDiscoveryGreenSource(),
    fetchBuffaloBayouSource(),
    fetchBlafferSource(),
    fetchLawndaleSource(),
    fetchProjectRowHousesSource(),
    fetchOrangeShowSource(),
  ]);

  const primaryStatuses = [
    menilResult.statuses.find((status) => status.sourceName === "Menil") ?? menilResult.statuses[0],
    camhResult.statuses.find((status) => status.sourceName === "CAMH") ?? camhResult.statuses[0],
    meowWolfResult.statuses.find((status) => status.sourceName === "Meow Wolf") ?? meowWolfResult.statuses[0],
    discoveryGreenResult.statuses.find((status) => status.sourceName === "Discovery Green") ?? discoveryGreenResult.statuses[0],
    buffaloBayouResult.statuses.find((status) => status.sourceName === "Buffalo Bayou Partnership") ?? buffaloBayouResult.statuses[0],
    blafferResult.statuses.find((status) => status.sourceName === "Blaffer Art Museum") ?? blafferResult.statuses[0],
    lawndaleResult.statuses.find((status) => status.sourceName === "Lawndale Art Center") ?? lawndaleResult.statuses[0],
    projectRowHousesResult.statuses.find((status) => status.sourceName === "Project Row Houses") ?? projectRowHousesResult.statuses[0],
    orangeShowResult.statuses.find((status) => status.sourceName === "Orange Show") ?? orangeShowResult.statuses[0],
  ].filter(Boolean) as CultureSourceStatus[];
  const statuses = primaryStatuses;
  const combinedEvents = dedupeEvents([
    ...menilResult.events,
    ...camhResult.events,
    ...meowWolfResult.events,
    ...discoveryGreenResult.events,
    ...buffaloBayouResult.events,
    ...blafferResult.events,
    ...lawndaleResult.events,
    ...projectRowHousesResult.events,
    ...orangeShowResult.events,
  ]).sort((left, right) => {
    const dateComparison = left.dateTime.localeCompare(right.dateTime);

    if (dateComparison !== 0) {
      return dateComparison;
    }

    return right.tasteScore - left.tasteScore;
  });
  const filtered = filterCultureEvents(combinedEvents);
  const coverageSources = [
    menilResult.coverageSummary,
    camhResult.coverageSummary,
    meowWolfResult.coverageSummary,
    discoveryGreenResult.coverageSummary,
    buffaloBayouResult.coverageSummary,
    blafferResult.coverageSummary,
    lawndaleResult.coverageSummary,
    projectRowHousesResult.coverageSummary,
    orangeShowResult.coverageSummary,
  ];
  const mergedCoverage: Partial<CultureCoverageSummary> = {
    dateWindowStart: coverageSources.find((coverage) => coverage.dateWindowStart)?.dateWindowStart,
    dateWindowEnd: coverageSources.find((coverage) => coverage.dateWindowEnd)?.dateWindowEnd,
    eventCalendarHeadingFound: coverageSources.some((coverage) => coverage.eventCalendarHeadingFound),
    cleanedLineCount: coverageSources.reduce((total, coverage) => total + (coverage.cleanedLineCount ?? 0), 0),
    dateHeadingMatches: coverageSources.reduce((total, coverage) => total + (coverage.dateHeadingMatches ?? 0), 0),
    titleMatches: coverageSources.reduce((total, coverage) => total + (coverage.titleMatches ?? 0), 0),
    dateTimeMatches: coverageSources.reduce((total, coverage) => total + (coverage.dateTimeMatches ?? 0), 0),
    hiddenPastEventsCount: filtered.hiddenPastEventsCount,
    ongoingEventsDisplayedCount: filtered.ongoingEventsDisplayedCount,
    inWindowEventsDisplayedCount: filtered.inWindowEventsDisplayedCount,
  };
  const hasLiveProvider = statuses.some((status) =>
    status.status === "working" || status.status === "limited" || status.status === "audited_limited"
  );
  const source = hasLiveProvider
    ? "live_provider"
    : filtered.events.length > 0
      ? "mixed"
      : "mock";
  const note = buildNote(statuses, [menilResult, camhResult, meowWolfResult, discoveryGreenResult, buffaloBayouResult, blafferResult, lawndaleResult, projectRowHousesResult, orangeShowResult]);

  return {
    source,
    note,
    events: filtered.events,
    coverageSummary: buildCoverageSummary(
      filtered.events,
      statuses,
      source,
      note,
      mergedCoverage,
    ),
    statuses,
  };
}
