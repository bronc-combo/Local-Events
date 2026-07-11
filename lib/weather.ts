import { unstable_noStore as noStore } from "next/cache";
import { installSourceCache, getSourceCacheSnapshotByUrl } from "@/lib/source-cache";
import type {
  HourlyRainChance,
  SourceLink,
  WeatherOverview,
} from "@/types/dashboard";

installSourceCache();

const WEATHER_API_URL =
  "https://api.open-meteo.com/v1/forecast?latitude=29.7947&longitude=-95.3673&current=temperature_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m&hourly=temperature_2m,apparent_temperature,precipitation_probability,precipitation,weather_code&daily=temperature_2m_max,temperature_2m_min,apparent_temperature_max,apparent_temperature_min,precipitation_probability_max,precipitation_sum,weather_code,sunrise,sunset&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=America%2FChicago&forecast_days=2";

export { WEATHER_API_URL as WEATHER_SOURCE_URL };

const OPEN_METEO_LINK: SourceLink = {
  label: "Open-Meteo",
  url: "https://open-meteo.com/",
};

interface OpenMeteoResponse {
  current?: {
    temperature_2m?: number;
    apparent_temperature?: number;
    wind_speed_10m?: number;
    weather_code?: number;
  };
  hourly?: {
    time?: string[];
    precipitation_probability?: number[];
    weather_code?: number[];
  };
  daily?: {
    temperature_2m_max?: number[];
    temperature_2m_min?: number[];
    precipitation_probability_max?: number[];
    weather_code?: number[];
  };
}

export interface WeatherFetchResult {
  error?: string;
  weather?: WeatherOverview;
}

interface RainWindow {
  startIndex: number;
  endIndex: number;
  maxChance: number;
}

export function formatTemperature(value: number): string {
  return `${Math.round(value)}°F`;
}

export function formatWindSpeed(value: number): string {
  return `${Math.round(value)} mph`;
}

export function clampPercentage(value: number): number {
  return Math.min(Math.max(Math.round(value), 0), 100);
}

export function formatHourLabel(dateTime: string): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    timeZone: "America/Chicago",
  }).format(new Date(dateTime));
}

export function selectHourlyRainDisplay(
  hourlyRainChances: HourlyRainChance[],
  maxRows = 12,
): { hours: HourlyRainChance[]; isSampled: boolean } {
  if (hourlyRainChances.length <= maxRows) {
    return {
      hours: hourlyRainChances,
      isSampled: false,
    };
  }

  const selectedIndices = new Set<number>();

  for (let index = 0; index < hourlyRainChances.length; index += 2) {
    selectedIndices.add(index);

    if (selectedIndices.size >= maxRows) {
      break;
    }
  }

  const rainiestHours = hourlyRainChances
    .map((hour, index) => ({ hour, index }))
    .sort((left, right) => {
      return (
        right.hour.precipitationProbability -
        left.hour.precipitationProbability
      );
    });

  for (const rainiestHour of rainiestHours) {
    if (selectedIndices.size >= maxRows) {
      break;
    }

    selectedIndices.add(rainiestHour.index);
  }

  const selectedHours = hourlyRainChances.filter((_, index) => {
    return selectedIndices.has(index);
  });

  return {
    hours: selectedHours.slice(0, maxRows),
    isSampled: true,
  };
}

function formatRainRange(startTime: string, endTime: string): string {
  return `${formatHourLabel(startTime)}-${formatHourLabel(endTime)}`;
}

function getWeatherDescription(weatherCode: number | undefined): string {
  if (weatherCode === undefined) {
    return "mixed conditions";
  }

  if (weatherCode === 0) {
    return "clear skies";
  }

  if ([1, 2].includes(weatherCode)) {
    return "partly cloudy skies";
  }

  if (weatherCode === 3) {
    return "cloudy skies";
  }

  if ([45, 48].includes(weatherCode)) {
    return "foggy conditions";
  }

  if ([51, 53, 55, 56, 57].includes(weatherCode)) {
    return "light rain";
  }

  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(weatherCode)) {
    return "rain";
  }

  if ([71, 73, 75, 77, 85, 86].includes(weatherCode)) {
    return "wintry conditions";
  }

  if ([95, 96, 99].includes(weatherCode)) {
    return "thunderstorms";
  }

  return "mixed conditions";
}

