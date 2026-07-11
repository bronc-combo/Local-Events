import type { EventItem, SourceLink } from "@/types/dashboard";
import {
  getMusicTasteOverrideImpact,
  type MusicTasteTarget,
} from "@/lib/music-taste-overrides";

export interface EventSeed {
  id: string;
  title: string;
  dateTime: string;
  venue: string;
  city: string;
  category: string;
  sectionCategory?: EventItem["sectionCategory"];
  eventSubtype?: string;
  genreTags: string[];
  sourceLinks: SourceLink[];
  eventUrl?: string;
  eventUrlLabel?: "Event page" | "Source page";
  supportActs?: string;
  subtitle?: string;
  description?: string;
  rawGenre?: string;
  price?: string;
  ageRestriction?: string;
  room?: string;
  metadataConfidence?: number;
  similarArtists?: string[];
  isGreatLiveAct: boolean;
  liveReputationStatus?: "unknown" | "not_found" | "strong" | "legendary";
  liveReputationConfidence?: number;
  liveReputationReasons?: string[];
  liveReputationSources?: SourceLink[];
  venueFitScore: number;
  knownLiveReputationScore: number;
  rarityScore: number;
  distanceRelevanceScore: number;
  feedbackHistoryPlaceholderScore: number;
}

const GENRE_MATCH_KEYWORDS = [
  "experimental rock",
  "post-hardcore",
  "noise rock",
  "math rock",
  "metal",
  "doom",
  "sludge",
  "death metal",
  "black metal",
  "industrial",
  "experimental electronic",
  "techno",
  "idm",
  "drone",
  "ambient",
  "post-rock",
  "punk",
  "hardcore",
  "left-field hip-hop",
  "art rock",
  "free jazz",
  "jazz",
  "avant-garde",
  "americana",
  "folk",
  "irish",
  "celtic",
  "acoustic",
  "songwriter",
  "singer-songwriter",
  "country",
  "blues",
  "roots",
  "bluegrass",
];

function calculateGenreMatchScore(genreTags: string[]): number {
  const normalizedTags = genreTags.map((tag) => tag.toLowerCase());
  const matches = GENRE_MATCH_KEYWORDS.filter((keyword) => {
    return normalizedTags.some((tag) => tag.includes(keyword));
  });

  if (matches.length >= 3) {
    return 40;
  }

  if (matches.length === 2) {
    return 32;
  }

  if (matches.length === 1) {
    return 22;
  }

  if (normalizedTags.some((tag) => tag.includes("indie") || tag.includes("art"))) {
    return 14;
  }

  return 4;
}

function calculateCategoryBonus(category: string): number {
  const normalized = category.toLowerCase();

  if (normalized.includes("film")) {
    return 12;
  }

  if (normalized.includes("comedy")) {
    return 12;
  }

  if (normalized.includes("market")) {
    return 10;
  }

  if (normalized.includes("workshop") || normalized.includes("writers room") || normalized.includes("class")) {
    return 10;
  }

  if (normalized.includes("community art") || normalized.includes("art market")) {
    return 11;
  }

  if (normalized.includes("air hockey")) {
    return 14;
  }

  if (normalized.includes("games") || normalized.includes("tournament")) {
    return 8;
  }

  if (normalized.includes("run club") || normalized.includes("fitness") || normalized.includes("social")) {
    return 4;
  }

  if (
    normalized.includes("talk") ||
    normalized.includes("lecture") ||
    normalized.includes("gallery") ||
    normalized.includes("museum")
  ) {
    return 10;
  }

  if (normalized.includes("performance")) {
    return 8;
  }

  if (normalized.includes("activity") || normalized.includes("special event")) {
    return 6;
  }

  if (normalized.includes("arts") || normalized.includes("culture")) {
    return 8;
  }

  return 0;
}

