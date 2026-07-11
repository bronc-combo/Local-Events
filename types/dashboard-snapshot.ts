import type { DashboardData } from "@/lib/dashboard-fetch";
import type { SourceCacheSnapshot } from "@/types/dashboard";

export interface DashboardSnapshot extends DashboardData {
  version: 1;
  generatedAt: string;
  sourceCacheSnapshots: SourceCacheSnapshot[];
}
