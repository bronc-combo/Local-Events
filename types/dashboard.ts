export interface LocationProfile {
  city: string;
  zipCode: string;
  label: string;
}

export interface SourceLink {
  label: string;
  url: string;
}

export type SourceCacheCategory = "weather" | "music" | "culture" | "sports" | "other";
export type SourceCacheRefreshPolicy = "hourly" | "daily";
export type SourceCacheMode = "live" | "cached" | "cached_fallback" | "failed";
export type EventSectionCategory = "concert" | "arts_culture" | "sports" | "food_drink" | "other";
export type SourceTier = "official" | "third_party";

export interface SourceCacheSnapshot {
  cacheKey: string;
  url: string;
  category: SourceCacheCategory;
  refreshPolicy: SourceCacheRefreshPolicy;
  mode: SourceCacheMode;
  ok: boolean;
  status: number;
  lastFetchedAt?: string;
  lastFetchedLabel?: string;
  cacheAgeMinutes?: number;
  nextRefreshAfterLabel?: string;
  warning?: string;
}

export interface FoodDrinkSpecialDetail {
  title?: string;
  description?: string;
  startTime?: string;
  endTime?: string;
  displayTime?: string;
  type?: string;
  source?: string;
}

export interface FoodDrinkCoverageSummary {
  source: "local_capacities_export" | "mock_fallback";
  totalEntriesLoaded: number;
  displayedTodayCount: number;
  surfacedTodayEventsCount: number;
  structuredSpecialEntryCount: number;
  freeTextFallbackEntryCount: number;
  structuredSpecialsSurfacedCount: number;
  freeTextFallbackSurfacedCount: number;
  hiddenNoSpecialCount: number;
  hiddenNotTodayCount: number;
  malformedSpecialCount: number;
  unparseableFreeTextCount: number;
  sourceDetail?: string;
  lastUpdatedLabel?: string;
  localExportPath?: string;
  note: string;
}

export interface SportsRegistryEntry {
  id: string;
  displayName: string;
  league: string;
  sport: string;
  homeVenue: string;
  city: string;
  priority: "mandatory" | "candidate" | "inactive" | "historical";
  officialUrl: string | null;
  scheduleUrl: string | null;
  providerId: "astros" | "rockets" | "texans" | "dynamo" | "dash" | "sabercats" | "not_implemented" | null;
  providerStatus: "working" | "limited" | "audited_limited" | "blocked" | "not_implemented" | "inactive";
  notes?: string;
}

export interface SportsSourceDebug {
  urlChecked: string;
  responseStatus?: number;
  dateWindowStart: string;
  dateWindowEnd: string;
  datesReturned: number;
  gamesParsed: number;
  astrosGamesParsed: number;
  dashGamesParsed?: number;
  fullDashGamesParsed?: number;
  homeGamesParsed: number;
  dashHomeGamesParsed?: number;
  fullScheduleRowsParsed?: number;
  fullDynamoGamesParsed?: number;
  inWindowGamesParsed?: number;
  inWindowHomeGamesParsed?: number;
  gameToday?: boolean;
  earliestInWindowGame?: string;
  latestInWindowGame?: string;
  nextHomeGameDate?: string;
  nextHomeGameLabel?: string;
  icsCalendarRead?: boolean;
  unfoldedLineCount?: number;
  veventCount?: number;
  candidateDynamoEventCount?: number;
  todayChecked: boolean;
  astrosGameToday: boolean;
  dashGameToday?: boolean;
  earliestParsedGameDate?: string;
  latestParsedGameDate?: string;
  scheduleHeadingFound?: boolean;
  cleanedLineCount?: number;
  dateMatches?: number;
  matchupCandidates?: number;
  parsedFeedTitle?: string;
  warning?: string;
}

