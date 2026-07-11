import styles from "../page.module.css";
import {
  formatSourceCacheSnapshot,
  getSourceCacheSnapshotByUrl,
} from "@/lib/source-cache";
import {
  CONTINENTAL_CLUB_SOURCE_NAME,
  type ContinentalClubSourceDebug,
} from "@/lib/sources/continental-club";
import {
  getEventSourceKey,
  normalizeEventSourceKey,
  type VenueSourceStatus,
} from "@/lib/event-sources";
import { HOUSTON_CULTURE_REGISTRY } from "@/lib/culture-registry";
import {
  HOUSTON_VENUE_REGISTRY,
  type VenueRegistryEntry,
} from "@/lib/venue-registry";
import { HOUSTON_SPORTS_REGISTRY } from "@/lib/sports-registry";
import { THIRD_PARTY_SOURCE_REGISTRY } from "@/lib/third-party-source-registry";
import { getMusicTasteOverrideSummary } from "@/lib/music-taste-overrides";
import { FeedbackHealthPanel } from "./feedback-profile";
import type {
  CultureCoverageSummary,
  CultureRegistryEntry,
  CultureSourceStatus,
  FoodDrinkCoverageSummary,
  OtherEventsCoverageSummary,
  OtherEventsSourceStatus,
  EventItem,
  SportsCoverageSummary,
  SportsRegistryEntry,
  SportsSourceStatus,
} from "@/types/dashboard";

function getStatusBadgeClass(status: string): string {
  switch (status) {
    case "working":
      return styles.sourceBadgeWorking;
    case "limited":
    case "audited limited":
    case "audited_limited":
    case "blocked":
      return styles.sourceBadgeLimited;
    case "failed":
      return styles.sourceBadgeFailed;
    case "not implemented":
    case "inactive":
      return styles.sourceBadgeNeutral;
    case "no events today":
      return styles.sourceBadgeSubtle;
    default:
      return styles.sourceBadgeNeutral;
  }
}

function getUrlCacheSummary(urls: Array<string | null | undefined>): string {
  for (const url of urls) {
    if (!url) {
      continue;
    }

    const snapshot = getSourceCacheSnapshotByUrl(url);

    if (snapshot) {
      return formatSourceCacheSnapshot(snapshot) ?? "Not reported";
    }
  }

  return "Not reported";
}

function getFirstDebugUrl(value: unknown): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const urlsChecked = (value as { urlsChecked?: unknown }).urlsChecked;

  if (Array.isArray(urlsChecked) && typeof urlsChecked[0] === "string") {
    return urlsChecked[0];
  }

  const urlChecked = (value as { urlChecked?: unknown }).urlChecked;

  if (typeof urlChecked === "string") {
    return urlChecked;
  }

  return null;
}

function getParsedCount(status?: VenueSourceStatus): number | null {
  const debug = status?.debug;

  if (!debug || !("parsedValidEvents" in debug) || typeof debug.parsedValidEvents !== "number") {
    return null;
  }

  return debug.parsedValidEvents;
}

function getTodayChecked(status?: VenueSourceStatus): string {
  const debug = status?.debug;

  if (!debug || !("todayChecked" in debug)) {
    return "Not reported";
  }

  return debug.todayChecked ? "Yes" : "No";
}

function getTodayEventsFound(status?: VenueSourceStatus): string {
  const debug = status?.debug;

  if (!debug || !("todayHadEvents" in debug)) {
    return "Not reported";
  }

  return debug.todayHadEvents ? "Yes" : "No";
}

function getPrimaryHealthLabel(
  venue: VenueRegistryEntry,
  status?: VenueSourceStatus,
): string {
  if (venue.parserStatus === "not_implemented") {
    return "not implemented";
  }

  if (!status) {
    return venue.parserStatus === "limited" ? "limited" : "Not reported";
  }

  if (status.status === "failed") {
    return "failed";
  }

  if (venue.parserStatus === "limited") {
    return "limited";
  }

  return "working";
}

function getSecondaryHealthLabel(status?: VenueSourceStatus): string | null {
  const debug = status?.debug;

  if (!debug || !("todayChecked" in debug) || !debug.todayChecked) {
    return null;
  }

  return debug.todayHadEvents ? null : "no events today";
}

function getSourceTierLabel(status?: VenueSourceStatus): string | null {
  if (status?.sourceTier !== "third_party") {
    return null;
  }

  if (status.sourceDisclosure) {
    return status.sourceDisclosure;
  }

  return `Third-party listing${status.thirdPartySourceName ? `: ${status.thirdPartySourceName}` : ""}`;
}

function getParsedInWindowCount(status?: VenueSourceStatus): number | null {
  return getDebugNumberByKeys(status, [
    "displayedInWindowShows",
    "displayedInWindowShowsCount",
    "displayedInWindowEventsCount",
    "displayedInWindowCount",
    "timelyInWindowCount",
    "inWindowShowsCount",
    "inWindowEventsDisplayedCount",
    "visibleUpcomingShowsCount",
  ]);
}

function getCultureParsedCount(status?: CultureSourceStatus): number | null {
  const debug = status?.debug;

  if (!debug || typeof debug.parsedValidEvents !== "number") {
    return null;
  }

  return debug.parsedValidEvents;
}

function getCultureTodayChecked(status?: CultureSourceStatus): string {
  const debug = status?.debug;

  if (!debug || typeof debug.todayChecked !== "boolean") {
    return "Not reported";
  }

  return debug.todayChecked ? "Yes" : "No";
}

function getCultureTodayEventsFound(status?: CultureSourceStatus): string {
  const debug = status?.debug;

  if (!debug || typeof debug.todayEventsCount !== "number") {
    return "Not reported";
  }

  return debug.todayEventsCount > 0 ? "Yes" : "No";
}

function getCultureTodayEventsCount(status?: CultureSourceStatus): number | null {
  const debug = status?.debug;

  if (!debug || typeof debug.todayEventsCount !== "number") {
    return null;
  }

  return debug.todayEventsCount;
}

function getCultureUrlsChecked(status?: CultureSourceStatus): string {
  const debug = status?.debug;

  if (!debug || !Array.isArray(debug.urlsChecked) || debug.urlsChecked.length === 0) {
    return "Not reported";
  }

  return debug.urlsChecked.join(" · ");
}

function getCultureCacheSummary(status?: CultureSourceStatus, fallbackUrl?: string | null): string {
  const debug = status?.debug as { urlsChecked?: string[] } | undefined;
  return getUrlCacheSummary([
    ...(Array.isArray(debug?.urlsChecked) ? debug.urlsChecked : []),
    fallbackUrl,
  ]);
}

function getVenueResponseStatus(status?: VenueSourceStatus): string {
  const debug = status?.debug as { responseStatuses?: Record<string, number | null>; responseStatus?: number } | undefined;

  if (!debug) {
    return "Not reported";
  }

  if (
    status?.sourceName === CONTINENTAL_CLUB_SOURCE_NAME &&
    typeof (status.debug as ContinentalClubSourceDebug | undefined)?.timelyPagesFetched === "number"
  ) {
    const timelyDebug = status.debug as ContinentalClubSourceDebug;
    const labels: string[] = [];

    const timelyEntries = Object.entries(timelyDebug.timelyResponseStatuses ?? timelyDebug.responseStatuses ?? {});

    timelyEntries.forEach(([, value], index) => {
      labels.push(`${index === 0 ? "official page" : `page ${index}`}: ${value}`);
    });

    if (labels.length > 0) {
      return labels.join(" · ");
    }
  }

  if (debug.responseStatuses && Object.keys(debug.responseStatuses).length > 0) {
    return Object.entries(debug.responseStatuses)
      .map(([label, value]) => `${label}: ${value}`)
      .join(" · ");
  }

  if (typeof debug.responseStatus === "number") {
    return String(debug.responseStatus);
  }

  return "Not reported";
}

function getCultureDisplayNote(
  entry: CultureRegistryEntry,
  status?: CultureSourceStatus,
): string {
  if (!status) {
    return entry.notes ?? "Not reported";
  }

  if (status.status === "audited_limited") {
    return status.message || entry.notes || "Audited-limited source.";
  }

  if (status.status === "limited") {
    return status.message || entry.notes || "Limited source.";
  }

  if (status.status === "working") {
    return status.message || entry.notes || "Working source.";
  }

  return status.message || entry.notes || "Not reported";
}

function getCultureRollupSummary(coverage: CultureCoverageSummary): string {
  return [
    `tracked sources: ${coverage.trackedSourcesCount}`,
    `active providers: ${coverage.activeLiveProvidersCount}`,
    `audited limited: ${HOUSTON_CULTURE_REGISTRY.filter((entry) => entry.providerStatus === "audited_limited").length}`,
    `in-window displayed: ${coverage.inWindowEventsDisplayedCount ?? 0}`,
    `hidden past: ${coverage.hiddenPastEventsCount ?? 0}`,
  ].join(" · ");
}

function getCultureResponseStatus(status?: CultureSourceStatus): string {
  const debug = status?.debug;

  if (!debug) {
    return "Not reported";
  }

  if (debug.responseStatuses && Object.keys(debug.responseStatuses).length > 0) {
    return Object.entries(debug.responseStatuses)
      .map(([label, value]) => `${label}: ${value}`)
      .join(" · ");
  }

  if (typeof debug.responseStatus === "number") {
    return String(debug.responseStatus);
  }

  return "Not reported";
}

function getCultureResponseCode(status?: CultureSourceStatus): number | null {
  const debug = status?.debug as { responseStatus?: unknown; responseStatuses?: Record<string, unknown> } | undefined;

  if (typeof debug?.responseStatus === "number") {
    return debug.responseStatus;
  }

  if (debug?.responseStatuses) {
    for (const value of Object.values(debug.responseStatuses)) {
      if (typeof value === "number") {
        return value;
      }
    }
  }

  return null;
}

