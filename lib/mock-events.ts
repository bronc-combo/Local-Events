import {
  scoreEvent,
  sortEventsByTasteScore,
  type EventSeed,
} from "@/lib/event-scoring";

const todayEventSeeds: EventSeed[] = [
  {
    id: "today-melt-banana-white-oak",
    title: "Melt-Banana with Nerver",
    dateTime: "2026-06-21T20:00:00-05:00",
    venue: "White Oak Music Hall",
    city: "Houston",
    category: "Concert",
    genreTags: ["noise rock", "post-hardcore", "experimental rock"],
    sourceLinks: [
      {
        label: "White Oak listing",
        url: "https://whiteoakmusichall.com/shows/melt-banana-houston",
      },
      {
        label: "Band page",
        url: "https://melt-banana.net/tour/houston",
      },
    ],
    similarArtists: ["Drive Like Jehu", "Gilla Band", "Pissed Jeans"],
    isGreatLiveAct: true,
    liveReputationStatus: "strong",
    liveReputationConfidence: 92,
    liveReputationReasons: ["explicit mock example for a known high-impact live act"],
    liveReputationSources: [
      {
        label: "Mock curated live reputation note",
        url: "https://whiteoakmusichall.com/shows/melt-banana-houston",
      },
    ],
    venueFitScore: 15,
    knownLiveReputationScore: 15,
    rarityScore: 9,
    distanceRelevanceScore: 9,
    feedbackHistoryPlaceholderScore: 7,
  },
  {
    id: "today-menil-video-installation",
    title: "Signal Decay: Video + Sound Installation",
    dateTime: "2026-06-21T18:30:00-05:00",
    venue: "The Menil Collection",
    city: "Houston",
    category: "Art / Exhibition",
    genreTags: ["art", "experimental electronic", "ambient"],
    sourceLinks: [
      {
        label: "Menil event page",
        url: "https://www.menil.org/events/signal-decay-installation",
      },
    ],
    similarArtists: ["Tim Hecker", "Ben Frost"],
    isGreatLiveAct: false,
    venueFitScore: 8,
    knownLiveReputationScore: 5,
    rarityScore: 7,
    distanceRelevanceScore: 9,
    feedbackHistoryPlaceholderScore: 6,
  },
  {
    id: "today-dan-electros-slab-hardcore",
    title: "Slab Signal + Ghost Work + Serrated",
    dateTime: "2026-06-21T21:00:00-05:00",
    venue: "Dan Electro's",
    city: "Houston",
    category: "Concert",
    genreTags: ["punk", "hardcore", "noise rock"],
    sourceLinks: [
      {
        label: "Dan Electro's calendar",
        url: "https://danelectrosheights.com/calendar/slab-signal-ghost-work",
      },
    ],
    similarArtists: ["Shellac", "METZ", "Chat Pile"],
    isGreatLiveAct: true,
    liveReputationStatus: "strong",
    liveReputationConfidence: 82,
    liveReputationReasons: ["explicit mock example for testing the live-act badge"],
    liveReputationSources: [
      {
        label: "Mock curated live reputation note",
        url: "https://danelectrosheights.com/calendar/slab-signal-ghost-work",
      },
    ],
    venueFitScore: 15,
    knownLiveReputationScore: 12,
    rarityScore: 6,
    distanceRelevanceScore: 10,
    feedbackHistoryPlaceholderScore: 6,
  },
  {
    id: "today-arena-pop-tour",
    title: "Summer Lights Arena Tour",
    dateTime: "2026-06-21T19:30:00-05:00",
    venue: "Toyota Center",
    city: "Houston",
    category: "Concert",
    genreTags: ["mainstream pop", "arena show"],
    sourceLinks: [
      {
        label: "Toyota Center events",
        url: "https://www.toyotacenter.com/events/summer-lights-tour",
      },
    ],
    isGreatLiveAct: false,
    venueFitScore: 1,
    knownLiveReputationScore: 4,
    rarityScore: 2,
    distanceRelevanceScore: 6,
    feedbackHistoryPlaceholderScore: 1,
  },
];

