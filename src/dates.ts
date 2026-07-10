// Alle Datumsberechnungen laufen über UTC-Mittag, um Zeitzonen-/DST-Probleme zu vermeiden.

export function parseISO(iso: string): Date {
  return new Date(iso + "T12:00:00Z");
}

export function toISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  const d = parseISO(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return toISO(d);
}

export function diffDays(fromISO: string, toISOStr: string): number {
  return Math.round((parseISO(toISOStr).getTime() - parseISO(fromISO).getTime()) / 86400000);
}

export function todayISO(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate()
  ).padStart(2, "0")}`;
}

/** Sichtbarkeitsfenster für Nicht-Admins */
export const VISIBILITY_PAST_DAYS = 14;
export const VISIBILITY_FUTURE_DAYS = 60;

export function visibleWindow(today = todayISO()) {
  return {
    min: addDays(today, -VISIBILITY_PAST_DAYS),
    max: addDays(today, VISIBILITY_FUTURE_DAYS),
  };
}

export function isInVisibleWindow(iso: string, today = todayISO()) {
  const { min, max } = visibleWindow(today);
  return iso >= min && iso <= max;
}

/** Enthält der Zeitraum (inklusiv) einen Samstag oder Sonntag? */
export function rangeIncludesWeekend(startISO: string, endISO: string): boolean {
  const days = diffDays(startISO, endISO) + 1;
  if (days >= 6) return true;
  for (let i = 0; i < days; i++) {
    const d = parseISO(addDays(startISO, i));
    const wd = d.getUTCDay();
    if (wd === 0 || wd === 6) return true;
  }
  return false;
}

export function clampDateRange(start: string, end: string, today = todayISO()) {
  const { min, max } = visibleWindow(today);
  let s = start;
  let e = end;
  if (s < min) {
    const shift = diffDays(s, min);
    s = min;
    e = addDays(e, shift);
  }
  if (e > max) {
    const shift = diffDays(e, max);
    e = max;
    s = addDays(s, shift);
  }
  if (s < min) s = min;
  if (e > max) e = max;
  if (s > e) return null;
  return { start: s, end: e };
}

/** Montag der Woche, in der `iso` liegt */
export function startOfWeek(iso: string): string {
  const d = parseISO(iso);
  const weekday = (d.getUTCDay() + 6) % 7; // Mo=0 ... So=6
  return addDays(iso, -weekday);
}

/** ISO-Kalenderwoche */
export function isoWeek(iso: string): number {
  const d = parseISO(iso);
  const target = new Date(d.getTime());
  target.setUTCDate(target.getUTCDate() + 3 - ((target.getUTCDay() + 6) % 7));
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4, 12));
  firstThursday.setUTCDate(
    firstThursday.getUTCDate() + 3 - ((firstThursday.getUTCDay() + 6) % 7)
  );
  return 1 + Math.round((target.getTime() - firstThursday.getTime()) / (7 * 86400000));
}

export const WEEKDAYS_SHORT = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
export const MONTHS = [
  "Januar",
  "Februar",
  "März",
  "April",
  "Mai",
  "Juni",
  "Juli",
  "August",
  "September",
  "Oktober",
  "November",
  "Dezember",
];

export interface DayInfo {
  iso: string;
  dayOfMonth: number;
  weekdayIdx: number; // Mo=0 ... So=6
  month: number;
  year: number;
  isWeekend: boolean;
}

export function buildDays(startISO: string, count: number): DayInfo[] {
  const days: DayInfo[] = [];
  for (let i = 0; i < count; i++) {
    const iso = addDays(startISO, i);
    const d = parseISO(iso);
    const weekdayIdx = (d.getUTCDay() + 6) % 7;
    days.push({
      iso,
      dayOfMonth: d.getUTCDate(),
      weekdayIdx,
      month: d.getUTCMonth(),
      year: d.getUTCFullYear(),
      isWeekend: weekdayIdx >= 5,
    });
  }
  return days;
}