function getCultureFetchStateLabel(entry: CultureRegistryEntry, status?: CultureSourceStatus): string | null {
  const responseCode = getCultureResponseCode(status);

  if (responseCode === 403) {
    return "blocked";
  }

  if (status?.status === "failed") {
    return "failed";
  }

  if (entry.providerStatus === "audited_limited" || status?.status === "audited_limited") {
    return "audited limited";
  }

  if (entry.providerStatus === "limited" || status?.status === "limited") {
    return "limited";
  }

  return null;
}

function getCulturePrimaryLabel(
  venue: CultureRegistryEntry,
  status?: CultureSourceStatus,
): string {
  if (venue.providerStatus === "not_implemented") {
    return "not implemented";
  }

  if (venue.providerStatus === "audited_limited") {
    return "audited limited";
  }

  if (!status) {
    return venue.providerStatus === "limited" ? "limited" : "Not reported";
  }

  if (status.status === "failed") {
    return "failed";
  }

  if (
    status.status === "limited" ||
    status.status === "audited_limited" ||
    venue.providerStatus === "limited"
  ) {
    return "limited";
  }

  return "working";
}

function buildCultureRows(statuses: CultureSourceStatus[]) {
  const statusByName = new Map(statuses.map((status) => [status.sourceName, status]));

  return HOUSTON_CULTURE_REGISTRY.filter((entry) => entry.priority !== "candidate").map((entry) => {
    const status = statusByName.get(entry.displayName);

    return {
      entry,
      status,
      primaryLabel: getCulturePrimaryLabel(entry, status),
      fetchStateLabel: getCultureFetchStateLabel(entry, status),
      sourceLabel: entry.shortName ?? entry.displayName,
      priorityLabel: entry.priority === "priority" ? "priority tracked" : "mandatory",
      parsedCount: getCultureParsedCount(status),
      todayChecked: getCultureTodayChecked(status),
      todayEventsFound: getCultureTodayEventsFound(status),
      todayEventsCount: getCultureTodayEventsCount(status),
      hiddenPastEventsCount: status?.debug?.hiddenPastEventsCount,
      note: getCultureDisplayNote(entry, status),
      sourceUrl: entry.eventSourceUrl ?? entry.officialUrl,
      responseStatus: getCultureResponseStatus(status),
      urlsChecked: getCultureUrlsChecked(status),
      cacheSummary: getCultureCacheSummary(status, entry.eventSourceUrl ?? entry.officialUrl),
      dateWindowStart: status?.debug?.dateWindowStart ?? "Not reported",
      dateWindowEnd: status?.debug?.dateWindowEnd ?? "Not reported",
      eventCalendarHeadingFound: status?.debug?.eventCalendarHeadingFound ? "Yes" : "No",
      cleanedLineCount: status?.debug?.cleanedLineCount ?? "Not reported",
      dateHeadingMatches: status?.debug?.dateHeadingMatches ?? "Not reported",
      titleMatches: status?.debug?.titleMatches ?? "Not reported",
      dateTimeMatches: status?.debug?.dateTimeMatches ?? "Not reported",
    };
  });
}

function buildCultureCandidateRows(statuses: CultureSourceStatus[]) {
  const statusByName = new Map(statuses.map((status) => [status.sourceName, status]));

  return HOUSTON_CULTURE_REGISTRY.filter((entry) => entry.priority === "candidate").map((entry) => {
    const status = statusByName.get(entry.displayName);

    return {
      entry,
      status,
      primaryLabel: getCulturePrimaryLabel(entry, status),
      note: getCultureDisplayNote(entry, status),
      sourceUrl: entry.eventSourceUrl ?? entry.officialUrl,
      priorityLabel: "candidate",
    };
  });
}

const futureVenueRows = HOUSTON_VENUE_REGISTRY.filter(
  (venue) => venue.priority !== "mandatory",
);

function getSportsPrimaryLabel(team: SportsRegistryEntry, status?: SportsSourceStatus): string {
  const teamStatus = String(team.providerStatus);
  const liveStatus = String(status?.status ?? "");

  if (teamStatus === "inactive" || status?.isInactive) {
    return "inactive";
  }

  if (teamStatus === "audited_limited") {
    return "audited limited";
  }

  if (status) {
    return liveStatus === "success" || liveStatus === "working"
      ? "working"
      : liveStatus === "limited"
        ? "limited"
        : liveStatus === "audited_limited"
          ? "audited limited"
        : liveStatus === "failed"
          ? "failed"
          : "not implemented";
  }

  if (teamStatus === "audited_limited") {
    return "audited limited";
  }

  return team.providerStatus === "not_implemented"
    ? "not implemented"
    : team.providerStatus;
}

function buildSportsRows(statuses: SportsSourceStatus[]) {
  const statusById = new Map(statuses.map((status) => [status.teamId, status]));

  return HOUSTON_SPORTS_REGISTRY.map((team) => ({
    team,
    status: statusById.get(team.id),
    primaryLabel: getSportsPrimaryLabel(team, statusById.get(team.id)),
    sourceUrl: team.scheduleUrl ?? team.officialUrl,
    cacheSummary: getSportsCacheSummary(statusById.get(team.id), team.scheduleUrl ?? team.officialUrl),
    note: statusById.get(team.id)?.message
      ?? team.notes
      ?? "Needs source audit before live provider implementation.",
  }));
}

function getDashCount(status?: SportsSourceStatus, key?: string): number | null {
  const debug = status?.debug;

  if (!debug || !key || !(key in debug)) {
    return null;
  }

  const value = (debug as unknown as Record<string, unknown>)[key];

  return typeof value === "number" ? value : null;
}

function getDashLabel(status?: SportsSourceStatus, key?: string): string | null {
  const debug = status?.debug;

  if (!debug || !key || !(key in debug)) {
    return null;
  }

  const value = (debug as unknown as Record<string, unknown>)[key];

  return typeof value === "string" && value.trim() ? value : null;
}

function getDashBoolean(status?: SportsSourceStatus, key?: string): boolean | null {
  const debug = status?.debug;

  if (!debug || !key || !(key in debug)) {
    return null;
  }

  const value = (debug as unknown as Record<string, unknown>)[key];

  return typeof value === "boolean" ? value : null;
}

function getSportsCacheSummary(status?: SportsSourceStatus, fallbackUrl?: string | null): string {
  const debug = status?.debug as { urlChecked?: string } | undefined;

  return getUrlCacheSummary([
    debug?.urlChecked,
    fallbackUrl,
  ]);
}

function getOtherEventsParsedCount(status?: OtherEventsSourceStatus): number | null {
  const debug = status?.debug;

  if (!debug || typeof debug.parsedValidEvents !== "number") {
    return null;
  }

  return debug.parsedValidEvents;
}

function getOtherEventsTodayChecked(status?: OtherEventsSourceStatus): string {
  const debug = status?.debug;

  if (!debug || typeof debug.todayChecked !== "boolean") {
    return "Not reported";
  }

  return debug.todayChecked ? "Yes" : "No";
}

function getOtherEventsResponseStatus(status?: OtherEventsSourceStatus): string {
  const debug = status?.debug;

  if (!debug) {
    return "Not reported";
  }

  if (debug.responseStatuses && Object.keys(debug.responseStatuses).length > 0) {
    return Object.entries(debug.responseStatuses)
      .map(([label, value]) => `${label}: ${value}`)
      .join(" · ");
  }

  if (typeof debug.responseStatus === "number") {
    return String(debug.responseStatus);
  }

  return "Not reported";
}

function getOtherEventsCacheSummary(status?: OtherEventsSourceStatus): string {
  const debug = status?.debug;

  if (!debug || !Array.isArray(debug.urlsChecked) || debug.urlsChecked.length === 0) {
    return "Not reported";
  }

  return getUrlCacheSummary(debug.urlsChecked);
}

function getTheEndDebugCount(key: string, status?: VenueSourceStatus): number | null {
  const debug = status?.debug;

  if (!debug || !("sourceName" in status) || status.sourceName !== "The End") {
    return null;
  }

  if (!(key in debug)) {
    return null;
  }

  const value = (debug as unknown as Record<string, unknown>)[key];

  return typeof value === "number" ? value : null;
}

function getDebugNumber(status?: VenueSourceStatus, key?: string): number | null {
  const debug = status?.debug;

  if (!debug || !key || !(key in debug)) {
    return null;
  }

  const value = (debug as unknown as Record<string, unknown>)[key];

  return typeof value === "number" ? value : null;
}

function getDebugNumberByKeys(status: VenueSourceStatus | undefined, keys: string[]): number | null {
  if (!status?.debug) {
    return null;
  }

  for (const key of keys) {
    const value = getDebugNumber(status, key);

    if (typeof value === "number") {
      return value;
    }
  }

  return null;
}

function getDebugStringByKeys(status: VenueSourceStatus | undefined, keys: string[]): string | null {
  if (!status?.debug) {
    return null;
  }

  for (const key of keys) {
    if (!(key in status.debug)) {
      continue;
    }

    const value = (status.debug as unknown as Record<string, unknown>)[key];

    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }

  return null;
}

function getDebugStringArray(status?: VenueSourceStatus, key?: string): string[] | null {
  const debug = status?.debug;

  if (!debug || !key || !(key in debug)) {
    return null;
  }

  const value = (debug as unknown as Record<string, unknown>)[key];

  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value as string[]
    : null;
}

