import styles from "../page.module.css";
import type { FoodDrinkSpecial } from "@/types/dashboard";

function getVerificationClass(status: string): string {
  if (status === "Confirmed") {
    return styles.statusConfirmed;
  }

  if (status === "From Capacities only") {
    return styles.statusCapacitiesOnly;
  }

  return styles.statusUnverified;
}

export function FoodDrinkCard({
  item,
  muted = false,
}: {
  item: FoodDrinkSpecial;
  muted?: boolean;
}) {
  const hasStructuredSpecials = (item.todaySpecials?.length ?? 0) > 0;
  const showMetaRow = Boolean(
    item.myRating !== undefined
    || item.distanceMiles !== undefined
    || item.estimatedCost,
  );

  return (
    <article
      className={`${styles.foodDrinkCard} ${muted ? styles.foodDrinkCardMuted : ""}`}
    >
      <div className={styles.foodDrinkCardHeader}>
        <div className={styles.foodDrinkTitleWrap}>
          <h3>{item.name}</h3>
          <p className={styles.foodDrinkMetaPrimary}>
            {item.type}
            {item.neighborhood ? ` · ${item.neighborhood}` : ""}
          </p>
          {item.address ? (
            <p className={styles.foodDrinkMetaSecondary}>{item.address}</p>
          ) : null}
        </div>
        <span className={`${styles.verificationBadge} ${getVerificationClass(item.verificationStatus)}`}>
          {item.verificationStatus}
        </span>
      </div>

      {showMetaRow ? (
        <div className={styles.foodDrinkMetaRow}>
          {item.myRating !== undefined ? (
            <span className={styles.foodDrinkPill}>My rating {item.myRating.toFixed(1)}</span>
          ) : null}
          {item.distanceMiles !== undefined ? (
            <span className={styles.foodDrinkPill}>
              {item.distanceMiles.toFixed(1)} mi from 77009
            </span>
          ) : null}
          {item.estimatedCost ? (
            <span className={styles.foodDrinkPill}>{item.estimatedCost}</span>
          ) : null}
        </div>
      ) : null}

      <div className={styles.foodDrinkDetailBlock}>
        {hasStructuredSpecials ? (
          <div className={styles.foodDrinkSpecialList}>
            {item.todaySpecials?.map((special, index) => (
              <div
                className={styles.foodDrinkSpecialItem}
                key={`${item.id}-special-${index}`}
              >
                {special.title ? (
                  <p className={styles.foodDrinkSpecialTitle}>{special.title}</p>
                ) : null}
                {special.description ? (
                  <p className={styles.foodDrinkSpecial}>{special.description}</p>
                ) : null}
                {special.displayTime ? (
                  <p className={styles.foodDrinkTime}>{special.displayTime}</p>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <>
            {item.special ? (
              <p className={styles.foodDrinkSpecial}>{item.special}</p>
            ) : null}
            {item.happyHour ? (
              <p className={styles.foodDrinkTime}>{item.happyHour}</p>
            ) : null}
          </>
        )}
      </div>

      <p className={styles.foodDrinkSource}>Source: {item.source}</p>

      {item.sourceLinks.length > 0 ? (
        <div className={styles.eventSourceLinks}>
          {item.sourceLinks.map((link) => (
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
    </article>
  );
}

export function FoodDrinkSection({
  primaryItems,
  lowerPriorityItems,
  note,
}: {
  primaryItems: FoodDrinkSpecial[];
  lowerPriorityItems: FoodDrinkSpecial[];
  note?: string;
}) {
  return (
    <>
      {note ? <p className={styles.sectionNote}>{note}</p> : null}
      {primaryItems.length > 0 ? (
        <div className={styles.foodDrinkList}>
          {primaryItems.map((item) => (
            <FoodDrinkCard item={item} key={item.id} />
          ))}
        </div>
      ) : (
        <p className={styles.cardMuted}>No saved Food & Drink specials for today.</p>
      )}

      {lowerPriorityItems.length > 0 ? (
        <details className={styles.lowPriorityPanel}>
          <summary>Lower priority food & drink</summary>
          <div className={styles.lowPriorityList}>
            {lowerPriorityItems.map((item) => (
              <div className={styles.lowPriorityItem} key={item.id}>
                <FoodDrinkCard item={item} muted />
                {item.hiddenReason ? (
                  <p className={styles.lowPriorityReason}>{item.hiddenReason}</p>
                ) : null}
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </>
  );
}
