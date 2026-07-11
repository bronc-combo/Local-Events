import {
  CONTINENTAL_CLUB_SOURCE_NAME,
  CONTINENTAL_CLUB_SOURCE_URL,
} from "@/lib/sources/continental-club";
import {
  DAN_ELECTROS_SOURCE_NAME,
  DAN_ELECTROS_SOURCE_URL,
} from "@/lib/sources/dan-electros";
import {
  SCOUT_BAR_SOURCE_NAME,
  SCOUT_BAR_SOURCE_URL,
} from "@/lib/sources/scout-bar";
import {
  MUCKY_DUCK_SOURCE_NAME,
  MUCKY_DUCK_SOURCE_URL,
} from "@/lib/sources/mucky-duck";
import {
  WHITE_OAK_SOURCE_NAME,
  WHITE_OAK_SOURCE_URL,
} from "@/lib/sources/white-oak";

export type VenuePriority = "mandatory" | "candidate" | "high_value";
export type VenueCategory = "music";
export type SourceReliability = "high" | "medium" | "limited" | "unknown";
export type ParserStatus = "working" | "limited" | "audited_limited" | "blocked" | "not_implemented";
export type VenueProviderId =
  | "white-oak"
  | "dan-electros"
  | "house-of-blues-houston"
  | "warehouse-live-midtown"
  | "heights-theater"
  | "713-music-hall"
  | "numbers"
  | "mucky-duck"
  | "axelrad"
  | "continental-club"
  | "scout-bar"
  | "the-end"
  | "secret-group"
  | "not_implemented";

export interface VenueRegistryEntry {
  id: string;
  name: string;
  displayName: string;
  city: string;
  area?: string;
  category: VenueCategory;
  priority: VenuePriority;
  officialUrl: string | null;
  eventSourceUrl: string | null;
  providerId: VenueProviderId | null;
  sourceReliability: SourceReliability;
  parserStatus: ParserStatus;
  notes?: string;
}