export interface SportsSourceStatus {
  teamId: string;
  sourceName: string;
  sourceUrl: string;
  status: "success" | "working" | "limited" | "audited_limited" | "failed" | "not_implemented";
  message: string;
  sourceTier?: SourceTier;
  sourceTrustLabel?: string;
  sourceDisclosure?: string;
  thirdPartySourceName?: string;
  isInactive?: boolean;
  debug?: SportsSourceDebug;
}

export interface SportsCoverageSummary {
  source: "mock_fallback" | "live_provider" | "mixed";
  trackedTeamsCount: number;
  activeLiveProvidersCount: number;
  auditedLimitedTeamsCount?: number;
  notImplementedTeamsCount: number;
  inactiveTeamsCount?: number;
  parsedGamesCount: number;
  liveGamesParsedCount?: number;
  homeGamesDisplayedCount?: number;
  awayGamesHiddenCount?: number;
  mockFallbackUsed?: boolean;
  emptyStateReason?: string;
  astrosGamesParsedCount: number;
  dashGamesParsedCount?: number;
  dashFullScheduleRowsCount?: number;
  dashFullGamesParsedCount?: number;
  dashInWindowGamesCount?: number;
  dashInWindowHomeGamesCount?: number;
  dynamoGamesParsedCount?: number;
  dynamoFullScheduleRowsCount?: number;
  dynamoFullGamesParsedCount?: number;
  dynamoInWindowGamesCount?: number;
  dynamoInWindowHomeGamesCount?: number;
  homeGamesCount: number;
  dashHomeGamesCount?: number;
  dynamoHomeGamesCount?: number;
  todayChecked: boolean;
  todayGameCount: number;
  dashTodayGameCount?: number;
  dynamoTodayGameCount?: number;
  dashNextHomeGameDate?: string;
  dashNextHomeGameLabel?: string;
  dynamoNextHomeGameDate?: string;
  dynamoNextHomeGameLabel?: string;
  earliestParsedGameDate?: string;
  latestParsedGameDate?: string;
  fallbackNote: string;
  note: string;
}

export interface SportsProviderResult {
  source: "mock_fallback" | "live_provider" | "mixed";
  note: string;
  primarySports: SportsEvent[];
  lowerPrioritySports: SportsEvent[];
  coverageSummary: SportsCoverageSummary;
  statuses: SportsSourceStatus[];
}

export type CulturePriority = "mandatory" | "priority" | "candidate";
export type CultureProviderId =
  | "mfah"
  | "menil"
  | "camh"
  | "meow-wolf"
  | "discovery-green"
  | "asia-society-texas"
  | "buffalo-bayou"
  | "blaffer"
  | "lawndale"
  | "project-row-houses"
  | "orange-show"
  | "not_implemented"
  | null;

export interface CultureRegistryEntry {
  id: string;
  name: string;
  displayName: string;
  shortName?: string;
  city: string;
  area?: string;
  category: "arts" | "arts_culture";
  priority: CulturePriority;
  officialUrl: string | null;
  eventSourceUrl: string | null;
  providerId: CultureProviderId;
  sourceReliability: "high" | "medium" | "limited" | "unknown";
  providerStatus: "working" | "limited" | "audited_limited" | "failed" | "not_implemented";
  notes?: string;
}

export interface CultureSourceDebug {
  urlsChecked: string[];
  responseStatus?: number;
  responseStatuses?: Record<string, number>;
  homepageReached?: boolean;
  eventsPageReached?: boolean;
  calendarPageReached?: boolean;
  eventsArchiveHeadingFound?: boolean;
  upcomingEventsHeadingFound?: boolean;
  allUpcomingEventsHeadingFound?: boolean;
  dateWindowStart: string;
  dateWindowEnd: string;
  eventCalendarHeadingFound: boolean;
  eventsNavigationFound?: boolean;
  happeningSectionFound?: boolean;
  cleanedLineCount: number;
  dateHeadingMatches: number;
  titleMatches?: number;
  dateTimeMatches?: number;
  rawEventCandidates: number;
  parsedValidEvents: number;
  closureRowsSkipped?: number;
  noEventsRowsSkipped?: number;
  duplicateEventsRemoved?: number;
  thirdPartyLinksDiscovered?: number;
  thirdPartyPagesSkipped?: number;
  hiddenPastEventsCount?: number;
  displayedInWindowEventsCount?: number;
  todayChecked: boolean;
  todayEventsCount: number;
  earliestParsedEventDate?: string;
  latestParsedEventDate?: string;
  reachedOfficialPage?: boolean;
  eventsCalendarLinkFound?: boolean;
  ticketingPageReached?: boolean;
  usefulDatedEventTextFound?: boolean;
  structuredDataFound?: boolean;
  dateRangeEventCount?: number;
  sampleLines?: string[];
  warnings: string[];
}

