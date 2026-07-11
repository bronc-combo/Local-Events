"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { createEmptyFeedbackProfile, getFeedbackImpactForEvent, getFeedbackTypeForEvent, buildFeedbackRuleFromEvent, loadLocalFeedbackProfile, serializeFeedbackProfile, summarizeFeedbackProfile, type FeedbackType, type LocalFeedbackLoadResult, type LocalFeedbackProfile } from "@/lib/feedback-profile";
import type { EventItem } from "@/types/dashboard";
import styles from "../page.module.css";

const STORAGE_KEY = "daily-overview:event-feedback:v1";

interface FeedbackProfileContextValue {
  profile: LocalFeedbackProfile;
  loaded: boolean;
  warning?: string;
  toggleFeedbackForEvent: (event: EventItem, type: FeedbackType) => void;
  clearFeedback: () => void;
  getSelectedFeedbackForEvent: (event: EventItem) => FeedbackType | null;
  getFeedbackImpact: (event: EventItem) => ReturnType<typeof getFeedbackImpactForEvent>;
}

const FeedbackProfileContext = createContext<FeedbackProfileContextValue | null>(null);

function readStoredProfile(): LocalFeedbackLoadResult {
  try {
    if (typeof window === "undefined") {
      return { profile: createEmptyFeedbackProfile(), loaded: false };
    }

    return loadLocalFeedbackProfile(window.localStorage.getItem(STORAGE_KEY));
  } catch (error) {
    return {
      profile: createEmptyFeedbackProfile(),
      loaded: true,
      warning: error instanceof Error ? `Feedback profile could not be loaded: ${error.message}` : "Feedback profile could not be loaded.",
    };
  }
}

