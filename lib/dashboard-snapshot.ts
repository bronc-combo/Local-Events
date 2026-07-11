import { readFile } from "node:fs/promises";
import path from "node:path";

import type { DashboardSnapshot } from "@/types/dashboard-snapshot";

const SNAPSHOT_PATH = path.join(process.cwd(), "public", "data", "dashboard-snapshot.json");

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isDashboardSnapshot(value: unknown): value is DashboardSnapshot {
  if (!isObject(value)) {
    return false;
  }

  return (
    value.version === 1 &&
    typeof value.generatedAt === "string" &&
    isObject(value.weatherResult) &&
    isObject(value.eventProvider) &&
    isObject(value.foodDrinkProvider) &&
    isObject(value.sportsProvider) &&
    Array.isArray(value.sourceCacheSnapshots)
  );
}

export async function loadDashboardSnapshot(): Promise<DashboardSnapshot> {
  const raw = await readFile(SNAPSHOT_PATH, "utf8");
  const parsed = JSON.parse(raw) as unknown;

  if (!isDashboardSnapshot(parsed)) {
    throw new Error("Dashboard snapshot is missing or has an unexpected shape.");
  }

  return parsed;
}

export { SNAPSHOT_PATH as DASHBOARD_SNAPSHOT_PATH };
