import "server-only";

import fs from "node:fs";
import path from "node:path";

import type { EventItem } from "@/types/dashboard";

export interface MusicTasteOverrideEntry {
  match: string;
  genreTags?: string[];
  scoreBoost?: number;
  scorePenalty?: number;
  reasons?: string[];
  greatLiveAct?: boolean;
  suppress?: boolean;
  liveReputationStatus?: EventItem["liveReputationStatus"];
  liveReputationConfidence?: number;
  metadataConfidenceBoost?: number;
}

export interface MusicTasteOverridesFile {
  version: 1;
  artists?: MusicTasteOverrideEntry[];
  titlePatterns?: MusicTasteOverrideEntry[];
  negativeMatches?: MusicTasteOverrideEntry[];
}

export interface LoadedMusicTasteOverrides {
  source: "local" | "example" | "empty";
  localFileFound: boolean;
  exampleFallbackUsed: boolean;
  warning?: string;
  invalidEntriesCount: number;
  artistOverridesCount: number;
  titlePatternOverridesCount: number;
  negativeMatchesCount: number;
  overrides: MusicTasteOverridesFile;
  cacheSignature: string;
}

export interface MusicTasteTarget {
  title: string;
  supportActs?: string;
  subtitle?: string;
  description?: string;
  rawGenre?: string;
  genreTags?: string[];
}

export interface MusicTasteOverrideImpact {
  matchedArtistCount: number;
  matchedTitlePatternCount: number;
  matchedNegativeCount: number;
  matchedTitles: string[];
  genreTags: string[];
  scoreAdjustment: number;
  reasons: string[];
  greatLiveAct: boolean;
  liveReputationStatus?: EventItem["liveReputationStatus"];
  liveReputationConfidence: number;
  metadataConfidenceBoost: number;
  suppress: boolean;
}

export interface MusicTasteOverrideSummary {
  source: LoadedMusicTasteOverrides["source"];
  localFileFound: boolean;
  exampleFallbackUsed: boolean;
  warning?: string;
  invalidEntriesCount: number;
  artistOverridesCount: number;
  titlePatternOverridesCount: number;
  negativeMatchesCount: number;
  matchedEventsCount: number;
  visibleMatchedTitles: string[];
}

const LOCAL_FILE_PATH = path.join(process.cwd(), "data", "music-taste.overrides.local.json");
const EXAMPLE_FILE_PATH = path.join(process.cwd(), "data", "music-taste.overrides.example.json");
const DEFAULT_OVERRIDES: MusicTasteOverridesFile = {
  version: 1,
  artists: [],
  titlePatterns: [],
  negativeMatches: [],
};

let cachedOverrides: LoadedMusicTasteOverrides | null = null;

function normalizeTasteText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function toStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(hasText).map((item) => item.trim());
}

function clampNumber(value: unknown, minimum: number, maximum: number): number | undefined {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return undefined;
  }

  return Math.min(Math.max(Math.round(value), minimum), maximum);
}

function sanitizeOverrideEntry(rawEntry: unknown): MusicTasteOverrideEntry | null {
  if (!rawEntry || typeof rawEntry !== "object") {
    return null;
  }

  const entry = rawEntry as Record<string, unknown>;
  if (!hasText(entry.match)) {
    return null;
  }

  const sanitizedEntry: MusicTasteOverrideEntry = {
    match: entry.match.trim(),
  };

  const genreTags = toStringList(entry.genreTags);
  if (genreTags.length > 0) {
    sanitizedEntry.genreTags = genreTags;
  }

  const scoreBoost = clampNumber(entry.scoreBoost, -50, 50);
  if (typeof scoreBoost === "number") {
    sanitizedEntry.scoreBoost = scoreBoost;
  }

  const scorePenalty = clampNumber(entry.scorePenalty, 0, 50);
  if (typeof scorePenalty === "number") {
    sanitizedEntry.scorePenalty = scorePenalty;
  }

  const reasons = toStringList(entry.reasons);
  if (reasons.length > 0) {
    sanitizedEntry.reasons = reasons;
  }

  if (typeof entry.greatLiveAct === "boolean") {
    sanitizedEntry.greatLiveAct = entry.greatLiveAct;
  }

  if (typeof entry.suppress === "boolean") {
    sanitizedEntry.suppress = entry.suppress;
  }

  if (
    entry.liveReputationStatus === "unknown" ||
    entry.liveReputationStatus === "not_found" ||
    entry.liveReputationStatus === "strong" ||
    entry.liveReputationStatus === "legendary"
  ) {
    sanitizedEntry.liveReputationStatus = entry.liveReputationStatus;
  }

  const liveReputationConfidence = clampNumber(entry.liveReputationConfidence, 0, 100);
  if (typeof liveReputationConfidence === "number") {
    sanitizedEntry.liveReputationConfidence = liveReputationConfidence;
  }

  const metadataConfidenceBoost = clampNumber(entry.metadataConfidenceBoost, 0, 10);
  if (typeof metadataConfidenceBoost === "number") {
    sanitizedEntry.metadataConfidenceBoost = metadataConfidenceBoost;
  }

  return sanitizedEntry;
}

