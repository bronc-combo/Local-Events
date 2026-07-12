import { CollapsibleSection } from "./collapsible-section";
import { EventSection } from "./event-card";
import { FoodDrinkSection } from "./food-drink-card";
import { RefreshControls } from "./refresh-controls";
import { SourceHealth } from "./source-health";
import { SportsSection } from "./sports-card";
import { WeatherCard } from "./weather-card";
import styles from "../page.module.css";
import { buildFoodDrinkTodayEvents } from "@/lib/food-drink-provider";
import { buildEventRefreshLabel } from "@/lib/event-sources";
import { HOUSTON_VENUE_REGISTRY } from "@/lib/venue-registry";
import { formatSourceCacheSnapshot } from "@/lib/source-cache";
import type { EventItem, LocationProfile, SportsEvent } from "@/types/dashboard";
import type { DashboardData } from "@/lib/dashboard-fetch";

const defaultLocation: LocationProfile = {
  city: "Houston, TX",
  zipCode: "77009",
  label: "Houston, TX 77009",
};

function getHoustonTodayDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function isEventActiveToday(event: Pick<EventItem, "dateTime" | "startDate" | "endDate">): boolean {
  const today = getHoustonTodayDate();
  const eventDate = event.dateTime.slice(0, 10);
  const startDate = event.startDate ?? eventDate;
  const endDate = event.endDate ?? eventDate;

  if (startDate !== endDate) {
    return startDate <= today && endDate >= today;
  }

  return eventDate === today;
}

function isOngoingTodayEvent(event: Pick<EventItem, "dateTime" | "startDate" | "endDate" | "isOngoing">): boolean {
  const eventDate = event.dateTime.slice(0, 10);
  const startDate = event.startDate ?? eventDate;
  const endDate = event.endDate ?? eventDate;

  if (event.isOngoing) {
    return true;
  }

  return startDate !== endDate && isEventActiveToday(event);
}

function uniqueEventsById(events: EventItem[]): EventItem[] {
  return events.filter((event, index, allEvents) => allEvents.findIndex((other) => other.id === event.id) === index);
}

function sortMusicEventsForToday(events: EventItem[]): EventItem[] {
  return [...events].sort((left, right) => {
    if (right.tasteScore !== left.tasteScore) {
      return right.tasteScore - left.tasteScore;
    }

    return left.dateTime.localeCompare(right.dateTime);
  });
}

function sortDateThenTitle(events: EventItem[]): EventItem[] {
  return [...events].sort((left, right) => {
    if (left.dateTime !== right.dateTime) {
      return left.dateTime.localeCompare(right.dateTime);
    }

    return left.title.localeCompare(right.title);
  });
}

function sortPreserveOrder(events: EventItem[]): EventItem[] {
  return [...events];
}

function getTodayBucketOrder(event: EventItem): number {
  if (isOngoingTodayEvent(event)) {
    return 5;
  }

  switch (event.sectionCategory) {
    case "concert":
      return 0;
    case "food_drink":
      return 1;
    case "arts_culture":
      return 2;
    case "sports":
      return 3;
    case "other":
      return 4;
    default:
      return 6;
  }
}

function buildBalancedTodayEvents(events: EventItem[]): EventItem[] {
  const buckets = new Map<number, EventItem[]>();
  const bucketSorters: Record<number, (items: EventItem[]) => EventItem[]> = {
    0: sortMusicEventsForToday,
    1: sortDateThenTitle,
    2: sortDateThenTitle,
    3: sortDateThenTitle,
    4: sortDateThenTitle,
    5: sortDateThenTitle,
    6: sortPreserveOrder,
  };

  for (const event of events) {
    const key = getTodayBucketOrder(event);
    const existing = buckets.get(key) ?? [];
    existing.push(event);
    buckets.set(key, existing);
  }

  for (const [key, bucket] of buckets) {
    const sorter = bucketSorters[key] ?? sortPreserveOrder;
    buckets.set(key, sorter(bucket));
  }

  const bucketOrder = [...buckets.keys()].sort((left, right) => left - right);
  const balanced: EventItem[] = [];

  for (const bucketKey of bucketOrder) {
    const bucket = buckets.get(bucketKey);

    if (bucket && bucket.length > 0) {
      balanced.push(...bucket);
    }
  }

  return balanced;
}

