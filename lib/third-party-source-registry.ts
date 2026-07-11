import type { SourceTier } from "@/types/dashboard";

export interface ThirdPartySourceRegistryEntry {
  providerKey: string;
  venueName: string;
  officialSourceStatus: "none" | "blocked" | "unparseable" | "disabled";
  thirdPartySourceAllowed: boolean;
  thirdPartySourceName: string;
  thirdPartySourceUrl: string | null;
  enabled: boolean;
  sourceTier: SourceTier;
  notes?: string;
}

// Optional fallback tier for venues whose official calendars are unavailable or
// not parseable. Keep official sources preferred, and only enable third-party
// listings when a venue has no usable first-party calendar.
export const THIRD_PARTY_SOURCE_REGISTRY: ThirdPartySourceRegistryEntry[] = [
  {
    providerKey: "black-magic-bandsintown",
    venueName: "Black Magic Social Club",
    officialSourceStatus: "blocked",
    thirdPartySourceAllowed: true,
    thirdPartySourceName: "Bandsintown",
    thirdPartySourceUrl: "https://www.bandsintown.com/v/10281529-black-magic-social-club",
    enabled: false,
    sourceTier: "third_party",
    notes: "Bandsintown venue page returned HTTP 403 from the app fetch path; disabled until a reliable non-blocked source is available.",
  },
];
