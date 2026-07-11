import type { EventItem } from "@/types/dashboard";

const HOUSTON_TIME_ZONE = "America/Chicago";
const DEFAULT_DESCRIPTION_NOTE = "End time not listed; default duration used by Daily Overview.";

export interface CalendarDownloadInfo {
  available: boolean;
  label: string;
  filename?: string;
  icsText?: string;
  unavailableReason?: string;
}

interface CalendarTiming {
  kind: "timed" | "all_day";
  start: string;
  end: string;
  note?: string;
}

function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "event";
}

function formatLocalDate(date: string): string {
  const normalized = date.trim();

  return normalized.replace(/-/g, "");
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00-05:00`);
  value.setDate(value.getDate() + days);

  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: HOUSTON_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(value).reduce<Record<string, string>>((accumulator, part) => {
    if (part.type !== "literal") {
      accumulator[part.type] = part.value;
    }

    return accumulator;
  }, {});

  return `${parts.year}-${parts.month}-${parts.day}`;
}

function getDefaultDurationMinutes(event: EventItem): number {
  const category = (event.sectionCategory ?? event.category).toLowerCase();

  if (category.includes("sports")) {
    return 180;
  }

  if (category.includes("concert")) {
    return 120;
  }

  if (
    category.includes("arts") ||
    category.includes("culture") ||
    category.includes("other")
  ) {
    return 90;
  }

  return 90;
}

function addMinutes(dateTime: string, minutes: number): string {
  const value = new Date(dateTime);
  value.setMinutes(value.getMinutes() + minutes);
  return value.toISOString();
}

function formatUtcIcsDateTime(dateTime: string): string {
  return new Date(dateTime)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

function hasExactTimeLabel(event: EventItem): boolean {
  const label = (event.timeLabel ?? "").trim();

  return /\b\d{1,2}:\d{2}\s?(?:AM|PM)\b/i.test(label) || /\b\d{1,2}\s?(?:AM|PM)\b/i.test(label);
}

function isAllDayStyleEvent(event: EventItem): boolean {
  const label = (event.timeLabel ?? "").trim().toLowerCase();

  if (event.startDate && event.endDate && event.startDate !== event.endDate) {
    return true;
  }

  if (!hasExactTimeLabel(event) && (event.startDate || event.endDate)) {
    return true;
  }

  return (
    label.includes("time not listed") ||
    label.includes("date listed on source") ||
    label.includes("all day") ||
    label.includes("ongoing") ||
    label.startsWith("runs ") ||
    label.startsWith("on view ")
  );
}

function getCalendarTiming(event: EventItem): CalendarTiming | null {
  if (event.sectionCategory === "sports" && !hasExactTimeLabel(event)) {
    return null;
  }

  if (isAllDayStyleEvent(event)) {
    const startDate = event.startDate ?? event.dateTime.slice(0, 10);
    const endDate = event.endDate ?? startDate;

    if (!startDate) {
      return null;
    }

    return {
      kind: "all_day",
      start: formatLocalDate(startDate),
      end: formatLocalDate(addDays(endDate, 1)),
      note: event.startDate && event.endDate && event.startDate !== event.endDate
        ? "All-day date range based on the event listing."
        : "Time not listed; added as an all-day calendar item.",
    };
  }

  const durationMinutes = getDefaultDurationMinutes(event);

  return {
    kind: "timed",
    start: formatUtcIcsDateTime(event.dateTime),
    end: formatUtcIcsDateTime(addMinutes(event.dateTime, durationMinutes)),
    note: DEFAULT_DESCRIPTION_NOTE,
  };
}

function getSummary(event: EventItem): string {
  return event.title;
}

function getDescription(event: EventItem, timing: CalendarTiming, url: string): string {
  const lines = [
    `Daily Overview recommendation for ${event.title}.`,
    `${event.venue}, ${event.city}.`,
    `Category: ${event.category}.`,
    `Source: ${event.sourceLabel ?? event.venue}.`,
    url ? `URL: ${url}.` : null,
    timing.note ? timing.note : null,
  ].filter((line): line is string => Boolean(line));

  return lines.join("\n");
}

function getEventUrl(event: EventItem): string | null {
  return event.eventUrl ?? event.sourceLinks[0]?.url ?? null;
}

export function buildCalendarDownloadInfo(event: EventItem): CalendarDownloadInfo {
  const timing = getCalendarTiming(event);

  if (!timing) {
    return {
      available: false,
      label: "Calendar unavailable: no exact date.",
      unavailableReason: "No reliable date or time could be derived for this event.",
    };
  }

  const eventUrl = getEventUrl(event);
  const uidSeed = `${event.id}-${timing.start}-${timing.end}`;
  const filenameDate = formatLocalDate(event.startDate ?? event.dateTime.slice(0, 10));
  const filename = `${slugify(event.title)}-${filenameDate}.ics`;
  const description = getDescription(event, timing, eventUrl ?? "");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Daily Overview//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${escapeIcsText(uidSeed)}@daily-overview.local`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}`,
    `SUMMARY:${escapeIcsText(getSummary(event))}`,
    timing.kind === "all_day"
      ? `DTSTART;VALUE=DATE:${timing.start}`
      : `DTSTART:${timing.start}`,
    timing.kind === "all_day"
      ? `DTEND;VALUE=DATE:${timing.end}`
      : `DTEND:${timing.end}`,
    event.venue || event.city
      ? `LOCATION:${escapeIcsText([event.venue, event.city].filter(Boolean).join(", "))}`
      : null,
    `DESCRIPTION:${escapeIcsText(description)}`,
    eventUrl ? `URL:${escapeIcsText(eventUrl)}` : null,
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter((line): line is string => Boolean(line));

  return {
    available: true,
    label: "Download .ics",
    filename,
    icsText: `${lines.join("\r\n")}\r\n`,
  };
}