function sanitizeOverridesFile(rawOverrides: unknown): {
  file: MusicTasteOverridesFile;
  invalidEntriesCount: number;
} {
  const sanitized: MusicTasteOverridesFile = {
    version: 1,
    artists: [],
    titlePatterns: [],
    negativeMatches: [],
  };

  if (!rawOverrides || typeof rawOverrides !== "object") {
    return { file: sanitized, invalidEntriesCount: 0 };
  }

  const source = rawOverrides as Record<string, unknown>;
  const invalidEntryCounts: number[] = [];

  if (source.version !== 1) {
    invalidEntryCounts.push(1);
  }

  for (const key of ["artists", "titlePatterns", "negativeMatches"] as const) {
    const rawEntries = source[key];

    if (!Array.isArray(rawEntries)) {
      continue;
    }

    const validEntries: MusicTasteOverrideEntry[] = [];
    let invalidCount = 0;

    for (const rawEntry of rawEntries) {
      const sanitizedEntry = sanitizeOverrideEntry(rawEntry);
      if (sanitizedEntry) {
        validEntries.push(sanitizedEntry);
      } else {
        invalidCount += 1;
      }
    }

    if (key === "artists") {
      sanitized.artists?.push(...validEntries);
    } else if (key === "titlePatterns") {
      sanitized.titlePatterns?.push(...validEntries);
    } else {
      sanitized.negativeMatches?.push(...validEntries);
    }
    invalidEntryCounts.push(invalidCount);
  }

  return {
    file: sanitized,
    invalidEntriesCount: invalidEntryCounts.reduce((total, value) => total + value, 0),
  };
}

function readJsonFile(filePath: string): unknown {
  const content = fs.readFileSync(filePath, "utf8");
  return JSON.parse(content) as unknown;
}

function getFileSignature(filePath: string): string {
  try {
    const stat = fs.statSync(filePath);
    return `${filePath}:${stat.mtimeMs}:${stat.size}`;
  } catch {
    return `${filePath}:missing`;
  }
}

function loadOverridesFromFile(filePath: string): {
  file: MusicTasteOverridesFile;
  invalidEntriesCount: number;
  warning?: string;
} {
  try {
    const parsed = readJsonFile(filePath);
    const { file, invalidEntriesCount } = sanitizeOverridesFile(parsed);

    if (invalidEntriesCount > 0) {
      return {
        file,
        invalidEntriesCount,
        warning: `${path.basename(filePath)} has ${invalidEntriesCount} invalid override entr${invalidEntriesCount === 1 ? "y" : "ies"}.`,
      };
    }

    return { file, invalidEntriesCount };
  } catch (error) {
    return {
      file: DEFAULT_OVERRIDES,
      invalidEntriesCount: 0,
      warning: error instanceof Error
        ? `${path.basename(filePath)} could not be read: ${error.message}`
        : `${path.basename(filePath)} could not be read.`,
    };
  }
}

