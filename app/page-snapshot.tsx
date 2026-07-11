import { FeedbackProfileProvider } from "./components/feedback-profile";
import { DashboardPage } from "./components/dashboard-page";
import { hydrateSourceCacheSnapshots } from "@/lib/source-cache";
import { loadDashboardSnapshot } from "@/lib/dashboard-snapshot";

export default async function SnapshotDashboardPage() {
  const snapshot = await loadDashboardSnapshot();

  hydrateSourceCacheSnapshots(snapshot.sourceCacheSnapshots);

  return (
    <FeedbackProfileProvider>
      <DashboardPage
        eventProvider={snapshot.eventProvider}
        foodDrinkProvider={snapshot.foodDrinkProvider}
        sportsProvider={snapshot.sportsProvider}
        weatherResult={snapshot.weatherResult}
        snapshotGeneratedAt={snapshot.generatedAt}
        snapshotMode
      />
    </FeedbackProfileProvider>
  );
}
