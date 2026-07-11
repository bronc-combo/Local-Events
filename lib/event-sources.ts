import { unstable_noStore as noStore } from "next/cache";
import { sortEventsByTasteScore } from "@/lib/event-scoring";
import { getSourceCacheSnapshotByUrl, installSourceCache } from "@/lib/source-cache";
import { EVENT_DISPLAY_WINDOW_DAYS } from "@/lib/event-window";
import { mockTodayEvents, mockUpcomingEvents } from "@/lib/mock-events";
import {
  HOUSTON_VENUE_REGISTRY,
  HOUSTON_MANDATORY_VENUES,
  type VenueProviderId,
} from "@/lib/venue-registry";
import {
  CONTINENTAL_CLUB_SOURCE_NAME,
  CONTINENTAL_CLUB_SOURCE_URL,
  fetchContinentalClubSource,
  type ContinentalClubSourceDebug,
} from "@/lib/sources/continental-club";
import {
  DAN_ELECTROS_SOURCE_NAME,
  DAN_ELECTROS_SOURCE_URL,
  fetchDanElectrosSource,
  type DanElectrosSourceDebug,
} from "@/lib/sources/dan-electros";
import {
  SCOUT_BAR_SOURCE_NAME,
  SCOUT_BAR_SOURCE_URL,
  fetchScoutBarSource,
  type ScoutBarSourceDebug,
} from "@/lib/sources/scout-bar";
import {
  WAREHOUSE_LIVE_MIDTOWN_SOURCE_NAME,
  WAREHOUSE_LIVE_MIDTOWN_SOURCE_URL,
  fetchWarehouseLiveMidtownSource,
  type WarehouseLiveMidtownSourceDebug,
} from "@/lib/sources/warehouse-live-midtown";
import {
  HEIGHTS_THEATER_SOURCE_NAME,
  HEIGHTS_THEATER_SOURCE_URL,
  fetchHeightsTheaterSource,
  type HeightsTheaterSourceDebug,
} from "@/lib/sources/heights-theater";
import {
  SEVEN_THIRTEEN_MUSIC_HALL_SOURCE_NAME,
  SEVEN_THIRTEEN_MUSIC_HALL_SHOWS_URL,
  fetchSevenThirteenMusicHallSource,
  type SevenThirteenMusicHallSourceDebug,
} from "@/lib/sources/seven-thirteen-music-hall";
import {
  THE_END_SOURCE_NAME,
  THE_END_SOURCE_URL,
  fetchTheEndSource,
  type TheEndSourceDebug,
} from "@/lib/sources/the-end";
import {
  THE_SECRET_GROUP_SOURCE_NAME,
  THE_SECRET_GROUP_SOURCE_URL,
  fetchSecretGroupSource,
  type SecretGroupSourceDebug,
} from "@/lib/sources/the-secret-group";
import {
  HOUSE_OF_BLUES_HOUSTON_SOURCE_NAME,
  HOUSE_OF_BLUES_HOUSTON_SOURCE_URL,
  fetchHouseOfBluesHoustonSource,
  type HouseOfBluesHoustonSourceDebug,
} from "@/lib/sources/house-of-blues-houston";
import {
  NUMBERS_SOURCE_NAME,
  NUMBERS_SOURCE_URL,
  fetchNumbersSource,
  type NumbersSourceDebug,
} from "@/lib/sources/numbers";
import {
  MUCKY_DUCK_SOURCE_NAME,
  MUCKY_DUCK_SOURCE_URL,
  fetchMuckyDuckSource,
  type MuckyDuckSourceDebug,
} from "@/lib/sources/mucky-duck";
import {
  AXELRAD_SOURCE_NAME,
  AXELRAD_SOURCE_URL,
  fetchAxelradSource,
  type AxelradSourceDebug,
} from "@/lib/sources/axelrad";
import {
  BLACK_MAGIC_BANDSINTOWN_SOURCE_NAME,
  BLACK_MAGIC_BANDSINTOWN_SOURCE_URL,
  BLACK_MAGIC_BANDSINTOWN_SOURCE_KEY,
  fetchBlackMagicBandsintownSource,
  type BlackMagicBandsintownSourceDebug,
} from "@/lib/sources/black-magic-bandsintown";
import { THIRD_PARTY_SOURCE_REGISTRY } from "@/lib/third-party-source-registry";
import { fetchBadAstronautSource } from "@/lib/sources/bad-astronaut";
import {
  WHITE_OAK_SOURCE_NAME,
  WHITE_OAK_SOURCE_URL,
  fetchWhiteOakSource,
  type WhiteOakSourceDebug,
} from "@/lib/sources/white-oak";
import { getCultureEvents } from "@/lib/culture-provider";
import type { EventItem } from "@/types/dashboard";
import type {
  CultureCoverageSummary,
  CultureSourceStatus,
  OtherEventsCoverageSummary,
  OtherEventsSourceDebug,
  OtherEventsSourceStatus,
} from "@/types/dashboard";

