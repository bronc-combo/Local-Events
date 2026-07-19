import { readFile } from "node:fs/promises";
import { foodDrinkLowerPriority, foodDrinkPrimary } from "@/lib/mock-food-drink";
import type {
  FoodDrinkCoverageSummary,
  FoodDrinkSpecial,
  FoodDrinkSpecialDetail,
  EventItem,
  SourceLink,
} from "@/types/dashboard";

interface CapacitiesFoodDrinkStructuredSpecial {
  title?: string;
  description?: string;
  daysOfWeek?: string[];
  startTime?: string;
  endTime?: string;
  type?: string;
  source?: string;
}

interface CapacitiesFoodDrinkEntry {
  title?: string;
  name?: string;
  type_?: string;
  location?: string | string[];
  neighborhood?: string;
  address?: string;
  googleMapsLink?: string;
  mapsUrl?: string;
  homepage?: string;
  instagram?: string;
  phoneNumber?: string;
  cuisineType?: string;
  diningFormat?: string;
  estimatedCost?: string;
  criticGuideMentions?: string | string[];
  wellReviewedItems?: string | string[];
  happyHour?: string;
  specials?: CapacitiesFoodDrinkStructuredSpecial[];
  notes?: string;
  source?: string;
  hours?: string;
  parkingSituation?: string;
  hoursOfOperation?: string;
  myRating?: number | string;
  averagePublicRating?: number | string;
  confirmed?: boolean;
  lastUpdated?: string;
}

export interface FoodDrinkProviderResult {
  source: "local_capacities_export" | "mock_fallback";
  note: string;
  primaryItems: FoodDrinkSpecial[];
  lowerPriorityItems: FoodDrinkSpecial[];
  coverageSummary: FoodDrinkCoverageSummary;
}

const CAPACITIES_EXPORT_PATH = `${process.cwd()}/data/food-drink.capacities.json`;

function getSpecialText(entry: CapacitiesFoodDrinkEntry): string {
  if (entry.happyHour?.trim()) {
    return entry.happyHour.trim();
  }

  return "";
}

function getHappyHourLabel(entry: CapacitiesFoodDrinkEntry): string {
  if (entry.hoursOfOperation?.trim()) {
    return entry.hoursOfOperation.trim();
  }

  if (entry.hours?.trim()) {
    return entry.hours.trim();
  }

  if (entry.parkingSituation?.trim()) {
    return `Parking: ${entry.parkingSituation.trim()}`;
  }

  return "";
}

function buildSourceLinks(entry: CapacitiesFoodDrinkEntry): SourceLink[] {
  const links: SourceLink[] = [];

  if (entry.homepage?.trim()) {
    links.push({
      label: "Homepage",
      url: entry.homepage.trim(),
    });
  }

  if (entry.googleMapsLink?.trim() || entry.mapsUrl?.trim()) {
    links.push({
      label: "Google Maps",
      url: (entry.googleMapsLink ?? entry.mapsUrl ?? "").trim(),
    });
  }

  if (entry.instagram?.trim()) {
    links.push({
      label: "Instagram",
      url: entry.instagram.trim(),
    });
  }

  return links;
}

function normalizeOptionalText(value?: string | string[]): string | undefined {
  if (Array.isArray(value)) {
    const joined = value.map((item) => item.trim()).filter(Boolean).join(", ");
    return joined || undefined;
  }

  const trimmed = value?.trim();
  return trimmed || undefined;
}

function parseRating(value?: number | string): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();

  if (!trimmed) {
    return undefined;
  }

  const directNumber = Number(trimmed);

  if (Number.isFinite(directNumber)) {
    return directNumber;
  }

  const starCount = (trimmed.match(/⭐/g) ?? []).length;

  if (starCount > 0) {
    return starCount;
  }

  return undefined;
}

function normalizeWeekday(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  const aliases: Record<string, string> = {
    sun: "sunday",
    sunday: "sunday",
    mon: "monday",
    monday: "monday",
    tue: "tuesday",
    tues: "tuesday",
    tuesday: "tuesday",
    wed: "wednesday",
    wednesday: "wednesday",
    thu: "thursday",
    thur: "thursday",
    thurs: "thursday",
    thursday: "thursday",
    fri: "friday",
    friday: "friday",
    sat: "saturday",
    saturday: "saturday",
  };

  return aliases[normalized] ?? null;
}

function getHoustonWeekdayIndex(): number {
  const dayName = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    weekday: "long",
  }).format(new Date());

  const dayMap: Record<string, number> = {
    sunday: 0,
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6,
  };

  return dayMap[dayName.toLowerCase()] ?? 0;
}