function getVenueResponseCode(status?: VenueSourceStatus): number | null {
  const debug = status?.debug as { responseStatus?: unknown; responseStatuses?: Record<string, unknown> } | undefined;

  if (typeof debug?.responseStatus === "number") {
    return debug.responseStatus;
  }

  if (debug?.responseStatuses) {
    for (const value of Object.values(debug.responseStatuses)) {
      if (typeof value === "number") {
        return value;
      }
    }
  }

  return null;
}

function getVenueFetchStateLabel(venue: VenueRegistryEntry, status?: VenueSourceStatus): string | null {
  const responseCode = getVenueResponseCode(status);

  if (responseCode === 403) {
    return "blocked";
  }

  if (status?.status === "failed") {
    return "failed";
  }

  if (venue.parserStatus === "limited") {
    return "limited";
  }

  return null;
}

function getRenderedMusicEventsForVenue(
  musicEvents: EventItem[],
  venueName: string,
): EventItem[] {
  const target = normalizeEventSourceKey(venueName);

  return musicEvents.filter((event) => {
    return getEventSourceKey(event) === target;
  });
}

function getRenderedOtherEventsForVenue(
  otherEvents: EventItem[],
  venueName: string,
): EventItem[] {
  const target = normalizeEventSourceKey(venueName);

  return otherEvents.filter((event) => {
    return getEventSourceKey(event) === target;
  });
}

function getTheEndMusicEvents(musicEvents: EventItem[]): EventItem[] {
  return getRenderedMusicEventsForVenue(musicEvents, "The End");
}

function hasText(value?: string): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function countMusicMetadataFields(event: EventItem): number {
  return [
    event.supportActs,
    event.subtitle,
    event.description,
    event.rawGenre,
    event.price,
    event.ageRestriction,
    event.room,
  ].filter(hasText).length;
}

function buildMusicMetadataSummary(events: EventItem[]): {
  explicitGenreRows: number;
  supportActRows: number;
  descriptionSubtitleRows: number;
  titleOnlyRows: number;
  enrichedMetadataRows: number;
  genericLiveMusicOnlyRows: number;
} {
  const explicitGenreRows = events.filter((event) => hasText(event.rawGenre)).length;
  const supportActRows = events.filter((event) => hasText(event.supportActs)).length;
  const descriptionSubtitleRows = events.filter((event) => hasText(event.description) || hasText(event.subtitle)).length;
  const enrichedMetadataRows = events.filter((event) => countMusicMetadataFields(event) >= 2).length;
  const titleOnlyRows = events.filter((event) => countMusicMetadataFields(event) === 0).length;
  const genericLiveMusicOnlyRows = events.filter(
    (event) => countMusicMetadataFields(event) === 0 && event.genreTags?.length === 1 && event.genreTags[0] === "live music",
  ).length;

  return {
    explicitGenreRows,
    supportActRows,
    descriptionSubtitleRows,
    titleOnlyRows,
    enrichedMetadataRows,
    genericLiveMusicOnlyRows,
  };
}

function buildActiveSourceRows(
  statuses: VenueSourceStatus[],
  musicEvents: EventItem[],
  musicLowPriorityEvents: EventItem[],
  otherEvents: EventItem[],
) {
  const statusByName = new Map(statuses.map((status) => [status.sourceName, status]));

  const activeVenues = HOUSTON_VENUE_REGISTRY.filter(
    (venue) => venue.providerId !== null && venue.parserStatus !== "not_implemented",
  );

  return activeVenues.map((venue) => {
    const status = statusByName.get(venue.displayName);
    const renderedMusicEvents = [
      ...getRenderedMusicEventsForVenue(musicEvents, venue.displayName),
      ...getRenderedMusicEventsForVenue(musicLowPriorityEvents, venue.displayName),
    ];
    const renderedOtherEvents = getRenderedOtherEventsForVenue(otherEvents, venue.displayName);
    const visibleMusicEvents = renderedMusicEvents.filter((event) => !event.hiddenReason);
    const lowPriorityMusicEvents = renderedMusicEvents.filter((event) => Boolean(event.hiddenReason));
    const visibleOtherEvents = renderedOtherEvents.filter((event) => !event.hiddenReason);
    const lowPriorityOtherEvents = renderedOtherEvents.filter((event) => Boolean(event.hiddenReason));
    const visibleTitles = [...visibleMusicEvents, ...visibleOtherEvents]
      .map((event) => event.title)
      .filter((title, index, titles) => titles.indexOf(title) === index);
    const parsedInWindowCount = getParsedInWindowCount(status);
    const renderedCount = visibleMusicEvents.length + lowPriorityMusicEvents.length + visibleOtherEvents.length + lowPriorityOtherEvents.length;
      const renderContractWarning = status?.status !== "failed"
      && typeof parsedInWindowCount === "number"
      && parsedInWindowCount > 0
      && renderedCount === 0
      ? `${venue.displayName}: Parsed events are not entering rendered arrays; check merge/category/date/source-key normalization.`
      : null;
    const fetchStateLabel = getVenueFetchStateLabel(venue, status);

    return {
      venue,
      status,
      primaryLabel: getPrimaryHealthLabel(venue, status),
      secondaryLabel: getSecondaryHealthLabel(status),
      sourceTierLabel: getSourceTierLabel(status),
      parsedCount: getParsedCount(status),
      todayChecked: getTodayChecked(status),
      todayEventsFound: getTodayEventsFound(status),
      cacheSummary: getUrlCacheSummary([
        getFirstDebugUrl(status?.debug),
        venue.eventSourceUrl ?? venue.officialUrl,
      ]),
      note: status?.message ?? venue.notes ?? "Not reported",
      sourceUrl: venue.eventSourceUrl ?? venue.officialUrl,
      visibleMusicCount: visibleMusicEvents.length,
      lowPriorityMusicCount: lowPriorityMusicEvents.length,
      visibleMusicTitles: visibleMusicEvents.map((event) => event.title),
      lowPriorityMusicTitles: lowPriorityMusicEvents.map((event) => event.title),
      visibleOtherCount: visibleOtherEvents.length,
      lowPriorityOtherCount: lowPriorityOtherEvents.length,
      lowPriorityOtherTitles: lowPriorityOtherEvents.map((event) => event.title),
      visibleTitles,
      earliestEventDate: getDebugStringByKeys(status, ["earliestEventDate", "earliestParsedEventDate"]),
      latestEventDate: getDebugStringByKeys(status, ["latestEventDate", "latestParsedEventDate"]),
      skippedReasons: getDebugStringArray(status, "skippedReasons"),
      parsedInWindowCount,
      renderContractWarning,
      fetchStateLabel,
    };
  });
}

function buildThirdPartyRows(statuses: VenueSourceStatus[]) {
  const registryByName = new Map(
    THIRD_PARTY_SOURCE_REGISTRY.map((entry) => [entry.venueName, entry]),
  );

  return statuses
    .filter((status) => status.sourceTier === "third_party")
    .filter((status) => registryByName.get(status.sourceName)?.enabled ?? true)
    .map((status) => ({
      status,
      sourceTierLabel: getSourceTierLabel(status),
      parsedCount: getParsedCount(status),
      todayChecked: getTodayChecked(status),
      todayEventsFound: getTodayEventsFound(status),
      cacheSummary: getUrlCacheSummary([getFirstDebugUrl(status.debug), status.sourceUrl]),
      visibleMusicCount: getDebugNumber(status, "visibleMusicCount"),
      lowPriorityMusicCount: getDebugNumber(status, "lowPriorityMusicCount"),
      visibleOtherCount: getDebugNumber(status, "visibleOtherCount"),
      lowPriorityOtherCount: getDebugNumber(status, "lowPriorityOtherCount"),
      visibleTitles: getDebugStringArray(status, "visibleTitles"),
      lowPriorityMusicTitles: getDebugStringArray(status, "lowPriorityMusicTitles"),
      lowPriorityOtherTitles: getDebugStringArray(status, "lowPriorityOtherTitles"),
      earliestEventDate: getDebugStringByKeys(status, ["earliestEventDate", "earliestParsedEventDate"]),
      latestEventDate: getDebugStringByKeys(status, ["latestEventDate", "latestParsedEventDate"]),
      skippedReasons: getDebugStringArray(status, "skippedReasons"),
      parsedInWindowCount: getParsedInWindowCount(status),
      renderContractWarning: status.status !== "failed" && (getParsedInWindowCount(status) ?? 0) > 0 && getRenderedCount(status) === 0
        ? "Parsed events are not entering rendered arrays; check merge/category/date/source-key normalization."
        : null,
    }));
}

function getRenderedCount(status: VenueSourceStatus): number {
  return (
    (getDebugNumber(status, "visibleMusicCount") ?? 0) +
    (getDebugNumber(status, "lowPriorityMusicCount") ?? 0) +
    (getDebugNumber(status, "visibleOtherCount") ?? 0) +
    (getDebugNumber(status, "lowPriorityOtherCount") ?? 0)
  );
}

