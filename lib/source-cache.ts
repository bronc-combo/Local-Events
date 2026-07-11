import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type {
  SourceCacheSnapshot,
  SourceCacheCategory,
  SourceCacheMode,
  SourceCacheRefreshPolicy,
} from "@/types/dashboard";

const CACHE_DIR = path.join(process.cwd(), ".daily-overview-cache");
const TIME_ZONE = "America/Chicago";
const DAILY_REFRESH_HOUR = 5;
const refreshScopeStorage = new AsyncLocalStorage<SourceCacheRefreshScope | null>();

const MUSIC_HOSTS = [
  "whiteoakmusichall.com",
  "danelectros.com",
  "warehouselivemidtown.com",
  "theheightstheater.com",
  "713musichall.com",
  "continentalclub.com",
  "scoutbar.com",
  "theendhtx.com",
  "thesecretgrouphtx.com",
  "numbersnightclub.com",
  "mcgonigels.com",
  "axelradhouston.com",
  "bandsintown.com",
];

const CULTURE_HOSTS = [
  "mfah.org",
  "menil.org",
  "camh.org",
  "discoverygreen.com",
  "buffalobayou.org",
  "blafferartmuseum.org",
  "lawndaleartcenter.org",
  "projectrowhouses.org",
  "orangeshow.org",
  "meowwolf.com",
  "asiasociety.org",
];

const SPORTS_HOSTS = [
  "mlb.com",
  "statsapi.mlb.com",
  "houstondash.com",
  "houstondynamofc.com",
  "texans.com",
  "rockets.com",
];

interface SourceCacheRecord {
  cacheKey: string;
  url: string;
  category: SourceCacheCategory;
  refreshPolicy: SourceCacheRefreshPolicy;
  ok: boolean;
  status: number;
  body: string;
  fetchedAt: string;
  fetchedLocalDate: string;
  fetchedLocalTime: string;
  fetchedLocalHour: number;
  warning?: string;
}

export interface CachedFetchOptions extends RequestInit {
  cacheKey?: string;
  category?: SourceCacheCategory;
  refreshPolicy?: SourceCacheRefreshPolicy;
  timezone?: string;
  dailyRefreshHour?: number;
  forceRefresh?: boolean;
}

export type SourceCacheRefreshScope = "weather" | "events";

interface CachedFetchResponseLike {
  ok: boolean;
  status: number;
  url: string;
  fromCache: boolean;
  mode: SourceCacheMode;
  lastFetchedAt?: string;
  lastFetchedLabel?: string;
  cacheAgeMinutes?: number;
  nextRefreshAfterLabel?: string;
  warning?: string;
  text(): Promise<string>;
  json<T = unknown>(): Promise<T>;
}

declare global {
  var __dailyOverviewSourceCacheInstalled: boolean | undefined;
  var __dailyOverviewSourceCacheByKey: Map<string, SourceCacheSnapshot> | undefined;
  var __dailyOverviewSourceCacheByUrl: Map<string, SourceCacheSnapshot> | undefined;
  var __dailyOverviewSourceCacheOriginalFetch: typeof fetch | undefined;
}

function getCacheByKeyStore(): Map<string, SourceCacheSnapshot> {
  if (!globalThis.__dailyOverviewSourceCacheByKey) {
    globalThis.__dailyOverviewSourceCacheByKey = new Map();
  }

  return globalThis.__dailyOverviewSourceCacheByKey;
}

function getCacheByUrlStore(): Map<string, SourceCacheSnapshot> {
  if (!globalThis.__dailyOverviewSourceCacheByUrl) {
    globalThis.__dailyOverviewSourceCacheByUrl = new Map();
  }

  return globalThis.__dailyOverviewSourceCacheByUrl;
}

function getOriginalFetch(): typeof fetch {
  if (!globalThis.__dailyOverviewSourceCacheOriginalFetch) {
    globalThis.__dailyOverviewSourceCacheOriginalFetch = globalThis.fetch.bind(globalThis);
  }

  return globalThis.__dailyOverviewSourceCacheOriginalFetch;
}

function hashKey(value: string): string {
  return createHash("sha1").update(value).digest("hex");
}

function toCacheFilePath(cacheKey: string): string {
  const digest = hashKey(cacheKey);

  return path.join(CACHE_DIR, `${digest}.json`);
}

