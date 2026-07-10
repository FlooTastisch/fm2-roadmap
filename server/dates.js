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

export function visibleWindow(today = todayISO()) {
  return {
    min: addDays(today, -VISIBILITY_PAST_DAYS),
    max: addDays(today, VISIBILITY_FUTURE_DAYS),
  };
}

/** Nur Aufgaben, die vollständig im Fenster liegen */
export function taskFullyVisible(task, today = todayISO()) {
  const { min, max } = visibleWindow(today);
  return task.start_date >= min && task.end_date <= max;
}

export function assertDatesInWindow(start, end, today = todayISO()) {
  const { min, max } = visibleWindow(today);
  if (start < min || end > max) {
    return `Zeitraum muss zwischen ${min} und ${max} liegen`;
  }
  return null;
}