export function SourceHealth({
  cultureCoverage,
  cultureStatuses,
  foodDrinkCoverage,
  otherCoverage,
  otherStatuses,
  musicEvents,
  musicFallbackPromotedEvents = [],
  musicLowPriorityEvents = [],
  cultureEvents = [],
  otherEvents,
  statuses,
  sportsCoverage,
  sportsStatuses,
  todayRollup,
}: {
  cultureCoverage: CultureCoverageSummary;
  cultureStatuses: CultureSourceStatus[];
  foodDrinkCoverage: FoodDrinkCoverageSummary;
  otherCoverage: OtherEventsCoverageSummary;
  otherStatuses: OtherEventsSourceStatus[];
  musicEvents: EventItem[];
  musicFallbackPromotedEvents?: EventItem[];
  musicLowPriorityEvents?: EventItem[];
  cultureEvents?: EventItem[];
  otherEvents: EventItem[];
  statuses: VenueSourceStatus[];
  sportsCoverage: SportsCoverageSummary;
  sportsStatuses: SportsSourceStatus[];
  todayRollup?: {
    music: number;
    sports: number;
    arts: number;
    other: number;
    foodDrink: number;
  };
}) {
  const activeRows = buildActiveSourceRows(statuses, musicEvents, musicLowPriorityEvents, otherEvents);
  const thirdPartyRows = buildThirdPartyRows(statuses);
  const cultureRows = buildCultureRows(cultureStatuses);
  const cultureCandidateRows = buildCultureCandidateRows(cultureStatuses);
  const foodDrinkSourceLabel = foodDrinkCoverage.source === "local_capacities_export"
    ? "local Capacities export"
    : "mock fallback";
  const sportsRows = buildSportsRows(sportsStatuses);
  const visibleMusicEvents = musicEvents.filter((event) => !event.hiddenReason);
  const renderedMusicEvents = [...musicEvents, ...musicLowPriorityEvents];
  const musicMetadataSummary = buildMusicMetadataSummary(renderedMusicEvents);
  const musicTasteOverrideSummary = getMusicTasteOverrideSummary(renderedMusicEvents);
  const otherRows = otherStatuses.map((status) => ({
    status,
    visibleOtherEvents: getRenderedOtherEventsForVenue(otherEvents, status.sourceName).filter((event) => !event.hiddenReason),
    lowPriorityOtherEvents: getRenderedOtherEventsForVenue(otherEvents, status.sourceName).filter((event) => Boolean(event.hiddenReason)),
    visibleMusicEvents: getRenderedMusicEventsForVenue(musicEvents, status.sourceName).filter((event) => !event.hiddenReason),
    lowPriorityMusicEvents: getRenderedMusicEventsForVenue(musicEvents, status.sourceName).filter((event) => Boolean(event.hiddenReason)),
  }));
  const theEndVisibleMusicEvents = getTheEndMusicEvents(musicEvents);
  const theEndStatus = activeRows.find((row) => row.venue.displayName === "The End")?.status;
  const otherSourceLabel = otherCoverage.source === "live_provider"
    ? "live provider"
    : otherCoverage.source === "mixed"
      ? "mixed"
      : "mock fallback";
  const cultureSourceLabel = cultureCoverage.source === "live_provider"
    ? "live provider"
    : cultureCoverage.source === "mixed"
      ? "live + candidates"
      : "mock fallback";
  const sportsSourceLabel = sportsCoverage.source === "live_provider"
    ? "live provider"
    : sportsCoverage.source === "mixed"
      ? "live + mock"
      : "mock fallback";
  const activeSportsCount = sportsCoverage.trackedTeamsCount
    - (sportsCoverage.auditedLimitedTeamsCount ?? 0)
    - (sportsCoverage.inactiveTeamsCount ?? 0);
  const mainSportsSummary = `${sportsCoverage.liveGamesParsedCount ?? sportsCoverage.parsedGamesCount} live games parsed · ${sportsCoverage.homeGamesDisplayedCount ?? sportsCoverage.homeGamesCount} home games displayed · ${sportsCoverage.awayGamesHiddenCount ?? 0} away games hidden`;

  return (
    <div className={styles.sourceHealthSection}>
      <div className={styles.sourceHealthGroup}>
        <h3 className={styles.sourceHealthHeading}>Active event sources</h3>
        <div className={styles.sourceHealthList}>
          {todayRollup ? (
            <article className={styles.sourceHealthRow}>
              <div className={styles.sourceHealthTopRow}>
                <div className={styles.sourceHealthNameBlock}>
                  <h4>Today&apos;s cross-category rollup</h4>
                  <div className={styles.sourceHealthBadges}>
                    <span className={`${styles.sourceHealthBadge} ${styles.sourceBadgeSubtle}`}>
                      music: {todayRollup.music}
                    </span>
                    <span className={`${styles.sourceHealthBadge} ${styles.sourceBadgeSubtle}`}>
                      sports: {todayRollup.sports}
                    </span>
                    <span className={`${styles.sourceHealthBadge} ${styles.sourceBadgeSubtle}`}>
                      arts: {todayRollup.arts}
                    </span>
                    <span className={`${styles.sourceHealthBadge} ${styles.sourceBadgeSubtle}`}>
                      other: {todayRollup.other}
                    </span>
                    <span className={`${styles.sourceHealthBadge} ${styles.sourceBadgeSubtle}`}>
                      food/drink: {todayRollup.foodDrink}
                    </span>
                  </div>
                </div>
              </div>

              <p className={styles.sourceHealthNote}>
                Today&apos;s Events is now a cross-category feed, and today-relevant Food &amp; Drink specials from the local Capacities export can surface there too.
              </p>
            </article>
          ) : null}

          {activeRows.map((row) => (
            <article className={styles.sourceHealthRow} key={row.venue.id}>
              <div className={styles.sourceHealthTopRow}>
                <div className={styles.sourceHealthNameBlock}>
                  <h4>{row.venue.displayName}</h4>
                  <div className={styles.sourceHealthBadges}>
                    <span className={`${styles.sourceHealthBadge} ${getStatusBadgeClass(row.primaryLabel)}`}>
                      {row.primaryLabel}
                    </span>
                    {row.fetchStateLabel ? (
                      <span className={`${styles.sourceHealthBadge} ${styles.sourceBadgeSubtle}`}>
                        {row.fetchStateLabel}
                      </span>
                    ) : null}
                    {row.secondaryLabel ? (
                      <span className={`${styles.sourceHealthBadge} ${getStatusBadgeClass(row.secondaryLabel)}`}>
                        {row.secondaryLabel}
                      </span>
                    ) : null}
                    {row.sourceTierLabel ? (
                      <span className={`${styles.sourceHealthBadge} ${styles.sourceBadgeSubtle}`}>
                        {row.sourceTierLabel}
                      </span>
                    ) : null}
                  </div>
                </div>
                {row.sourceUrl ? (
                  <a
                    className={styles.sourceHealthLink}
                    href={row.sourceUrl}
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    Source
                  </a>
                ) : null}
              </div>

              <div className={styles.sourceHealthMeta}>
                <span>Response: {getVenueResponseStatus(row.status)}</span>
                <span>Events parsed: {row.parsedCount ?? "Not reported"}</span>
                <span>Today checked: {row.todayChecked}</span>
                <span>Today events: {row.todayEventsFound}</span>
                {getDebugNumber(row.status, "rawEventCandidates") !== null ? (
                  <span>Raw candidates: {getDebugNumber(row.status, "rawEventCandidates")}</span>
                ) : null}
                {getDebugNumber(row.status, "parsedBeforeDedupe") !== null ? (
                  <span>Parsed before dedupe: {getDebugNumber(row.status, "parsedBeforeDedupe")}</span>
                ) : null}
                {getVenueResponseCode(row.status) !== null ? (
                  <span>HTTP status: {getVenueResponseCode(row.status)}</span>
                ) : null}
                {getDebugNumber(row.status, "duplicateRowsRemoved") !== null ? (
                  <span>Duplicates removed: {getDebugNumber(row.status, "duplicateRowsRemoved")}</span>
                ) : null}
                {getDebugNumber(row.status, "hiddenPastShows") !== null ? (
                  <span>Hidden past: {getDebugNumber(row.status, "hiddenPastShows")}</span>
                ) : null}
                {getDebugNumber(row.status, "todayEventCount") !== null ? (
                  <span>Today count: {getDebugNumber(row.status, "todayEventCount")}</span>
                ) : null}
                {typeof row.visibleMusicCount === "number" ? (
                  <span>Visible music: {row.visibleMusicCount}</span>
                ) : null}
                {typeof row.lowPriorityMusicCount === "number" ? (
                  <span>Low-priority music: {row.lowPriorityMusicCount}</span>
                ) : null}
                {typeof row.visibleOtherCount === "number" ? (
                  <span>Visible other: {row.visibleOtherCount}</span>
                ) : null}
                {typeof row.lowPriorityOtherCount === "number" ? (
                  <span>Low-priority other: {row.lowPriorityOtherCount}</span>
                ) : null}
                {typeof row.parsedInWindowCount === "number" ? (
                  <span>Parsed in window: {row.parsedInWindowCount}</span>
                ) : null}
                {getDebugNumber(row.status, "concertRowsParsed") !== null ? (
                  <span>Concert rows: {getDebugNumber(row.status, "concertRowsParsed")}</span>
                ) : null}
                {getDebugNumber(row.status, "otherRowsParsed") !== null ? (
                  <span>Other rows: {getDebugNumber(row.status, "otherRowsParsed")}</span>
                ) : null}
                {getDebugNumber(row.status, "skippedRows") !== null ? (
                  <span>Skipped rows: {getDebugNumber(row.status, "skippedRows")}</span>
                ) : null}
                {row.earliestEventDate ? <span>Earliest parsed event: {row.earliestEventDate}</span> : null}
                {row.latestEventDate ? <span>Latest parsed event: {row.latestEventDate}</span> : null}
                {row.status?.sourceName === CONTINENTAL_CLUB_SOURCE_NAME && row.status.debug && "timelyFeedUrlTemplate" in row.status.debug ? (
                  <span>
                    Timely feed: {(row.status.debug as ContinentalClubSourceDebug).timelyFeedUrlTemplate}
                  </span>
                ) : null}
                {row.status?.sourceName === CONTINENTAL_CLUB_SOURCE_NAME && row.status.debug && "timelyPagesFetched" in row.status.debug ? (
                  <span>
                    Timely pages fetched: {(row.status.debug as ContinentalClubSourceDebug).timelyPagesFetched ?? "Not reported"}
                  </span>
                ) : null}
                {row.status?.sourceName === CONTINENTAL_CLUB_SOURCE_NAME && row.status.debug && "timelyFeedTotal" in row.status.debug ? (
                  <span>
                    Timely feed total: {(row.status.debug as ContinentalClubSourceDebug).timelyFeedTotal ?? "Not reported"}
                  </span>
                ) : null}
                {row.status?.sourceName === CONTINENTAL_CLUB_SOURCE_NAME && row.status.debug && "timelyRawItemsCount" in row.status.debug ? (
                  <span>
                    Timely raw items: {(row.status.debug as ContinentalClubSourceDebug).timelyRawItemsCount ?? "Not reported"}
                  </span>
                ) : null}
                {row.status?.sourceName === CONTINENTAL_CLUB_SOURCE_NAME && row.status.debug && "timelySkippedCount" in row.status.debug ? (
                  <span>
                    Timely skipped: {(row.status.debug as ContinentalClubSourceDebug).timelySkippedCount ?? "Not reported"}
                  </span>
                ) : null}
                {row.status?.sourceName === CONTINENTAL_CLUB_SOURCE_NAME && row.status.debug && "timelyVenueCounts" in row.status.debug ? (
                  <span>
                    Venue counts: Continental Club Houston {(row.status.debug as ContinentalClubSourceDebug).timelyVenueCounts?.continentalClubHouston ?? 0} · Shoeshine Charley&apos;s Big Top Lounge {(row.status.debug as ContinentalClubSourceDebug).timelyVenueCounts?.shoeshineCharleysBigTopLounge ?? 0}
                  </span>
                ) : null}
                {row.visibleTitles?.length ? (
                  <span>Visible titles: {row.visibleTitles.slice(0, 6).join(" · ")}</span>
                ) : row.visibleMusicTitles?.length ? (
                  <span>Visible music titles: {row.visibleMusicTitles.slice(0, 4).join(" · ")}</span>
                ) : null}
                {row.lowPriorityMusicTitles?.length ? (
                  <span>
                    Low-priority music titles: {row.lowPriorityMusicTitles.slice(0, 4).join(" · ")}
                  </span>
                ) : null}
                {row.lowPriorityOtherTitles?.length ? (
                  <span>
                    Low-priority other titles: {row.lowPriorityOtherTitles.slice(0, 4).join(" · ")}
                  </span>
                ) : null}
                {row.skippedReasons?.length ? (
                  <span>Skipped reasons: {row.skippedReasons.slice(0, 4).join(" · ")}</span>
                ) : null}
                {row.status?.debug && "subtypeCounts" in row.status.debug && row.status.debug.subtypeCounts ? (
                  <span>
                    Subtypes: {Object.entries(row.status.debug.subtypeCounts).map(([label, count]) => `${label} ${count}`).join(" · ")}
                  </span>
                ) : null}
                {row.renderContractWarning ? (
                  <span>{row.renderContractWarning}</span>
                ) : null}
                <span>Cache: {row.cacheSummary}</span>
              </div>

            <p className={styles.sourceHealthNote}>{row.note}</p>
          </article>
          ))}
        </div>
      </div>

      {thirdPartyRows.length > 0 ? (
        <div className={styles.sourceHealthGroup}>
          <h3 className={styles.sourceHealthHeading}>Third-party fallback sources</h3>
          <div className={styles.sourceHealthList}>
            {thirdPartyRows.map((row) => (
              <article className={styles.sourceHealthRow} key={row.status.sourceName}>
                <div className={styles.sourceHealthTopRow}>
                  <div className={styles.sourceHealthNameBlock}>
                    <h4>{row.status.sourceName}</h4>
                    <div className={styles.sourceHealthBadges}>
                      <span className={`${styles.sourceHealthBadge} ${styles.sourceBadgeSubtle}`}>
                        {row.sourceTierLabel ?? "Third-party listing"}
                      </span>
                      <span className={`${styles.sourceHealthBadge} ${styles.sourceBadgeSubtle}`}>
                        {row.status.thirdPartySourceName ?? "Third-party"}
                      </span>
                    </div>
                  </div>
                  {row.status.sourceUrl ? (
                    <a
                      className={styles.sourceHealthLink}
                      href={row.status.sourceUrl}
                      rel="noopener noreferrer"
                      target="_blank"
                    >
                      Source
                    </a>
                  ) : null}
                </div>

                <div className={styles.sourceHealthMeta}>
                  <span>Response: {getVenueResponseStatus(row.status)}</span>
                  <span>Source tier: third-party</span>
                  <span>Events parsed: {row.parsedCount ?? "Not reported"}</span>
                  <span>Today checked: {row.todayChecked}</span>
                  <span>Today events: {row.todayEventsFound}</span>
                  {typeof row.visibleMusicCount === "number" ? <span>Visible music: {row.visibleMusicCount}</span> : null}
                  {typeof row.lowPriorityMusicCount === "number" ? <span>Low-priority music: {row.lowPriorityMusicCount}</span> : null}
                  {typeof row.visibleOtherCount === "number" ? <span>Visible other: {row.visibleOtherCount}</span> : null}
                  {typeof row.lowPriorityOtherCount === "number" ? <span>Low-priority other: {row.lowPriorityOtherCount}</span> : null}
                  {typeof row.parsedInWindowCount === "number" ? <span>Parsed in window: {row.parsedInWindowCount}</span> : null}
                  {row.earliestEventDate ? <span>Earliest parsed event: {row.earliestEventDate}</span> : null}
                  {row.latestEventDate ? <span>Latest parsed event: {row.latestEventDate}</span> : null}
                  {row.visibleTitles?.length ? <span>Visible titles: {row.visibleTitles.slice(0, 6).join(" · ")}</span> : null}
                  {row.lowPriorityMusicTitles?.length ? <span>Low-priority music titles: {row.lowPriorityMusicTitles.slice(0, 4).join(" · ")}</span> : null}
                  {row.lowPriorityOtherTitles?.length ? <span>Low-priority other titles: {row.lowPriorityOtherTitles.slice(0, 4).join(" · ")}</span> : null}
                  {row.skippedReasons?.length ? <span>Skipped reasons: {row.skippedReasons.slice(0, 4).join(" · ")}</span> : null}
                  {row.renderContractWarning ? <span>{row.renderContractWarning}</span> : null}
                  <span>Cache: {row.cacheSummary}</span>
                </div>

                <p className={styles.sourceHealthNote}>Official venue calendar unavailable; third-party listing enabled.</p>
              </article>
            ))}
          </div>
        </div>
      ) : null}

      <div className={styles.sourceHealthGroup}>
        <h3 className={styles.sourceHealthHeading}>Music coverage</h3>
        <div className={styles.sourceHealthList}>
          <article className={styles.sourceHealthRow}>
            <div className={styles.sourceHealthTopRow}>
              <div className={styles.sourceHealthNameBlock}>
                <h4>Music section render</h4>
                <div className={styles.sourceHealthBadges}>
                  <span className={`${styles.sourceHealthBadge} ${styles.sourceBadgeNeutral}`}>
                    visible: {visibleMusicEvents.length}
                  </span>
                  <span className={`${styles.sourceHealthBadge} ${styles.sourceBadgeSubtle}`}>
                    low-confidence: {musicLowPriorityEvents.length}
                  </span>
                  <span className={`${styles.sourceHealthBadge} ${styles.sourceBadgeSubtle}`}>
                    fallback-promoted: {musicFallbackPromotedEvents.length}
                  </span>
                </div>
              </div>
            </div>

            <div className={styles.sourceHealthMetaGrid}>
              <span>Rendered visible cards: {visibleMusicEvents.length}</span>
              <span>Rendered low-confidence cards: {musicLowPriorityEvents.length}</span>
              <span>Fallback-promoted cards: {musicFallbackPromotedEvents.length}</span>
              <span>Explicit genre rows: {musicMetadataSummary.explicitGenreRows}</span>
              <span>Support-act rows: {musicMetadataSummary.supportActRows}</span>
              <span>Description/subtitle rows: {musicMetadataSummary.descriptionSubtitleRows}</span>
              <span>Enriched metadata rows: {musicMetadataSummary.enrichedMetadataRows}</span>
              <span>Title-only rows: {musicMetadataSummary.titleOnlyRows}</span>
              <span>Generic live music only rows: {musicMetadataSummary.genericLiveMusicOnlyRows}</span>
              <span>
                Visible titles: {visibleMusicEvents.length > 0
                  ? visibleMusicEvents.slice(0, 6).map((event) => event.title).join(" · ")
                  : musicFallbackPromotedEvents.slice(0, 6).map((event) => event.title).join(" · ") || "Not reported"}
              </span>
            </div>

            <p className={styles.sourceHealthNote}>
              {visibleMusicEvents.length > 0
                ? "Music is showing normal visible picks."
                : "Showing lower-confidence music picks because no stronger matches are in the 30-day window."}
            </p>
          </article>

          <article className={styles.sourceHealthRow}>
            <div className={styles.sourceHealthTopRow}>
              <div className={styles.sourceHealthNameBlock}>
                <h4>Music taste overrides</h4>
                <div className={styles.sourceHealthBadges}>
                  <span className={`${styles.sourceHealthBadge} ${styles.sourceBadgeSubtle}`}>
                    local file: {musicTasteOverrideSummary.localFileFound ? "yes" : "no"}
                  </span>
                  <span className={`${styles.sourceHealthBadge} ${styles.sourceBadgeSubtle}`}>
                    example fallback: {musicTasteOverrideSummary.exampleFallbackUsed ? "yes" : "no"}
                  </span>
                  <span className={`${styles.sourceHealthBadge} ${styles.sourceBadgeNeutral}`}>
                    matched: {musicTasteOverrideSummary.matchedEventsCount}
                  </span>
                </div>
              </div>
            </div>

            <div className={styles.sourceHealthMetaGrid}>
              <span>Artist overrides: {musicTasteOverrideSummary.artistOverridesCount}</span>
              <span>Title-pattern overrides: {musicTasteOverrideSummary.titlePatternOverridesCount}</span>
              <span>Negative matches: {musicTasteOverrideSummary.negativeMatchesCount}</span>
              <span>Invalid entries: {musicTasteOverrideSummary.invalidEntriesCount}</span>
              <span>Matched events: {musicTasteOverrideSummary.matchedEventsCount}</span>
              <span>
                Visible matched titles: {musicTasteOverrideSummary.visibleMatchedTitles.length > 0
                  ? musicTasteOverrideSummary.visibleMatchedTitles.join(" · ")
                  : "Not reported"}
              </span>
            </div>

            <p className={styles.sourceHealthNote}>
              {musicTasteOverrideSummary.warning
                ? `Override warning: ${musicTasteOverrideSummary.warning}`
                : musicTasteOverrideSummary.source === "local"
                  ? "Music is applying the local taste override file."
                  : musicTasteOverrideSummary.source === "example"
                    ? "Music is using the example override file as a fallback."
                    : "No music taste override file is loaded yet."}
            </p>
          </article>

          <FeedbackHealthPanel
            cultureEvents={cultureEvents}
            musicEvents={[...musicEvents, ...musicLowPriorityEvents]}
            otherEvents={otherEvents}
          />
        </div>
      </div>

      {theEndStatus ? (
        <div className={styles.sourceHealthGroup}>
          <h3 className={styles.sourceHealthHeading}>The End visibility</h3>
          <div className={styles.sourceHealthList}>
            <article className={styles.sourceHealthRow}>
              <div className={styles.sourceHealthTopRow}>
                <div className={styles.sourceHealthNameBlock}>
                  <h4>The End</h4>
                  <div className={styles.sourceHealthBadges}>
                    <span className={`${styles.sourceHealthBadge} ${getStatusBadgeClass(theEndStatus.status)}`}>
                      {theEndStatus.status === "failed" ? "failed" : "working"}
                    </span>
                    <span className={`${styles.sourceHealthBadge} ${styles.sourceBadgeSubtle}`}>
                      all events: {getTheEndDebugCount("parsedValidEvents", theEndStatus) ?? "Not reported"}
                    </span>
                  </div>
                </div>
              </div>

              <div className={styles.sourceHealthMetaGrid}>
                <span>The End events in allEvents: {getTheEndDebugCount("parsedValidEvents", theEndStatus) ?? "Not reported"}</span>
                <span>The End events after date filter: {getTheEndDebugCount("displayedInWindowShows", theEndStatus) ?? "Not reported"}</span>
                <span>The End events in music input: {theEndVisibleMusicEvents.length}</span>
                <span>The End events in visible music cards: {theEndVisibleMusicEvents.filter((event) => !event.hiddenReason).length}</span>
                <span>The End events in low-priority music cards: {theEndVisibleMusicEvents.filter((event) => Boolean(event.hiddenReason)).length}</span>
                <span>Visible music titles: {theEndVisibleMusicEvents.slice(0, 4).map((event) => event.title).join(" · ") || "Not reported"}</span>
                <span>Earliest parsed event: {theEndStatus?.debug && "earliestEventDate" in theEndStatus.debug ? theEndStatus.debug.earliestEventDate ?? "Not reported" : "Not reported"}</span>
                <span>Latest parsed event: {theEndStatus?.debug && "latestEventDate" in theEndStatus.debug ? theEndStatus.debug.latestEventDate ?? "Not reported" : "Not reported"}</span>
              </div>

              <p className={styles.sourceHealthNote}>{theEndStatus?.message ?? "The End visibility is being tracked from the live music array."}</p>
            </article>
          </div>
        </div>
      ) : null}

      <div className={styles.sourceHealthGroup}>
        <h3 className={styles.sourceHealthHeading}>Arts &amp; Culture coverage</h3>
        <div className={styles.sourceHealthList}>
          <article className={styles.sourceHealthRow}>
            <div className={styles.sourceHealthTopRow}>
              <div className={styles.sourceHealthNameBlock}>
                <h4>Arts &amp; Culture rollup</h4>
                <div className={styles.sourceHealthBadges}>
                  <span className={`${styles.sourceHealthBadge} ${styles.sourceBadgeNeutral}`}>
                    {cultureSourceLabel}
                  </span>
                  <span className={`${styles.sourceHealthBadge} ${styles.sourceBadgeSubtle}`}>
                    tracked sources: {cultureCoverage.trackedSourcesCount}
                  </span>
                  <span className={`${styles.sourceHealthBadge} ${styles.sourceBadgeSubtle}`}>
                    active providers: {cultureCoverage.activeLiveProvidersCount}
                  </span>
                  <span className={`${styles.sourceHealthBadge} ${styles.sourceBadgeSubtle}`}>
                    audited limited: {HOUSTON_CULTURE_REGISTRY.filter((entry) => entry.providerStatus === "audited_limited").length}
                  </span>
                </div>
              </div>
            </div>

            <div className={styles.sourceHealthMetaGrid}>
              <span>Parsed events: {cultureCoverage.parsedEventsCount}</span>
              <span>Today checked: {cultureCoverage.todayChecked ? "Yes" : "No"}</span>
              <span>Today events: {cultureCoverage.todayEventsCount ?? 0}</span>
              <span>Hidden past: {cultureCoverage.hiddenPastEventsCount ?? 0}</span>
              <span>Ongoing displayed: {cultureCoverage.ongoingEventsDisplayedCount ?? 0}</span>
              <span>In-window displayed: {cultureCoverage.inWindowEventsDisplayedCount ?? 0}</span>
            </div>

            <p className={styles.sourceHealthNote}>{getCultureRollupSummary(cultureCoverage)}</p>
          </article>

          {cultureRows.map((row) => (
            <article className={styles.sourceHealthRow} key={row.entry.id}>
              <div className={styles.sourceHealthTopRow}>
                <div className={styles.sourceHealthNameBlock}>
                  <h4>{row.entry.displayName}</h4>
                <div className={styles.sourceHealthBadges}>
                  <span className={`${styles.sourceHealthBadge} ${getStatusBadgeClass(row.primaryLabel)}`}>
                    {row.primaryLabel}
                  </span>
                  {row.fetchStateLabel ? (
                    <span className={`${styles.sourceHealthBadge} ${getStatusBadgeClass(row.fetchStateLabel)}`}>
                      {row.fetchStateLabel}
                    </span>
                  ) : null}
                  <span className={`${styles.sourceHealthBadge} ${styles.sourceBadgeSubtle}`}>
                    {row.priorityLabel}
                  </span>
                  </div>
                </div>
                {row.sourceUrl ? (
                  <a
                    className={styles.sourceHealthLink}
                    href={row.sourceUrl}
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    Source
                  </a>
                ) : null}
              </div>

              <div className={styles.sourceHealthMetaGrid}>
                <span>Source checked: {row.urlsChecked}</span>
                <span>Response status: {row.responseStatus}</span>
                {getCultureResponseCode(row.status) !== null ? (
                  <span>HTTP status: {getCultureResponseCode(row.status)}</span>
                ) : null}
                <span>Cache: {row.cacheSummary}</span>
                <span>Parsed valid events: {row.parsedCount ?? "Not reported"}</span>
                <span>Today checked: {row.todayChecked}</span>
                <span>Today events: {row.todayEventsCount ?? row.todayEventsFound}</span>
                <span>Hidden past: {typeof row.hiddenPastEventsCount === "number" ? row.hiddenPastEventsCount : "Not reported"}</span>
                <span>Calendar heading: {row.eventCalendarHeadingFound}</span>
                <span>Cleaned lines: {row.cleanedLineCount}</span>
                <span>Date headings: {row.dateHeadingMatches}</span>
              </div>

              <p className={styles.sourceHealthNote}>{row.note}</p>
            </article>
          ))}

          {cultureCandidateRows.map((row) => (
            <article className={styles.sourceHealthRow} key={row.entry.id}>
              <div className={styles.sourceHealthTopRow}>
                <div className={styles.sourceHealthNameBlock}>
                  <h4>{row.entry.displayName}</h4>
                  <div className={styles.sourceHealthBadges}>
                    <span className={`${styles.sourceHealthBadge} ${getStatusBadgeClass(row.primaryLabel)}`}>
                      {row.primaryLabel}
                    </span>
                    <span className={`${styles.sourceHealthBadge} ${styles.sourceBadgeSubtle}`}>
                      {row.priorityLabel}
                    </span>
                  </div>
                </div>
                {row.sourceUrl ? (
                  <a
                    className={styles.sourceHealthLink}
                    href={row.sourceUrl}
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    Source
                  </a>
                ) : null}
              </div>

              <div className={styles.sourceHealthMetaGrid}>
                <span>Category: {row.entry.category}</span>
                <span>Priority: {row.entry.priority.replace("_", " ")}</span>
                <span>Provider: {row.entry.providerId ?? "Not implemented"}</span>
                <span>Official URL: {row.entry.officialUrl ?? "Not reported"}</span>
              </div>

              <p className={styles.sourceHealthNote}>{row.note}</p>
            </article>
          ))}
        </div>
      </div>

      <div className={styles.sourceHealthGroup}>
        <h3 className={styles.sourceHealthHeading}>Food &amp; Drink coverage</h3>
        <div className={styles.sourceHealthList}>
          <article className={styles.sourceHealthRow}>
            <div className={styles.sourceHealthTopRow}>
              <div className={styles.sourceHealthNameBlock}>
                <h4>Food &amp; Drink</h4>
                <div className={styles.sourceHealthBadges}>
                  <span className={`${styles.sourceHealthBadge} ${styles.sourceBadgeNeutral}`}>
                    {foodDrinkSourceLabel}
                  </span>
                  <span className={`${styles.sourceHealthBadge} ${styles.sourceBadgeSubtle}`}>
                    showing today: {foodDrinkCoverage.displayedTodayCount}
                  </span>
                  {todayRollup ? (
                    <span className={`${styles.sourceHealthBadge} ${styles.sourceBadgeSubtle}`}>
                      surfaced in Today&apos;s Events: {todayRollup.foodDrink}
                    </span>
                  ) : null}
                  {foodDrinkCoverage.sourceDetail ? (
                    <span className={`${styles.sourceHealthBadge} ${styles.sourceBadgeSubtle}`}>
                      {foodDrinkCoverage.sourceDetail}
                    </span>
                  ) : null}
                  {foodDrinkCoverage.lastUpdatedLabel ? (
                    <span className={`${styles.sourceHealthBadge} ${styles.sourceBadgeSubtle}`}>
                      Last update: {foodDrinkCoverage.lastUpdatedLabel}
                    </span>
                  ) : null}
                </div>
              </div>
            </div>

            <div className={styles.sourceHealthMetaGrid}>
              <span>Loaded: {foodDrinkCoverage.totalEntriesLoaded} saved places</span>
              <span>Structured specials: {foodDrinkCoverage.structuredSpecialEntryCount}</span>
              <span>Free-text fallback specials: {foodDrinkCoverage.freeTextFallbackEntryCount}</span>
              <span>Structured specials surfaced today: {foodDrinkCoverage.structuredSpecialsSurfacedCount}</span>
              <span>Free-text fallback surfaced today: {foodDrinkCoverage.freeTextFallbackSurfacedCount}</span>
              <span>Hidden with no saved special: {foodDrinkCoverage.hiddenNoSpecialCount}</span>
              <span>Hidden because not today: {foodDrinkCoverage.hiddenNotTodayCount}</span>
              <span>Malformed specials ignored: {foodDrinkCoverage.malformedSpecialCount}</span>
              <span>Unparseable free-text specials: {foodDrinkCoverage.unparseableFreeTextCount}</span>
              {foodDrinkCoverage.lastUpdatedLabel ? (
                <span>Last local update: {foodDrinkCoverage.lastUpdatedLabel}</span>
              ) : null}
            </div>

            <p className={styles.sourceHealthNote}>{foodDrinkCoverage.note}</p>
          </article>
        </div>
      </div>

      <div className={styles.sourceHealthGroup}>
        <h3 className={styles.sourceHealthHeading}>Other Events coverage</h3>
        <div className={styles.sourceHealthList}>
          <article className={styles.sourceHealthRow}>
            <div className={styles.sourceHealthTopRow}>
              <div className={styles.sourceHealthNameBlock}>
                <h4>Other Events rollup</h4>
                <div className={styles.sourceHealthBadges}>
                  <span className={`${styles.sourceHealthBadge} ${styles.sourceBadgeNeutral}`}>
                    {otherSourceLabel}
                  </span>
                  <span className={`${styles.sourceHealthBadge} ${styles.sourceBadgeSubtle}`}>
                    tracked sources: {otherCoverage.trackedSourcesCount}
                  </span>
                  <span className={`${styles.sourceHealthBadge} ${styles.sourceBadgeSubtle}`}>
                    active providers: {otherCoverage.activeLiveProvidersCount}
                  </span>
                  <span className={`${styles.sourceHealthBadge} ${styles.sourceBadgeSubtle}`}>
                    concerts: {otherCoverage.concertEventsCount}
                  </span>
                  <span className={`${styles.sourceHealthBadge} ${styles.sourceBadgeSubtle}`}>
                    others: {otherCoverage.otherEventsCount}
                  </span>
                </div>
              </div>
            </div>

            <div className={styles.sourceHealthMetaGrid}>
              <span>Tracked sources: {otherCoverage.trackedSourcesCount}</span>
              <span>Active providers: {otherCoverage.activeLiveProvidersCount}</span>
              <span>Parsed valid events: {otherCoverage.parsedEventsCount}</span>
              <span>Today checked: {otherCoverage.todayChecked ? "Yes" : "No"}</span>
              <span>Today events: {otherCoverage.todayEventsCount ?? "Not reported"}</span>
              <span>Hidden past: {otherCoverage.hiddenPastEventsCount ?? 0}</span>
              <span>Displayed in window: {otherCoverage.displayedInWindowEventsCount ?? 0}</span>
            </div>

            <p className={styles.sourceHealthNote}>{otherCoverage.note}</p>
          </article>

          {otherRows.map((row) => (
            <article className={styles.sourceHealthRow} key={row.status.sourceName}>
              <div className={styles.sourceHealthTopRow}>
                <div className={styles.sourceHealthNameBlock}>
                  <h4>{row.status.sourceName}</h4>
                  <div className={styles.sourceHealthBadges}>
                    <span className={`${styles.sourceHealthBadge} ${getStatusBadgeClass(row.status.status === "failed" ? "failed" : row.status.status === "limited" ? "limited" : "working")}`}>
                      {row.status.status === "failed" ? "failed" : row.status.status === "limited" ? "limited" : "working"}
                    </span>
                  </div>
                </div>
                {row.status.sourceUrl ? (
                  <a
                    className={styles.sourceHealthLink}
                    href={row.status.sourceUrl}
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    Source
                  </a>
                ) : null}
              </div>

              <div className={styles.sourceHealthMetaGrid}>
                <span>Source checked: {row.status.debug?.urlsChecked?.join(" · ") ?? "Not reported"}</span>
                <span>Response status: {getOtherEventsResponseStatus(row.status)}</span>
                <span>Cache: {getOtherEventsCacheSummary(row.status)}</span>
                <span>Parsed valid events: {getOtherEventsParsedCount(row.status) ?? "Not reported"}</span>
                <span>Today checked: {getOtherEventsTodayChecked(row.status)}</span>
                <span>Today events: {row.status.debug?.todayEventsCount ?? "Not reported"}</span>
                <span>Concert rows: {row.status.debug?.concertRowsParsed ?? "Not reported"}</span>
                <span>Other rows: {row.status.debug?.otherRowsParsed ?? "Not reported"}</span>
                <span>Visible Music: {row.visibleMusicEvents.length}</span>
                <span>Low-priority Music: {row.lowPriorityMusicEvents.length}</span>
                <span>Visible Other: {row.visibleOtherEvents.length}</span>
                <span>Low-priority Other: {row.lowPriorityOtherEvents.length}</span>
                {row.status.debug?.subtypeCounts ? (
                  <span>Subtypes: {Object.entries(row.status.debug.subtypeCounts).map(([label, count]) => `${label} ${count}`).join(" · ")}</span>
                ) : null}
                {row.visibleMusicEvents.length + row.visibleOtherEvents.length > 0 ? (
                  <span>
                    Visible titles: {[...row.visibleMusicEvents, ...row.visibleOtherEvents].slice(0, 6).map((event) => event.title).join(" · ")}
                  </span>
                ) : null}
              </div>

              <p className={styles.sourceHealthNote}>{row.status.message}</p>
            </article>
          ))}
        </div>
      </div>

      <div className={styles.sourceHealthGroup}>
        <h3 className={styles.sourceHealthHeading}>Sports coverage</h3>
        <div className={styles.sourceHealthList}>
              <article className={styles.sourceHealthRow}>
                <div className={styles.sourceHealthTopRow}>
                  <div className={styles.sourceHealthNameBlock}>
                    <h4>Houston pro sports</h4>
                    <div className={styles.sourceHealthBadges}>
                  <span className={`${styles.sourceHealthBadge} ${styles.sourceBadgeNeutral}`}>
                    {sportsSourceLabel}
                  </span>
                  <span className={`${styles.sourceHealthBadge} ${styles.sourceBadgeSubtle}`}>
                    tracked teams: {sportsCoverage.trackedTeamsCount}
                  </span>
                  <span className={`${styles.sourceHealthBadge} ${styles.sourceBadgeSubtle}`}>
                    live providers: {sportsCoverage.activeLiveProvidersCount}
                  </span>
                  <span className={`${styles.sourceHealthBadge} ${styles.sourceBadgeSubtle}`}>
                    not implemented: {sportsCoverage.notImplementedTeamsCount}
                  </span>
                  <span className={`${styles.sourceHealthBadge} ${styles.sourceBadgeSubtle}`}>
                    audited limited: {sportsCoverage.auditedLimitedTeamsCount ?? 0}
                  </span>
                  <span className={`${styles.sourceHealthBadge} ${styles.sourceBadgeSubtle}`}>
                    inactive: {sportsCoverage.inactiveTeamsCount ?? 0}
                  </span>
                  <span className={`${styles.sourceHealthBadge} ${styles.sourceBadgeSubtle}`}>
                    active teams: {activeSportsCount}
                  </span>
                </div>
              </div>
            </div>

            <div className={styles.sourceHealthMetaGrid}>
              <span>Parsed games: {sportsCoverage.parsedGamesCount}</span>
              <span>Astros games: {sportsCoverage.astrosGamesParsedCount}</span>
              <span>Dash schedule rows: {sportsCoverage.dashFullScheduleRowsCount ?? 0}</span>
              <span>Dash games parsed: {sportsCoverage.dashFullGamesParsedCount ?? 0}</span>
              <span>Dash in-window games: {sportsCoverage.dashInWindowGamesCount ?? 0}</span>
              <span>Dash in-window home: {sportsCoverage.dashInWindowHomeGamesCount ?? 0}</span>
              <span>Dynamo schedule rows: {sportsCoverage.dynamoFullScheduleRowsCount ?? 0}</span>
              <span>Dynamo games parsed: {sportsCoverage.dynamoFullGamesParsedCount ?? 0}</span>
              <span>Dynamo in-window games: {sportsCoverage.dynamoInWindowGamesCount ?? 0}</span>
              <span>Dynamo in-window home: {sportsCoverage.dynamoInWindowHomeGamesCount ?? 0}</span>
              <span>Home games: {sportsCoverage.homeGamesCount}</span>
              <span>Today checked: {sportsCoverage.todayChecked ? "Yes" : "No"}</span>
              <span>Today games: {sportsCoverage.todayGameCount}</span>
              <span>Dash home games: {sportsCoverage.dashHomeGamesCount ?? 0}</span>
              <span>Dash today games: {sportsCoverage.dashTodayGameCount ?? 0}</span>
              <span>Dynamo home games: {sportsCoverage.dynamoHomeGamesCount ?? 0}</span>
              <span>Dynamo today games: {sportsCoverage.dynamoTodayGameCount ?? 0}</span>
              <span>
                Next home: {sportsCoverage.dashNextHomeGameLabel ?? "Not reported"}
              </span>
              <span>
                Dynamo next home: {sportsCoverage.dynamoNextHomeGameLabel ?? "Not reported"}
              </span>
              <span>
                Earliest game: {sportsCoverage.earliestParsedGameDate ?? "Not reported"}
              </span>
              <span>
                Latest game: {sportsCoverage.latestParsedGameDate ?? "Not reported"}
              </span>
            </div>

            <p className={styles.sourceHealthNote}>{mainSportsSummary}</p>
            <p className={styles.sourceHealthNote}>{sportsCoverage.fallbackNote}</p>
          </article>

          {sportsRows.map((row) => (
            <article className={styles.sourceHealthRow} key={row.team.id}>
              <div className={styles.sourceHealthTopRow}>
                <div className={styles.sourceHealthNameBlock}>
                  <h4>{row.team.displayName}</h4>
                  <div className={styles.sourceHealthBadges}>
                    <span className={`${styles.sourceHealthBadge} ${getStatusBadgeClass(row.primaryLabel)}`}>
                      {row.primaryLabel}
                    </span>
                    <span className={`${styles.sourceHealthBadge} ${styles.sourceBadgeSubtle}`}>
                      {row.team.priority.replace("_", " ")}
                    </span>
                  </div>
                </div>
                {row.sourceUrl ? (
                  <a
                    className={styles.sourceHealthLink}
                    href={row.sourceUrl}
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    Source
                  </a>
                ) : null}
              </div>

              <div className={styles.sourceHealthMetaGrid}>
                <span>League: {row.team.league}</span>
                <span>Sport: {row.team.sport}</span>
                <span>Home venue: {row.team.homeVenue}</span>
                <span>Provider: {row.team.providerId ?? "Not reported"}</span>
                {row.status?.debug ? (
                  <>
                    <span>
                      {row.team.id === "houston-dash" || row.team.id === "houston-dynamo-fc"
                        ? "Full schedule rows: "
                        : "Parsed games: "}
                      {row.team.id === "houston-dash"
                        ? getDashCount(row.status, "fullScheduleRowsParsed") ?? row.status.debug.gamesParsed
                        : row.team.id === "houston-dynamo-fc"
                          ? getDashCount(row.status, "fullScheduleRowsParsed") ?? row.status.debug.gamesParsed
                        : row.status.debug.gamesParsed}
                    </span>
                    {row.team.id === "houston-dash" ? (
                      <span>
                        Full Dash games: {getDashCount(row.status, "fullDashGamesParsed") ?? row.status.debug.gamesParsed}
                      </span>
                    ) : row.team.id === "houston-dynamo-fc" ? (
                      <span>
                        Full Dynamo games: {getDashCount(row.status, "fullDynamoGamesParsed") ?? row.status.debug.gamesParsed}
                      </span>
                    ) : (
                      "dashGamesParsed" in row.status.debug && typeof row.status.debug.dashGamesParsed === "number" ? (
                        <span>Dash games: {row.status.debug.dashGamesParsed}</span>
                      ) : null
                    )}
                    <span>Today checked: {row.status.debug.todayChecked ? "Yes" : "No"}</span>
                    {row.team.id === "houston-dash" ? (
                      <span>
                        Today game: {getDashBoolean(row.status, "gameToday") ? "Yes" : "No"}
                      </span>
                    ) : row.team.id === "houston-dynamo-fc" ? (
                      <span>
                        Today game: {getDashBoolean(row.status, "gameToday") ? "Yes" : "No"}
                      </span>
                    ) : "dashGameToday" in row.status.debug ? (
                      <span>Today game: {row.status.debug.dashGameToday ? "Yes" : "No"}</span>
                    ) : (
                      <span>Today game: {row.status.debug.astrosGameToday ? "Yes" : "No"}</span>
                    )}
                    {row.team.id === "houston-dash" ? (
                      <>
                        <span>
                          In-window games: {getDashCount(row.status, "inWindowGamesParsed") ?? 0}
                        </span>
                        <span>
                          In-window home: {getDashCount(row.status, "inWindowHomeGamesParsed") ?? 0}
                        </span>
                        <span>
                          Next home: {getDashLabel(row.status, "nextHomeGameLabel") ?? "Not reported"}
                        </span>
                        <span>
                          Earliest in window: {getDashLabel(row.status, "earliestInWindowGame") ?? "Not reported"}
                        </span>
                        <span>
                          Latest in window: {getDashLabel(row.status, "latestInWindowGame") ?? "Not reported"}
                        </span>
                      </>
                    ) : row.team.id === "houston-dynamo-fc" ? (
                      <>
                        <span>
                          In-window games: {getDashCount(row.status, "inWindowGamesParsed") ?? 0}
                        </span>
                        <span>
                          In-window home: {getDashCount(row.status, "inWindowHomeGamesParsed") ?? 0}
                        </span>
                        <span>
                          Next home: {getDashLabel(row.status, "nextHomeGameLabel") ?? "Not reported"}
                        </span>
                        <span>
                          Earliest in window: {getDashLabel(row.status, "earliestInWindowGame") ?? "Not reported"}
                        </span>
                        <span>
                          Latest in window: {getDashLabel(row.status, "latestInWindowGame") ?? "Not reported"}
                        </span>
                        <span>
                          ICS read: {getDashBoolean(row.status, "icsCalendarRead") ? "Yes" : "No"}
                        </span>
                        <span>
                          VEVENTs: {getDashCount(row.status, "veventCount") ?? 0}
                        </span>
                        <span>
                          Candidate matches: {getDashCount(row.status, "candidateDynamoEventCount") ?? 0}
                        </span>
                        <span>
                          Feed title: {getDashLabel(row.status, "parsedFeedTitle") ?? "Not reported"}
                        </span>
                      </>
                    ) : null}
                    {"scheduleHeadingFound" in row.status.debug ? (
                      <span>Schedule heading: {row.status.debug.scheduleHeadingFound ? "Yes" : "No"}</span>
                    ) : null}
                    {"cleanedLineCount" in row.status.debug ? (
                      <span>Cleaned lines: {row.status.debug.cleanedLineCount}</span>
                    ) : null}
                    {"dateMatches" in row.status.debug ? (
                      <span>Date matches: {row.status.debug.dateMatches}</span>
                    ) : null}
                    {"matchupCandidates" in row.status.debug ? (
                      <span>Matchups: {row.status.debug.matchupCandidates}</span>
                    ) : null}
                    <span>Cache: {row.cacheSummary}</span>
                  </>
                ) : null}
              </div>

              <p className={styles.sourceHealthNote}>{row.note}</p>
            </article>
          ))}
        </div>
      </div>

      <div className={styles.sourceHealthGroup}>
        <h3 className={styles.sourceHealthHeading}>Tracked future venues</h3>
        <div className={styles.sourceHealthList}>
          {futureVenueRows.map((venue) => (
            <article className={styles.sourceHealthRow} key={venue.id}>
              <div className={styles.sourceHealthTopRow}>
                <div className={styles.sourceHealthNameBlock}>
                  <h4>{venue.displayName}</h4>
                  <div className={styles.sourceHealthBadges}>
                    <span className={`${styles.sourceHealthBadge} ${getStatusBadgeClass(venue.parserStatus)}`}>
                      {venue.parserStatus.replace("_", " ")}
                    </span>
                    <span className={`${styles.sourceHealthBadge} ${styles.sourceBadgeSubtle}`}>
                      {venue.priority.replace("_", " ")}
                    </span>
                  </div>
                </div>
                {venue.officialUrl ? (
                  <a
                    className={styles.sourceHealthLink}
                    href={venue.officialUrl}
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    Site
                  </a>
                ) : null}
              </div>

              <div className={styles.sourceHealthMeta}>
                <span>Category: {venue.category}</span>
                <span>Parser: {venue.parserStatus.replace("_", " ")}</span>
                <span>Reliability: {venue.sourceReliability}</span>
              </div>

              <p className={styles.sourceHealthNote}>
                {venue.notes ?? "Needs source audit before parser implementation."}
              </p>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}