installSourceCache();

export interface VenueEventBatch {
  sourceKey: string;
  sourceName: string;
  events: EventItem[];
}

export interface VenueSourceStatus {
  sourceName: string;
  sourceUrl: string;
  status: "success" | "unavailable" | "failed";
  message: string;
  sourceTier?: "official" | "third_party";
  sourceTrustLabel?: string;
  sourceDisclosure?: string;
  thirdPartySourceName?: string;
  debug?:
  | WhiteOakSourceDebug
  | DanElectrosSourceDebug
  | WarehouseLiveMidtownSourceDebug
  | HeightsTheaterSourceDebug
  | SevenThirteenMusicHallSourceDebug
  | ContinentalClubSourceDebug
  | ScoutBarSourceDebug
  | TheEndSourceDebug
  | SecretGroupSourceDebug
  | HouseOfBluesHoustonSourceDebug
  | NumbersSourceDebug
  | MuckyDuckSourceDebug
  | AxelradSourceDebug
  | BlackMagicBandsintownSourceDebug
  | OtherEventsSourceDebug;
}

export interface OfficialVenueEventResult {
  source: "live" | "mixed" | "mock";
  note: string;
  todayEvents: EventItem[];
  upcomingEvents: EventItem[];
  cultureEvents: EventItem[];
  otherEvents: EventItem[];
  statuses: VenueSourceStatus[];
  cultureCoverage: CultureCoverageSummary;
  cultureStatuses: CultureSourceStatus[];
  otherCoverage: OtherEventsCoverageSummary;
  otherStatuses: OtherEventsSourceStatus[];
  debugSummary: string;
}

export interface EventRefreshStatusLike {
  sourceName: string;
  sourceUrl: string;
  status: string;
  message: string;
  debug?: unknown;
}