function calculateNoisePenalty(title: string): number {
  const normalized = title.toLowerCase();
  const highNoiseTerms = [
    "karaoke",
    "open mic",
    "open jam",
    "industry karaoke",
    "music mixer",
    "happy hour show",
    "happy hour",
  ];
  const mediumNoiseTerms = [
    "tribute",
    "cover",
    "cover band",
    "cover act",
    "tribute act",
    "jam session",
    "showcase",
  ];

  if (highNoiseTerms.some((term) => normalized.includes(term))) {
    return 24;
  }

  if (mediumNoiseTerms.some((term) => normalized.includes(term))) {
    return 12;
  }

  return 0;
}

function isDateOnlyListing(title: string): boolean {
  const normalized = title.trim();

  return /^((monday|tuesday|wednesday|thursday|friday|saturday|sunday|sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)\s*,?\s*)?[a-z]+\s+\d{1,2}(?:,\s*\d{4})?(?:\s*[-–—]\s*(?:[a-z]+\s+\d{1,2}(?:,\s*\d{4})?)?)?$/i.test(
    normalized,
  );
}

function clampScore(value: number): number {
  return Math.min(Math.max(Math.round(value), 0), 100);
}

function isSpecificEventUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/\/+$/, "");

    if (!path || path === "") {
      return false;
    }

    if (/^\/?(events?|calendar|schedule|upcomingevents|event-calendar|upcoming|shows?)$/i.test(path)) {
      return false;
    }

    return /(?:\/|^)(event|details|show|ticket|program|rsvp|archive)[^/]*\/?/i.test(path);
  } catch {
    return false;
  }
}

function inferPrimaryEventLink(
  sourceLinks: SourceLink[],
): { eventUrl?: string; eventUrlLabel?: "Event page" | "Source page" } {
  if (sourceLinks.length === 0) {
    return {};
  }

  const explicitMatch = sourceLinks.find((link) => {
    const label = link.label.toLowerCase();
    const url = link.url.toLowerCase();
    return (
      /event page|discover more|details|buy tickets|tickets?|program|more info|rsvp/.test(label) ||
      isSpecificEventUrl(url)
    );
  });

  if (explicitMatch) {
    return {
      eventUrl: explicitMatch.url,
      eventUrlLabel: "Event page",
    };
  }

  const firstLink = sourceLinks[0];
  return {
    eventUrl: firstLink.url,
    eventUrlLabel: "Source page",
  };
}

function buildTasteReasons(seed: EventSeed): string[] {
  const reasons: string[] = [];
  const matchedGenres = seed.genreTags.slice(0, 2).join("/");
  const categoryBonus = calculateCategoryBonus(seed.category);
  const normalizedCategory = seed.category.toLowerCase();

  if (matchedGenres) {
    reasons.push(`${matchedGenres} match`);
  }

  if (categoryBonus >= 8) {
    if (normalizedCategory.includes("comedy")) {
      reasons.push("comedy fit");
    } else if (normalizedCategory.includes("market")) {
      reasons.push("market / community fit");
    } else if (normalizedCategory.includes("workshop")) {
      reasons.push("workshop fit");
    } else if (normalizedCategory.includes("community art")) {
      reasons.push("community art fit");
    } else if (normalizedCategory.includes("air hockey")) {
      reasons.push("air hockey tournament match");
    } else if (normalizedCategory.includes("games") || normalizedCategory.includes("tournament")) {
      reasons.push("games / tournament fit");
    } else if (normalizedCategory.includes("film") || normalizedCategory.includes("art") || normalizedCategory.includes("culture")) {
      reasons.push("arts & culture fit");
    } else {
      reasons.push("local event fit");
    }
  }

  if (seed.similarArtists && seed.similarArtists.length > 0) {
    reasons.push(`similar to ${seed.similarArtists.join(" / ")}`);
  }

  if (seed.rarityScore >= 8) {
    reasons.push("rarer or special booking");
  }

  if (reasons.length === 0) {
    reasons.push("local event fit");
  }

  return reasons;
}

