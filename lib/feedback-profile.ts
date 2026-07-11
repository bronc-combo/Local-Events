import type { EventItem } from "@/types/dashboard";

export type FeedbackType =
  | "interested"
  | "not_interested"
  | "hide_artist"
  | "already_saw";

export interface FeedbackPattern {
  match: string;
  weight: number;
  kind: "exact" | "title" | "support" | "subtitle" | "description" | "genre" | "genreTag";
}

export interface StoredFeedbackRule {
  id: string;
  type: FeedbackType;
  eventId: string;
  eventSignature: string;
  entityLabel: string;
  patterns: FeedbackPattern[];
  createdAt: string;
  updatedAt: string;
}

export interface LocalFeedbackProfile {
  version: 1;
  rules: StoredFeedbackRule[];
}

export interface LocalFeedbackLoadResult {
  profile: LocalFeedbackProfile;
  warning?: string;
  loaded: boolean;
}

export interface LocalFeedbackImpact {
  scoreAdjustment: number;
  reasons: string[];
  suppress: boolean;
  isGreatLiveAct: boolean;
  liveReputationStatus?: EventItem["liveReputationStatus"];
  liveReputationConfidence: number;
  matchedRuleIds: string[];
}

export interface LocalFeedbackSummary {
  loaded: boolean;
  warning?: string;
  explicitEventFeedbackCount: number;
  interestedCount: number;
  notInterestedCount: number;
  hiddenArtistCount: number;
  alreadySawCount: number;
  feedbackAdjustedVisibleEventsCount: number;
  feedbackHiddenEventsCount: number;
}

const DEFAULT_PROFILE: LocalFeedbackProfile = {
  version: 1,
  rules: [],
};

const FEEDBACK_BASE_SCORE: Record<FeedbackType, number> = {
  interested: 10,
  not_interested: -12,
  hide_artist: -100,
  already_saw: -10,
};

const FEEDBACK_REASON: Record<FeedbackType, string> = {
  interested: "boosted by your feedback",
  not_interested: "lowered by your feedback",
  hide_artist: "artist hidden by feedback",
  already_saw: "repeat appearance lowered by Already saw",
};

const GENERIC_PHRASES = new Set([
  "live",
  "music",
  "concert",
  "tour",
  "tickets",
  "ticket",
  "presents",
  "present",
  "doors",
  "show",
  "shows",
  "houston",
  "tx",
  "texas",
  "event",
  "events",
  "venue",
  "room",
  "stage",
  "hall",
  "club",
  "theater",
  "theatre",
  "and",
  "with",
  "w",
  "featuring",
  "feat",
  "at",
  "this",
  "that",
  "the",
  "a",
  "an",
  "night",
  "nights",
  "afternoon",
  "evening",
  "day",
  "days",
  "sun",
  "mon",
  "tue",
  "tues",
  "wed",
  "thu",
  "thur",
  "thurs",
  "fri",
  "sat",
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
]);

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function normalizeFeedbackText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitCandidatePhrases(value: string): string[] {
  return value
    .split(/(?:\/|\\| w\/ | with | featuring | feat\.?| and | · | - | — | – |\||,|;|:|\(|\)|\[|\]|\{|\})/i)
    .map((part) => normalizeFeedbackText(part))
    .filter((part) => part.length > 2);
}

