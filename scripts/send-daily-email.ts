import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { buildFoodDrinkTodayEvents } from "../lib/food-drink-provider";
import type { DashboardSnapshot } from "../types/dashboard-snapshot";
import type { EventItem, SportsEvent } from "../types/dashboard";

const HOUSTON_TIME_ZONE = "America/Chicago";
const SNAPSHOT_PATH = path.join(process.cwd(), "public", "data", "dashboard-snapshot.json");
const DRY_RUN_DIRECTORY = path.join(process.cwd(), ".tmp");
const DASHBOARD_URL = "https://bronc-combo.github.io/Local-Events/";

type EmailSection = {
  title: string;
  events: EventItem[];
};

function getHoustonDate(value: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: HOUSTON_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

function formatHoustonDate(value: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: HOUSTON_TIME_ZONE,
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(value);
}

function formatHoustonDateTime(value: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: HOUSTON_TIME_ZONE,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(value);
}

function formatEventDateTime(dateTime: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: HOUSTON_TIME_ZONE,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(dateTime));
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function isActiveToday(event: Pick<EventItem, "dateTime" | "startDate" | "endDate">, today: string): boolean {
  const eventDate = event.dateTime.slice(0, 10);
  const startDate = event.startDate ?? eventDate;
  const endDate = event.endDate ?? eventDate;

  return startDate !== endDate ? startDate <= today && endDate >= today : eventDate === today;
}

function isOngoingToday(event: Pick<EventItem, "dateTime" | "startDate" | "endDate" | "isOngoing">, today: string): boolean {
  const eventDate = event.dateTime.slice(0, 10);
  const startDate = event.startDate ?? eventDate;
  const endDate = event.endDate ?? eventDate;

  return event.isOngoing === true || (startDate !== endDate && isActiveToday(event, today));
}

function uniqueEvents(events: EventItem[]): EventItem[] {
  const seen = new Set<string>();

  return events.filter((event) => {
    const key = event.eventUrl ?? `${event.title}|${event.dateTime}|${event.venue}`;

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function sortMusic(events: EventItem[]): EventItem[] {
  return [...events].sort((left, right) => right.tasteScore - left.tasteScore || left.dateTime.localeCompare(right.dateTime));
}

function sortByTimeThenTitle(events: EventItem[]): EventItem[] {
  return [...events].sort((left, right) => left.dateTime.localeCompare(right.dateTime) || left.title.localeCompare(right.title));
}

function sportsEventToEventItem(event: SportsEvent): EventItem {
  const primaryLink = event.sourceLinks[0];

  return {
    id: `sports-${event.id}`,
    title: `${event.awayTeam} at ${event.homeTeam}`,
    dateTime: event.dateTime,
    venue: event.venue,
    city: event.city,
    category: event.league,
    sectionCategory: "sports",
    eventSubtype: event.note,
    sourceLabel: event.sourceLabel ?? event.league,
    eventUrl: primaryLink?.url,
    eventUrlLabel: primaryLink ? (event.sourceLinks.length > 1 ? "Event page" : "Source page") : undefined,
    sourceLinks: event.sourceLinks,
    tasteScore: 55,
    tasteReasons: [event.note || "local pro sports fit"],
    isGreatLiveAct: false,
    liveReputationStatus: "unknown",
    hiddenReason: event.hiddenReason,
  };
}

function buildTodaySections(snapshot: DashboardSnapshot): EmailSection[] {
  const today = getHoustonDate(new Date(snapshot.generatedAt));
  const allMusic = snapshot.eventProvider.todayEvents.filter(
    (event) => event.sectionCategory === "concert" && isActiveToday(event, today),
  );
  const allFoodDrink = buildFoodDrinkTodayEvents(snapshot.foodDrinkProvider.primaryItems, today);
  const allArtsCulture = snapshot.eventProvider.cultureEvents.filter(
    (event) => isActiveToday(event, today),
  );
  const allSports = snapshot.sportsProvider.primarySports
    .filter((event) => event.isHomeOrLocal)
    .map(sportsEventToEventItem)
    .filter((event) => isActiveToday(event, today));
  const allOther = snapshot.eventProvider.otherEvents.filter(
    (event) => isActiveToday(event, today),
  );
  const ongoing = [
    ...allMusic,
    ...allFoodDrink,
    ...allArtsCulture,
    ...allSports,
    ...allOther,
  ].filter((event) => isOngoingToday(event, today));
  const ongoingIds = new Set(ongoing.map((event) => event.id));
  const music = allMusic.filter((event) => !ongoingIds.has(event.id));
  const foodDrink = allFoodDrink.filter((event) => !ongoingIds.has(event.id));
  const artsCulture = allArtsCulture.filter((event) => !ongoingIds.has(event.id));
  const sports = allSports.filter((event) => !ongoingIds.has(event.id));
  const other = allOther.filter((event) => !ongoingIds.has(event.id));

  return [
    { title: "Music", events: sortMusic(uniqueEvents(music)) },
    { title: "Food & Drink", events: sortByTimeThenTitle(uniqueEvents(foodDrink)) },
    { title: "Arts & Culture", events: sortByTimeThenTitle(uniqueEvents(artsCulture)) },
    { title: "Sports", events: sortByTimeThenTitle(uniqueEvents(sports)) },
    { title: "Other", events: sortByTimeThenTitle(uniqueEvents(other)) },
    { title: "Ongoing", events: sortByTimeThenTitle(uniqueEvents(ongoing)) },
  ];
}

function getEventSchedule(event: EventItem): string {
  if (event.startDate && event.endDate && event.startDate !== event.endDate) {
    return event.isOngoing ? `Ongoing through ${event.endDate}` : `Runs ${event.startDate}–${event.endDate}`;
  }

  return event.timeLabel ? `${formatEventDateTime(event.dateTime)} · ${event.timeLabel}` : formatEventDateTime(event.dateTime);
}

function getEventLink(event: EventItem): string | undefined {
  return event.eventUrl ?? event.sourceLinks[0]?.url;
}

function buildHtml(snapshot: DashboardSnapshot, sections: EmailSection[]): string {
  const weather = snapshot.weatherResult.weather;
  const generatedAt = formatHoustonDateTime(new Date(snapshot.generatedAt));
  const date = formatHoustonDate(new Date(snapshot.generatedAt));
  const sectionsHtml = sections
    .filter((section) => section.events.length > 0)
    .map((section) => `
      <section style="margin:24px 0 0">
        <h2 style="margin:0 0 10px;font-size:18px;color:#e8eef4">${escapeHtml(section.title)}</h2>
        ${section.events.map((event) => {
          const link = getEventLink(event);
          const title = escapeHtml(event.title);
          const eventLink = link
            ? `<p style="margin:10px 0 0"><a href="${escapeHtml(link)}" style="color:#8fd5ee;text-decoration:none">Event page</a></p>`
            : "";

          return `
            <article style="background:#121a22;border:1px solid #263645;border-radius:12px;padding:14px;margin:10px 0">
              <p style="margin:0;font-size:16px;font-weight:700;color:#f3f7fa">${title}</p>
              <p style="margin:7px 0 0;color:#bcc9d5">${escapeHtml(getEventSchedule(event))}</p>
              <p style="margin:5px 0 0;color:#bcc9d5">${escapeHtml(`${event.venue}, ${event.city}`)}</p>
              <p style="margin:5px 0 0;color:#91a5b8;font-size:13px">${escapeHtml(event.category)}${event.sourceLabel ? ` · ${escapeHtml(event.sourceLabel)}` : ""}</p>
              ${eventLink}
            </article>`;
        }).join("")}
      </section>`
    ).join("");
  const noEvents = sections.every((section) => section.events.length === 0);
  const weatherHtml = weather
    ? `
      <section style="background:#13212a;border:1px solid #294252;border-radius:12px;padding:16px">
        <h2 style="margin:0 0 8px;font-size:18px;color:#e8eef4">Weather</h2>
        <p style="margin:0;color:#d5e0e8">${escapeHtml(weather.summary)}</p>
        <p style="margin:8px 0 0;color:#b9c8d4">${Math.round(weather.currentTemperatureF)}° now · High ${Math.round(weather.highF)}° · Low ${Math.round(weather.lowF)}°</p>
        <p style="margin:8px 0 0;color:#b9c8d4">Rain chance: ${weather.maxRainChance}%${weather.likelyRainWindow ? ` · ${escapeHtml(weather.likelyRainWindow)}` : ""}</p>
      </section>`
    : "";

  return `<!doctype html>
<html lang="en">
  <body style="margin:0;background:#0b1117;color:#d5e0e8;font-family:Arial,Helvetica,sans-serif">
    <main style="max-width:640px;margin:0 auto;padding:24px 16px 32px">
      <p style="margin:0 0 4px;color:#8fd5ee;font-size:13px;letter-spacing:.06em;text-transform:uppercase">Houston daily overview</p>
      <h1 style="margin:0 0 8px;font-size:26px;color:#f3f7fa">Houston Today — ${escapeHtml(date)}</h1>
      <p style="margin:0 0 20px;color:#91a5b8;font-size:13px">Snapshot generated ${escapeHtml(generatedAt)}</p>
      ${weatherHtml}
      ${noEvents ? "<p style=\"margin:24px 0 0;color:#bcc9d5\">No discrete events were found for today. Ongoing events are included below when available.</p>" : sectionsHtml}
      <p style="margin:28px 0 0"><a href="${DASHBOARD_URL}" style="color:#8fd5ee;text-decoration:none;font-weight:700">Open the full Houston dashboard</a></p>
    </main>
  </body>
</html>`;
}

function buildText(snapshot: DashboardSnapshot, sections: EmailSection[]): string {
  const weather = snapshot.weatherResult.weather;
  const lines = [
    `Houston Today — ${formatHoustonDate(new Date(snapshot.generatedAt))}`,
    `Snapshot generated ${formatHoustonDateTime(new Date(snapshot.generatedAt))}`,
    "",
  ];

  if (weather) {
    lines.push(
      "WEATHER",
      weather.summary,
      `${Math.round(weather.currentTemperatureF)}° now · High ${Math.round(weather.highF)}° · Low ${Math.round(weather.lowF)}°`,
      `Rain chance: ${weather.maxRainChance}%${weather.likelyRainWindow ? ` · ${weather.likelyRainWindow}` : ""}`,
      "",
    );
  }

  const nonEmptySections = sections.filter((section) => section.events.length > 0);

  if (nonEmptySections.length === 0) {
    lines.push("No discrete events were found for today. Ongoing events are included when available.", "");
  }

  for (const section of nonEmptySections) {
    lines.push(section.title.toUpperCase());
    for (const event of section.events) {
      lines.push(event.title, `${getEventSchedule(event)} · ${event.venue}, ${event.city}`, `${event.category}${event.sourceLabel ? ` · ${event.sourceLabel}` : ""}`);
      const link = getEventLink(event);
      if (link) {
        lines.push(link);
      }
      lines.push("");
    }
  }

  lines.push(`Full dashboard: ${DASHBOARD_URL}`);
  return lines.join("\n");
}

async function loadSnapshot(): Promise<DashboardSnapshot> {
  const raw = await readFile(SNAPSHOT_PATH, "utf8");
  return JSON.parse(raw) as DashboardSnapshot;
}

async function writeDryRun(html: string, text: string): Promise<void> {
  await mkdir(DRY_RUN_DIRECTORY, { recursive: true });
  await Promise.all([
    writeFile(path.join(DRY_RUN_DIRECTORY, "daily-email.html"), html, "utf8"),
    writeFile(path.join(DRY_RUN_DIRECTORY, "daily-email.txt"), text, "utf8"),
  ]);
  console.log("Dry run written to .tmp/daily-email.html and .tmp/daily-email.txt");
}

async function sendEmail(html: string, text: string, snapshot: DashboardSnapshot): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.DAILY_EMAIL_TO;
  const from = process.env.DAILY_EMAIL_FROM;

  if (!apiKey || !to || !from) {
    throw new Error("RESEND_API_KEY, DAILY_EMAIL_TO, and DAILY_EMAIL_FROM must be configured before sending email.");
  }

  const date = getHoustonDate(new Date(snapshot.generatedAt));
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `daily-overview-houston-${date}`,
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject: `Houston Today — ${formatHoustonDate(new Date(snapshot.generatedAt))}`,
      html,
      text,
    }),
  });

  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(`Resend email request failed with status ${response.status}: ${responseText.slice(0, 500)}`);
  }

  let responseId: string | undefined;
  try {
    responseId = (JSON.parse(responseText) as { id?: string }).id;
  } catch {
    // A successful response without JSON is still a completed send.
  }

  console.log(responseId ? `Daily email sent. Resend response ID: ${responseId}` : "Daily email sent.");
}

async function main(): Promise<void> {
  const snapshot = await loadSnapshot();
  const sections = buildTodaySections(snapshot);
  const html = buildHtml(snapshot, sections);
  const text = buildText(snapshot, sections);

  if (process.env.DAILY_EMAIL_DRY_RUN === "true") {
    await writeDryRun(html, text);
    return;
  }

  await sendEmail(html, text, snapshot);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