function getLocalParts(date = new Date(), timeZone = TIME_ZONE): {
  localDate: string;
  localTime: string;
  localHour: number;
  localMinute: number;
} {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const parts = formatter
    .formatToParts(date)
    .reduce<Record<string, string>>((accumulator, part) => {
      if (part.type !== "literal") {
        accumulator[part.type] = part.value;
      }

      return accumulator;
    }, {});

  const localDate = `${parts.year}-${parts.month}-${parts.day}`;
  const localHour = Number(parts.hour ?? 0);
  const localMinute = Number(parts.minute ?? 0);

  return {
    localDate,
    localTime: `${String(localHour).padStart(2, "0")}:${String(localMinute).padStart(2, "0")}`,
    localHour,
    localMinute,
  };
}

function formatHoustonClock(date: Date | string, timeZone = TIME_ZONE): string {
  const value = typeof date === "string" ? new Date(date) : date;

  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
}

function formatReadableDate(date: string): string {
  const value = new Date(`${date}T12:00:00-05:00`);

  return new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    month: "short",
    day: "numeric",
  }).format(value);
}

function formatRefreshHour(hour: number): string {
  if (hour === 0) {
    return "12:00 AM";
  }

  const displayHour = hour > 12 ? hour - 12 : hour;

  return `${displayHour}:00 ${hour >= 12 ? "PM" : "AM"}`;
}

function getRefreshAfterLabel(
  refreshPolicy: SourceCacheRefreshPolicy,
  timeZone = TIME_ZONE,
  dailyRefreshHour = DAILY_REFRESH_HOUR,
): string {
  const now = getLocalParts(new Date(), timeZone);

  if (refreshPolicy === "hourly") {
    return "about 60 minutes";
  }

  const currentMinutes = now.localHour * 60 + now.localMinute;
  const refreshMinutes = dailyRefreshHour * 60;

  return currentMinutes >= refreshMinutes
    ? `tomorrow ${formatRefreshHour(dailyRefreshHour)}`
    : `today ${formatRefreshHour(dailyRefreshHour)}`;
}

function buildSnapshot(
  record: SourceCacheRecord,
  mode: SourceCacheMode,
): SourceCacheSnapshot {
  const fetchedAt = new Date(record.fetchedAt);
  const ageMinutes = Math.max(0, Math.round((Date.now() - fetchedAt.getTime()) / 60000));
  const nowParts = getLocalParts(new Date(), TIME_ZONE);
  const fetchedLabel = record.fetchedLocalDate === nowParts.localDate
    ? `today ${formatHoustonClock(record.fetchedAt)}`
    : `${formatReadableDate(record.fetchedLocalDate)} ${formatHoustonClock(record.fetchedAt)}`;

  return {
    cacheKey: record.cacheKey,
    url: record.url,
    category: record.category,
    refreshPolicy: record.refreshPolicy,
    mode,
    ok: record.ok,
    status: record.status,
    lastFetchedAt: record.fetchedAt,
    lastFetchedLabel: fetchedLabel,
    cacheAgeMinutes: ageMinutes,
    nextRefreshAfterLabel: getRefreshAfterLabel(record.refreshPolicy, TIME_ZONE, DAILY_REFRESH_HOUR),
    warning: record.warning,
  };
}

async function readCacheRecord(cacheKey: string): Promise<SourceCacheRecord | null> {
  try {
    const raw = await readFile(toCacheFilePath(cacheKey), "utf8");
    return JSON.parse(raw) as SourceCacheRecord;
  } catch {
    return null;
  }
}

async function writeCacheRecord(record: SourceCacheRecord): Promise<void> {
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(toCacheFilePath(record.cacheKey), `${JSON.stringify(record, null, 2)}\n`, "utf8");
}

function selectCategory(url: string, explicitCategory?: SourceCacheCategory): SourceCacheCategory {
  if (explicitCategory) {
    return explicitCategory;
  }

  const normalized = url.toLowerCase();

  if (normalized.includes("open-meteo.com")) {
    return "weather";
  }

  if (SPORTS_HOSTS.some((host) => normalized.includes(host))) {
    return "sports";
  }

  if (CULTURE_HOSTS.some((host) => normalized.includes(host))) {
    return "culture";
  }

  if (MUSIC_HOSTS.some((host) => normalized.includes(host))) {
    return "music";
  }

  return "other";
}