export function detectRainWindow(
  times: string[],
  precipitationProbabilities: number[],
): string {
  const rainyIndices = times.reduce<RainWindow[]>((windows, time, index) => {
    const chance = precipitationProbabilities[index] ?? 0;

    if (chance < 30) {
      return windows;
    }

    const lastWindow = windows[windows.length - 1];

    if (lastWindow && index === lastWindow.endIndex + 1) {
      lastWindow.endIndex = index;
      lastWindow.maxChance = Math.max(lastWindow.maxChance, chance);
      return windows;
    }

    windows.push({
      startIndex: index,
      endIndex: index,
      maxChance: chance,
    });

    return windows;
  }, []);

  if (rainyIndices.length === 0) {
    return "No major rain window expected.";
  }

  const strongestWindow = rainyIndices.reduce((best, current) => {
    if (current.maxChance > best.maxChance) {
      return current;
    }

    if (current.maxChance === best.maxChance) {
      const currentLength = current.endIndex - current.startIndex;
      const bestLength = best.endIndex - best.startIndex;

      if (currentLength > bestLength) {
        return current;
      }
    }

    return best;
  });

  const primaryWindow = `Most likely rain: ${formatRainRange(
    times[strongestWindow.startIndex],
    times[strongestWindow.endIndex],
  )}.`;

  if (rainyIndices.length === 1) {
    return primaryWindow;
  }

  return `${primaryWindow} Scattered chances at other times too.`;
}

export function generateWeatherSummary({
  highF,
  maxRainChance,
  weatherCode,
}: {
  highF: number;
  maxRainChance: number;
  weatherCode?: number;
}): string {
  const temperatureSentence =
    highF >= 90
      ? `Hot today with ${getWeatherDescription(weatherCode)}.`
      : highF < 80
        ? `Mild weather today with ${getWeatherDescription(weatherCode)}.`
        : `Warm today with ${getWeatherDescription(weatherCode)}.`;

  if (maxRainChance >= 60) {
    return `${temperatureSentence} A stronger rain chance is in the forecast.`;
  }

  if (maxRainChance >= 30) {
    return `${temperatureSentence} Keep an eye on rain chances later today.`;
  }

  return temperatureSentence;
}

function getTodayHourCount(times: string[]): number {
  if (times.length === 0) {
    return 0;
  }

  const todayDate = times[0]?.slice(0, 10);

  return times.filter((time) => time.startsWith(todayDate)).length;
}

function getCurrentHoustonHourKey(): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  })
    .format(new Date())
    .replace(" ", "T");
}

function buildHourlyRainChances(
  times: string[],
  precipitationProbabilities: number[],
): HourlyRainChance[] {
  const currentHourKey = getCurrentHoustonHourKey();

  return times.reduce<HourlyRainChance[]>((items, time, index) => {
    const precipitationProbability = precipitationProbabilities[index];

    if (precipitationProbability === undefined) {
      return items;
    }

    if (time < currentHourKey) {
      return items;
    }

    items.push({
      time,
      displayTime: formatHourLabel(time),
      precipitationProbability,
    });

    return items;
  }, []);
}

function mapWeatherOverview(data: OpenMeteoResponse): WeatherOverview {
  const current = data.current;
  const hourlyTimes = data.hourly?.time ?? [];
  const hourlyRainProbabilities =
    data.hourly?.precipitation_probability ?? [];
  const todayHourCount = getTodayHourCount(hourlyTimes);
  const todayTimes = hourlyTimes.slice(0, todayHourCount);
  const todayRainChances = hourlyRainProbabilities.slice(0, todayHourCount);
  const todayHigh = data.daily?.temperature_2m_max?.[0];
  const todayLow = data.daily?.temperature_2m_min?.[0];
  const todayMaxRainChance =
    data.daily?.precipitation_probability_max?.[0] ??
    Math.max(...todayRainChances, 0);
  const hourlyRainChances = buildHourlyRainChances(
    todayTimes,
    todayRainChances,
  );

  if (
    current?.temperature_2m === undefined ||
    current.apparent_temperature === undefined ||
    current.wind_speed_10m === undefined ||
    todayHigh === undefined ||
    todayLow === undefined
  ) {
    throw new Error("Weather data is missing required fields.");
  }

  return {
    locationLabel: "Houston, TX 77009",
    summary: generateWeatherSummary({
      highF: todayHigh,
      maxRainChance: todayMaxRainChance,
      weatherCode:
        data.daily?.weather_code?.[0] ?? data.current?.weather_code,
    }),
    currentTemperatureF: current.temperature_2m,
    feelsLikeTemperatureF: current.apparent_temperature,
    highF: todayHigh,
    lowF: todayLow,
    maxRainChance: todayMaxRainChance,
    likelyRainWindow: detectRainWindow(todayTimes, todayRainChances),
    currentWindSpeedMph: current.wind_speed_10m,
    hourlyRainChances,
    sourceLinks: [OPEN_METEO_LINK],
    cache: getSourceCacheSnapshotByUrl(WEATHER_API_URL),
  };
}

export async function getHoustonWeather(): Promise<WeatherFetchResult> {
  noStore();

  try {
    const response = await fetch(WEATHER_API_URL, {
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`Open-Meteo returned ${response.status}.`);
    }

    const data = (await response.json()) as OpenMeteoResponse;

    return {
      weather: mapWeatherOverview(data),
    };
  } catch {
    return {
      error:
        "Weather is temporarily unavailable. Please try again in a moment.",
    };
  }
}