function isMusicTasteEligible(seed: Pick<EventSeed, "category" | "sectionCategory">): boolean {
  if (seed.sectionCategory === "concert") {
    return true;
  }

  return /music|concert/i.test(seed.category);
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export function scoreEvent(seed: EventSeed): EventItem {
  const musicOverrideTarget: MusicTasteTarget = {
    title: seed.title,
    supportActs: seed.supportActs,
    subtitle: seed.subtitle,
    description: seed.description,
    rawGenre: seed.rawGenre,
    genreTags: seed.genreTags,
  };
  const musicTasteOverrideImpact = isMusicTasteEligible(seed)
    ? getMusicTasteOverrideImpact(musicOverrideTarget)
    : {
        matchedArtistCount: 0,
        matchedTitlePatternCount: 0,
        matchedNegativeCount: 0,
        matchedTitles: [],
        genreTags: [],
        scoreAdjustment: 0,
        reasons: [],
        greatLiveAct: false,
        liveReputationConfidence: 0,
        metadataConfidenceBoost: 0,
        suppress: false,
      };
  const genreTags = dedupeStrings([...seed.genreTags, ...musicTasteOverrideImpact.genreTags]);
  const primaryLink = seed.eventUrl
    ? {
        eventUrl: seed.eventUrl,
        eventUrlLabel: seed.eventUrlLabel ?? (isSpecificEventUrl(seed.eventUrl) ? "Event page" : "Source page"),
      }
    : inferPrimaryEventLink(seed.sourceLinks);
  const tasteScore = clampScore(
    calculateGenreMatchScore(genreTags) +
      calculateCategoryBonus(seed.category) +
      seed.rarityScore +
      seed.distanceRelevanceScore +
      seed.feedbackHistoryPlaceholderScore -
      calculateNoisePenalty(seed.title) +
      musicTasteOverrideImpact.scoreAdjustment,
  );

  const tasteReasons = dedupeStrings([
    ...musicTasteOverrideImpact.reasons,
    ...buildTasteReasons({
      ...seed,
      genreTags,
    }),
  ]);
  const isLowPriority = tasteScore < 45;
  const titleIsDateOnly = isDateOnlyListing(seed.title);
  const shouldSuppress = musicTasteOverrideImpact.suppress;

  // A later enrichment step can raise this from unknown when we have
  // explicit evidence from user feedback, curated lists, or public consensus.
  return {
    id: seed.id,
    title: seed.title,
    dateTime: seed.dateTime,
    venue: seed.venue,
    city: seed.city,
    category: seed.category,
    sectionCategory: seed.sectionCategory,
    eventSubtype: seed.eventSubtype,
    genreTags,
    supportActs: seed.supportActs,
    subtitle: seed.subtitle,
    description: seed.description,
    rawGenre: seed.rawGenre,
    price: seed.price,
    ageRestriction: seed.ageRestriction,
    room: seed.room,
    metadataConfidence: seed.metadataConfidence,
    eventUrl: primaryLink.eventUrl,
    eventUrlLabel: primaryLink.eventUrlLabel,
    sourceLinks: seed.sourceLinks,
    tasteScore,
    tasteReasons,
    isGreatLiveAct: seed.isGreatLiveAct || musicTasteOverrideImpact.greatLiveAct,
    liveReputationStatus:
      musicTasteOverrideImpact.liveReputationStatus ?? seed.liveReputationStatus ?? "unknown",
    liveReputationConfidence: Math.max(
      seed.liveReputationConfidence ?? 0,
      musicTasteOverrideImpact.liveReputationConfidence,
    ),
    liveReputationReasons: seed.liveReputationReasons ?? [],
    liveReputationSources: seed.liveReputationSources ?? [],
    musicTasteOverrideSuppressed: shouldSuppress || undefined,
    hiddenReason: titleIsDateOnly
      ? "Skipped malformed date-only listing."
      : shouldSuppress
      ? "Hidden by local taste override."
      : isLowPriority
      ? "Lower priority for your taste profile: broader mainstream or weaker genre match."
      : undefined,
  };
}

export function sortEventsByTasteScore(events: EventItem[]): EventItem[] {
  return [...events].sort((left, right) => right.tasteScore - left.tasteScore);
}