function isUsefulPattern(value: string): boolean {
  if (!value || value.length < 3) {
    return false;
  }

  if (/^\d{1,2}(?::\d{2})?\s*(am|pm)?$/.test(value)) {
    return false;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const tokens = value.split(" ").filter(Boolean);
  if (tokens.length === 0) {
    return false;
  }

  if (tokens.every((token) => GENERIC_PHRASES.has(token))) {
    return false;
  }

  return true;
}

function uniquePatterns(patterns: FeedbackPattern[]): FeedbackPattern[] {
  const seen = new Set<string>();
  const deduped: FeedbackPattern[] = [];

  for (const pattern of patterns) {
    const key = `${pattern.kind}:${pattern.match}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(pattern);
  }

  return deduped;
}

export function buildEventFeedbackSignature(event: Pick<EventItem, "id" | "title" | "dateTime" | "startDate" | "sectionCategory" | "category">): string {
  return normalizeFeedbackText(
    [
      event.id,
      event.title,
      event.dateTime.slice(0, 10),
      event.startDate ?? "",
      event.sectionCategory ?? "",
      event.category,
    ].join(" | "),
  );
}

export function buildEventFeedbackPatterns(event: Pick<EventItem, "id" | "title" | "supportActs" | "subtitle" | "description" | "rawGenre" | "genreTags">): FeedbackPattern[] {
  const patterns: FeedbackPattern[] = [
    {
      match: normalizeFeedbackText(event.id),
      kind: "exact",
      weight: 1,
    },
    {
      match: normalizeFeedbackText(event.title),
      kind: "title",
      weight: 1,
    },
  ];

  for (const phrase of splitCandidatePhrases(event.title)) {
    if (isUsefulPattern(phrase)) {
      patterns.push({
        match: phrase,
        kind: "title",
        weight: 0.95,
      });
    }
  }

  if (hasText(event.supportActs)) {
    for (const phrase of splitCandidatePhrases(event.supportActs)) {
      if (isUsefulPattern(phrase)) {
        patterns.push({
          match: phrase,
          kind: "support",
          weight: 0.9,
        });
      }
    }
  }

  if (hasText(event.subtitle)) {
    for (const phrase of splitCandidatePhrases(event.subtitle)) {
      if (isUsefulPattern(phrase)) {
        patterns.push({
          match: phrase,
          kind: "subtitle",
          weight: 0.8,
        });
      }
    }
  }

  if (hasText(event.description)) {
    for (const phrase of splitCandidatePhrases(event.description).slice(0, 6)) {
      if (isUsefulPattern(phrase)) {
        patterns.push({
          match: phrase,
          kind: "description",
          weight: 0.5,
        });
      }
    }
  }

  if (hasText(event.rawGenre)) {
    for (const phrase of splitCandidatePhrases(event.rawGenre)) {
      if (isUsefulPattern(phrase)) {
        patterns.push({
          match: phrase,
          kind: "genre",
          weight: 0.7,
        });
      }
    }
  }

  for (const genreTag of event.genreTags ?? []) {
    const normalized = normalizeFeedbackText(genreTag);

    if (isUsefulPattern(normalized)) {
      patterns.push({
        match: normalized,
        kind: "genreTag",
        weight: 0.65,
      });
    }
  }

  return uniquePatterns(patterns);
}

export function buildFeedbackRuleFromEvent(
  event: Pick<EventItem, "id" | "title" | "supportActs" | "subtitle" | "description" | "rawGenre" | "genreTags" | "dateTime" | "startDate" | "sectionCategory" | "category">,
  type: FeedbackType,
): StoredFeedbackRule {
  const now = new Date().toISOString();

  return {
    id: `${normalizeFeedbackText(event.id)}:${type}`,
    type,
    eventId: event.id,
    eventSignature: buildEventFeedbackSignature(event),
    entityLabel: event.title,
    patterns: buildEventFeedbackPatterns(event),
    createdAt: now,
    updatedAt: now,
  };
}

export function loadLocalFeedbackProfile(rawValue: string | null): LocalFeedbackLoadResult {
  if (!rawValue) {
    return { profile: DEFAULT_PROFILE, loaded: true };
  }

  try {
    const parsed = JSON.parse(rawValue) as unknown;

    if (!parsed || typeof parsed !== "object") {
      return {
        profile: DEFAULT_PROFILE,
        loaded: true,
        warning: "Feedback profile was not an object and was ignored.",
      };
    }

    const candidate = parsed as Partial<LocalFeedbackProfile> & { rules?: unknown };
    if (candidate.version !== 1 || !Array.isArray(candidate.rules)) {
      return {
        profile: DEFAULT_PROFILE,
        loaded: true,
        warning: "Feedback profile format was not recognized and was ignored.",
      };
    }

    const rules: StoredFeedbackRule[] = [];

    for (const rawRule of candidate.rules) {
      if (!rawRule || typeof rawRule !== "object") {
        continue;
      }

      const rule = rawRule as Partial<StoredFeedbackRule>;

      if (
        !hasText(rule.id) ||
        !hasText(rule.eventId) ||
        !hasText(rule.eventSignature) ||
        !hasText(rule.entityLabel) ||
        !Array.isArray(rule.patterns) ||
        !hasText(rule.createdAt) ||
        !hasText(rule.updatedAt)
      ) {
        continue;
      }

      const type = rule.type;
      if (
        type !== "interested" &&
        type !== "not_interested" &&
        type !== "hide_artist" &&
        type !== "already_saw"
      ) {
        continue;
      }

      const patterns = rule.patterns.filter((pattern): pattern is FeedbackPattern => {
        return Boolean(
          pattern &&
            typeof pattern === "object" &&
            hasText(pattern.match) &&
            pattern.weight >= 0 &&
            pattern.weight <= 1 &&
            (pattern.kind === "exact" ||
              pattern.kind === "title" ||
              pattern.kind === "support" ||
              pattern.kind === "subtitle" ||
              pattern.kind === "description" ||
              pattern.kind === "genre" ||
              pattern.kind === "genreTag"),
        );
      });

      rules.push({
        id: rule.id,
        type,
        eventId: rule.eventId,
        eventSignature: rule.eventSignature,
        entityLabel: rule.entityLabel,
        patterns: uniquePatterns(patterns),
        createdAt: rule.createdAt,
        updatedAt: rule.updatedAt,
      });
    }

    return { profile: { version: 1, rules }, loaded: true };
  } catch (error) {
    return {
      profile: DEFAULT_PROFILE,
      loaded: true,
      warning: error instanceof Error ? `Feedback profile could not be read: ${error.message}` : "Feedback profile could not be read.",
    };
  }
}

export function serializeFeedbackProfile(profile: LocalFeedbackProfile): string {
  return JSON.stringify(profile);
}

export function getFeedbackRuleForEvent(
  event: Pick<EventItem, "id" | "title" | "dateTime" | "startDate" | "sectionCategory" | "category">,
  profile: LocalFeedbackProfile,
): StoredFeedbackRule | null {
  const signature = buildEventFeedbackSignature(event);

  return (
    profile.rules.find((rule) => rule.eventId === event.id || rule.eventSignature === signature) ?? null
  );
}

export function getFeedbackTypeForEvent(
  event: Pick<EventItem, "id" | "title" | "dateTime" | "startDate" | "sectionCategory" | "category">,
  profile: LocalFeedbackProfile,
): FeedbackType | null {
  return getFeedbackRuleForEvent(event, profile)?.type ?? null;
}

function getTargetText(
  event: Pick<EventItem, "id" | "title" | "supportActs" | "subtitle" | "description" | "rawGenre" | "genreTags">,
): string {
  return normalizeFeedbackText(
    [
      event.id,
      event.title,
      event.supportActs,
      event.subtitle,
      event.description,
      event.rawGenre,
      ...(event.genreTags ?? []),
    ]
      .filter(hasText)
      .join(" "),
  );
}

function matchRuleToEvent(
  event: Pick<EventItem, "id" | "title" | "supportActs" | "subtitle" | "description" | "rawGenre" | "genreTags" | "dateTime" | "startDate" | "sectionCategory" | "category">,
  rule: StoredFeedbackRule,
): { matched: boolean; weight: number } {
  const signature = buildEventFeedbackSignature(event);

  if (rule.eventId === event.id || rule.eventSignature === signature) {
    return { matched: true, weight: 1 };
  }

  const targetText = getTargetText(event);
  let bestWeight = 0;

  for (const pattern of rule.patterns) {
    if (targetText.includes(pattern.match)) {
      bestWeight = Math.max(bestWeight, pattern.weight);
    }
  }

  return {
    matched: bestWeight > 0,
    weight: bestWeight,
  };
}

export function getFeedbackImpactForEvent(
  event: Pick<EventItem, "id" | "title" | "supportActs" | "subtitle" | "description" | "rawGenre" | "genreTags" | "dateTime" | "startDate" | "sectionCategory" | "category">,
  profile: LocalFeedbackProfile,
): LocalFeedbackImpact {
  let scoreAdjustment = 0;
  let suppress = false;
  const isGreatLiveAct = false;
  const liveReputationStatus: EventItem["liveReputationStatus"] | undefined = undefined;
  const liveReputationConfidence = 0;
  const reasons: string[] = [];
  const matchedRuleIds: string[] = [];

  for (const rule of profile.rules) {
    const match = matchRuleToEvent(event, rule);

    if (!match.matched) {
      continue;
    }

    matchedRuleIds.push(rule.id);

    if (rule.type === "hide_artist") {
      suppress = true;
      reasons.push(FEEDBACK_REASON.hide_artist);
      continue;
    }

    const baseWeight = FEEDBACK_BASE_SCORE[rule.type];
    const adjustedWeight = Math.round(baseWeight * match.weight);

    scoreAdjustment += adjustedWeight;
    reasons.push(FEEDBACK_REASON[rule.type]);
  }

  const cappedAdjustment = suppress
    ? scoreAdjustment
    : Math.min(Math.max(scoreAdjustment, -25), 35);

  return {
    scoreAdjustment: cappedAdjustment,
    reasons: [...new Set(reasons)],
    suppress,
    isGreatLiveAct,
    liveReputationStatus,
    liveReputationConfidence,
    matchedRuleIds,
  };
}

export function buildFeedbackRuleMap(profile: LocalFeedbackProfile): Map<string, StoredFeedbackRule> {
  return new Map(profile.rules.map((rule) => [rule.id, rule]));
}

export function summarizeFeedbackProfile(
  profile: LocalFeedbackProfile,
  events: Array<Pick<EventItem, "id" | "title" | "supportActs" | "subtitle" | "description" | "rawGenre" | "genreTags" | "dateTime" | "startDate" | "sectionCategory" | "category" | "tasteScore" | "hiddenReason">>,
): LocalFeedbackSummary {
  let adjustedVisibleEventsCount = 0;
  let feedbackHiddenEventsCount = 0;

  for (const event of events) {
    const impact = getFeedbackImpactForEvent(event, profile);
    const adjustedScore = Math.min(Math.max(Math.round(event.tasteScore + impact.scoreAdjustment), 0), 100);
    const hiddenByFeedback = impact.suppress;
    const hiddenReason = event.hiddenReason;
    const isVisibleAfterFeedback = !hiddenByFeedback && !(hiddenReason && !hiddenReason.startsWith("Lower priority")) && adjustedScore >= 45;

    if (isVisibleAfterFeedback) {
      adjustedVisibleEventsCount += 1;
    }

    if (hiddenByFeedback && !hiddenReason) {
      feedbackHiddenEventsCount += 1;
    }
  }

  const countsByType = profile.rules.reduce(
    (acc, rule) => {
      acc[rule.type] += 1;
      return acc;
    },
    {
      interested: 0,
      not_interested: 0,
      hide_artist: 0,
      already_saw: 0,
    } as Record<FeedbackType, number>,
  );

  return {
    loaded: true,
    explicitEventFeedbackCount: profile.rules.length,
    interestedCount: countsByType.interested,
    notInterestedCount: countsByType.not_interested,
    hiddenArtistCount: countsByType.hide_artist,
    alreadySawCount: countsByType.already_saw,
    feedbackAdjustedVisibleEventsCount: adjustedVisibleEventsCount,
    feedbackHiddenEventsCount,
  };
}

export function createEmptyFeedbackProfile(): LocalFeedbackProfile {
  return {
    version: 1,
    rules: [],
  };
}
