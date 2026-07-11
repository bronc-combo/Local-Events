import { FeedbackProfileProvider } from "./components/feedback-profile";
import { DashboardPage } from "./components/dashboard-page";
import { fetchDashboardData } from "@/lib/dashboard-fetch";

type HomeSearchParams = {
  refresh?: string;
};

export default async function LiveDashboardPage({
  searchParams,
}: {
  searchParams?: Promise<HomeSearchParams>;
}) {
  const resolvedSearchParams = await Promise.resolve(searchParams);
  const refresh = resolvedSearchParams?.refresh;
  const refreshWeather = refresh === "weather";
  const refreshEvents = refresh === "events";
  const dashboardData = await fetchDashboardData({
    refreshWeather,
    refreshEvents,
  });

  return (
    <FeedbackProfileProvider>
      <DashboardPage {...dashboardData} />
    </FeedbackProfileProvider>
  );
}
