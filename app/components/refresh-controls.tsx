"use client";

import { useEffect, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import styles from "../page.module.css";

type RefreshScope = "weather" | "events";

export function RefreshControls({
  eventsUpdatedLabel,
  weatherUpdatedLabel,
}: {
  eventsUpdatedLabel: string;
  weatherUpdatedLabel: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const refreshScope = searchParams.get("refresh") as RefreshScope | null;
  const [pendingScope, setPendingScope] = useState<RefreshScope | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>("Ready.");
  const [isPending, startTransition] = useTransition();

  function startRefresh(scope: RefreshScope): void {
    if (pendingScope) {
      return;
    }

    setPendingScope(scope);
    setStatusMessage(scope === "weather" ? "Refreshing weather…" : "Refreshing events…");

    startTransition(() => {
      const nextParams = new URLSearchParams(searchParams.toString());
      nextParams.set("refresh", scope);
      router.replace(`${pathname}?${nextParams.toString()}`, { scroll: false });
    });
  }

  useEffect(() => {
    if (!refreshScope || refreshScope !== pendingScope) {
      return;
    }

    const timer = window.setTimeout(() => {
      setStatusMessage(
        `${refreshScope === "weather" ? "Weather" : "Events"} refresh complete.`,
      );
      setPendingScope(null);
      router.replace(pathname, { scroll: false });
    }, 0);

    return () => window.clearTimeout(timer);
  }, [pendingScope, pathname, refreshScope, router]);

  return (
    <div className={styles.refreshControls}>
      <div className={styles.refreshButtons}>
        <button
          className={styles.refreshButton}
          disabled={Boolean(pendingScope) || isPending}
          onClick={() => startRefresh("weather")}
          type="button"
        >
          {pendingScope === "weather" ? "Refreshing weather…" : "Refresh weather"}
        </button>
        <button
          className={styles.refreshButton}
          disabled={Boolean(pendingScope) || isPending}
          onClick={() => startRefresh("events")}
          type="button"
        >
          {pendingScope === "events" ? "Refreshing events…" : "Refresh events"}
        </button>
      </div>

      <div className={styles.refreshStatus}>
        <p>{statusMessage}</p>
        <p>
          Weather updated: {weatherUpdatedLabel} · Events updated: {eventsUpdatedLabel}
        </p>
      </div>
    </div>
  );
}