export function normalizeEventSourceKey(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function getEventSourceKey(event: Pick<EventItem, "sourceKey" | "sourceLabel" | "venue">): string {
  return normalizeEventSourceKey(event.sourceKey ?? event.sourceLabel ?? event.venue);
}

export function tagEventsWithSourceKey(events: EventItem[], sourceKey: string): EventItem[] {
  const normalizedSourceKey = normalizeEventSourceKey(sourceKey);

  return events.map((event) => ({
    ...event,
    sourceKey: event.sourceKey ?? normalizedSourceKey,
    sourceTier: event.sourceTier ?? "official",
  }));
}

export function mergeVenueEventBatches(batches: VenueEventBatch[]): EventItem[] {
  return batches.flatMap((batch) => tagEventsWithSourceKey(batch.events, batch.sourceKey));
}

export const MUST_CHECK_VENUE_SOURCES = HOUSTON_MANDATORY_VENUES.map((venue) => ({
  sourceName: venue.displayName,
  sourceUrl: venue.eventSourceUrl,
})) as ReadonlyArray<{ sourceName: string; sourceUrl: string }>;

function dedupeEvents(events: EventItem[]): EventItem[] {
  const byKey = new Map<string, EventItem>();

  for (const event of events) {
    const key = `${event.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}|${event.dateTime.slice(0, 10)}|${getEventSourceKey(event)}`;
    const existing = byKey.get(key);

    if (!existing) {
      byKey.set(key, event);
      continue;
    }

    const existingConfidence = existing.metadataConfidence ?? 0;
    const nextConfidence = event.metadataConfidence ?? 0;

    if (nextConfidence > existingConfidence) {
      byKey.set(key, event);
    }
  }

  return [...byKey.values()];
}

function buildLiveSourceNote(statuses: Array<VenueSourceStatus | CultureSourceStatus | OtherEventsSourceStatus>): string {
  const successfulSources = statuses
    .filter((status) => status.status === "success" || status.status === "working")
    .map((status) => status.sourceName);
  const hasThirdPartySource = statuses.some((status) => status.sourceTier === "third_party");
  const sourceSentence = hasThirdPartySource
    ? "Using official venue, culture, other, and approved third-party fallback sources where available."
    : "Using official venue, culture, and other event sources where available.";

  if (successfulSources.length === 0) {
    return `${sourceSentence} Mock fallback is filling gaps where live events were not found.`;
  }

  return `${sourceSentence} Loaded: ${successfulSources.join(", ")}.`;
}

function getStatusResponseCode(status: EventRefreshStatusLike): number | null {
  const debug = status.debug as { responseStatus?: unknown; responseStatuses?: Record<string, unknown> } | undefined;

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

function describeRefreshIssue(status: EventRefreshStatusLike): string {
  const responseCode = getStatusResponseCode(status);

  if (responseCode === 403) {
    return `${status.sourceName} blocked (403)`;
  }

  if (status.status === "failed") {
    return `${status.sourceName} failed`;
  }

  if (status.status === "limited") {
    return `${status.sourceName} limited`;
  }

  if (status.status === "unavailable") {
    return `${status.sourceName} unavailable`;
  }

  return `${status.sourceName} updated`;
}

export function buildEventRefreshLabel(statuses: EventRefreshStatusLike[]): string {
  if (statuses.length === 0) {
    return "Events refreshed.";
  }

  const snapshots = statuses.map((status) => getSourceCacheSnapshotByUrl(status.sourceUrl));
  const cacheUsed = snapshots.some((snapshot) => snapshot?.mode === "cached" || snapshot?.mode === "cached_fallback");
  const failedStatuses = statuses.filter((status) => {
    const responseCode = getStatusResponseCode(status);

    return status.status === "failed" || responseCode === 403;
  });
  const hadUsableSource = statuses.some((status, index) => {
    const snapshot = snapshots[index];

    return status.status !== "failed" || snapshot?.mode === "cached" || snapshot?.mode === "cached_fallback";
  });
  const issueSummary = failedStatuses.slice(0, 3).map(describeRefreshIssue).join(" · ");

  if (failedStatuses.length === 0) {
    return cacheUsed
      ? "Events refreshed · some sources used cached data."
      : "Events refreshed.";
  }

  if (hadUsableSource) {
    return `Events refreshed with partial failures: ${issueSummary}${cacheUsed ? " · cached data used where available" : ""}.`;
  }

  return cacheUsed
    ? `Events refreshed from cache with failures: ${issueSummary}.`
    : `Live fetch failed: ${issueSummary}.`;
}

function buildStatusRecord(
  sourceName: string,
  sourceUrl: string,
  status: VenueSourceStatus["status"],
  message: string,
  debug?: VenueSourceStatus["debug"],
  extra?: Pick<VenueSourceStatus, "sourceTier" | "sourceTrustLabel" | "sourceDisclosure" | "thirdPartySourceName">,
): VenueSourceStatus {
  return {
    sourceName,
    sourceUrl,
    status,
    message,
    sourceTier: "official",
    ...extra,
    debug,
  };
}

function buildFailedStatus(providerId: VenueProviderId): VenueSourceStatus {
  const venue = HOUSTON_VENUE_REGISTRY.find((entry) => entry.providerId === providerId) ?? HOUSTON_MANDATORY_VENUES.find(
    (entry) => entry.providerId === providerId,
  );

  if (!venue) {
    return buildStatusRecord(
      "Unknown venue",
      "",
      "failed",
      "Venue source failed before today-specific coverage could be verified.",
    );
  }

  const failureMessages: Record<VenueProviderId, string> = {
    "white-oak": "White Oak Music Hall source failed to load.",
    "dan-electros":
      "Dan Electro's source failed before today-specific coverage could be verified.",
    "warehouse-live-midtown":
      "Warehouse Live Midtown source failed before today-specific coverage could be verified.",
    "heights-theater":
      "The Heights Theater source failed before today-specific coverage could be verified.",
    "713-music-hall":
      "713 Music Hall source failed before today-specific coverage could be verified.",
    numbers:
      "Numbers Nightclub source failed before today-specific coverage could be verified.",
    axelrad:
      "Axelrad source failed before today-specific coverage could be verified.",
    "continental-club":
      "Continental Club Houston source failed before today-specific coverage could be verified.",
    "scout-bar":
      "Scout Bar source failed before today-specific coverage could be verified.",
    "the-end":
      "The End source failed before today-specific coverage could be verified.",
    "secret-group":
      "The Secret Group source failed before today-specific coverage could be verified.",
    "house-of-blues-houston":
      "House of Blues Houston source failed before today-specific coverage could be verified.",
    "mucky-duck":
      "McGonigel’s Mucky Duck source failed before today-specific coverage could be verified.",
    "not_implemented":
      "Venue source has not been implemented yet.",
  };

  return buildStatusRecord(
    venue.displayName,
    venue.eventSourceUrl ?? venue.officialUrl ?? "",
    "failed",
    failureMessages[providerId],
  );
}

function getHoustonTodayDate(): string {
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

function partitionEvents(events: EventItem[]): {
  todayEvents: EventItem[];
  upcomingEvents: EventItem[];
} {
  const today = getHoustonTodayDate();
  const upcomingEnd = addDays(today, EVENT_DISPLAY_WINDOW_DAYS);

  return {
    todayEvents: sortEventsByTasteScore(
      events.filter((event) => event.dateTime.slice(0, 10) === today),
    ),
    upcomingEvents: sortEventsByTasteScore(
      events.filter((event) => {
        const eventDate = event.dateTime.slice(0, 10);
        return eventDate > today && eventDate <= upcomingEnd;
      }),
    ),
  };
}

function partitionOtherEvents(events: EventItem[]): EventItem[] {
  const today = getHoustonTodayDate();
  const upcomingEnd = addDays(today, EVENT_DISPLAY_WINDOW_DAYS);

  return sortEventsByTasteScore(
    events.filter((event) => {
      const eventDate = event.dateTime.slice(0, 10);

      return eventDate >= today && eventDate <= upcomingEnd;
    }),
  );
}

export async function getOfficialVenueEvents(): Promise<OfficialVenueEventResult> {
  noStore();

  const statuses: VenueSourceStatus[] = [];

  try {
    const blackMagicBandsintownEnabled = THIRD_PARTY_SOURCE_REGISTRY.find(
      (entry) => entry.providerKey === BLACK_MAGIC_BANDSINTOWN_SOURCE_KEY,
    )?.enabled ?? false;

    // Houston uses a curated mandatory venue registry, so every listed provider
    // should be attempted even if some sources are only partially parseable.
    const [whiteOakResult, danElectrosResult, warehouseLiveMidtownResult, heightsTheaterResult, sevenThirteenMusicHallResult, numbersResult, muckyDuckResult, axelradResult, houseOfBluesResult, continentalClubResult, scoutBarResult, theEndResult, secretGroupResult, blackMagicBandsintownResult, badAstronautResult] = await Promise.all([
      fetchWhiteOakSource(),
      fetchDanElectrosSource(),
      fetchWarehouseLiveMidtownSource(),
      fetchHeightsTheaterSource(),
      fetchSevenThirteenMusicHallSource(),
      fetchNumbersSource(),
      fetchMuckyDuckSource(),
      fetchAxelradSource(),
      fetchHouseOfBluesHoustonSource(),
      fetchContinentalClubSource(),
      fetchScoutBarSource(),
      fetchTheEndSource(),
      fetchSecretGroupSource(),
      blackMagicBandsintownEnabled
        ? fetchBlackMagicBandsintownSource()
        : Promise.resolve({
            events: [],
            sourceName: BLACK_MAGIC_BANDSINTOWN_SOURCE_NAME,
            sourceUrl: BLACK_MAGIC_BANDSINTOWN_SOURCE_URL,
            status: "unavailable" as const,
            message: "Third-party fallback disabled after HTTP 403.",
            debug: {
              urlsChecked: [BLACK_MAGIC_BANDSINTOWN_SOURCE_URL],
              responseStatus: 403,
              homepageReached: false,
              venuePageReached: false,
              cleanedLineCount: 0,
              rawEventCandidates: 0,
              parsedBeforeDedupe: 0,
              parsedValidEvents: 0,
              duplicateRowsRemoved: 0,
              skippedRows: 0,
              skippedReasons: ["Third-party source disabled after HTTP 403."],
              hiddenPastEventsCount: 0,
              displayedInWindowEventsCount: 0,
              todayChecked: false,
              todayEventsCount: 0,
              todayHadEvents: false,
              earliestEventDate: undefined,
              latestEventDate: undefined,
              visibleMusicCount: 0,
              lowPriorityMusicCount: 0,
              visibleOtherCount: 0,
              lowPriorityOtherCount: 0,
              visibleTitles: [],
              lowPriorityMusicTitles: [],
              lowPriorityOtherTitles: [],
              warnings: ["Third-party source disabled after HTTP 403."],
              sourceTier: "third_party",
              thirdPartySourceName: "Bandsintown",
              sourceDisclosure: "Third-party listing: Bandsintown, not official venue site",
              officialSourceStatus: "blocked",
            } satisfies BlackMagicBandsintownSourceDebug,
          }),
      fetchBadAstronautSource(),
    ]);
    const cultureResult = await getCultureEvents();
    const secretGroupConcertEvents = secretGroupResult.events.filter((event) => event.sectionCategory === "concert");
    const secretGroupOtherEvents = secretGroupResult.events.filter((event) => event.sectionCategory === "other");
    const axelradMusicEvents = axelradResult.events.filter((event) => event.sectionCategory === "concert");
    const axelradOtherEvents = axelradResult.events.filter((event) => event.sectionCategory === "other");
    const blackMagicMusicEvents = blackMagicBandsintownResult.events.filter((event) => event.sectionCategory === "concert");
    const blackMagicOtherEvents = blackMagicBandsintownResult.events.filter((event) => event.sectionCategory === "other");
    const houseOfBluesStatus =
      houseOfBluesResult.status === "failed"
        ? "failed"
        : houseOfBluesResult.events.length > 0
          ? "success"
          : "unavailable";
    const combinedEvents = sortEventsByTasteScore(dedupeEvents(mergeVenueEventBatches([
      { sourceKey: WHITE_OAK_SOURCE_NAME, sourceName: WHITE_OAK_SOURCE_NAME, events: whiteOakResult.events },
      { sourceKey: DAN_ELECTROS_SOURCE_NAME, sourceName: DAN_ELECTROS_SOURCE_NAME, events: danElectrosResult.events },
      { sourceKey: WAREHOUSE_LIVE_MIDTOWN_SOURCE_NAME, sourceName: WAREHOUSE_LIVE_MIDTOWN_SOURCE_NAME, events: warehouseLiveMidtownResult.events },
      { sourceKey: HEIGHTS_THEATER_SOURCE_NAME, sourceName: HEIGHTS_THEATER_SOURCE_NAME, events: heightsTheaterResult.events },
      { sourceKey: SEVEN_THIRTEEN_MUSIC_HALL_SOURCE_NAME, sourceName: SEVEN_THIRTEEN_MUSIC_HALL_SOURCE_NAME, events: sevenThirteenMusicHallResult.events },
      { sourceKey: NUMBERS_SOURCE_NAME, sourceName: NUMBERS_SOURCE_NAME, events: numbersResult.events },
      { sourceKey: MUCKY_DUCK_SOURCE_NAME, sourceName: MUCKY_DUCK_SOURCE_NAME, events: muckyDuckResult.events },
      { sourceKey: AXELRAD_SOURCE_NAME, sourceName: AXELRAD_SOURCE_NAME, events: axelradMusicEvents },
      { sourceKey: BLACK_MAGIC_BANDSINTOWN_SOURCE_KEY, sourceName: BLACK_MAGIC_BANDSINTOWN_SOURCE_NAME, events: blackMagicMusicEvents },
      { sourceKey: HOUSE_OF_BLUES_HOUSTON_SOURCE_NAME, sourceName: HOUSE_OF_BLUES_HOUSTON_SOURCE_NAME, events: houseOfBluesResult.events },
      { sourceKey: CONTINENTAL_CLUB_SOURCE_NAME, sourceName: CONTINENTAL_CLUB_SOURCE_NAME, events: continentalClubResult.events },
      { sourceKey: SCOUT_BAR_SOURCE_NAME, sourceName: SCOUT_BAR_SOURCE_NAME, events: scoutBarResult.events },
      { sourceKey: THE_END_SOURCE_NAME, sourceName: THE_END_SOURCE_NAME, events: theEndResult.events },
      { sourceKey: THE_SECRET_GROUP_SOURCE_NAME, sourceName: THE_SECRET_GROUP_SOURCE_NAME, events: secretGroupConcertEvents },
      { sourceKey: "houston-culture", sourceName: "Houston arts & culture", events: cultureResult.events },
      { sourceKey: "bad-astronaut", sourceName: "Bad Astronaut", events: badAstronautResult.events.filter((event) => event.sectionCategory === "concert") },
    ])));
    const otherEvents = partitionOtherEvents(dedupeEvents(mergeVenueEventBatches([
      { sourceKey: CONTINENTAL_CLUB_SOURCE_NAME, sourceName: CONTINENTAL_CLUB_SOURCE_NAME, events: continentalClubResult.events.filter((event) => event.sectionCategory === "other") },
      { sourceKey: "bad-astronaut", sourceName: "Bad Astronaut", events: badAstronautResult.events.filter((event) => event.sectionCategory === "other") },
      { sourceKey: THE_SECRET_GROUP_SOURCE_NAME, sourceName: THE_SECRET_GROUP_SOURCE_NAME, events: secretGroupOtherEvents },
      { sourceKey: AXELRAD_SOURCE_NAME, sourceName: AXELRAD_SOURCE_NAME, events: axelradOtherEvents },
      { sourceKey: BLACK_MAGIC_BANDSINTOWN_SOURCE_KEY, sourceName: BLACK_MAGIC_BANDSINTOWN_SOURCE_NAME, events: blackMagicOtherEvents },
    ])));
    const partitioned = partitionEvents(combinedEvents);

    statuses.push(
      buildStatusRecord(
        WHITE_OAK_SOURCE_NAME,
        WHITE_OAK_SOURCE_URL,
        whiteOakResult.status,
        whiteOakResult.message,
        whiteOakResult.debug,
      ),
      buildStatusRecord(
        DAN_ELECTROS_SOURCE_NAME,
        DAN_ELECTROS_SOURCE_URL,
        danElectrosResult.status,
        danElectrosResult.message,
        danElectrosResult.debug,
      ),
      buildStatusRecord(
        WAREHOUSE_LIVE_MIDTOWN_SOURCE_NAME,
        WAREHOUSE_LIVE_MIDTOWN_SOURCE_URL,
        warehouseLiveMidtownResult.status,
        warehouseLiveMidtownResult.message,
        warehouseLiveMidtownResult.debug,
      ),
      buildStatusRecord(
        HEIGHTS_THEATER_SOURCE_NAME,
        HEIGHTS_THEATER_SOURCE_URL,
        heightsTheaterResult.status,
        heightsTheaterResult.message,
        heightsTheaterResult.debug,
      ),
      buildStatusRecord(
        SEVEN_THIRTEEN_MUSIC_HALL_SOURCE_NAME,
        SEVEN_THIRTEEN_MUSIC_HALL_SHOWS_URL,
        sevenThirteenMusicHallResult.status,
        sevenThirteenMusicHallResult.message,
        sevenThirteenMusicHallResult.debug,
      ),
      buildStatusRecord(
        NUMBERS_SOURCE_NAME,
        NUMBERS_SOURCE_URL,
        numbersResult.status,
        numbersResult.message,
        numbersResult.debug,
      ),
      buildStatusRecord(
        MUCKY_DUCK_SOURCE_NAME,
        MUCKY_DUCK_SOURCE_URL,
        muckyDuckResult.status,
        muckyDuckResult.message,
        muckyDuckResult.debug,
      ),
      buildStatusRecord(
        AXELRAD_SOURCE_NAME,
        AXELRAD_SOURCE_URL,
        axelradResult.status,
        axelradResult.message,
        axelradResult.debug,
      ),
      ...(blackMagicBandsintownEnabled
        ? [
            buildStatusRecord(
              BLACK_MAGIC_BANDSINTOWN_SOURCE_NAME,
              BLACK_MAGIC_BANDSINTOWN_SOURCE_URL,
              blackMagicBandsintownResult.status,
              blackMagicBandsintownResult.message,
              blackMagicBandsintownResult.debug,
              {
                sourceTier: "third_party",
                sourceTrustLabel: "Third-party listing",
                sourceDisclosure: "Third-party listing: Bandsintown, not official venue site",
                thirdPartySourceName: "Bandsintown",
              },
            ),
          ]
        : []),
      buildStatusRecord(
        HOUSE_OF_BLUES_HOUSTON_SOURCE_NAME,
        HOUSE_OF_BLUES_HOUSTON_SOURCE_URL,
        houseOfBluesStatus,
        houseOfBluesResult.message,
        houseOfBluesResult.debug,
      ),
      buildStatusRecord(
        CONTINENTAL_CLUB_SOURCE_NAME,
        CONTINENTAL_CLUB_SOURCE_URL,
        continentalClubResult.status,
        continentalClubResult.message,
        continentalClubResult.debug,
      ),
      buildStatusRecord(
        SCOUT_BAR_SOURCE_NAME,
        SCOUT_BAR_SOURCE_URL,
        scoutBarResult.status,
        scoutBarResult.message,
        scoutBarResult.debug,
      ),
      buildStatusRecord(
        THE_END_SOURCE_NAME,
        THE_END_SOURCE_URL,
        theEndResult.status,
        theEndResult.message,
        theEndResult.debug,
      ),
      buildStatusRecord(
        THE_SECRET_GROUP_SOURCE_NAME,
        THE_SECRET_GROUP_SOURCE_URL,
        secretGroupResult.status === "failed" ? "failed" : secretGroupConcertEvents.length > 0 ? "success" : "unavailable",
        secretGroupResult.message,
        secretGroupResult.debug,
      ),
    );

    const usingMockToday = partitioned.todayEvents.length === 0;
    const usingMockUpcoming = partitioned.upcomingEvents.length === 0;
    const debugSummary = [
      whiteOakResult.message,
      danElectrosResult.message,
      warehouseLiveMidtownResult.message,
      heightsTheaterResult.message,
      sevenThirteenMusicHallResult.message,
      numbersResult.message,
      muckyDuckResult.message,
      houseOfBluesResult.message,
      continentalClubResult.message,
      scoutBarResult.message,
      theEndResult.message,
      secretGroupResult.message,
      badAstronautResult.message,
      cultureResult.note,
    ].join(" ");
    const combinedNote = [
      buildLiveSourceNote([...statuses, ...cultureResult.statuses, badAstronautResult]),
      badAstronautResult.message,
      secretGroupResult.message,
      numbersResult.message,
      muckyDuckResult.message,
      cultureResult.note,
      usingMockToday || usingMockUpcoming
        ? "Mock fallback filled any empty date buckets."
        : null,
    ].filter(Boolean).join(" ");
    const otherStatuses: OtherEventsSourceStatus[] = [
      badAstronautResult,
      {
        sourceName: secretGroupResult.sourceName,
        sourceUrl: secretGroupResult.sourceUrl,
        status: secretGroupResult.status === "failed" ? "failed" : secretGroupOtherEvents.length > 0 ? "working" : "limited",
        message: secretGroupResult.message,
        debug: secretGroupResult.debug,
      },
    ];
    const otherSourceDebugs = otherStatuses
      .map((status) => status.debug)
      .filter((debug): debug is OtherEventsSourceDebug => Boolean(debug));
    const otherDates = otherSourceDebugs
      .flatMap((debug) => [debug.earliestEventDate, debug.latestEventDate])
      .filter((value): value is string => Boolean(value))
      .sort();

    return {
      source:
        usingMockToday || usingMockUpcoming || cultureResult.source !== "live_provider" || badAstronautResult.status === "failed" || secretGroupResult.status === "failed"
          ? "mixed"
          : "live",
      note: combinedNote,
      todayEvents: usingMockToday ? mockTodayEvents : partitioned.todayEvents,
      upcomingEvents: usingMockUpcoming
        ? mockUpcomingEvents
        : partitioned.upcomingEvents,
      cultureEvents: cultureResult.events,
      otherEvents,
      statuses,
      cultureCoverage: cultureResult.coverageSummary,
      cultureStatuses: cultureResult.statuses,
      otherCoverage: badAstronautResult.debug
        ? {
            source:
              otherStatuses.every((status) => status.status === "failed")
                ? "mock"
                : otherStatuses.some((status) => status.status === "failed")
                  ? "mixed"
                  : "live_provider",
            trackedSourcesCount: otherStatuses.length,
            activeLiveProvidersCount: otherStatuses.filter((status) => status.status !== "failed").length,
            parsedEventsCount: otherSourceDebugs.reduce((sum, debug) => sum + debug.parsedValidEvents, 0),
            concertEventsCount: otherSourceDebugs.reduce((sum, debug) => sum + debug.concertRowsParsed, 0),
            otherEventsCount: otherSourceDebugs.reduce((sum, debug) => sum + debug.otherRowsParsed, 0),
            hiddenPastEventsCount: otherSourceDebugs.reduce((sum, debug) => sum + debug.hiddenPastEventsCount, 0),
            displayedInWindowEventsCount: otherSourceDebugs.reduce((sum, debug) => sum + debug.displayedInWindowEventsCount, 0),
            todayChecked: otherSourceDebugs.some((debug) => debug.todayChecked),
            todayEventsCount: otherSourceDebugs.reduce((sum, debug) => sum + debug.todayEventsCount, 0),
            earliestEventDate: otherDates[0],
            latestEventDate: otherDates[otherDates.length - 1],
            note: [badAstronautResult.message, secretGroupResult.message].filter(Boolean).join(" "),
          }
        : {
            source: "mock",
            trackedSourcesCount: 2,
            activeLiveProvidersCount: 0,
            parsedEventsCount: 0,
            concertEventsCount: 0,
            otherEventsCount: 0,
            todayChecked: false,
            todayEventsCount: 0,
            note: "Bad Astronaut source unavailable.",
          },
      otherStatuses,
      debugSummary,
    };
  } catch (error) {
    const failedStatuses = [
      buildFailedStatus("white-oak"),
      buildFailedStatus("dan-electros"),
      buildFailedStatus("warehouse-live-midtown"),
      buildFailedStatus("heights-theater"),
      buildFailedStatus("713-music-hall"),
      buildFailedStatus("numbers"),
      buildFailedStatus("mucky-duck"),
      buildFailedStatus("axelrad"),
      buildFailedStatus("house-of-blues-houston"),
      buildFailedStatus("continental-club"),
      buildFailedStatus("scout-bar"),
      buildFailedStatus("the-end"),
      buildFailedStatus("secret-group"),
    ];

    if (error instanceof Error && failedStatuses[0]) {
      failedStatuses[0] = buildStatusRecord(
        failedStatuses[0].sourceName,
        failedStatuses[0].sourceUrl,
        "failed",
        error.message,
      );
    }

    statuses.push(...failedStatuses);

    return {
      source: "mock",
      note: "Using mock fallback because live venue and culture sources could not be loaded.",
      todayEvents: mockTodayEvents,
      upcomingEvents: mockUpcomingEvents,
      cultureEvents: [],
      otherEvents: [],
      statuses,
      cultureCoverage: {
        source: "mock",
        trackedSourcesCount: 0,
        activeLiveProvidersCount: 0,
        notImplementedSourcesCount: 0,
        parsedEventsCount: 0,
        todayChecked: false,
        todayEventsCount: 0,
        note: "Using mock fallback because live venue and culture sources could not be loaded.",
      },
      cultureStatuses: [],
      otherCoverage: {
        source: "mock",
        trackedSourcesCount: 1,
        activeLiveProvidersCount: 0,
        parsedEventsCount: 0,
        concertEventsCount: 0,
        otherEventsCount: 0,
        todayChecked: false,
        todayEventsCount: 0,
        note: "Using mock fallback because live venue and culture sources could not be loaded.",
      },
      otherStatuses: [],
      debugSummary: "Official venue and culture source loading failed before today-specific coverage could be verified.",
    };
  }
}