function selectRefreshPolicy(url: string, explicitPolicy?: SourceCacheRefreshPolicy): SourceCacheRefreshPolicy {
  if (explicitPolicy) {
    return explicitPolicy;
  }

  return url.toLowerCase().includes("open-meteo.com") ? "hourly" : "daily";
}

function shouldForceRefreshForScope(
  category: SourceCacheCategory,
  scope: SourceCacheRefreshScope | null | undefined,
): boolean {
  if (!scope) {
    return false;
  }

  if (scope === "weather") {
    return category === "weather";
  }

  return category === "music" || category === "culture" || category === "sports" || category === "other";
}

function createResponseLike(
  record: SourceCacheRecord,
  mode: SourceCacheMode,
): CachedFetchResponseLike {
  const snapshot = buildSnapshot(record, mode);

  getCacheByKeyStore().set(record.cacheKey, snapshot);
  getCacheByUrlStore().set(record.url, snapshot);

  return {
    ok: record.ok,
    status: record.status,
    url: record.url,
    fromCache: mode !== "live",
    mode,
    lastFetchedAt: record.fetchedAt,
    lastFetchedLabel: snapshot.lastFetchedLabel,
    cacheAgeMinutes: snapshot.cacheAgeMinutes,
    nextRefreshAfterLabel: snapshot.nextRefreshAfterLabel,
    warning: snapshot.warning,
    async text() {
      return record.body;
    },
    async json<T = unknown>() {
      return JSON.parse(record.body) as T;
    },
  };
}

function isFresh(record: SourceCacheRecord, refreshPolicy: SourceCacheRefreshPolicy): boolean {
  if (refreshPolicy === "hourly") {
    return Math.max(0, Math.round((Date.now() - new Date(record.fetchedAt).getTime()) / 60000)) < 60;
  }

  const nowParts = getLocalParts(new Date());
  const fetchedDate = record.fetchedLocalDate;

  return fetchedDate === nowParts.localDate && record.fetchedLocalHour >= DAILY_REFRESH_HOUR;
}

function shouldBypassCache(url: string, method?: string): boolean {
  if (method && method.toUpperCase() !== "GET") {
    return true;
  }

  if (!/^https?:\/\//i.test(url)) {
    return true;
  }

  return false;
}

async function performLiveFetch(
  input: RequestInfo | URL,
  init?: CachedFetchOptions,
): Promise<Response> {
  const originalFetch = getOriginalFetch();

  return originalFetch(input, init);
}

export function getSourceCacheSnapshotByKey(cacheKey: string): SourceCacheSnapshot | undefined {
  return getCacheByKeyStore().get(cacheKey);
}

export function getSourceCacheSnapshotByUrl(url: string | undefined | null): SourceCacheSnapshot | undefined {
  if (!url) {
    return undefined;
  }

  return getCacheByUrlStore().get(url);
}

export function getAllSourceCacheSnapshots(): SourceCacheSnapshot[] {
  return [...getCacheByUrlStore().values()];
}

export function hydrateSourceCacheSnapshots(snapshots: SourceCacheSnapshot[]): void {
  const byKeyStore = getCacheByKeyStore();
  const byUrlStore = getCacheByUrlStore();

  byKeyStore.clear();
  byUrlStore.clear();

  for (const snapshot of snapshots) {
    byKeyStore.set(snapshot.cacheKey, snapshot);
    byUrlStore.set(snapshot.url, snapshot);
  }
}

export function formatSourceCacheSnapshot(snapshot?: SourceCacheSnapshot | null): string | null {
  if (!snapshot) {
    return null;
  }

  if (snapshot.mode === "failed") {
    return snapshot.warning ?? "Live fetch failed.";
  }

  const prefix = snapshot.mode === "cached_fallback"
    ? "Cached fallback"
    : snapshot.mode === "cached"
      ? "Cached"
      : "Live fetch";
  const lastFetchedBase = snapshot.lastFetchedLabel?.replace(/^today\s+/i, "") ?? "recently";
  const lastFetched = snapshot.mode === "live"
    ? `checked ${lastFetchedBase}`
    : `fetched ${lastFetchedBase}`;
  const parts = [
    prefix,
    lastFetched,
  ];

  if (snapshot.warning && snapshot.mode === "cached_fallback") {
    parts.push("live fetch failed");
  }

  if (snapshot.nextRefreshAfterLabel) {
    parts.push(`next refresh after ${snapshot.nextRefreshAfterLabel}`);
  }

  return parts.join(" · ");
}

