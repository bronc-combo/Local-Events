const HOUSTON_TIME_ZONE = "America/Chicago";

function formatParts(dateTime: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormatPart[] {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: HOUSTON_TIME_ZONE,
    ...options,
  }).formatToParts(new Date(dateTime));
}

function getPart(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  return parts.find((part) => part.type === type)?.value ?? "";
}

export function formatChicagoDateLabel(dateTime: string): string {
  const parts = formatParts(dateTime, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

  return `${getPart(parts, "weekday")}, ${getPart(parts, "month")} ${getPart(parts, "day")}`;
}

export function formatChicagoTimeLabel(dateTime: string): string {
  const parts = formatParts(dateTime, {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  return `${getPart(parts, "hour")}:${getPart(parts, "minute")} ${getPart(parts, "dayPeriod")}`;
}

export function formatChicagoDateTimeLabel(dateTime: string): string {
  return `${formatChicagoDateLabel(dateTime)} at ${formatChicagoTimeLabel(dateTime)}`;
}

export function formatChicagoShortDate(dateTime: string): string {
  const parts = formatParts(dateTime, {
    month: "short",
    day: "numeric",
  });

  return `${getPart(parts, "month")} ${getPart(parts, "day")}`;
}