export function loadMusicTasteOverrides(): LoadedMusicTasteOverrides {
  const localSignature = getFileSignature(LOCAL_FILE_PATH);
  const exampleSignature = getFileSignature(EXAMPLE_FILE_PATH);
  const currentSignature = `${localSignature}|${exampleSignature}`;

  if (cachedOverrides && cachedOverrides.cacheSignature === currentSignature) {
    return cachedOverrides;
  }

  if (fs.existsSync(LOCAL_FILE_PATH)) {
    const loaded = loadOverridesFromFile(LOCAL_FILE_PATH);
    cachedOverrides = {
      source: "local",
      localFileFound: true,
      exampleFallbackUsed: false,
      warning: loaded.warning,
      invalidEntriesCount: loaded.invalidEntriesCount,
      artistOverridesCount: loaded.file.artists?.length ?? 0,
      titlePatternOverridesCount: loaded.file.titlePatterns?.length ?? 0,
      negativeMatchesCount: loaded.file.negativeMatches?.length ?? 0,
      overrides: loaded.file,
      cacheSignature: currentSignature,
    };
    return cachedOverrides;
  }

  if (fs.existsSync(EXAMPLE_FILE_PATH)) {
    const loaded = loadOverridesFromFile(EXAMPLE_FILE_PATH);
    cachedOverrides = {
      source: "example",
      localFileFound: false,
      exampleFallbackUsed: true,
      warning: loaded.warning,
      invalidEntriesCount: loaded.invalidEntriesCount,
      artistOverridesCount: loaded.file.artists?.length ?? 0,
      titlePatternOverridesCount: loaded.file.titlePatterns?.length ?? 0,
      negativeMatchesCount: loaded.file.negativeMatches?.length ?? 0,
      overrides: loaded.file,
      cacheSignature: currentSignature,
    };
    return cachedOverrides;
  }

  cachedOverrides = {
    source: "empty",
    localFileFound: false,
    exampleFallbackUsed: false,
    invalidEntriesCount: 0,
    artistOverridesCount: 0,
    titlePatternOverridesCount: 0,
    negativeMatchesCount: 0,
    overrides: DEFAULT_OVERRIDES,
    cacheSignature: currentSignature,
  };

  return cachedOverrides;
}

function buildSearchText(target: MusicTasteTarget): string {
  return [
    target.title,
    target.supportActs,
    target.subtitle,
    target.description,
    target.rawGenre,
    ...(target.genreTags ?? []),
  ]
    .filter(hasText)
    .map((value) => normalizeTasteText(value))
    .join(" ");
}

function getMatchKindValue(kind: "artist" | "titlePattern" | "negative"): number {
  switch (kind) {
    case "artist":
      return 3;
    case "titlePattern":
      return 2;
    case "negative":
      return 1;
    default:
      return 0;
  }
}

function getMatches(
  target: MusicTasteTarget,
): Array<{ kind: "artist" | "titlePattern" | "negative"; entry: MusicTasteOverrideEntry; matchText: string }> {
  const overrides = loadMusicTasteOverrides();
  const searchText = buildSearchText(target);

  return [
    ...((overrides.overrides.artists ?? []).map((entry) => ({ kind: "artist" as const, entry })) ?? []),
    ...((overrides.overrides.titlePatterns ?? []).map((entry) => ({ kind: "titlePattern" as const, entry })) ?? []),
    ...((overrides.overrides.negativeMatches ?? []).map((entry) => ({ kind: "negative" as const, entry })) ?? []),
  ]
    .filter(({ entry }) => normalizeTasteText(entry.match).length > 0 && searchText.includes(normalizeTasteText(entry.match)))
    .sort((left, right) => {
      const kindDelta = getMatchKindValue(right.kind) - getMatchKindValue(left.kind);
      if (kindDelta !== 0) {
        return kindDelta;
      }

      return normalizeTasteText(left.entry.match).length - normalizeTasteText(right.entry.match).length;
    })
    .map(({ kind, entry }) => ({
      kind,
      entry,
      matchText: normalizeTasteText(entry.match),
    }));
}