// Houston has a curated mandatory venue registry so these sources are always
// attempted before we fall back to any generic discovery flow.
export const HOUSTON_VENUE_REGISTRY: VenueRegistryEntry[] = [
  {
    id: "white-oak-music-hall",
    name: WHITE_OAK_SOURCE_NAME,
    displayName: WHITE_OAK_SOURCE_NAME,
    city: "Houston",
    area: "Near Northside",
    category: "music",
    priority: "mandatory",
    officialUrl: WHITE_OAK_SOURCE_URL,
    eventSourceUrl: WHITE_OAK_SOURCE_URL,
    providerId: "white-oak",
    sourceReliability: "high",
    parserStatus: "working",
    notes: "Mandatory Houston venue with a working official source parser.",
  },
  {
    id: "dan-electros",
    name: DAN_ELECTROS_SOURCE_NAME,
    displayName: DAN_ELECTROS_SOURCE_NAME,
    city: "Houston",
    area: "Heights",
    category: "music",
    priority: "mandatory",
    officialUrl: "https://danelectros.com/",
    eventSourceUrl: DAN_ELECTROS_SOURCE_URL,
    providerId: "dan-electros",
    sourceReliability: "high",
    parserStatus: "working",
    notes: "Mandatory Houston venue using the official upcoming events page.",
  },
  {
    id: "continental-club-houston",
    name: CONTINENTAL_CLUB_SOURCE_NAME,
    displayName: CONTINENTAL_CLUB_SOURCE_NAME,
    city: "Houston",
    area: "Midtown",
    category: "music",
    priority: "mandatory",
    officialUrl: CONTINENTAL_CLUB_SOURCE_URL,
    eventSourceUrl: CONTINENTAL_CLUB_SOURCE_URL,
    providerId: "continental-club",
    sourceReliability: "high",
    parserStatus: "working",
    notes:
      "Official embedded Timely calendar feed is now the primary source, with the official page kept as the source link.",
  },
  {
    id: "scout-bar",
    name: SCOUT_BAR_SOURCE_NAME,
    displayName: SCOUT_BAR_SOURCE_NAME,
    city: "Houston",
    area: "Clear Lake",
    category: "music",
    priority: "mandatory",
    officialUrl: SCOUT_BAR_SOURCE_URL,
    eventSourceUrl: SCOUT_BAR_SOURCE_URL,
    providerId: "scout-bar",
    sourceReliability: "high",
    parserStatus: "working",
    notes: "Mandatory Houston venue with parseable official homepage event listings.",
  },
  {
    id: "the-end",
    name: "The End",
    displayName: "The End",
    city: "Houston",
    area: "Lawndale / East End",
    category: "music",
    priority: "mandatory",
    officialUrl: "https://www.theendhtx.com/",
    eventSourceUrl: "https://www.theendhtx.com/",
    providerId: "the-end",
    sourceReliability: "high",
    parserStatus: "working",
    notes: "Mandatory Houston venue with parseable official homepage event cards.",
  },
  // Candidate and high-value venues are tracked here for future source audits.
  // They should not be attempted until a provider is implemented.
  {
    id: "warehouse-live-midtown",
    name: "Warehouse Live Midtown",
    displayName: "Warehouse Live Midtown",
    city: "Houston",
    area: "Midtown",
    category: "music",
    priority: "mandatory",
    officialUrl: "https://warehouselivemidtown.com/",
    eventSourceUrl: "https://warehouselivemidtown.com/",
    providerId: "warehouse-live-midtown",
    sourceReliability: "high",
    parserStatus: "working",
    notes: "Mandatory Houston venue with parseable official homepage event cards.",
  },
  {
    id: "the-heights-theater",
    name: "The Heights Theater",
    displayName: "The Heights Theater",
    city: "Houston",
    area: "Heights",
    category: "music",
    priority: "mandatory",
    officialUrl: "https://theheightstheater.com/",
    eventSourceUrl: "https://theheightstheater.com/",
    providerId: "heights-theater",
    sourceReliability: "high",
    parserStatus: "working",
    notes: "Mandatory Houston venue with parseable official homepage event listings.",
  },
  {
    id: "713-music-hall",
    name: "713 Music Hall",
    displayName: "713 Music Hall",
    city: "Houston",
    area: "Downtown",
    category: "music",
    priority: "mandatory",
    officialUrl: "https://www.713musichall.com/",
    eventSourceUrl: "https://www.713musichall.com/shows",
    providerId: "713-music-hall",
    sourceReliability: "high",
    parserStatus: "working",
    notes: "Official first-party shows page exposes server-visible MusicEvent schema blocks.",
  },
  {
    id: "house-of-blues-houston",
    name: "House of Blues Houston",
    displayName: "House of Blues Houston",
    city: "Houston",
    area: "Downtown",
    category: "music",
    priority: "high_value",
    officialUrl: "https://houston.houseofblues.com/",
    eventSourceUrl: "https://houston.houseofblues.com/",
    providerId: "house-of-blues-houston",
    sourceReliability: "high",
    parserStatus: "working",
    notes: "Official Houston homepage exposes server-visible featured show rows.",
  },
  // Last Concert Cafe omitted: official calendar had no server-visible current/future
  // event rows during audit; re-audit only if the site changes.
  {
    id: "numbers-nightclub",
    name: "Numbers Nightclub",
    displayName: "Numbers Nightclub",
    city: "Houston",
    area: "Montrose",
    category: "music",
    priority: "high_value",
    officialUrl: "https://numbersnightclub.com/",
    eventSourceUrl: "https://numbersnightclub.com/events/",
    providerId: "numbers",
    sourceReliability: "high",
    parserStatus: "working",
    notes: "Live music and nightlife provider using the official Numbers events list and month calendar.",
  },
  {
    id: "mcgonigels-mucky-duck",
    name: MUCKY_DUCK_SOURCE_NAME,
    displayName: MUCKY_DUCK_SOURCE_NAME,
    city: "Houston",
    area: "Rice Village",
    category: "music",
    priority: "high_value",
    officialUrl: MUCKY_DUCK_SOURCE_URL,
    eventSourceUrl: MUCKY_DUCK_SOURCE_URL,
    providerId: "mucky-duck",
    sourceReliability: "high",
    parserStatus: "working",
    notes: "Official homepage exposes parseable current and future show cards.",
  },
  {
    id: "axelrad",
    name: "Axelrad",
    displayName: "Axelrad",
    city: "Houston",
    area: "Midtown",
    category: "music",
    priority: "mandatory",
    officialUrl: "https://www.axelradhouston.com/",
    eventSourceUrl: "https://www.axelradhouston.com/calendar",
    providerId: "axelrad",
    sourceReliability: "medium",
    parserStatus: "working",
    notes: "Official homepage and calendar expose parseable current and future event rows.",
  },
  {
    id: "the-secret-group",
    name: "The Secret Group",
    displayName: "The Secret Group",
    city: "Houston",
    area: "EaDo",
    category: "music",
    priority: "mandatory",
    officialUrl: "https://www.thesecretgrouphtx.com/",
    eventSourceUrl: "https://www.thesecretgrouphtx.com/",
    providerId: "secret-group",
    sourceReliability: "medium",
    parserStatus: "working",
    notes: "Official mixed-events homepage source with concerts routed to Music and comedy/nightlife routed to Other Events.",
  },
  {
    id: "bad-astronaut-brewing",
    name: "Bad Astronaut Brewing",
    displayName: "Bad Astronaut Brewing",
    city: "Houston",
    area: "Houston",
    category: "music",
    priority: "candidate",
    officialUrl: null,
    eventSourceUrl: null,
    providerId: null,
    sourceReliability: "unknown",
    parserStatus: "not_implemented",
    notes: "Metadata-only venue candidate. Needs source audit before parser implementation.",
  },
  {
    id: "black-magic-social-club",
    name: "Black Magic Social Club",
    displayName: "Black Magic Social Club",
    city: "Houston",
    area: "East Downtown",
    category: "music",
    priority: "candidate",
    officialUrl: null,
    eventSourceUrl: null,
    providerId: null,
    sourceReliability: "unknown",
    parserStatus: "not_implemented",
    notes: "Metadata-only venue candidate. Needs source audit before parser implementation.",
  },
  // Equal Parts Brewing omitted: official homepage/events page loaded but exposed
  // no parseable current/future event rows during audit; re-audit only if the site changes.
] as const;

export const HOUSTON_MANDATORY_VENUES = HOUSTON_VENUE_REGISTRY.filter(
  (venue) => venue.priority === "mandatory",
);

export const HOUSTON_PRIORITY_VENUE_NAMES = new Set(
  HOUSTON_MANDATORY_VENUES.map((venue) => venue.displayName),
);

export function getVenueByProviderId(
  providerId: VenueProviderId,
): VenueRegistryEntry | undefined {
  return HOUSTON_VENUE_REGISTRY.find((venue) => venue.providerId === providerId);
}

// Future city switching can fall back to a discovered venue registry when no
// curated registry exists, but Houston should keep using this mandatory list.