export function FeedbackProfileProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<LocalFeedbackProfile>(() => createEmptyFeedbackProfile());
  const [loaded, setLoaded] = useState(false);
  const [warning, setWarning] = useState<string | undefined>();

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const loadedProfile = readStoredProfile();
      setProfile(loadedProfile.profile);
      setLoaded(true);
      setWarning(loadedProfile.warning);
    }, 0);

    return () => window.clearTimeout(timeout);
  }, []);

  useEffect(() => {
    if (!loaded || typeof window === "undefined") {
      return;
    }

    const timeout = window.setTimeout(() => {
      try {
        window.localStorage.setItem(STORAGE_KEY, serializeFeedbackProfile(profile));
      } catch (error) {
        setWarning(error instanceof Error ? `Feedback profile could not be saved: ${error.message}` : "Feedback profile could not be saved.");
      }
    }, 0);

    return () => window.clearTimeout(timeout);
  }, [loaded, profile]);

  const toggleFeedbackForEvent = useCallback((event: EventItem, type: FeedbackType) => {
    setProfile((current) => {
      const signature = buildFeedbackRuleFromEvent(event, type).eventSignature;
      const existingRule = current.rules.find((rule) => rule.eventId === event.id || rule.eventSignature === signature);

      if (existingRule && existingRule.type === type) {
        return {
          version: 1,
          rules: current.rules.filter((rule) => rule.id !== existingRule.id),
        };
      }

      const nextRule = buildFeedbackRuleFromEvent(event, type);
      const remainingRules = current.rules.filter((rule) => rule.id !== existingRule?.id);

      return {
        version: 1,
        rules: [...remainingRules, nextRule],
      };
    });
  }, []);

  const clearFeedback = useCallback(() => {
    setProfile(createEmptyFeedbackProfile());

    if (typeof window !== "undefined") {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  const getSelectedFeedbackForEvent = useCallback((event: EventItem) => {
    return getFeedbackTypeForEvent(event, profile);
  }, [profile]);

  const getFeedbackImpact = useCallback((event: EventItem) => {
    return getFeedbackImpactForEvent(event, profile);
  }, [profile]);

  const value = useMemo<FeedbackProfileContextValue>(() => ({
    profile,
    loaded,
    warning,
    toggleFeedbackForEvent,
    clearFeedback,
    getSelectedFeedbackForEvent,
    getFeedbackImpact,
  }), [clearFeedback, getFeedbackImpact, getSelectedFeedbackForEvent, loaded, profile, toggleFeedbackForEvent, warning]);

  return <FeedbackProfileContext.Provider value={value}>{children}</FeedbackProfileContext.Provider>;
}

export function useFeedbackProfile(): FeedbackProfileContextValue {
  const context = useContext(FeedbackProfileContext);

  if (!context) {
    throw new Error("useFeedbackProfile must be used inside FeedbackProfileProvider.");
  }

  return context;
}

export function applyFeedbackToEvents(events: EventItem[], profile: LocalFeedbackProfile): EventItem[] {
  const adjusted = new Map<string, EventItem>();

  for (const event of events) {
    const impact = getFeedbackImpactForEvent(event, profile);
    const adjustedScore = Math.min(Math.max(Math.round(event.tasteScore + impact.scoreAdjustment), 0), 100);
    const feedbackReasons = impact.reasons.filter(Boolean);
    const hiddenByFeedback = impact.suppress;
    const isDateOnlySkip = event.hiddenReason?.startsWith("Skipped malformed date-only listing.");
    const shouldHide = hiddenByFeedback || (event.hiddenReason ? adjustedScore < 45 && !isDateOnlySkip : adjustedScore < 45);
    const hiddenReason = hiddenByFeedback
      ? "Hidden by your feedback."
      : isDateOnlySkip
        ? event.hiddenReason
        : shouldHide
          ? feedbackReasons.includes("boosted by your feedback")
            ? "Lower priority for your taste profile after feedback."
            : event.hiddenReason ?? "Lower priority for your taste profile."
          : undefined;

    adjusted.set(event.id, {
      ...event,
      tasteScore: adjustedScore,
      tasteReasons: feedbackReasons.length > 0
        ? [...feedbackReasons, ...event.tasteReasons].filter((reason, index, list) => list.indexOf(reason) === index)
        : event.tasteReasons,
      hiddenReason,
      isGreatLiveAct: event.isGreatLiveAct || impact.isGreatLiveAct,
      liveReputationStatus: impact.liveReputationStatus ?? event.liveReputationStatus,
      liveReputationConfidence: Math.max(event.liveReputationConfidence ?? 0, impact.liveReputationConfidence),
      musicTasteOverrideSuppressed: event.musicTasteOverrideSuppressed || hiddenByFeedback || undefined,
    });
  }

  return [...adjusted.values()].sort((left, right) => {
    if (right.tasteScore !== left.tasteScore) {
      return right.tasteScore - left.tasteScore;
    }

    return left.dateTime.localeCompare(right.dateTime);
  });
}

export function getFeedbackSummaryForEvents(events: EventItem[], profile: LocalFeedbackProfile) {
  return summarizeFeedbackProfile(profile, events);
}

export function FeedbackResetButton() {
  const { clearFeedback } = useFeedbackProfile();

  return (
    <button
      className={styles.feedbackResetButton}
      onClick={() => {
        const confirmed = window.confirm("Clear local feedback on this browser?");
        if (confirmed) {
          clearFeedback();
        }
      }}
      type="button"
    >
      Reset local feedback
    </button>
  );
}

export function FeedbackHealthPanel({
  musicEvents,
  cultureEvents,
  otherEvents,
}: {
  musicEvents: EventItem[];
  cultureEvents: EventItem[];
  otherEvents: EventItem[];
}) {
  const { loaded, profile, warning } = useFeedbackProfile();
  const summary = useMemo(() => {
    const uniqueEvents = new Map<string, EventItem>();

    for (const event of [...musicEvents, ...cultureEvents, ...otherEvents]) {
      uniqueEvents.set(event.id, event);
    }

    return summarizeFeedbackProfile(profile, [...uniqueEvents.values()]);
  }, [cultureEvents, musicEvents, otherEvents, profile]);

  return (
    <article className={styles.sourceHealthRow}>
      <div className={styles.sourceHealthTopRow}>
        <div className={styles.sourceHealthNameBlock}>
          <h4>Local feedback profile</h4>
          <div className={styles.sourceHealthBadges}>
            <span className={`${styles.sourceHealthBadge} ${styles.sourceBadgeSubtle}`}>
              loaded: {loaded ? "yes" : "no"}
            </span>
            <span className={`${styles.sourceHealthBadge} ${styles.sourceBadgeNeutral}`}>
              explicit: {summary.explicitEventFeedbackCount}
            </span>
          </div>
        </div>
        <FeedbackResetButton />
      </div>

      <div className={styles.sourceHealthMetaGrid}>
        <span>Interested: {summary.interestedCount}</span>
        <span>Not interested: {summary.notInterestedCount}</span>
        <span>Hide artist: {summary.hiddenArtistCount}</span>
        <span>Already saw: {summary.alreadySawCount}</span>
        <span>Feedback-adjusted visible events: {summary.feedbackAdjustedVisibleEventsCount}</span>
        <span>Feedback-hidden events: {summary.feedbackHiddenEventsCount}</span>
      </div>

      <p className={styles.sourceHealthNote}>
        {warning
          ? `Feedback warning: ${warning}`
          : profile.rules.length > 0
            ? "Local feedback is active in this browser only."
            : "No local feedback has been saved in this browser yet."}
      </p>
    </article>
  );
}