export function getMusicTasteOverrideImpact(target: MusicTasteTarget): MusicTasteOverrideImpact {
  const matched = getMatches(target);
  const matchedArtists = matched.filter((entry) => entry.kind === "artist");
  const matchedTitlePatterns = matched.filter((entry) => entry.kind === "titlePattern");
  const matchedNegative = matched.filter((entry) => entry.kind === "negative");

  const genreTags = new Set<string>(target.genreTags ?? []);
  const reasons: string[] = [];
  let artistScoreAdjustment = 0;
  let titlePatternScoreAdjustment = 0;
  let negativeScoreAdjustment = 0;
  let greatLiveAct = false;
  let liveReputationStatus: EventItem["liveReputationStatus"] | undefined;
  let liveReputationConfidence = 0;
  let metadataConfidenceBoost = 0;
  let suppress = false;

  for (const entry of matchedArtists) {
    const { entry: override } = entry;
    const boost = Math.min(Math.max(override.scoreBoost ?? 0, -50), 35);

    artistScoreAdjustment += boost;
    metadataConfidenceBoost += override.metadataConfidenceBoost ?? 0;
    override.genreTags?.forEach((tag) => genreTags.add(tag));
    override.reasons?.forEach((reason) => reasons.push(reason));

    if (override.greatLiveAct) {
      greatLiveAct = true;
      liveReputationStatus = override.liveReputationStatus ?? "strong";
      liveReputationConfidence = Math.max(liveReputationConfidence, override.liveReputationConfidence ?? 75);
      if (!override.reasons?.length) {
        reasons.push("artist override: great live act");
      }
    }

    if (override.suppress) {
      suppress = true;
    }
  }

  for (const entry of matchedTitlePatterns) {
    const { entry: override } = entry;
    const boost = Math.min(Math.max(override.scoreBoost ?? 0, -25), 15);

    titlePatternScoreAdjustment += boost;
    metadataConfidenceBoost += override.metadataConfidenceBoost ?? 0;
    override.genreTags?.forEach((tag) => genreTags.add(tag));
    override.reasons?.forEach((reason) => reasons.push(reason));

    if (override.greatLiveAct) {
      greatLiveAct = true;
      liveReputationStatus = override.liveReputationStatus ?? liveReputationStatus ?? "strong";
      liveReputationConfidence = Math.max(liveReputationConfidence, override.liveReputationConfidence ?? 60);
      if (!override.reasons?.length) {
        reasons.push("local override: great live act");
      }
    }

    if (override.suppress) {
      suppress = true;
    }
  }

  for (const entry of matchedNegative) {
    const { entry: override } = entry;
    const penalty = Math.min(Math.max(override.scorePenalty ?? 0, 0), 25);

    negativeScoreAdjustment += penalty;
    metadataConfidenceBoost += override.metadataConfidenceBoost ?? 0;
    override.genreTags?.forEach((tag) => genreTags.add(tag));
    override.reasons?.forEach((reason) => reasons.push(reason));

    if (override.greatLiveAct) {
      greatLiveAct = true;
      liveReputationStatus = override.liveReputationStatus ?? liveReputationStatus ?? "strong";
      liveReputationConfidence = Math.max(liveReputationConfidence, override.liveReputationConfidence ?? 55);
      if (!override.reasons?.length) {
        reasons.push("artist override: great live act");
      }
    }

    if (override.suppress) {
      suppress = true;
    }
  }

  if (matchedArtists.length > 0 && reasons.length === 0) {
    reasons.push("artist override: strong taste match");
  }

  if (matchedTitlePatterns.length > 0 && reasons.length === 0) {
    reasons.push("local override: genre tags added");
  }

  if (matchedNegative.length > 0 && reasons.length === 0) {
    reasons.push("local override: lower-interest pattern");
  }

  const scoreAdjustment =
    Math.min(Math.max(artistScoreAdjustment, 0), 35) +
    Math.min(Math.max(titlePatternScoreAdjustment, 0), 15) -
    Math.min(Math.max(negativeScoreAdjustment, 0), 25);

  return {
    matchedArtistCount: matchedArtists.length,
    matchedTitlePatternCount: matchedTitlePatterns.length,
    matchedNegativeCount: matchedNegative.length,
    matchedTitles: matched.map(({ entry }) => entry.match),
    genreTags: [...genreTags],
    scoreAdjustment,
    reasons,
    greatLiveAct,
    liveReputationStatus,
    liveReputationConfidence,
    metadataConfidenceBoost,
    suppress,
  };
}

export function getMusicTasteOverrideSummary(events: MusicTasteTarget[]): MusicTasteOverrideSummary {
  const loaded = loadMusicTasteOverrides();
  const matchedTitles = new Set<string>();
  let matchedEventsCount = 0;

  for (const event of events) {
    const impact = getMusicTasteOverrideImpact(event);

    if (impact.matchedArtistCount + impact.matchedTitlePatternCount + impact.matchedNegativeCount > 0) {
      matchedEventsCount += 1;
      matchedTitles.add(event.title);
    }
  }

  return {
    source: loaded.source,
    localFileFound: loaded.localFileFound,
    exampleFallbackUsed: loaded.exampleFallbackUsed,
    warning: loaded.warning,
    invalidEntriesCount: loaded.invalidEntriesCount,
    artistOverridesCount: loaded.artistOverridesCount,
    titlePatternOverridesCount: loaded.titlePatternOverridesCount,
    negativeMatchesCount: loaded.negativeMatchesCount,
    matchedEventsCount,
    visibleMatchedTitles: [...matchedTitles].slice(0, 6),
  };
}