function getHoustonWeekdayName(): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    weekday: "long",
  }).format(new Date()).toLowerCase();
}

function getHoustonTodayDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function getWeekdayKeywords(index: number): string[] {
  const names = [
    ["sunday", "sun"],
    ["monday", "mon"],
    ["tuesday", "tue", "tues"],
    ["wednesday", "wed"],
    ["thursday", "thu", "thur", "thurs"],
    ["friday", "fri"],
    ["saturday", "sat"],
  ];

  return names[index] ?? [];
}

function formatSpecialTimeRange(
  startTime?: string,
  endTime?: string,
): string | undefined {
  if (!startTime && !endTime) {
    return undefined;
  }

  const formatTime = (value: string): string => {
    const [hoursText, minutesText] = value.split(":");
    const hours = Number(hoursText);
    const minutes = Number(minutesText ?? "0");

    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
      return value;
    }

    const period = hours >= 12 ? "PM" : "AM";
    const displayHour = hours % 12 === 0 ? 12 : hours % 12;

    return `${displayHour}:${String(minutes).padStart(2, "0")} ${period}`;
  };

  if (startTime && endTime) {
    return `${formatTime(startTime)}-${formatTime(endTime)}`;
  }

  return startTime ? formatTime(startTime) : formatTime(endTime!);
}

function getTodayStructuredSpecials(
  specials?: CapacitiesFoodDrinkStructuredSpecial[],
): {
  todaySpecials: FoodDrinkSpecialDetail[];
  hasStructuredSpecialData: boolean;
  malformedSpecialCount: number;
} {
  if (!Array.isArray(specials) || specials.length === 0) {
    return {
      todaySpecials: [],
      hasStructuredSpecialData: false,
      malformedSpecialCount: 0,
    };
  }

  const todayName = getHoustonWeekdayName();
  let malformedSpecialCount = 0;

  const parsedSpecials = specials.map((special): FoodDrinkSpecialDetail | null => {
      if (!special || typeof special !== "object") {
        malformedSpecialCount += 1;
        return null;
      }

      const daysOfWeek = Array.isArray(special.daysOfWeek)
        ? special.daysOfWeek
            .map((day) => normalizeWeekday(day))
            .filter((day): day is string => Boolean(day))
        : [];

      if (Array.isArray(special.daysOfWeek) && special.daysOfWeek.length > 0 && daysOfWeek.length === 0) {
        malformedSpecialCount += 1;
        return null;
      }

      if (daysOfWeek.length > 0 && !daysOfWeek.includes(todayName)) {
        return null;
      }

      const title = normalizeOptionalText(special.title);
      const description = normalizeOptionalText(special.description);
      const displayTime = formatSpecialTimeRange(
        special.startTime,
        special.endTime,
      );

      if (!title && !description && !displayTime) {
        malformedSpecialCount += 1;
        return null;
      }

      return {
        title,
        description,
        startTime: normalizeOptionalText(special.startTime),
        endTime: normalizeOptionalText(special.endTime),
        displayTime,
        type: normalizeOptionalText(special.type),
        source: normalizeOptionalText(special.source),
      };
    });

  const todaySpecials = parsedSpecials.filter(
    (special): special is FoodDrinkSpecialDetail => special !== null,
  );

  return {
    todaySpecials,
    hasStructuredSpecialData: specials.length > malformedSpecialCount,
    malformedSpecialCount,
  };
}

function appliesRange(
  text: string,
  startAliases: string[],
  endAliases: string[],
  todayIndex: number,
): boolean | null {
  const normalized = text.toLowerCase();
  const week = [
    ["sun", "sunday"],
    ["mon", "monday"],
    ["tue", "tues", "tuesday"],
    ["wed", "wednesday"],
    ["thu", "thur", "thurs", "thursday"],
    ["fri", "friday"],
    ["sat", "saturday"],
  ];

  const startIndex = week.findIndex((aliases) =>
    aliases.some((alias) => startAliases.includes(alias)),
  );
  const endIndex = week.findIndex((aliases) =>
    aliases.some((alias) => endAliases.includes(alias)),
  );

  if (startIndex === -1 || endIndex === -1) {
    return null;
  }

  const joinedStart = startAliases.join("|");
  const joinedEnd = endAliases.join("|");
  const rangePattern = new RegExp(
    `\\b(?:${joinedStart})\\s*(?:-|–|—|to)\\s*(?:${joinedEnd})\\b`,
    "i",
  );

  if (!rangePattern.test(normalized)) {
    return null;
  }

  if (startIndex <= endIndex) {
    return todayIndex >= startIndex && todayIndex <= endIndex;
  }

  return todayIndex >= startIndex || todayIndex <= endIndex;
}

