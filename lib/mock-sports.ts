import type { SportsEvent } from "@/types/dashboard";

const sportsItems: SportsEvent[] = [
  {
    id: "sports-astros-home-mariners",
    league: "MLB",
    homeTeam: "Houston Astros",
    awayTeam: "Seattle Mariners",
    dateTime: "2026-06-21T13:10:00-05:00",
    venue: "Daikin Park",
    city: "Houston",
    note: "Home game",
    isHomeOrLocal: true,
    sourceLinks: [
      {
        label: "Astros schedule",
        url: "https://www.mlb.com/astros/schedule/2026-06-21",
      },
      {
        label: "Daikin Park guide",
        url: "https://www.mlb.com/astros/ballpark",
      },
    ],
  },
  {
    id: "sports-dash-home-gotham",
    league: "NWSL",
    homeTeam: "Houston Dash",
    awayTeam: "Gotham FC",
    dateTime: "2026-06-21T19:00:00-05:00",
    venue: "Shell Energy Stadium",
    city: "Houston",
    note: "Home game",
    isHomeOrLocal: true,
    sourceLinks: [
      {
        label: "Dash schedule",
        url: "https://www.houstondynamofc.com/houstondash/schedule/2026-06-21",
      },
    ],
  },
  {
    id: "sports-rugby-local-showcase",
    league: "Major League Rugby",
    homeTeam: "Houston SaberCats",
    awayTeam: "San Diego Legion",
    dateTime: "2026-06-21T17:00:00-05:00",
    venue: "SaberCats Stadium",
    city: "Houston",
    note: "Local pro event",
    isHomeOrLocal: true,
    sourceLinks: [
      {
        label: "SaberCats schedule",
        url: "https://www.houstonsabercats.com/schedule/2026-06-21",
      },
    ],
  },
  {
    id: "sports-space-cowboys-upcoming",
    league: "Triple-A Baseball",
    homeTeam: "Sugar Land Space Cowboys",
    awayTeam: "El Paso Chihuahuas",
    dateTime: "2026-06-23T19:05:00-05:00",
    venue: "Constellation Field",
    city: "Sugar Land",
    note: "Upcoming soon",
    isHomeOrLocal: true,
    hiddenReason: "Not today, but nearby and coming up soon.",
    sourceLinks: [
      {
        label: "Space Cowboys schedule",
        url: "https://www.milb.com/sugar-land/schedule/2026-06-23",
      },
    ],
  },
  {
    id: "sports-dynamo-away-austin",
    league: "MLS",
    homeTeam: "Austin FC",
    awayTeam: "Houston Dynamo FC",
    dateTime: "2026-06-21T19:30:00-05:00",
    venue: "Q2 Stadium",
    city: "Austin",
    note: "Away match",
    isHomeOrLocal: false,
    hiddenReason: "Away match outside Houston, so lower priority for the daily local view.",
    sourceLinks: [
      {
        label: "Dynamo schedule",
        url: "https://www.houstondynamofc.com/schedule/matches/2026-06-21",
      },
    ],
  },
];

function sortSports(items: SportsEvent[]): SportsEvent[] {
  return [...items].sort((left, right) => {
    if (left.isHomeOrLocal !== right.isHomeOrLocal) {
      return left.isHomeOrLocal ? -1 : 1;
    }

    return left.dateTime.localeCompare(right.dateTime);
  });
}

export const sportsTodayPrimary = sortSports(
  sportsItems.filter((item) => item.isHomeOrLocal && !item.hiddenReason),
);

export const sportsLowerPriority = sortSports(
  sportsItems.filter((item) => item.hiddenReason),
);
