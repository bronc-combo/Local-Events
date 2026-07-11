import styles from "../page.module.css";
import {
  clampPercentage,
  formatTemperature,
  formatWindSpeed,
  selectHourlyRainDisplay,
  type WeatherFetchResult,
} from "@/lib/weather";

export function WeatherCardLoading() {
  return <p className={styles.cardMuted}>Loading Houston weather...</p>;
}

export function WeatherCard({ result }: { result: WeatherFetchResult }) {
  if (result.error || !result.weather) {
    return <p className={styles.cardMuted}>{result.error}</p>;
  }

  const { weather } = result;
  const hourlyRainDisplay = selectHourlyRainDisplay(weather.hourlyRainChances);
  const weatherTag = weather.cache?.mode === "cached_fallback"
    ? "Cached fallback"
    : weather.cache?.mode === "cached"
      ? "Cached"
      : "Live";

  return (
    <>
      <div className={styles.cardHeader}>
        <div>
          <p className={styles.cardSubtle}>{weather.locationLabel}</p>
        </div>
        <span className={styles.cardTag}>{weatherTag}</span>
      </div>

      <div className={styles.weatherHero}>
        <div>
          <p className={styles.weatherValue}>
            {formatTemperature(weather.currentTemperatureF)}
          </p>
          <p className={styles.cardMuted}>
            Feels like {formatTemperature(weather.feelsLikeTemperatureF)}
          </p>
        </div>
        <p className={styles.weatherSummary}>{weather.summary}</p>
      </div>

      <div className={styles.weatherGrid}>
        <div className={styles.weatherStat}>
          <span>High / Low</span>
          <strong>
            {formatTemperature(weather.highF)} /{" "}
            {formatTemperature(weather.lowF)}
          </strong>
        </div>

        <div className={styles.weatherStat}>
          <span>Max rain chance</span>
          <strong>{Math.round(weather.maxRainChance)}%</strong>
        </div>

        <div className={styles.weatherStat}>
          <span>Likely rain window</span>
          <strong>{weather.likelyRainWindow}</strong>
        </div>

        <div className={styles.weatherStat}>
          <span>Wind</span>
          <strong>{formatWindSpeed(weather.currentWindSpeedMph)}</strong>
        </div>
      </div>

      <div className={styles.rainStripSection}>
        <p className={styles.rainStripLabel}>Hourly rain chance</p>

        {hourlyRainDisplay.hours.length > 0 ? (
          <>
            {hourlyRainDisplay.isSampled ? (
              <p className={styles.rainStripNote}>Showing key remaining hours.</p>
            ) : null}

            <div
              className={styles.rainList}
              aria-label="Hourly rain chance for today"
            >
              {hourlyRainDisplay.hours.map((hour) => (
                <div className={styles.rainRow} key={hour.time}>
                  <span className={styles.rainHourTime}>{hour.displayTime}</span>
                  <div className={styles.rainBarTrack} aria-hidden="true">
                    <div
                      className={styles.rainBarFill}
                      style={{
                        width: `${clampPercentage(
                          hour.precipitationProbability,
                        )}%`,
                      }}
                    />
                  </div>
                  <span className={styles.rainHourPercent}>
                    {clampPercentage(hour.precipitationProbability)}%
                  </span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <p className={styles.cardMuted}>
            Hourly rain chance is unavailable right now.
          </p>
        )}
      </div>

      <p className={styles.cardSource}>
        Source:{" "}
        {weather.sourceLinks.map((link) => (
          <a
            key={link.url}
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            {link.label}
          </a>
        ))}
      </p>
    </>
  );
}
