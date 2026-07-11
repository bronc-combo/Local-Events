"use client";

import { useState } from "react";
import styles from "../page.module.css";

export function CollapsibleSection({
  title,
  summary,
  countLabel,
  defaultCollapsed = false,
  children,
}: {
  title: string;
  summary: string;
  countLabel?: string;
  defaultCollapsed?: boolean;
  children: React.ReactNode;
}) {
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);

  return (
    <article className={styles.card}>
      <div className={styles.collapsibleSection}>
        <button
          aria-expanded={!isCollapsed}
          className={styles.collapsibleToggle}
          onClick={() => setIsCollapsed((current) => !current)}
          type="button"
        >
          <div className={styles.collapsibleHeading}>
            <h2>{title}</h2>
            <p className={styles.cardMuted}>{summary}</p>
          </div>
          <div className={styles.collapsibleMeta}>
            {countLabel ? (
              <span className={styles.collapsibleCount}>{countLabel}</span>
            ) : null}
            <span className={styles.collapsibleIndicator}>
              {isCollapsed ? "Show" : "Hide"}
            </span>
          </div>
        </button>

        {!isCollapsed ? children : null}
      </div>
    </article>
  );
}
