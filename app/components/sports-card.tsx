import styles from "../page.module.css";
import type { SportsEvent } from "@/types/dashboard";

function formatSportsDateTime(dateTime: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Chicago",
  }).format(new Date(dateTime));
}

function formatSportsDate(dateTime: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "America/Chicago",
  }).format(new Date(dateTime));
}

function getSportsTitle(event: SportsEvent): string {
  return `${event.awayTeam} at ${event.homeTeam}`;
}

function getPriorityLabel(event: SportsEvent): string {
  return event.isHomeOrLocal ? "Home / local" : "Lower priority";
}

export function SportsCard({
  event,
  muted = false,
}: {
  event: SportsEvent;
  muted?: boolean;
}) {
  return (
    <article
      className={`${styles.sportsCard} ${muted ? styles.sportsCardMuted : ""}`}
    >
      <div className={styles.sportsCardHeader}>
        <div className={styles.sportsTitleWrap}>
          <h3>{getSportsTitle(event)}</h3>
          <p className={styles.sportsMetaPrimary}>
            {event.timeLabel ? formatSportsDate(event.dateTime) : formatSportsDateTime(event.dateTime)}
          </p>
          {event.timeLabel ? (
            <p className={styles.sportsMetaSecondary}>{event.timeLabel}</p>
          ) : null}
          <p className={styles.sportsMetaSecondary}>
            {event.venue}, {event.city}
          </p>
        </div>
        <span className={styles.sportsLeagueBadge}>{event.league}</span>
      </div>

      <div className={styles.sportsMetaRow}>
        <span className={styles.sportsPriorityPill}>
          {getPriorityLabel(event)}
        </span>
        <span className={styles.sportsNote}>{event.note}</span>
      </div>

      <div className={styles.eventSourceLinks}>
        {event.sourceLinks.map((link, index) => (
          <a
            className={styles.eventSourceLink}
            href={link.url}
            key={`${event.id}-${link.url}-${index}`}
            rel="noopener noreferrer"
            target="_blank"
          >
            {link.label}
          </a>
        ))}
      </div>
    </article>
  );
}

export function SportsSection({
  primarySports,
  lowerPrioritySports,
  note,
}: {
  primarySports: SportsEvent[];
  lowerPrioritySports: SportsEvent[];
  note?: string;
}) {
  return (
    <>
      {note ? <p className={styles.sectionNote}>{note}</p> : null}
      {primarySports.length > 0 ? (
        <div className={styles.sportsList}>
          {primarySports.map((event) => (
            <SportsCard event={event} key={event.id} />
          ))}
        </div>
      ) : (
        <p className={styles.cardMuted}>No local pro home games found for today.</p>
      )}

      {lowerPrioritySports.length > 0 ? (
        <details className={styles.lowPriorityPanel}>
          <summary>Lower priority sports</summary>
          <div className={styles.lowPriorityList}>
            {lowerPrioritySports.map((event) => (
              <div className={styles.lowPriorityItem} key={event.id}>
                <SportsCard event={event} muted />
                {event.hiddenReason ? (
                  <p className={styles.lowPriorityReason}>{event.hiddenReason}</p>
                ) : null}
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </>
  );
}
