import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const OUTPUT_PATH = path.join(ROOT, "data/food-drink.capacities.json");
const DEFAULT_INPUT_PATH = path.join(ROOT, "data/food-drink.capacities.import.json");
const NOW_ISO = new Date().toISOString();

function normalizeText(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
}

function normalizeComparableText(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getEntryName(entry) {
  return normalizeText(entry.title ?? entry.name);
}

function getEntryAddress(entry) {
  if (typeof entry.address === "string" && entry.address.trim()) {
    return entry.address.trim();
  }

  if (Array.isArray(entry.location)) {
    return entry.location.map((item) => normalizeText(item)).filter(Boolean).join(", ");
  }

  if (typeof entry.location === "string") {
    return entry.location.trim();
  }

  return "";
}

function getEntryType(entry) {
  return normalizeText(entry.type_ ?? entry.type ?? entry.diningFormat ?? entry.cuisineType) || "Food & Drink";
}

function getOptionalString(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
}

function getOptionalArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => getOptionalString(item)).filter(Boolean);
}

function parseRating(value) {
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

  const parsed = Number(trimmed);

  if (Number.isFinite(parsed)) {
    return parsed;
  }

  const starCount = (trimmed.match(/⭐/g) ?? []).length;

  return starCount > 0 ? starCount : undefined;
}

