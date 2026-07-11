const snapshotMode = process.env.DASHBOARD_DATA_MODE === "snapshot";

type HomeSearchParams = {
  refresh?: string;
};

export default async function Home({
  searchParams,
}: {
  searchParams?: Promise<HomeSearchParams>;
}) {
  if (snapshotMode) {
    const { default: SnapshotDashboardPage } = await import("./page-snapshot");
    return <SnapshotDashboardPage />;
  }

  const { default: LiveDashboardPage } = await import("./page-live");
  return <LiveDashboardPage searchParams={searchParams} />;
}