export async function withSourceCacheRefreshScope<T>(
  scope: SourceCacheRefreshScope | null,
  fn: () => Promise<T>,
): Promise<T> {
  return refreshScopeStorage.run(scope, fn);
}

export async function cachedFetch(
  input: RequestInfo | URL,
  init?: CachedFetchOptions,
): Promise<CachedFetchResponseLike> {
  const requestUrl = typeof input === "string"
    ? input
    : input instanceof URL
      ? input.toString()
      : input.url;

  if (shouldBypassCache(requestUrl, init?.method)) {
    const response = await performLiveFetch(input, init);

    return response as unknown as CachedFetchResponseLike;
  }

  const cacheKey = init?.cacheKey ?? requestUrl;
  const category = selectCategory(requestUrl, init?.category);
  const refreshPolicy = selectRefreshPolicy(requestUrl, init?.refreshPolicy);
  const timezone = init?.timezone ?? TIME_ZONE;
  const forceRefresh = init?.forceRefresh ?? shouldForceRefreshForScope(category, refreshScopeStorage.getStore());
  const existing = await readCacheRecord(cacheKey);

  if (!forceRefresh && existing && isFresh(existing, refreshPolicy)) {
    return createResponseLike(existing, "cached");
  }

  try {
    const response = await performLiveFetch(input, init);
    const body = await response.text();

    if (!response.ok) {
      if (existing) {
        const fallbackRecord: SourceCacheRecord = {
          ...existing,
          warning: `Live fetch failed; using cached response from ${existing.fetchedLocalTime}.`,
        };

        return createResponseLike(fallbackRecord, "cached_fallback");
      }

      const failedRecord: SourceCacheRecord = {
        cacheKey,
        url: requestUrl,
        category,
        refreshPolicy,
        ok: response.ok,
        status: response.status,
        body,
        fetchedAt: new Date().toISOString(),
        fetchedLocalDate: getLocalParts(new Date(), timezone).localDate,
        fetchedLocalTime: getLocalParts(new Date(), timezone).localTime,
        fetchedLocalHour: getLocalParts(new Date(), timezone).localHour,
        warning: `Live fetch failed with status ${response.status}.`,
      };

      const snapshot = buildSnapshot(failedRecord, "failed");
      getCacheByKeyStore().set(cacheKey, snapshot);
      getCacheByUrlStore().set(requestUrl, snapshot);

      return createResponseLike(failedRecord, "failed");
    }

    const now = new Date();
    const localParts = getLocalParts(now, timezone);
    const record: SourceCacheRecord = {
      cacheKey,
      url: requestUrl,
      category,
      refreshPolicy,
      ok: response.ok,
      status: response.status,
      body,
      fetchedAt: now.toISOString(),
      fetchedLocalDate: localParts.localDate,
      fetchedLocalTime: localParts.localTime,
      fetchedLocalHour: localParts.localHour,
    };

    await writeCacheRecord(record);

    return createResponseLike(record, "live");
  } catch (error) {
    if (existing) {
      const fallbackRecord: SourceCacheRecord = {
        ...existing,
        warning: `Live fetch failed; using cached response from ${existing.fetchedLocalTime}.`,
      };

      return createResponseLike(fallbackRecord, "cached_fallback");
    }

    throw error;
  }
}

export function installSourceCache(): void {
  if (globalThis.__dailyOverviewSourceCacheInstalled) {
    return;
  }

  if (!globalThis.__dailyOverviewSourceCacheOriginalFetch) {
    globalThis.__dailyOverviewSourceCacheOriginalFetch = globalThis.fetch.bind(globalThis);
  }

  globalThis.__dailyOverviewSourceCacheInstalled = true;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    return cachedFetch(input, init as CachedFetchOptions) as unknown as Promise<Response>;
  }) as typeof fetch;
}
