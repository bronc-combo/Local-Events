import type { FoodDrinkSpecial } from "@/types/dashboard";

const mockFoodDrinkItems: FoodDrinkSpecial[] = [
  {
    id: "food-blt-patio-hour",
    name: "Better Luck Tomorrow",
    type: "Cocktail bar",
    address: "544 Yale St",
    neighborhood: "The Heights",
    special: "$10 house cocktails and half-off snacks",
    happyHour: "Mon-Fri 4 PM-6 PM",
    source: "Capacities",
    verificationStatus: "Confirmed",
    sourceLinks: [
      {
        label: "BLT menu",
        url: "https://www.betterlucktomorrowhou.com/menu",
      },
      {
        label: "BLT happy hour",
        url: "https://www.betterlucktomorrowhou.com/happy-hour",
      },
    ],
    myRating: 4.8,
    distanceMiles: 2.3,
    estimatedCost: "$$",
  },
  {
    id: "food-onion-creek-wine-night",
    name: "Onion Creek",
    type: "Neighborhood bar",
    address: "3106 White Oak Dr",
    neighborhood: "Heights",
    special: "$2 off drafts and frozen drinks",
    happyHour: "Daily 3 PM-6 PM",
    source: "Capacities",
    verificationStatus: "From Capacities only",
    sourceLinks: [
      {
        label: "Onion Creek page",
        url: "https://www.onioncreekcafe.com/houston",
      },
    ],
    myRating: 4.5,
    distanceMiles: 2.1,
    estimatedCost: "$$",
  },
  {
    id: "food-vinyl-room-cocktails",
    name: "Vinyl Room",
    type: "Cocktail bar",
    address: "2120 N Main St",
    neighborhood: "Near Northside",
    special: "$9 martinis and late-night bar snacks",
    happyHour: "Sun-Thu 5 PM-7 PM",
    source: "Discovered",
    verificationStatus: "Could not verify",
    sourceLinks: [
      {
        label: "Venue Instagram",
        url: "https://www.instagram.com/vinylroomhouston/",
      },
      {
        label: "Neighborhood guide",
        url: "https://www.houstoncitybook.com/vinyl-room-houston",
      },
    ],
    myRating: 4.1,
    distanceMiles: 1.8,
    estimatedCost: "$$",
  },
  {
    id: "food-eden-plant-coffee",
    name: "Eden Plant Co. Cafe",
    type: "Coffee shop",
    address: "3401 Harrisburg Blvd",
    neighborhood: "East End",
    special: "Coffee + pastry combo before 5 PM",
    happyHour: "Daily until 5 PM",
    source: "Capacities",
    verificationStatus: "From Capacities only",
    sourceLinks: [
      {
        label: "Cafe page",
        url: "https://www.edenplantco.com/cafe",
      },
    ],
    myRating: 4.7,
    distanceMiles: 4.9,
    estimatedCost: "$",
  },
  {
    id: "food-dan-electros-burger-night",
    name: "Dan Electro's",
    type: "Bar / live venue",
    address: "1031 E 24th St",
    neighborhood: "Heights",
    special: "Burger night with discounted Lone Star",
    happyHour: "Sun 6 PM-9 PM",
    source: "Capacities",
    verificationStatus: "Confirmed",
    sourceLinks: [
      {
        label: "Dan Electro's calendar",
        url: "https://danelectrosheights.com/calendar",
      },
      {
        label: "Dan Electro's menu",
        url: "https://danelectrosheights.com/menu",
      },
    ],
    myRating: 4.4,
    distanceMiles: 2.2,
    estimatedCost: "$$",
  },
  {
    id: "food-ea-do-brewery-farther",
    name: "8th Wonder Brewery",
    type: "Brewery",
    address: "2202 Dallas St",
    neighborhood: "EaDo",
    special: "$1 off drafts before Astros first pitch",
    happyHour: "Game days 4 PM-6 PM",
    source: "Discovered",
    verificationStatus: "Could not verify",
    sourceLinks: [
      {
        label: "8th Wonder events",
        url: "https://8thwonder.com/events",
      },
    ],
    myRating: 3.9,
    distanceMiles: 5.8,
    estimatedCost: "$$",
    hiddenReason: "Farther from 77009 and a weaker overall deal than the top picks.",
  },
];

function getVerificationRank(status: string): number {
  if (status === "Confirmed") {
    return 3;
  }

  if (status === "From Capacities only") {
    return 2;
  }

  return 1;
}

function scoreFoodDrinkItem(item: FoodDrinkSpecial): number {
  const ratingScore = (item.myRating ?? 0) * 20;
  const distanceScore = Math.max(0, 30 - (item.distanceMiles ?? 10) * 4);
  const dealScore =
    item.verificationStatus === "Confirmed"
      ? 18
      : item.verificationStatus === "From Capacities only"
        ? 13
        : 8;

  return ratingScore + distanceScore + dealScore + getVerificationRank(item.verificationStatus);
}

function sortFoodDrink(items: FoodDrinkSpecial[]): FoodDrinkSpecial[] {
  return [...items].sort((left, right) => {
    return scoreFoodDrinkItem(right) - scoreFoodDrinkItem(left);
  });
}

export const foodDrinkPrimary = sortFoodDrink(
  mockFoodDrinkItems.filter((item) => !item.hiddenReason),
);

export const foodDrinkLowerPriority = sortFoodDrink(
  mockFoodDrinkItems.filter((item) => item.hiddenReason),
);
