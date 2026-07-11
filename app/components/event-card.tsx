"use client";

import { buildCalendarDownloadInfo } from "@/lib/calendar-ics";
import {
  formatChicagoDateLabel,
  formatChicagoDateTimeLabel,
  formatChicagoShortDate,
  formatChicagoTimeLabel,
} from "@/lib/event-formatting";
import { applyFeedbackToEvents, useFeedbackProfile } from "./feedback-profile";
import styles from "../page.module.css";
import type { FeedbackType } from "@/lib/feedback-profile";
import type { EventItem } from "@/types/dashboard";

const feedbackOptions: Array<{ label: string; value: FeedbackType }> = [
  { label: "Interested", value: "interested" },
  { label: "Not interested", value: "not_interested" },
  { label: "Hide artist", value: "hide_artist" },
  { label: "Already saw", value: "already_saw" },
];

function formatEventDate(dateTime: string): string {
  return formatChicagoDateTimeLabel(dateTime);
}

function formatEventDisplayDate(dateTime: string): string {
  return formatChicagoDateLabel(dateTime);
}

function formatEventTime(dateTime: string): string {
  return formatChicagoTimeLabel(dateTime);
}

function formatShortDate(date: string): string {
  return formatChicagoShortDate(`${date}T12:00:00-05:00`);
}

function getEventScheduleLabel(event: EventItem): string | null {
  if (event.startDate && event.endDate && event.startDate !== event.endDate) {
    if (event.isOngoing) {
      return `Ongoing through ${formatShortDate(event.endDate)}`;
    }

    return `Runs ${formatShortDate(event.startDate)}–${formatShortDate(event.endDate)}`;
  }

  return event.timeLabel ?? null;
}

function buildTasteExplanation(event: EventItem): string {
  return `Recommended because: ${event.tasteReasons.join("; ")}.`;
}

function shouldShowStrongLiveActLabel(event: EventItem): boolean {
  return (
    event.liveReputationStatus === "strong" ||
    event.liveReputationStatus === "legendary" ||
    (event.isGreatLiveAct === true && !event.liveReputationStatus)
  );
}

function getSourceTierLabel(event: EventItem): string | null {
  if (event.sourceTier !== "third_party") {
    return null;
  }

  if (event.sourceDisclosure) {
    return event.sourceDisclosure;
  }

  if (event.thirdPartySourceName) {
    return `Third-party listing: ${event.thirdPartySourceName}`;
  }

  return "Third-party listing";
}

function getPrimaryEventLink(event: EventItem): { url: string; label: "Event page" | "Source page" } | null {
  const url = event.eventUrl ?? event.sourceLinks[0]?.url;

  if (!url) {
    return null;
  }

  const label = event.eventUrlLabel ?? (event.sourceLinks.length > 1 ? "Event page" : "Source page");

  return { url, label };
}

function getScoreTone(score: number): string {
  if (score >= 80) {
    return styles.scoreHigh;
  }

  if (score >= 60) {
    return styles.scoreMedium;
  }

  return styles.scoreLow;
}

