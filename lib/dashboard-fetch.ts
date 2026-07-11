import { withSourceCacheRefreshScope } from "@/lib/source-cache";
import { getHoustonWeather } from "@/lib/weather";
import { getOfficialVenueEvents } from "@/lib/event-sources";
import { getFoodDrinkData } from "@/lib/food-drink-provider";
import { getSportsData } from "@/lib/sports-provider";
import type { FoodDrinkProviderResult } from "@/lib/food-drink-provider";
import type { OfficialVenueEventResult } from "@/lib/event-sources";
import type { WeatherFetchResult } from "@/lib/weather";
import type { SportsProviderResult } from "@/types/dashboard";

export interface DashboardData {
  weatherResult: WeatherFetchResult;
  eventProvider: OfficialVenueEventResult;
  foodDrinkProvider: FoodDrinkProviderResult;
  sportsProvider: SportsProviderResult;
}

export interface DashboardFetchOptions {
  refreshWeather: boolean;
  refreshEvents: boolean;
}

export async function fetchDashboardData({
  refreshWeather,
  refreshEvents,
}: DashboardFetchOptions): Promise<DashboardData> {
  const [weatherResult, eventProvider, foodDrinkProvider, sportsProvider] = await Promise.all([
    withSourceCacheRefreshScope(refreshWeather ? "weather" : null, () => getHoustonWeather()),
    withSourceCacheRefreshScope(refreshEvents ? "events" : null, () => getOfficialVenueEvents()),
    getFoodDrinkData(),
    withSourceCacheRefreshScope(refreshEvents ? "events" : null, () => getSportsData()),
  ]);

  return {
    weatherResult,
    eventProvider,
    foodDrinkProvider,
    sportsProvider,
  };
}