function normalizeWeekday(value) {
  const normalized = normalizeComparableText(value);

  const aliases = {
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

function normalizeTime(value) {
  const trimmed = normalizeText(value);

  if (!trimmed) {
    return "";
  }

  const match = trimmed.match(/^(\d{1,2})(?::(\d{2}))?\s*([ap]m)?$/i);

  if (!match) {
    return "";
  }

  let hours = Number(match[1]);
  const minutes = Number(match[2] ?? "0");
  const meridiem = match[3]?.toUpperCase();

  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || minutes < 0 || minutes > 59) {
    return "";
  }

  if (meridiem) {
    if (hours < 1 || hours > 12) {
      return "";
    }

    if (meridiem === "PM" && hours !== 12) {
      hours += 12;
    }

    if (meridiem === "AM" && hours === 12) {
      hours = 0;
    }
  } else if (hours > 23) {
    return "";
  }

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function normalizeStructuredSpecial(rawSpecial) {
  if (!rawSpecial || typeof rawSpecial !== "object") {
    return { special: null, warnings: ["Malformed structured special."] };
  }

  const warnings = [];
  const title = getOptionalString(rawSpecial.title);
  const description = getOptionalString(rawSpecial.description);
  const type = getOptionalString(rawSpecial.type);
  const source = getOptionalString(rawSpecial.source);

  const daysOfWeek = getOptionalArray(rawSpecial.daysOfWeek)
    .map((day) => normalizeWeekday(day))
    .filter(Boolean);

  if (Array.isArray(rawSpecial.daysOfWeek) && rawSpecial.daysOfWeek.length > 0 && daysOfWeek.length === 0) {
    warnings.push(`Ignored invalid day names for structured special${title ? ` "${title}"` : ""}.`);
  }

  const startTime = normalizeTime(rawSpecial.startTime);
  const endTime = normalizeTime(rawSpecial.endTime);

  if (rawSpecial.startTime && !startTime) {
    warnings.push(`Ignored invalid start time for structured special${title ? ` "${title}"` : ""}.`);
  }

  if (rawSpecial.endTime && !endTime) {
    warnings.push(`Ignored invalid end time for structured special${title ? ` "${title}"` : ""}.`);
  }

  const special = {
    ...(title ? { title } : {}),
    ...(description ? { description } : {}),
    ...(daysOfWeek.length > 0 ? { daysOfWeek } : {}),
    ...(startTime ? { startTime } : {}),
    ...(endTime ? { endTime } : {}),
    ...(type ? { type } : {}),
    ...(source ? { source } : {}),
  };

  if (!special.title && !special.description && !special.startTime && !special.endTime && !special.daysOfWeek) {
    return {
      special: null,
      warnings: ["Skipped empty structured special."],
    };
  }

  return {
    special,
    warnings,
  };
}

function mergeSpecials(existingSpecials = [], incomingSpecials = []) {
  const merged = [];
  const seen = new Map();

  const getKey = (special) => JSON.stringify([
    special?.title ?? "",
    Array.isArray(special?.daysOfWeek) ? special.daysOfWeek.join(",") : "",
    special?.type ?? "",
    special?.source ?? "",
  ]);

  const upsertSpecial = (special) => {
    const key = getKey(special);
    const existingIndex = seen.get(key);

    if (typeof existingIndex === "number") {
      const existing = merged[existingIndex];
      merged[existingIndex] = {
        ...existing,
        title: existing.title ?? special.title,
        description: existing.description ?? special.description,
        daysOfWeek: Array.isArray(existing.daysOfWeek) && existing.daysOfWeek.length > 0
          ? existing.daysOfWeek
          : special.daysOfWeek,
        startTime: existing.startTime ?? special.startTime,
        endTime: existing.endTime ?? special.endTime,
        type: existing.type ?? special.type,
        source: existing.source ?? special.source,
      };
      return;
    }

    seen.set(key, merged.length);
    merged.push(special);
  };

  for (const special of existingSpecials) {
    upsertSpecial(special);
  }

  for (const special of incomingSpecials) {
    upsertSpecial(special);
  }

  return merged;
}

function normalizeImportEntry(raw) {
  if (!raw || typeof raw !== "object") {
    return {
      entry: null,
      cleanupWarningCount: 0,
      warnings: ["Malformed entry."],
    };
  }

  const name = getEntryName(raw);

  if (!name) {
    return {
      entry: null,
      cleanupWarningCount: 0,
      warnings: ["Missing place name."],
    };
  }

  const specialWarnings = [];
  const normalizedSpecials = [];
  const specials = Array.isArray(raw.specials) ? raw.specials : [];

  for (const special of specials) {
    const normalized = normalizeStructuredSpecial(special);
    specialWarnings.push(...normalized.warnings);

    if (normalized.special) {
      normalizedSpecials.push(normalized.special);
    }
  }

  const happyHour = getOptionalString(raw.happyHour);
  const notes = getOptionalString(raw.notes);
  const source = getOptionalString(raw.source);
  const lastUpdated = getOptionalString(raw.lastUpdated);
  const address = getEntryAddress(raw);
  const neighborhood = getOptionalString(raw.neighborhood || raw.location);
  const type = getEntryType(raw);
  const entry = {
    title: name,
    name,
    type_: type,
    location: Array.isArray(raw.location)
      ? raw.location.map((item) => normalizeText(item)).filter(Boolean)
      : neighborhood
        ? neighborhood
        : undefined,
    address: address || undefined,
    googleMapsLink: getOptionalString(raw.googleMapsLink || raw.mapsUrl) || undefined,
    mapsUrl: getOptionalString(raw.mapsUrl || raw.googleMapsLink) || undefined,
    homepage: getOptionalString(raw.homepage) || undefined,
    instagram: getOptionalString(raw.instagram) || undefined,
    phoneNumber: getOptionalString(raw.phoneNumber) || undefined,
    cuisineType: getOptionalString(raw.cuisineType) || undefined,
    diningFormat: getOptionalString(raw.diningFormat) || undefined,
    estimatedCost: getOptionalString(raw.estimatedCost) || undefined,
    criticGuideMentions: Array.isArray(raw.criticGuideMentions) || typeof raw.criticGuideMentions === "string"
      ? raw.criticGuideMentions
      : undefined,
    wellReviewedItems: Array.isArray(raw.wellReviewedItems) || typeof raw.wellReviewedItems === "string"
      ? raw.wellReviewedItems
      : undefined,
    happyHour: happyHour || undefined,
    specials: normalizedSpecials.length > 0 ? normalizedSpecials : undefined,
    notes: notes || undefined,
    source: source || "Capacities import",
    neighborhood: neighborhood || undefined,
    hours: getOptionalString(raw.hours) || undefined,
    parkingSituation: getOptionalString(raw.parkingSituation) || undefined,
    hoursOfOperation: getOptionalString(raw.hoursOfOperation) || undefined,
    myRating: parseRating(raw.myRating),
    averagePublicRating: parseRating(raw.averagePublicRating),
    confirmed: typeof raw.confirmed === "boolean" ? raw.confirmed : undefined,
    lastUpdated: lastUpdated || undefined,
  };

  const hasMeaningfulHappyHour = Boolean(entry.happyHour);
  const hasStructuredSpecials = Array.isArray(entry.specials) && entry.specials.length > 0;

  return {
    entry,
    cleanupWarningCount:
      specialWarnings.length + (hasMeaningfulHappyHour && !hasStructuredSpecials ? 1 : 0),
    warnings: [
      ...specialWarnings,
      ...(hasMeaningfulHappyHour && !hasStructuredSpecials
        ? ["Free-text happy hour imported; consider structuring this later."]
        : []),
    ],
  };
}

function buildMatchKeys(entry) {
  const name = normalizeComparableText(getEntryName(entry));
  const address = normalizeComparableText(getEntryAddress(entry));

  return {
    name,
    nameAndAddress: name && address ? `${name}|${address}` : "",
  };
}

function isMeaningfulValue(value) {
  if (typeof value === "string") {
    return value.trim().length > 0;
  }

  if (Array.isArray(value)) {
    return value.length > 0;
  }

  return value !== undefined && value !== null;
}

function mergeEntry(existing, incoming) {
  const merged = { ...existing };
  let changed = false;

  const assignIfEmpty = (key, value) => {
    if (!isMeaningfulValue(value)) {
      return;
    }

    if (!isMeaningfulValue(merged[key])) {
      merged[key] = value;
      changed = true;
    }
  };

  assignIfEmpty("title", incoming.title);
  assignIfEmpty("name", incoming.name);
  assignIfEmpty("type_", incoming.type_);
  assignIfEmpty("location", incoming.location);
  assignIfEmpty("address", incoming.address);
  assignIfEmpty("neighborhood", incoming.neighborhood);
  assignIfEmpty("googleMapsLink", incoming.googleMapsLink);
  assignIfEmpty("mapsUrl", incoming.mapsUrl);
  assignIfEmpty("homepage", incoming.homepage);
  assignIfEmpty("instagram", incoming.instagram);
  assignIfEmpty("phoneNumber", incoming.phoneNumber);
  assignIfEmpty("cuisineType", incoming.cuisineType);
  assignIfEmpty("diningFormat", incoming.diningFormat);
  assignIfEmpty("estimatedCost", incoming.estimatedCost);
  assignIfEmpty("criticGuideMentions", incoming.criticGuideMentions);
  assignIfEmpty("wellReviewedItems", incoming.wellReviewedItems);
  assignIfEmpty("happyHour", incoming.happyHour);
  assignIfEmpty("notes", incoming.notes);
  assignIfEmpty("source", incoming.source);
  assignIfEmpty("hours", incoming.hours);
  assignIfEmpty("parkingSituation", incoming.parkingSituation);
  assignIfEmpty("hoursOfOperation", incoming.hoursOfOperation);
  assignIfEmpty("myRating", incoming.myRating);
  assignIfEmpty("averagePublicRating", incoming.averagePublicRating);
  assignIfEmpty("confirmed", incoming.confirmed);

  const existingSpecials = Array.isArray(merged.specials) ? merged.specials : [];
  const incomingSpecials = Array.isArray(incoming.specials) ? incoming.specials : [];
  const mergedSpecials = mergeSpecials(existingSpecials, incomingSpecials);

  if (mergedSpecials.length !== existingSpecials.length) {
    merged.specials = mergedSpecials;
    changed = true;
  }

  if (changed) {
    merged.lastUpdated = incoming.lastUpdated || NOW_ISO;
  } else if (!merged.lastUpdated && incoming.lastUpdated) {
    merged.lastUpdated = incoming.lastUpdated;
  }

  return {
    entry: merged,
    changed,
  };
}

function stringifyPretty(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function main() {
  const inputPath = process.argv[2] ? path.resolve(ROOT, process.argv[2]) : DEFAULT_INPUT_PATH;
  const [existingRaw, incomingRaw] = await Promise.all([
    readFile(OUTPUT_PATH, "utf8").catch(() => "[]"),
    readFile(inputPath, "utf8"),
  ]);

  const existingParsed = JSON.parse(existingRaw);
  const incomingParsed = JSON.parse(incomingRaw);

  if (!Array.isArray(existingParsed)) {
    throw new Error("The local Capacities file must contain a JSON array.");
  }

  if (!Array.isArray(incomingParsed)) {
    throw new Error("The import file must contain a JSON array.");
  }

  const normalizedIncoming = incomingParsed.map((raw) => normalizeImportEntry(raw));
  const warnings = [];
  const validIncoming = [];

  for (const result of normalizedIncoming) {
    warnings.push(...result.warnings);

    if (result.entry) {
      validIncoming.push(result);
    }
  }

  const existingEntries = existingParsed;
  const outputEntries = [...existingEntries];
  const indexByKey = new Map();

  for (let index = 0; index < outputEntries.length; index += 1) {
    const entry = outputEntries[index];
    const keys = buildMatchKeys(entry);

    if (keys.name) {
      indexByKey.set(keys.name, index);
    }

    if (keys.nameAndAddress) {
      indexByKey.set(keys.nameAndAddress, index);
    }
  }

  let addedCount = 0;
  let updatedCount = 0;
  let unchangedCount = 0;
  let specialsImported = 0;
  let specialsNeedCleanup = 0;

  for (const incomingResult of validIncoming) {
    const incoming = incomingResult.entry;
    const keys = buildMatchKeys(incoming);
    const preferredIndex = keys.nameAndAddress && indexByKey.has(keys.nameAndAddress)
      ? indexByKey.get(keys.nameAndAddress)
      : keys.name && indexByKey.has(keys.name)
        ? indexByKey.get(keys.name)
        : -1;

    if (preferredIndex === -1 || preferredIndex === undefined) {
      const newEntry = {
        ...incoming,
        lastUpdated: NOW_ISO,
      };

      outputEntries.push(newEntry);
      const newIndex = outputEntries.length - 1;

      if (keys.name) {
        indexByKey.set(keys.name, newIndex);
      }

      if (keys.nameAndAddress) {
        indexByKey.set(keys.nameAndAddress, newIndex);
      }

      addedCount += 1;
      specialsImported += Array.isArray(incoming.specials) ? incoming.specials.length : 0;
      specialsNeedCleanup += incomingResult.cleanupWarningCount;
      continue;
    }

    const merged = mergeEntry(outputEntries[preferredIndex], {
      ...incoming,
      lastUpdated: NOW_ISO,
    });

    outputEntries[preferredIndex] = merged.entry;

    if (merged.changed) {
      updatedCount += 1;
    } else {
      unchangedCount += 1;
    }

    specialsImported += Array.isArray(incoming.specials) ? incoming.specials.length : 0;
    specialsNeedCleanup += incomingResult.cleanupWarningCount;
  }

  await writeFile(OUTPUT_PATH, stringifyPretty(outputEntries), "utf8");

  const summaryLines = [
    "Capacities Food & Drink import complete.",
    `Places read: ${incomingParsed.length}`,
    `Places added: ${addedCount}`,
    `Places updated: ${updatedCount}`,
    `Places unchanged: ${unchangedCount}`,
    `Malformed entries skipped: ${incomingParsed.length - validIncoming.length}`,
    `Specials imported: ${specialsImported}`,
    `Specials needing manual cleanup: ${specialsNeedCleanup}`,
    `Wrote: data/food-drink.capacities.json`,
  ];

  console.log(summaryLines.join("\n"));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