function evaluateTodayApplicability(scheduleText?: string): {
  appliesToday: boolean;
  status: "applies_today" | "not_today" | "unparseable" | "missing";
} {
  const normalized = scheduleText?.trim().toLowerCase();

  if (!normalized) {
    return {
      appliesToday: false,
      status: "missing",
    };
  }

  const todayIndex = getHoustonWeekdayIndex();
  const todayKeywords = getWeekdayKeywords(todayIndex);

  if (/\b(daily|every day|everyday)\b/i.test(normalized)) {
    return {
      appliesToday: true,
      status: "applies_today",
    };
  }

  if (/\b(weekdays|weekday)\b/i.test(normalized)) {
    return {
      appliesToday: todayIndex >= 1 && todayIndex <= 5,
      status: todayIndex >= 1 && todayIndex <= 5 ? "applies_today" : "not_today",
    };
  }

  if (/\b(weekends|weekend)\b/i.test(normalized)) {
    return {
      appliesToday: todayIndex === 0 || todayIndex === 6,
      status: todayIndex === 0 || todayIndex === 6 ? "applies_today" : "not_today",
    };
  }

  const knownRanges = [
    [["mon", "monday"], ["fri", "friday"]],
    [["monday"], ["friday"]],
    [["sun", "sunday"], ["thu", "thursday"]],
    [["tue", "tuesday"], ["sat", "saturday"]],
  ] as const;

  for (const [startAliases, endAliases] of knownRanges) {
    const rangeResult = appliesRange(
      normalized,
      [...startAliases],
      [...endAliases],
      todayIndex,
    );

    if (rangeResult !== null) {
      return {
        appliesToday: rangeResult,
        status: rangeResult ? "applies_today" : "not_today",
      };
    }
  }

  const matchedTodayKeyword = todayKeywords.some((keyword) =>
    new RegExp(`\\b${keyword}\\b`, "i").test(normalized),
  );

  const otherDayKeywords = [
    ["sun", "sunday"],
    ["mon", "monday"],
    ["tue", "tues", "tuesday"],
    ["wed", "wednesday"],
    ["thu", "thur", "thurs", "thursday"],
    ["fri", "friday"],
    ["sat", "saturday"],
  ]
    .flat()
    .filter((keyword) => !todayKeywords.includes(keyword));

  const matchedOtherDayKeyword = otherDayKeywords.some((keyword) =>
    new RegExp(`\\b${keyword}\\b`, "i").test(normalized),
  );

  if (matchedTodayKeyword) {
    return {
      appliesToday: true,
      status: "applies_today",
    };
  }

  if (matchedOtherDayKeyword) {
    return {
      appliesToday: false,
      status: "not_today",
    };
  }

  return {
    appliesToday: false,
    status: "unparseable",
  };
}