export function EventCard({ event, muted = false }: { event: EventItem; muted?: boolean }) {
  const calendarInfo = buildCalendarDownloadInfo(event);
  const primaryLink = getPrimaryEventLink(event);
  const secondaryLinks = event.sourceLinks.filter((link) => link.url !== primaryLink?.url);
  const { getSelectedFeedbackForEvent, toggleFeedbackForEvent } = useFeedbackProfile();
  const selectedFeedback = getSelectedFeedbackForEvent(event);
  const sourceTierLabel = getSourceTierLabel(event);

  function handleFeedbackToggle(option: FeedbackType): void {
    toggleFeedbackForEvent(event, option);
  }

  function handleCalendarDownload(): void {
    if (!calendarInfo.available || !calendarInfo.icsText || !calendarInfo.filename) {
      return;
    }

    const blob = new Blob([calendarInfo.icsText], { type: "text/calendar;charset=utf-8" });
    const downloadUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");

    anchor.href = downloadUrl;
    anchor.download = calendarInfo.filename;
    anchor.rel = "noopener noreferrer";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(downloadUrl);
  }

  return (
    <article
      className={`${styles.eventCard} ${muted ? styles.eventCardMuted : ""}`}
    >
      <div className={styles.eventCardHeader}>
        <div className={styles.eventCardTitleWrap}>
          <h3>{event.title}</h3>
          <div className={styles.eventMetaStack}>
            <p className={styles.eventMetaPrimary}>
              {event.startDate && event.endDate && event.startDate !== event.endDate
                ? getEventScheduleLabel(event)
                : event.timeLabel
                  ? formatEventDisplayDate(event.dateTime)
                  : formatEventDate(event.dateTime)}
            </p>
            <p className={styles.eventMetaSecondary}>
              {event.startDate && event.endDate && event.startDate !== event.endDate
                ? `at ${event.venue}, ${event.city}`
                : `${event.timeLabel ?? formatEventTime(event.dateTime)} at ${event.venue}, ${event.city}`}
            </p>
          </div>
        </div>
        <div className={`${styles.eventScoreBadge} ${getScoreTone(event.tasteScore)}`}>
          {event.tasteScore}
        </div>
      </div>

      <div className={styles.eventMetaRow}>
        <span className={styles.eventCategory}>{event.category}</span>
        {event.sourceLabel ? <span className={styles.cardTag}>{event.sourceLabel}</span> : null}
        {sourceTierLabel ? <span className={styles.cardTag}>{sourceTierLabel}</span> : null}
        <span className={styles.eventScoreLabel}>Taste score</span>
      </div>

      <p className={styles.eventExplanation}>{buildTasteExplanation(event)}</p>

      {shouldShowStrongLiveActLabel(event) ? (
        <p className={styles.liveActNote}>Known strong live act.</p>
      ) : null}

      {primaryLink ? (
        <div className={styles.eventPrimaryLinkRow}>
          <a
            className={styles.eventPrimaryLink}
            href={primaryLink.url}
            rel="noopener noreferrer"
            target="_blank"
          >
            {primaryLink.label}
          </a>
        </div>
      ) : null}

      {secondaryLinks.length > 0 ? (
        <div className={styles.eventSourceLinks}>
          {secondaryLinks.map((link) => (
            <a
              className={styles.eventSourceLink}
              href={link.url}
              key={link.url}
              rel="noopener noreferrer"
              target="_blank"
            >
              {link.label}
            </a>
          ))}
        </div>
      ) : null}

      <div className={styles.eventCalendarRow}>
        {calendarInfo.available ? (
          <button
            className={styles.eventCalendarButton}
            onClick={handleCalendarDownload}
            type="button"
          >
            {calendarInfo.label}
          </button>
        ) : (
          <p className={styles.eventCalendarUnavailable}>{calendarInfo.label}</p>
        )}
      </div>

      <details className={styles.feedbackDisclosure}>
        <summary className={styles.feedbackSummary}>Feedback</summary>
        <div className={styles.feedbackPanel}>
          <div className={styles.feedbackGroup}>
            {feedbackOptions.map((option) => (
              <button
                className={`${styles.feedbackButton} ${
                  selectedFeedback === option.value ? styles.feedbackButtonActive : ""
                }`}
                aria-pressed={selectedFeedback === option.value}
                key={option.value}
                onClick={() => handleFeedbackToggle(option.value)}
                type="button"
              >
                {option.label}
              </button>
            ))}
          </div>

          {selectedFeedback ? (
            <p className={styles.feedbackNote}>Feedback noted: {feedbackOptions.find((option) => option.value === selectedFeedback)?.label ?? selectedFeedback}.</p>
          ) : null}
        </div>
      </details>
    </article>
  );
}

export function EventSection({
  events,
  note,
  lowPriorityEvents,
  lowPriorityNote,
  mutedEventIds,
}: {
  events: EventItem[];
  note?: string;
  lowPriorityEvents?: EventItem[];
  lowPriorityNote?: string;
  mutedEventIds?: string[];
}) {
  const { profile } = useFeedbackProfile();
  const combinedEvents = [...events, ...(lowPriorityEvents ?? [])];
  const adjustedEvents = applyFeedbackToEvents(combinedEvents, profile);
  const visibleEvents = adjustedEvents.filter(
    (event) => !event.hiddenReason?.startsWith("Skipped malformed date-only listing."),
  );
  const recommendedEvents = visibleEvents.filter((event) => !event.hiddenReason);
  const renderedLowPriorityEvents = visibleEvents.filter((event) => event.hiddenReason);
  const mutedEventIdSet = new Set(mutedEventIds ?? []);

  return (
    <>
      {note ? <p className={styles.sectionNote}>{note}</p> : null}
      {recommendedEvents.length > 0 || renderedLowPriorityEvents.length > 0 ? (
        <div className={styles.eventList}>
          {recommendedEvents.map((event) => (
            <EventCard event={event} key={event.id} muted={mutedEventIdSet.has(event.id)} />
          ))}
          {renderedLowPriorityEvents
            .filter((event) => mutedEventIdSet.has(event.id))
            .map((event) => (
              <EventCard event={event} key={event.id} muted />
            ))}
        </div>
      ) : (
        <p className={styles.cardMuted}>No events matched this section right now.</p>
      )}

      {renderedLowPriorityEvents.length > 0 ? (
        <details className={styles.lowPriorityPanel}>
          <summary>{lowPriorityNote ?? "Low-priority / hidden by taste filter"}</summary>
          <div className={styles.lowPriorityList}>
            {renderedLowPriorityEvents
              .filter((event) => !mutedEventIdSet.has(event.id))
              .map((event) => (
              <div className={styles.lowPriorityItem} key={event.id}>
                <EventCard event={event} muted />
                <p className={styles.lowPriorityReason}>{event.hiddenReason}</p>
              </div>
              ))}
          </div>
        </details>
      ) : null}
    </>
  );
}