export interface CultureSourceStatus {
  sourceName: string;
  sourceUrl: string;
  status: "working" | "limited" | "audited_limited" | "failed" | "not_implemented";
  message: string;
  sourceTier?: SourceTier;
  sourceTrustLabel?: string;
  sourceDisclosure?: string;
  thirdPartySourceName?: string;
  debug?: CultureSourceDebug;
}

export interface CultureCoverageSummary {
  source: "mock" | "live_provider" | "mixed";
  trackedSourcesCount: number;
  activeLiveProvidersCount: number;
  notImplementedSourcesCount: number;
  parsedEventsCount: number;
  hiddenPastEventsCount?: number;
  ongoingEventsDisplayedCount?: number;
  inWindowEventsDisplayedCount?: number;
  todayChecked: boolean;
  todayEventsCount: number;
  earliestParsedEventDate?: string;
  latestParsedEventDate?: string;
  dateWindowStart?: string;
  dateWindowEnd?: string;
  eventCalendarHeadingFound?: boolean;
  cleanedLineCount?: number;
  dateHeadingMatches?: number;
  titleMatches?: number;
  dateTimeMatches?: number;
  note: string;
}

export interface CultureProviderResult {
  source: "mock" | "live_provider" | "mixed";
  note: string;
  events: EventItem[];
  coverageSummary: CultureCoverageSummary;
  statuses: CultureSourceStatus[];
}

export interface OtherEventsSourceDebug {
  urlsChecked: string[];
  responseStatus?: number;
  responseStatuses?: Record<string, number>;
  fetchSucceeded: boolean;
  calendarPageFound: boolean;
  eventListFound?: boolean;
  fetchedTextLength?: number;
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
  skippedRows?: number;
  skippedReasons?: string[];
  subtypeCounts?: Record<string, number>;
  hiddenPastEventsCount: number;
  displayedInWindowEventsCount: number;
  todayChecked: boolean;
  todayEventsCount: number;
  todayHadEvents: boolean;
  earliestEventDate?: string;
  latestEventDate?: string;
  warnings: string[];
}

export interface AxelradSourceDebug {
  urlsChecked: string[];
  responseStatus?: number;
  responseStatuses?: Record<string, number>;
  homepageReached?: boolean;
  calendarPageReached?: boolean;
  eventsPageReached?: boolean;
  fetchedTextLength?: number;
  cleanedLineCount: number;
  dateHeadingMatches: number;
  timeMatches: number;
  titleMatches: number;
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
  earliestEventDate?: string;
  latestEventDate?: string;
  visibleMusicCount?: number;
  lowPriorityMusicCount?: number;
  visibleOtherCount?: number;
  lowPriorityOtherCount?: number;
  warnings: string[];
}

export interface OtherEventsSourceStatus {
  sourceName: string;
  sourceUrl: string;
  status: "success" | "working" | "limited" | "failed";
  message: string;
  sourceTier?: SourceTier;
  sourceTrustLabel?: string;
  sourceDisclosure?: string;
  thirdPartySourceName?: string;
  debug?: OtherEventsSourceDebug;
}