function getSportsPrimaryLink(event: SportsEvent): { url: string; label: "Event page" | "Source page" } | null {
  const url = event.sourceLinks[0]?.url;

  if (!url) {
    return null;
  }

  return {
    url,
    label: event.sourceLinks.length > 1 ? "Event page" : "Source page",
  };
}

function sportsEventToEventItem(event: SportsEvent): EventItem {
  const primaryLink = getSportsPrimaryLink(event);

  return {
    id: `sports-${event.id}`,
    title: `${event.awayTeam} at ${event.homeTeam}`,
    dateTime: event.dateTime,
    venue: event.venue,
    city: event.city,
    category: event.league,
    sectionCategory: "sports",
    eventSubtype: event.note,
    sourceLabel: event.sourceLabel ?? event.league,
    eventUrl: primaryLink?.url,
    eventUrlLabel: primaryLink?.label,
    sourceLinks: event.sourceLinks,
    tasteScore: 55,
    tasteReasons: [event.note || "local pro sports fit"],
    isGreatLiveAct: false,
    liveReputationStatus: "unknown",
    hiddenReason: event.hiddenReason,
  };
}

function formatSnapshotGeneratedLabel(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export function DashboardPage({
  weatherResult,
  eventProvider,
  foodDrinkProvider,
  sportsProvider,
  snapshotMode = false,
  snapshotGeneratedAt,
}: DashboardData & {
  snapshotMode?: boolean;
  snapshotGeneratedAt?: string;
}) {
  const musicEvents = eventProvider.upcomingEvents.filter((event) => event.sectionCategory === "concert");
  const visibleMusicEvents = musicEvents.filter((event) => !event.hiddenReason);
  const lowPriorityMusicEvents = musicEvents.filter((event) => Boolean(event.hiddenReason));
  const eligibleFallbackMusicEvents = lowPriorityMusicEvents.filter((event) => !event.musicTasteOverrideSuppressed);
  const musicFallbackPromotedEvents = visibleMusicEvents.length === 0
    ? eligibleFallbackMusicEvents.slice(0, 3).map((event) => ({
        ...event,
        hiddenReason: undefined,
      }))
    : [];
  const promotedMusicEventIds = new Set(
    musicFallbackPromotedEvents.map((event) => event.id),
  );
  const musicRemainingLowPriorityEvents = visibleMusicEvents.length > 0
    ? eligibleFallbackMusicEvents.filter((event) => !promotedMusicEventIds.has(event.id))
    : eligibleFallbackMusicEvents
        .slice(musicFallbackPromotedEvents.length)
        .filter((event) => !promotedMusicEventIds.has(event.id));
  const todayMusicEvents = eventProvider.todayEvents.filter(
    (event) => event.sectionCategory === "concert" && isEventActiveToday(event),
  );
  const todayFoodDrinkEvents = buildFoodDrinkTodayEvents(foodDrinkProvider.primaryItems);
  const todaySportsEvents = sportsProvider.primarySports
    .filter((event: SportsEvent) => event.isHomeOrLocal && isEventActiveToday(event))
    .map((event: SportsEvent) => sportsEventToEventItem(event));
  const todayCultureEvents = uniqueEventsById(
    eventProvider.cultureEvents.filter((event: EventItem) => isEventActiveToday(event)),
  );
  const todayCultureEventIds = todayCultureEvents.map((event) => event.id);
  const todayOtherEvents = uniqueEventsById(
    eventProvider.otherEvents.filter((event: EventItem) => isEventActiveToday(event)),
  );
  const todayOngoingEvents = uniqueEventsById([
    ...todayMusicEvents.filter(isOngoingTodayEvent),
    ...todayFoodDrinkEvents.filter(isOngoingTodayEvent),
    ...todayCultureEvents.filter(isOngoingTodayEvent),
    ...todaySportsEvents.filter(isOngoingTodayEvent),
    ...todayOtherEvents.filter(isOngoingTodayEvent),
  ]);
  const todayOngoingEventIds = new Set(todayOngoingEvents.map((event) => event.id));
  const todayNonOngoingMusicEvents = todayMusicEvents.filter((event) => !todayOngoingEventIds.has(event.id));
  const todayNonOngoingFoodDrinkEvents = todayFoodDrinkEvents.filter((event) => !todayOngoingEventIds.has(event.id));
  const todayNonOngoingCultureEvents = todayCultureEvents.filter((event) => !todayOngoingEventIds.has(event.id));
  const todayNonOngoingSportsEvents = todaySportsEvents.filter((event) => !todayOngoingEventIds.has(event.id));
  const todayNonOngoingOtherEvents = todayOtherEvents.filter((event) => !todayOngoingEventIds.has(event.id));
  const todayEvents = uniqueEventsById(buildBalancedTodayEvents([
    ...todayNonOngoingMusicEvents,
    ...todayNonOngoingFoodDrinkEvents,
    ...todayNonOngoingCultureEvents,
    ...todayNonOngoingSportsEvents,
    ...todayNonOngoingOtherEvents,
    ...todayOngoingEvents,
  ]));
  const otherRenderedEvents = [
    ...eventProvider.otherEvents,
  ].filter((event: EventItem, index: number, events: EventItem[]) => events.findIndex((other) => other.id === event.id) === index);
  const musicRenderedEvents = [
    ...(visibleMusicEvents.length > 0 ? visibleMusicEvents : musicFallbackPromotedEvents),
  ].filter((event: EventItem, index: number, events: EventItem[]) => events.findIndex((other) => other.id === event.id) === index);
  const weatherUpdatedLabel = weatherResult.weather?.cache
    ? formatSourceCacheSnapshot(weatherResult.weather.cache) ?? "Not reported"
    : weatherResult.error ?? "Not reported";
  const eventUpdatedLabel = buildEventRefreshLabel([
    ...eventProvider.statuses,
    ...eventProvider.cultureStatuses,
    ...eventProvider.otherStatuses,
    ...sportsProvider.statuses,
  ]);
  const sourceHealthLiveSourceCount = new Set([
    ...eventProvider.statuses.map((status) => status.sourceName),
    ...eventProvider.otherStatuses.map((status) => status.sourceName),
  ]).size;
  const snapshotGeneratedLabel = snapshotGeneratedAt
    ? formatSnapshotGeneratedLabel(snapshotGeneratedAt)
    : null;

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <header className={styles.header}>
          <div className={styles.headerText}>
            <p className={styles.eyebrow}>Daily dashboard</p>
            <h1>Daily Overview</h1>
            <p className={styles.locationLabel}>{defaultLocation.label}</p>
          </div>

          <div className={styles.inputGrid}>
            <label className={styles.field}>
              <span>City</span>
              <input
                aria-label="City"
                defaultValue={defaultLocation.city}
                name="city"
                type="text"
              />
            </label>

            <label className={styles.field}>
              <span>ZIP code</span>
              <input
                aria-label="ZIP code"
                defaultValue={defaultLocation.zipCode}
                inputMode="numeric"
                name="zipCode"
                type="text"
              />
            </label>
          </div>
        </header>

        {snapshotMode ? (
          <p className={styles.sectionNote}>
            Static snapshot generated {snapshotGeneratedLabel ?? "recently"}. Updates happen when the site is rebuilt.
          </p>
        ) : (
          <RefreshControls
            eventsUpdatedLabel={eventUpdatedLabel}
            weatherUpdatedLabel={weatherUpdatedLabel}
          />
        )}

        <section className={styles.cardGrid} aria-label="Overview sections">
          <CollapsibleSection
            countLabel="Current conditions"
            summary="Houston weather snapshot and rain timing."
            title="Weather"
          >
            <WeatherCard result={weatherResult} />
          </CollapsibleSection>

          <CollapsibleSection
            countLabel={`${todayEvents.length} events`}
            summary="Today's Houston picks across music, sports, arts, and local events."
            title="Today's Events"
          >
            <EventSection alwaysVisibleEventIds={todayCultureEventIds} events={todayEvents} />
          </CollapsibleSection>

          <CollapsibleSection
            countLabel={
              musicRenderedEvents.length > 0
                ? `${musicRenderedEvents.length} music events`
                : lowPriorityMusicEvents.length > 0
                  ? `${musicRenderedEvents.length} visible · ${musicRemainingLowPriorityEvents.length} low-confidence`
                  : "0 music events"
            }
            defaultCollapsed
            summary="Upcoming Houston concerts and live music, ranked by taste match."
            title="Music"
          >
            {musicRenderedEvents.length > 0 ? (
              <EventSection
                events={musicRenderedEvents}
                lowPriorityEvents={musicRemainingLowPriorityEvents}
                mutedEventIds={musicFallbackPromotedEvents.map((event) => event.id)}
              />
            ) : lowPriorityMusicEvents.length > 0 ? (
              <EventSection
                events={musicRenderedEvents}
                lowPriorityEvents={musicRemainingLowPriorityEvents}
                lowPriorityNote="Low-priority / hidden by taste filter"
                mutedEventIds={musicFallbackPromotedEvents.map((event) => event.id)}
                note="Showing lower-confidence music picks because no stronger matches are in the 30-day window."
              />
            ) : (
              <p className={styles.cardMuted}>No music events matched this section right now.</p>
            )}
          </CollapsibleSection>

          <CollapsibleSection
            countLabel={`${sportsProvider.primarySports.length + sportsProvider.lowerPrioritySports.length} items`}
            defaultCollapsed
            summary="Today's Houston-area pro and above-college-level sports picks."
            title="Sports"
          >
            <SportsSection
              lowerPrioritySports={sportsProvider.lowerPrioritySports}
              note={sportsProvider.note}
              primarySports={sportsProvider.primarySports}
            />
          </CollapsibleSection>

          <CollapsibleSection
            countLabel={`${eventProvider.cultureEvents.length} events`}
            defaultCollapsed
            summary="Live museum and cultural events from Houston arts sources."
            title="Arts & Culture"
          >
            {eventProvider.cultureEvents.length > 0 ? (
              <EventSection events={eventProvider.cultureEvents} />
            ) : (
              <p className={styles.cardMuted}>No Arts &amp; Culture events found in the current window.</p>
            )}
          </CollapsibleSection>

          <CollapsibleSection
            countLabel={`${otherRenderedEvents.length} events`}
            defaultCollapsed
            summary="Local recurring, social, brewery, market, comedy, and unusual community events."
            title="Other Events"
          >
            <EventSection events={otherRenderedEvents} note={eventProvider.otherCoverage.note} />
          </CollapsibleSection>

          <CollapsibleSection
            countLabel={`${foodDrinkProvider.primaryItems.length + foodDrinkProvider.lowerPriorityItems.length} places`}
            defaultCollapsed
            summary="Saved places from Capacities first, then nearby local discoveries."
            title="Food & Drink"
          >
            <FoodDrinkSection
              lowerPriorityItems={foodDrinkProvider.lowerPriorityItems}
              note={foodDrinkProvider.note}
              primaryItems={foodDrinkProvider.primaryItems}
            />
          </CollapsibleSection>

          <CollapsibleSection
            countLabel={`${sourceHealthLiveSourceCount} live sources · ${HOUSTON_VENUE_REGISTRY.length} tracked venues`}
            defaultCollapsed
            summary="Quick view of which Houston venue sources are working, limited, or still metadata-only."
            title="Source Health"
          >
            <SourceHealth
              cultureCoverage={eventProvider.cultureCoverage}
              cultureStatuses={eventProvider.cultureStatuses}
              cultureEvents={eventProvider.cultureEvents}
              foodDrinkCoverage={foodDrinkProvider.coverageSummary}
              musicEvents={musicRenderedEvents}
              musicLowPriorityEvents={musicRemainingLowPriorityEvents}
              musicFallbackPromotedEvents={musicFallbackPromotedEvents}
              otherEvents={otherRenderedEvents}
              otherCoverage={eventProvider.otherCoverage}
              otherStatuses={eventProvider.otherStatuses}
              sportsCoverage={sportsProvider.coverageSummary}
              sportsStatuses={sportsProvider.statuses}
              statuses={eventProvider.statuses}
              todayRollup={{
                music: todayMusicEvents.length,
                sports: todaySportsEvents.length,
                arts: todayCultureEvents.length,
                other: todayOtherEvents.length,
                foodDrink: todayFoodDrinkEvents.length,
              }}
            />
          </CollapsibleSection>
        </section>
      </main>
    </div>
  );
}