const upcomingEventSeeds: EventSeed[] = [
  {
    id: "upcoming-continental-doom-country",
    title: "Wrecked Halo + Funeral Chic Matinee",
    dateTime: "2026-06-24T19:00:00-05:00",
    venue: "The Continental Club",
    city: "Houston",
    category: "Concert",
    genreTags: ["doom", "post-punk", "noise rock"],
    sourceLinks: [
      {
        label: "Continental Club show page",
        url: "https://continentalclub.com/houston/shows/wrecked-halo-funeral-chic",
      },
    ],
    similarArtists: ["Protomartyr", "The Jesus Lizard", "Kowloon Walled City"],
    isGreatLiveAct: true,
    liveReputationStatus: "strong",
    liveReputationConfidence: 80,
    liveReputationReasons: ["explicit mock example for a curated strong live act"],
    liveReputationSources: [
      {
        label: "Mock curated live reputation note",
        url: "https://continentalclub.com/houston/shows/wrecked-halo-funeral-chic",
      },
    ],
    venueFitScore: 15,
    knownLiveReputationScore: 13,
    rarityScore: 8,
    distanceRelevanceScore: 9,
    feedbackHistoryPlaceholderScore: 7,
  },
  {
    id: "upcoming-electronic-warehouse",
    title: "Modular Drift Night",
    dateTime: "2026-06-26T22:00:00-05:00",
    venue: "East End Warehouse",
    city: "Houston",
    category: "Electronic",
    genreTags: ["techno", "idm", "experimental electronic"],
    sourceLinks: [
      {
        label: "Warehouse promoter page",
        url: "https://www.eastendwarehouse.com/events/modular-drift-night",
      },
    ],
    similarArtists: ["Autechre", "Karenn", "Rrose"],
    isGreatLiveAct: false,
    venueFitScore: 10,
    knownLiveReputationScore: 8,
    rarityScore: 9,
    distanceRelevanceScore: 8,
    feedbackHistoryPlaceholderScore: 6,
  },
  {
    id: "upcoming-film-screening",
    title: "Experimental Cinema + Live Score",
    dateTime: "2026-06-27T19:30:00-05:00",
    venue: "Asia Society Texas",
    city: "Houston",
    category: "Culture / Film",
    genreTags: ["avant-garde", "art", "drone"],
    sourceLinks: [
      {
        label: "Asia Society event page",
        url: "https://asiasociety.org/texas/events/experimental-cinema-live-score",
      },
    ],
    similarArtists: ["Boris score work", "Stars of the Lid"],
    isGreatLiveAct: false,
    venueFitScore: 7,
    knownLiveReputationScore: 5,
    rarityScore: 8,
    distanceRelevanceScore: 8,
    feedbackHistoryPlaceholderScore: 6,
  },
  {
    id: "upcoming-black-metal-white-oak",
    title: "Ashen Wake with Hex Body",
    dateTime: "2026-06-28T20:30:00-05:00",
    venue: "White Oak Music Hall",
    city: "Houston",
    category: "Concert",
    genreTags: ["black metal", "industrial", "drone"],
    sourceLinks: [
      {
        label: "White Oak listing",
        url: "https://whiteoakmusichall.com/shows/ashen-wake-hex-body",
      },
    ],
    similarArtists: ["Liturgy", "Uniform", "Full of Hell"],
    isGreatLiveAct: true,
    liveReputationStatus: "legendary",
    liveReputationConfidence: 95,
    liveReputationReasons: ["explicit mock example for a top-tier live reputation"],
    liveReputationSources: [
      {
        label: "Mock curated live reputation note",
        url: "https://whiteoakmusichall.com/shows/ashen-wake-hex-body",
      },
    ],
    venueFitScore: 15,
    knownLiveReputationScore: 14,
    rarityScore: 8,
    distanceRelevanceScore: 9,
    feedbackHistoryPlaceholderScore: 8,
  },
  {
    id: "upcoming-mainstream-country",
    title: "Red White & Boots Stadium Night",
    dateTime: "2026-06-30T19:00:00-05:00",
    venue: "NRG Stadium",
    city: "Houston",
    category: "Concert",
    genreTags: ["mainstream country", "stadium show"],
    sourceLinks: [
      {
        label: "NRG event page",
        url: "https://www.nrgpark.com/events/red-white-and-boots",
      },
    ],
    isGreatLiveAct: false,
    venueFitScore: 1,
    knownLiveReputationScore: 4,
    rarityScore: 1,
    distanceRelevanceScore: 5,
    feedbackHistoryPlaceholderScore: 1,
  },
];

export const mockTodayEvents = sortEventsByTasteScore(
  todayEventSeeds.map(scoreEvent),
);
export const mockUpcomingEvents = sortEventsByTasteScore(
  upcomingEventSeeds.map(scoreEvent),
);

export const todayEvents = mockTodayEvents;
export const upcomingEvents = mockUpcomingEvents;
