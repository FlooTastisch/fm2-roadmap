export const VISIBILITY_PAST_DAYS = 14;
export const VISIBILITY_FUTURE_DAYS = 60;

export function todayISO() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate()
  ).padStart(2, "0")}`;
}

export function addDays(iso, days) {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Montag der Woche, in der `iso` liegt */
export function startOfWeek(iso) {
  const d = new Date(iso + "T12:00:00Z");
  const weekday = (d.getUTCDay() + 6) % 7; // Mo=0 ... So=6
  d.setUTCDate(d.getUTCDate() - weekday);
  return d.toISOString().slice(0, 10);
}

/**
 * Sichtbarer Bereich für Nicht-Admins, auf volle Wochen (Mo–So) gerundet, damit
 * die Kalenderwochen-Spalten komplett sind und am Rand nichts halb wegfällt.
 */
export function visibleRange(today = todayISO()) {
  const rawMin = addDays(today, -VISIBILITY_PAST_DAYS);
  const rawMax = addDays(today, VISIBILITY_FUTURE_DAYS);
  return { min: startOfWeek(rawMin), max: addDays(startOfWeek(rawMax), 6) };
}

/**
 * Überlappt die Aufgabe den sichtbaren Bereich? Teilweise sichtbare Aufgaben
 * werden mitgesendet und im Frontend am Rand abgeschnitten dargestellt.
 */
export function taskVisibleForUser(task, today = todayISO()) {
  const { min, max } = visibleRange(today);
  return task.end_date >= min && task.start_date <= max;
}

export function assertDatesInWindow(start, end, today = todayISO()) {
  const { min, max } = visibleRange(today);
  if (start < min || end > max) {
    return `Zeitraum muss zwischen ${min} und ${max} liegen`;
  }
  return null;
}