export interface OtherEventsCoverageSummary {
  source: "mock" | "live_provider" | "mixed";
  trackedSourcesCount: number;
  activeLiveProvidersCount: number;
  parsedEventsCount: number;
  concertEventsCount: number;
  otherEventsCount: number;
  hiddenPastEventsCount?: number;
  displayedInWindowEventsCount?: number;
  todayChecked: boolean;
  todayEventsCount: number;
  earliestEventDate?: string;
  latestEventDate?: string;
  note: string;
}

export interface OtherEventsProviderResult {
  source: "mock" | "live_provider" | "mixed";
  note: string;
  events: EventItem[];
  coverageSummary: OtherEventsCoverageSummary;
  statuses: OtherEventsSourceStatus[];
}

export interface HourlyRainChance {
  time: string;
  displayTime: string;
  precipitationProbability: number;
}

export interface WeatherOverview {
  locationLabel: string;
  summary: string;
  currentTemperatureF: number;
  feelsLikeTemperatureF: number;
  highF: number;
  lowF: number;
  maxRainChance: number;
  likelyRainWindow: string;
  currentWindSpeedMph: number;
  hourlyRainChances: HourlyRainChance[];
  sourceLinks: SourceLink[];
  cache?: SourceCacheSnapshot;
}

export interface EventItem {
  id: string;
  title: string;
  dateTime: string;
  startDate?: string;
  endDate?: string;
  isOngoing?: boolean;
  timeLabel?: string;
  venue: string;
  city: string;
  category: string;
  sectionCategory?: EventSectionCategory;
  eventSubtype?: string;
  sourceLabel?: string;
  eventUrl?: string;
  eventUrlLabel?: "Event page" | "Source page";
  sourceLinks: SourceLink[];
  sourceKey?: string;
  sourceTier?: SourceTier;
  sourceTrustLabel?: string;
  sourceDisclosure?: string;
  thirdPartySourceName?: string;
  genreTags?: string[];
  supportActs?: string;
  subtitle?: string;
  description?: string;
  rawGenre?: string;
  price?: string;
  ageRestriction?: string;
  room?: string;
  metadataConfidence?: number;
  tasteScore: number;
  tasteReasons: string[];
  isGreatLiveAct: boolean;
  liveReputationStatus?: "unknown" | "not_found" | "strong" | "legendary";
  liveReputationConfidence?: number;
  liveReputationReasons?: string[];
  liveReputationSources?: SourceLink[];
  musicTasteOverrideSuppressed?: boolean;
  hiddenReason?: string;
}

export interface SportsEvent {
  id: string;
  league: string;
  homeTeam: string;
  awayTeam: string;
  dateTime: string;
  venue: string;
  city: string;
  note: string;
  isHomeOrLocal: boolean;
  sourceLabel?: string;
  status?: "scheduled" | "postponed" | "final" | "unknown";
  confidence?: number;
  sourceStatus?: string;
  timeLabel?: string;
  hiddenReason?: string;
  sourceLinks: SourceLink[];
}

export interface FoodDrinkSpecial {
  id: string;
  name: string;
  type: string;
  title?: string;
  address?: string;
  neighborhood?: string;
  special?: string;
  happyHour?: string;
  source: string;
  verificationStatus: string;
  sourceLinks: SourceLink[];
  notes?: string;
  mapsUrl?: string;
  hours?: string;
  lastUpdated?: string;
  myRating?: number;
  distanceMiles?: number;
  estimatedCost?: string;
  hasHappyHour?: boolean;
  hasUsefulDetails?: boolean;
  needsMoreDetails?: boolean;
  appliesToday?: boolean;
  specialScheduleStatus?: "applies_today" | "not_today" | "unparseable" | "missing";
  todaySpecials?: FoodDrinkSpecialDetail[];
  hasStructuredSpecialData?: boolean;
  usesFreeTextFallback?: boolean;
  malformedStructuredSpecialCount?: number;
  exportOrder?: number;
  hiddenReason?: string;
}
