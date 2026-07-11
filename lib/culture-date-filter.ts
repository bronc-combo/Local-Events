import type { EventItem } from "@/types/dashboard";
import { EVENT_DISPLAY_WINDOW_DAYS } from "@/lib/event-window";

export interface CultureEventFilterResult {
  events: EventItem[];
  hiddenPastEventsCount: number;
  ongoingEventsDisplayedCount: number;
  inWindowEventsDisplayedCount: number;
}

export function getHoustonTodayDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function addDaysToHoustonDate(baseDate: string, days: number): string {
  const base = new Date(`${baseDate}T12:00:00-05:00`);
  base.setDate(base.getDate() + days);

  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(base);
}

function getEventRange(event: EventItem): { startDate: string; endDate: string; isRange: boolean } {
  const startDate = event.startDate ?? event.dateTime.slice(0, 10);
  const endDate = event.endDate ?? event.dateTime.slice(0, 10);
  const isRange = startDate !== endDate;

  return { startDate, endDate, isRange };
}

function isRangeOngoingToday(startDate: string, endDate: string, today: string): boolean {
  return startDate <= today && endDate >= today;
}

export function filterCultureEvents(
  events: EventItem[],
  today = getHoustonTodayDate(),
  windowEnd = addDaysToHoustonDate(today, EVENT_DISPLAY_WINDOW_DAYS),
): CultureEventFilterResult {
  const visibleEvents: EventItem[] = [];
  let hiddenPastEventsCount = 0;
  let ongoingEventsDisplayedCount = 0;
  let inWindowEventsDisplayedCount = 0;

  for (const event of events) {
    const { startDate, endDate, isRange } = getEventRange(event);

    if (isRange) {
      if (endDate < today) {
        hiddenPastEventsCount += 1;
        continue;
      }

      if (startDate > windowEnd) {
        continue;
      }

      const isOngoing = isRangeOngoingToday(startDate, endDate, today);
      const isFutureWithinWindow = startDate > today && startDate <= windowEnd;

      if (!isOngoing && !isFutureWithinWindow) {
        continue;
      }

      visibleEvents.push({
        ...event,
        startDate,
        endDate,
        isOngoing,
        timeLabel:
          event.timeLabel ??
          (isOngoing ? `Ongoing through ${formatShortDate(endDate)}` : `Runs ${formatShortDate(startDate)}–${formatShortDate(endDate)}`),
      });

      if (isOngoing) {
        ongoingEventsDisplayedCount += 1;
      } else {
        inWindowEventsDisplayedCount += 1;
      }

      continue;
    }

    const eventDate = startDate;

    if (eventDate < today) {
      hiddenPastEventsCount += 1;
      continue;
    }

    if (eventDate > windowEnd) {
      continue;
    }

    visibleEvents.push({
      ...event,
      startDate: event.startDate ?? eventDate,
      endDate: event.endDate ?? eventDate,
      isOngoing: false,
    });

    inWindowEventsDisplayedCount += 1;
  }

  return {
    events: visibleEvents,
    hiddenPastEventsCount,
    ongoingEventsDisplayedCount,
    inWindowEventsDisplayedCount,
  };
}

function formatShortDate(date: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    month: "short",
    day: "numeric",
  }).format(new Date(`${date}T12:00:00-05:00`));
}
