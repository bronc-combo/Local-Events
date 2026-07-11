import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { getAllSourceCacheSnapshots } from "../lib/source-cache";
import { fetchDashboardData } from "../lib/dashboard-fetch";
import type { DashboardSnapshot } from "../types/dashboard-snapshot";

const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, "public", "data");
const OUTPUT_PATH = path.join(OUTPUT_DIR, "dashboard-snapshot.json");

async function main(): Promise<void> {
  const dashboardData = await fetchDashboardData({
    refreshWeather: true,
    refreshEvents: true,
  });

  const snapshot: DashboardSnapshot = {
    version: 1,
    generatedAt: new Date().toISOString(),
    ...dashboardData,
    sourceCacheSnapshots: getAllSourceCacheSnapshots(),
  };

  await mkdir(OUTPUT_DIR, { recursive: true });
  await writeFile(OUTPUT_PATH, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
