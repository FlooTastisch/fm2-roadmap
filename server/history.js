import { db } from "./db.js";

// Maximale Anzahl an Schritten, die rückgängig gemacht werden können
export const HISTORY_LIMIT = 30;

const insertStmt = db.prepare(
  "INSERT INTO history (entity, action, before_json, after_json) VALUES (?, ?, ?, ?)"
);
const trimStmt = db.prepare(
  `DELETE FROM history WHERE id NOT IN (SELECT id FROM history ORDER BY id DESC LIMIT ${HISTORY_LIMIT})`
);

/**
 * Protokolliert eine Änderung für die Rückgängig-Funktion.
 * entity: 'task' | 'lane' | 'lane_order'
 * action: 'create' | 'update' | 'delete'
 */
export function recordHistory(entity, action, before, after) {
  insertStmt.run(
    entity,
    action,
    before == null ? null : JSON.stringify(before),
    after == null ? null : JSON.stringify(after)
  );
  trimStmt.run();
}

export function historyCount() {
  return db.prepare("SELECT COUNT(*) AS c FROM history").get().c;
}

function restoreTask(t) {
  db.prepare(
    `INSERT OR REPLACE INTO tasks (id, lane_id, title, start_date, end_date, color, notes, done, fixed, row_index, row_span, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    t.id, t.lane_id, t.title, t.start_date, t.end_date,
    t.color, t.notes, t.done, t.fixed ?? 1, t.row_index ?? 0, t.row_span ?? 1, t.created_at, t.updated_at
  );
}

function restoreLane(l) {
  db.prepare(
    `INSERT OR REPLACE INTO lanes (id, name, kind, color, sort_order, weekend_off, sub_rows, compact, hidden, mc_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(l.id, l.name, l.kind, l.color, l.sort_order, l.weekend_off, l.sub_rows ?? 2, l.compact ?? 0, l.hidden ?? 0, l.mc_name ?? "");
}

/**
 * Macht den letzten Historien-Eintrag rückgängig.
 * Gibt { undone, remaining } zurück oder null, wenn nichts vorhanden ist.
 */
export const undoLast = db.transaction(() => {
  const entry = db.prepare("SELECT * FROM history ORDER BY id DESC LIMIT 1").get();
  if (!entry) return null;

  const before = entry.before_json ? JSON.parse(entry.before_json) : null;
  const after = entry.after_json ? JSON.parse(entry.after_json) : null;
  let description = "";

  if (entry.entity === "task") {
    if (entry.action === "create") {
      db.prepare("DELETE FROM tasks WHERE id = ?").run(after.id);
      description = `Aufgabe „${after.title}“ entfernt (Anlegen rückgängig)`;
    } else if (entry.action === "update") {
      restoreTask(before);
      description = `Aufgabe „${before.title}“ wiederhergestellt (Änderung rückgängig)`;
    } else if (entry.action === "delete") {
      const laneExists = db.prepare("SELECT id FROM lanes WHERE id = ?").get(before.lane_id);
      if (laneExists) {
        restoreTask(before);
        description = `Aufgabe „${before.title}“ wiederhergestellt (Löschen rückgängig)`;
      } else {
        description = `Aufgabe „${before.title}“ konnte nicht wiederhergestellt werden (Zeile existiert nicht mehr)`;
      }
    }
  } else if (entry.entity === "lane") {
    if (entry.action === "create") {
      db.prepare("DELETE FROM tasks WHERE lane_id = ?").run(after.id);
      db.prepare("DELETE FROM lanes WHERE id = ?").run(after.id);
      description = `Zeile „${after.name}“ entfernt (Anlegen rückgängig)`;
    } else if (entry.action === "update") {
      restoreLane(before);
      description = `Zeile „${before.name}“ wiederhergestellt (Änderung rückgängig)`;
    } else if (entry.action === "delete") {
      restoreLane(before.lane);
      for (const t of before.tasks) restoreTask(t);
      description = `Zeile „${before.lane.name}“ samt ${before.tasks.length} Aufgabe(n) wiederhergestellt`;
    }
  } else if (entry.entity === "lane_order") {
    const update = db.prepare("UPDATE lanes SET sort_order = ? WHERE id = ?");
    for (const l of before) update.run(l.sort_order, l.id);
    description = "Zeilen-Reihenfolge wiederhergestellt";
  }

  db.prepare("DELETE FROM history WHERE id = ?").run(entry.id);
  const remaining = db.prepare("SELECT COUNT(*) AS c FROM history").get().c;
  return { undone: description, remaining };
});