function mapCapacitiesEntry(
  entry: CapacitiesFoodDrinkEntry,
  index: number,
): FoodDrinkSpecial | null {
  const title = entry.title?.trim() || entry.name?.trim();

  if (!title) {
    return null;
  }

  const address = normalizeOptionalText(entry.address);
  const type = entry.type_?.trim()
    || entry.diningFormat?.trim()
    || entry.cuisineType?.trim()
    || "Food & Drink";
  const verificationStatus = entry.confirmed
    ? "Confirmed"
    : "From Capacities only";
  const structuredSpecialResult = getTodayStructuredSpecials(entry.specials);
  const todaySpecials = structuredSpecialResult.todaySpecials;
  const special = normalizeOptionalText(getSpecialText(entry));
  const happyHour = normalizeOptionalText(getHappyHourLabel(entry));
  const sourceLinks = buildSourceLinks(entry);
  const myRating = parseRating(entry.myRating);
  const hasUsefulDetails = Boolean(address || sourceLinks.length > 0);
  const hasHappyHour = todaySpecials.length > 0 || Boolean(special);
  const needsMoreDetails = !hasHappyHour && myRating === undefined && !hasUsefulDetails;
  const fallbackScheduleEvaluation = evaluateTodayApplicability(special);
  const usesStructuredSpecials = todaySpecials.length > 0;
  const usesFreeTextFallback = !usesStructuredSpecials && Boolean(special);
  const appliesToday = usesStructuredSpecials
    ? true
    : fallbackScheduleEvaluation.appliesToday;
  const specialScheduleStatus = usesStructuredSpecials
    ? "applies_today"
    : fallbackScheduleEvaluation.status;

  return {
    id: `capacities-food-drink-${index}-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    name: title,
    title,
    type,
    address,
    neighborhood: normalizeOptionalText(entry.neighborhood ?? entry.location),
    special,
    happyHour,
    source: "Capacities export",
    verificationStatus,
    sourceLinks,
    notes: normalizeOptionalText(entry.notes),
    mapsUrl: normalizeOptionalText(entry.mapsUrl),
    hours: normalizeOptionalText(entry.hours ?? entry.hoursOfOperation),
    lastUpdated: normalizeOptionalText(entry.lastUpdated),
    myRating,
    estimatedCost: entry.estimatedCost?.trim(),
    hasHappyHour,
    hasUsefulDetails,
    needsMoreDetails,
    appliesToday,
    specialScheduleStatus,
    todaySpecials,
    hasStructuredSpecialData: structuredSpecialResult.hasStructuredSpecialData,
    usesFreeTextFallback,
    malformedStructuredSpecialCount: structuredSpecialResult.malformedSpecialCount,
    exportOrder: index,
    hiddenReason:
      specialScheduleStatus === "missing"
        ? "No saved happy hour or special yet."
        : specialScheduleStatus === "not_today"
          ? "Saved special does not apply today."
          : specialScheduleStatus === "unparseable"
            ? "Saved special could not be matched to today."
            : undefined,
  };
}

function scoreFoodDrinkItem(item: FoodDrinkSpecial): number {
  const todayRank = item.appliesToday ? 4 : 0;
  const ratingRank = item.myRating !== undefined ? 3 : 0;
  const usefulDetailsRank = item.hasUsefulDetails ? 2 : 0;
  const structuredSpecialRank = (item.todaySpecials?.length ?? 0) > 0 ? 1 : 0;

  return todayRank * 10000
    + structuredSpecialRank * 5000
    + ratingRank * 1000
    + usefulDetailsRank * 100
    - (item.exportOrder ?? 0);
}

function sortFoodDrinkItems(items: FoodDrinkSpecial[]): FoodDrinkSpecial[] {
  return [...items].sort((left, right) => {
    return scoreFoodDrinkItem(right) - scoreFoodDrinkItem(left);
  });
}

function splitFoodDrinkItems(items: FoodDrinkSpecial[]): {
  primaryItems: FoodDrinkSpecial[];
  lowerPriorityItems: FoodDrinkSpecial[];
} {
  const todayRelevantItems = items.filter((item) => item.appliesToday);
  const sorted = sortFoodDrinkItems(todayRelevantItems);

  return {
    primaryItems: sorted,
    lowerPriorityItems: [],
  };
}

function buildCoverageSummary(
  items: FoodDrinkSpecial[],
  source: FoodDrinkCoverageSummary["source"],
  note: string,
  todayEventsCount = 0,
): FoodDrinkCoverageSummary {
  const latestUpdatedIso = items
    .map((item) => item.lastUpdated)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1);

  return {
    source,
    totalEntriesLoaded: items.length,
    displayedTodayCount: items.filter((item) => item.appliesToday).length,
    surfacedTodayEventsCount: todayEventsCount,
    structuredSpecialEntryCount: items.filter((item) => item.hasStructuredSpecialData).length,
    freeTextFallbackEntryCount: items.filter((item) => item.usesFreeTextFallback).length,
    structuredSpecialsSurfacedCount: items.filter((item) => item.appliesToday && item.hasStructuredSpecialData).length,
    freeTextFallbackSurfacedCount: items.filter((item) => item.appliesToday && item.usesFreeTextFallback).length,
    hiddenNoSpecialCount: items.filter((item) => item.specialScheduleStatus === "missing").length,
    hiddenNotTodayCount: items.filter((item) => item.specialScheduleStatus === "not_today").length,
    malformedSpecialCount: items.reduce(
      (total, item) => total + (item.malformedStructuredSpecialCount ?? 0),
      0,
    ),
    unparseableFreeTextCount: items.filter((item) => item.specialScheduleStatus === "unparseable").length,
    sourceDetail: source === "local_capacities_export"
      ? "Local Capacities export file"
      : "Mock fallback data",
    lastUpdatedLabel: latestUpdatedIso
      ? new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Chicago",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }).format(new Date(latestUpdatedIso))
      : undefined,
    localExportPath: source === "local_capacities_export" ? CAPACITIES_EXPORT_PATH : undefined,
    note,
  };
}

function getMockFallbackResult(note: string): FoodDrinkProviderResult {
  const mockItems = [...foodDrinkPrimary, ...foodDrinkLowerPriority];

  return {
    source: "mock_fallback",
    note,
    primaryItems: foodDrinkPrimary,
    lowerPriorityItems: foodDrinkLowerPriority,
    coverageSummary: buildCoverageSummary(mockItems, "mock_fallback", note),
  };
}

function formatTodaySpecialTime(item: FoodDrinkSpecial): string {
  const detail = item.todaySpecials?.[0];
  if (detail?.displayTime) {
    return detail.displayTime;
  }

  if (item.happyHour?.trim()) {
    return item.happyHour.trim();
  }

  if (item.specialScheduleStatus === "unparseable" || item.specialScheduleStatus === "missing") {
    return "Time not listed";
  }

  return "Today";
}

function getFoodDrinkPrimaryLink(item: FoodDrinkSpecial): { url: string; label: "Event page" | "Source page" } | null {
  const url = item.sourceLinks[0]?.url ?? item.mapsUrl;

  if (!url) {
    return null;
  }

  return {
    url,
    label: item.sourceLinks.length > 1 ? "Event page" : "Source page",
  };
}

function buildFoodDrinkTodayEvent(item: FoodDrinkSpecial, index: number, today: string): EventItem {
  const special = item.todaySpecials?.[0];
  const startTime = special?.startTime ?? "12:00:00";

  return {
    id: `food-drink-${item.id}-today-${index}`,
    title: special?.title?.trim()
      ? `${item.name} — ${special.title.trim()}`
      : `${item.name} — ${item.special ?? item.happyHour ?? "Today"}`,
    dateTime: `${today}T${startTime}-05:00`,
    venue: item.name,
    city: "Houston",
    category: "Food & Drink",
    sectionCategory: "food_drink",
    eventSubtype: special?.type?.trim() || (item.usesFreeTextFallback ? "Special" : "Happy hour"),
    sourceLabel: "Local Capacities export",
    eventUrl: getFoodDrinkPrimaryLink(item)?.url,
    eventUrlLabel: getFoodDrinkPrimaryLink(item)?.label,
    sourceLinks: item.sourceLinks,
    timeLabel: formatTodaySpecialTime(item),
    tasteScore: Math.min(
      55,
      30 + (item.myRating ? Math.round(item.myRating * 2) : 0) + (item.hasStructuredSpecialData ? 6 : 0) + (item.usesFreeTextFallback ? 2 : 0),
    ),
    tasteReasons: [
      "saved Food & Drink special for today",
      "from local Capacities export",
      ...(special?.description?.trim() ? [special.description.trim()] : []),
    ],
    isGreatLiveAct: false,
    liveReputationStatus: "unknown",
    hiddenReason: undefined,
  };
}

export function buildFoodDrinkTodayEvents(
  items: FoodDrinkSpecial[],
  today = getHoustonTodayDate(),
): EventItem[] {
  return items
    .filter((item) => item.appliesToday)
    .slice(0, 3)
    .map((item, index) => buildFoodDrinkTodayEvent(item, index, today));
}

export async function getFoodDrinkData(): Promise<FoodDrinkProviderResult> {
  try {
    const rawFile = await readFile(CAPACITIES_EXPORT_PATH, "utf8");
    const parsed = JSON.parse(rawFile);

    if (!Array.isArray(parsed) || parsed.length === 0) {
      return getMockFallbackResult(
        "Using Food & Drink mock data because no Capacities export was found.",
      );
    }

    const mappedItems = parsed
      .map((entry, index) => mapCapacitiesEntry(entry as CapacitiesFoodDrinkEntry, index))
      .filter((item): item is FoodDrinkSpecial => item !== null);

    if (mappedItems.length === 0) {
      return getMockFallbackResult(
        "Using Food & Drink mock data because no Capacities export was found.",
      );
    }

    const splitItems = splitFoodDrinkItems(mappedItems);
    const shownCount = splitItems.primaryItems.length;
    const todayEventCount = buildFoodDrinkTodayEvents(splitItems.primaryItems).length;
    const note =
      shownCount === 1
        ? "Using Food & Drink data from local Capacities export. Showing 1 today-relevant special."
        : `Using Food & Drink data from local Capacities export. Showing ${shownCount} today-relevant specials.`;

    return {
      source: "local_capacities_export",
      note,
      primaryItems: splitItems.primaryItems,
      lowerPriorityItems: splitItems.lowerPriorityItems,
      coverageSummary: buildCoverageSummary(mappedItems, "local_capacities_export", note, todayEventCount),
    };
  } catch (error) {
    if (
      error instanceof Error
      && "code" in error
      && error.code === "ENOENT"
    ) {
      return getMockFallbackResult(
        "Using Food & Drink mock data because no Capacities export was found.",
      );
    }

    return getMockFallbackResult(
      "Using Food & Drink mock data because the Capacities export could not be read.",
    );
  }
}
