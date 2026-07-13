import express from "express";
import cookieParser from "cookie-parser";
import crypto from "node:crypto";
import path from "node:path";
import { db } from "./db.js";
import { hashPassword, verifyPassword, canWrite, isAdmin, canSeeAll, ROLES } from "./auth.js";
import { assertDatesInWindow, taskVisibleForUser } from "./dates.js";
import { recordHistory, undoLast, historyCount } from "./history.js";
import { getDataVersion } from "./state.js";
import {
  DEFAULT_TASK_COLOR,
  TASK_COLORS,
  isValidTaskColor,
  resolveTaskColor,
} from "../shared/taskColors.js";

const PORT = process.env.PORT || 3000;
const SESSION_COOKIE = "roadmap_session";

// token -> userId. Benutzername und Rolle werden bewusst NICHT in der Session
// gecacht, sondern pro Anfrage frisch aus der Datenbank gelesen – so greifen
// Rollenänderungen durch den Admin sofort (ohne Neu-Login) und gelöschte
// Benutzer verlieren umgehend den Zugriff.
const sessions = new Map();

const app = express();
app.use(express.json());
app.use(cookieParser());

const getSessionUser = db.prepare("SELECT id, username, role FROM users WHERE id = ?");

function getSession(req) {
  const token = req.cookies[SESSION_COOKIE];
  if (!token) return null;
  const userId = sessions.get(token);
  if (userId === undefined) return null;
  const user = getSessionUser.get(userId);
  if (!user) {
    // Benutzer wurde inzwischen gelöscht → Session ungültig
    sessions.delete(token);
    return null;
  }
  return { userId: user.id, username: user.username, role: user.role };
}

function createSession(res, user) {
  const token = crypto.randomBytes(32).toString("hex");
  sessions.set(token, user.id);
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 1000 * 60 * 60 * 24 * 30,
  });
}

function markLogin(userId) {
  db.prepare("UPDATE users SET last_login = datetime('now') WHERE id = ?").run(userId);
}

function publicUser(row) {
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    created_at: row.created_at,
    // "registriert" = hat ein Passwort gesetzt (Selbstregistrierung abgeschlossen
    // oder vom Admin angelegt). Vorangelegte Team-Accounts haben noch keins.
    registered: Boolean(row.password_hash),
    last_login: row.last_login ?? null,
  };
}

// ---------- Auth ----------

app.post("/api/login", (req, res) => {
  const username = String(req.body?.username ?? "").trim();
  const password = String(req.body?.password ?? "");
  if (!username || !password) return res.status(400).json({ error: "Benutzername und Passwort erforderlich" });

  const user = db
    .prepare("SELECT * FROM users WHERE username = ? COLLATE NOCASE")
    .get(username);
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: "Ungültige Anmeldedaten" });
  }

  createSession(res, user);
  markLogin(user.id);
  res.json({ ok: true, user: publicUser(user) });
});

app.post("/api/logout", (req, res) => {
  const token = req.cookies[SESSION_COOKIE];
  if (token) {
    const userId = sessions.get(token);
    // Sofort aus der Online-Anzeige entfernen (nicht erst nach Ablauf des TTL)
    if (userId !== undefined) {
      presence.delete(userId);
      cursors.delete(userId);
    }
    sessions.delete(token);
  }
  res.clearCookie(SESSION_COOKIE);
  res.json({ ok: true });
});

app.get("/api/me", (req, res) => {
  const session = getSession(req);
  if (!session) return res.json({ authed: false });
  res.json({
    authed: true,
    user: { id: session.userId, username: session.username, role: session.role },
  });
});

// Selbstregistrierung in zwei Schritten:
//  1. /api/register/verify  – Benutzername + Geburtsdatum prüfen, kurzlebiges Token ausgeben
//  2. /api/register/complete – mit dem Token das Passwort setzen
// Der Account muss vorab angelegt sein und darf noch kein Passwort haben.
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const REGISTER_TOKEN_TTL_MS = 10 * 60 * 1000;
// token -> { userId, expires }
const pendingRegistrations = new Map();

function purgeExpiredRegistrations() {
  const now = Date.now();
  for (const [token, entry] of pendingRegistrations) {
    if (entry.expires < now) pendingRegistrations.delete(token);
  }
}

app.post("/api/register/verify", (req, res) => {
  const username = String(req.body?.username ?? "").trim();
  const birthdate = String(req.body?.birthdate ?? "").trim();

  if (!username || !birthdate) {
    return res.status(400).json({ error: "Benutzername und Geburtsdatum erforderlich" });
  }
  if (!ISO_DATE_RE.test(birthdate)) {
    return res.status(400).json({ error: "Ungültiges Geburtsdatum" });
  }

  const user = db.prepare("SELECT * FROM users WHERE username = ? COLLATE NOCASE").get(username);
  // Aus Sicherheitsgründen nicht verraten, ob der Benutzername existiert.
  const GENERIC = "Benutzername oder Geburtsdatum stimmt nicht.";
  if (!user || !user.birthdate) {
    return res.status(400).json({ error: GENERIC });
  }
  if (user.password_hash) {
    return res
      .status(409)
      .json({ error: "Für diesen Account wurde bereits ein Passwort gesetzt – bitte einloggen." });
  }
  if (user.birthdate !== birthdate) {
    return res.status(400).json({ error: GENERIC });
  }

  purgeExpiredRegistrations();
  const token = crypto.randomBytes(32).toString("hex");
  pendingRegistrations.set(token, { userId: user.id, expires: Date.now() + REGISTER_TOKEN_TTL_MS });
  res.json({ ok: true, token, username: user.username });
});

app.post("/api/register/complete", (req, res) => {
  const token = String(req.body?.token ?? "");
  const password = String(req.body?.password ?? "");

  purgeExpiredRegistrations();
  const entry = token ? pendingRegistrations.get(token) : null;
  if (!entry) {
    return res
      .status(400)
      .json({ error: "Verifizierung abgelaufen – bitte erneut mit Benutzername und Geburtsdatum starten." });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: "Passwort muss mindestens 6 Zeichen haben" });
  }

  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(entry.userId);
  if (!user) {
    pendingRegistrations.delete(token);
    return res.status(400).json({ error: "Account nicht gefunden" });
  }
  if (user.password_hash) {
    pendingRegistrations.delete(token);
    return res
      .status(409)
      .json({ error: "Für diesen Account wurde bereits ein Passwort gesetzt – bitte einloggen." });
  }

  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(
    hashPassword(password),
    user.id
  );
  pendingRegistrations.delete(token);
  createSession(res, user);
  markLogin(user.id);
  const fresh = db.prepare("SELECT * FROM users WHERE id = ?").get(user.id);
  res.json({ ok: true, user: publicUser(fresh) });
});

app.use("/api", (req, res, next) => {
  if (!getSession(req)) return res.status(401).json({ error: "Nicht angemeldet" });
  next();
});

function requireWrite(req, res, next) {
  const session = getSession(req);
  if (!session || !canWrite(session.role)) {
    return res.status(403).json({ error: "Keine Bearbeitungsrechte" });
  }
  next();
}

function requireAdmin(req, res, next) {
  const session = getSession(req);
  if (!session || !isAdmin(session.role)) {
    return res.status(403).json({ error: "Nur für Administratoren" });
  }
  next();
}

// ---------- Benutzerverwaltung (nur Admin) ----------

app.get("/api/users", requireAdmin, (_req, res) => {
  const users = db.prepare("SELECT * FROM users ORDER BY username").all();
  res.json(users.map(publicUser));
});

app.post("/api/users", requireAdmin, (req, res) => {
  const username = String(req.body?.username ?? "").trim();
  const password = String(req.body?.password ?? "");
  const role = req.body?.role ?? "viewer";
  if (!username) return res.status(400).json({ error: "Benutzername fehlt" });
  if (password.length < 6) return res.status(400).json({ error: "Passwort muss mindestens 6 Zeichen haben" });
  if (!ROLES.includes(role) || role === "admin") {
    return res.status(400).json({ error: "Ungültige Rolle (editor oder viewer)" });
  }
  const exists = db.prepare("SELECT id FROM users WHERE username = ? COLLATE NOCASE").get(username);
  if (exists) return res.status(409).json({ error: "Benutzername bereits vergeben" });

  const info = db
    .prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)")
    .run(username, hashPassword(password), role);
  res.json(publicUser(db.prepare("SELECT * FROM users WHERE id = ?").get(info.lastInsertRowid)));
});

app.put("/api/users/:id", requireAdmin, (req, res) => {
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.params.id);
  if (!user) return res.status(404).json({ error: "Nicht gefunden" });

  const session = getSession(req);
  const { role, password } = req.body;

  if (role !== undefined) {
    if (!ROLES.includes(role)) return res.status(400).json({ error: "Ungültige Rolle" });
    if (user.id === session.userId && role !== "admin") {
      return res.status(400).json({ error: "Eigene Admin-Rolle kann nicht entfernt werden" });
    }
    db.prepare("UPDATE users SET role = ? WHERE id = ?").run(role, user.id);
  }

  if (password) {
    if (String(password).length < 6) {
      return res.status(400).json({ error: "Passwort muss mindestens 6 Zeichen haben" });
    }
    db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hashPassword(password), user.id);
  }

  res.json(publicUser(db.prepare("SELECT * FROM users WHERE id = ?").get(user.id)));
});

app.delete("/api/users/:id", requireAdmin, (req, res) => {
  const session = getSession(req);
  if (Number(req.params.id) === session.userId) {
    return res.status(400).json({ error: "Eigenen Account kann man nicht löschen" });
  }
  const admins = db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'admin'").get().c;
  const user = db.prepare("SELECT role FROM users WHERE id = ?").get(req.params.id);
  if (!user) return res.status(404).json({ error: "Nicht gefunden" });
  if (user.role === "admin" && admins <= 1) {
    return res.status(400).json({ error: "Letzter Administrator kann nicht gelöscht werden" });
  }
  db.prepare("DELETE FROM users WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

// ---------- Lanes ----------

app.get("/api/lanes", (_req, res) => {
  res.json(db.prepare("SELECT * FROM lanes ORDER BY sort_order, id").all());
});

function normalizeSubRows(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 10) return null;
  return n;
}

app.post("/api/lanes", requireWrite, (req, res) => {
  const { name, kind = "person", color = "#e8eaed", weekend_off = 0, sub_rows = 2, compact = 0, hidden = 0, mc_name = "" } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: "Name fehlt" });
  const subRows = normalizeSubRows(sub_rows);
  if (subRows === null) return res.status(400).json({ error: "Unterzeilen: 1 bis 10 erlaubt" });
  const maxOrder = db.prepare("SELECT COALESCE(MAX(sort_order), -1) AS m FROM lanes").get().m;
  const info = db
    .prepare("INSERT INTO lanes (name, kind, color, sort_order, weekend_off, sub_rows, compact, hidden, mc_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(name.trim(), kind === "section" ? "section" : "person", color, maxOrder + 1, weekend_off ? 1 : 0, subRows, compact ? 1 : 0, hidden ? 1 : 0, String(mc_name ?? "").trim());
  const created = db.prepare("SELECT * FROM lanes WHERE id = ?").get(info.lastInsertRowid);
  recordHistory("lane", "create", null, created);
  res.json(created);
});

app.put("/api/lanes/:id", requireWrite, (req, res) => {
  const lane = db.prepare("SELECT * FROM lanes WHERE id = ?").get(req.params.id);
  if (!lane) return res.status(404).json({ error: "Nicht gefunden" });
  const {
    name = lane.name,
    color = lane.color,
    kind = lane.kind,
    weekend_off = lane.weekend_off,
    sub_rows = lane.sub_rows,
    compact = lane.compact,
    hidden = lane.hidden,
    mc_name = lane.mc_name,
  } = req.body;
  const subRows = normalizeSubRows(sub_rows);
  if (subRows === null) return res.status(400).json({ error: "Unterzeilen: 1 bis 10 erlaubt" });
  // Verkleinern nur, wenn keine Aufgabe unterhalb der neuen Grenze liegt
  const deepest = db
    .prepare("SELECT COALESCE(MAX(row_index + row_span), 0) AS m FROM tasks WHERE lane_id = ?")
    .get(lane.id).m;
  if (subRows < deepest) {
    return res.status(400).json({
      error: `Es gibt Aufgaben bis Unterzeile ${deepest} – bitte erst verschieben, dann verkleinern`,
    });
  }
  db.prepare("UPDATE lanes SET name = ?, color = ?, kind = ?, weekend_off = ?, sub_rows = ?, compact = ?, hidden = ?, mc_name = ? WHERE id = ?").run(
    name,
    color,
    kind,
    weekend_off ? 1 : 0,
    subRows,
    compact ? 1 : 0,
    hidden ? 1 : 0,
    String(mc_name ?? "").trim(),
    lane.id
  );
  const updated = db.prepare("SELECT * FROM lanes WHERE id = ?").get(lane.id);
  recordHistory("lane", "update", lane, updated);
  res.json(updated);
});

app.post("/api/lanes/reorder", requireWrite, (req, res) => {
  const ids = req.body?.ids;
  if (!Array.isArray(ids)) return res.status(400).json({ error: "ids fehlt" });
  const oldOrder = db.prepare("SELECT id, sort_order FROM lanes").all();
  const update = db.prepare("UPDATE lanes SET sort_order = ? WHERE id = ?");
  const tx = db.transaction(() => {
    ids.forEach((id, i) => update.run(i, id));
  });
  tx();
  const newOrder = db.prepare("SELECT id, sort_order FROM lanes").all();
  recordHistory("lane_order", "update", oldOrder, newOrder);
  res.json({ ok: true });
});

app.delete("/api/lanes/:id", requireWrite, (req, res) => {
  const lane = db.prepare("SELECT * FROM lanes WHERE id = ?").get(req.params.id);
  if (!lane) return res.status(404).json({ error: "Nicht gefunden" });
  const laneTasks = db.prepare("SELECT * FROM tasks WHERE lane_id = ?").all(lane.id);
  db.prepare("DELETE FROM tasks WHERE lane_id = ?").run(lane.id);
  db.prepare("DELETE FROM lanes WHERE id = ?").run(lane.id);
  recordHistory("lane", "delete", { lane, tasks: laneTasks }, null);
  res.json({ ok: true });
});

// ---------- Enthüllen (Admin kann die Verschleierung global aufheben) ----------

// Nach spätestens 10 Minuten greift die Verschleierung automatisch wieder –
// der Ablauf wird serverseitig bei jeder Anfrage geprüft, kein Client kann das umgehen.
const REVEAL_MAX_MS = 10 * 60 * 1000;
let revealUntil = 0;

function revealActive() {
  return Date.now() < revealUntil;
}

app.get("/api/reveal", (_req, res) => {
  const active = revealActive();
  res.json({ active, until: active ? revealUntil : null });
});

// ---------- Presence (wer hat die Roadmap gerade offen?) ----------

// Jeder Client meldet sich über das /api/state-Polling alle 2 Sekunden.
// Wer länger als PRESENCE_TTL_MS nichts von sich hören lässt (Tab zu,
// Rechner im Standby), fällt aus der Online-Liste heraus.
const PRESENCE_TTL_MS = 8 * 1000;
// userId -> { username, role, lastSeen }
const presence = new Map();

function markPresence(session) {
  presence.set(session.userId, {
    username: session.username,
    role: session.role,
    lastSeen: Date.now(),
  });
}

function onlineUsers() {
  const cutoff = Date.now() - PRESENCE_TTL_MS;
  const list = [];
  for (const [userId, entry] of presence) {
    if (entry.lastSeen < cutoff) {
      presence.delete(userId);
      continue;
    }
    list.push({ id: userId, username: entry.username, role: entry.role });
  }
  list.sort((a, b) => a.username.localeCompare(b.username, "de", { sensitivity: "base" }));
  return list;
}

// ---------- Live-Cursor (à la Figma: Mauszeiger der anderen sehen) ----------

// Positionen sind raster-basiert (Datum + Zeile + Anteil), nicht bildschirm-
// basiert – nur so stimmen sie bei unterschiedlichen Scroll-Positionen und
// Fenstergrößen. Kein Persistieren nötig: reiner Live-Zustand im Speicher.
const CURSOR_TTL_MS = 5 * 1000;
// userId -> { username, role, pos, ts }
const cursors = new Map();

function normalizeCursorPos(raw) {
  if (!raw || typeof raw !== "object") return null;
  const d = String(raw.d ?? "");
  const df = Number(raw.df);
  const lane = Number(raw.lane);
  const lf = Number(raw.lf);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  if (!Number.isFinite(df) || !Number.isFinite(lf) || !Number.isInteger(lane)) return null;
  return {
    d,
    df: Math.max(0, Math.min(1, df)),
    lane,
    lf: Math.max(0, Math.min(1, lf)),
  };
}

// Meldet die eigene Position (oder null = Zeiger nicht über dem Raster) und
// liefert im selben Rutsch die frischen Positionen aller anderen zurück.
app.post("/api/cursors", (req, res) => {
  const session = getSession(req);
  const pos = normalizeCursorPos(req.body?.pos);
  const now = Date.now();
  if (pos) {
    cursors.set(session.userId, { username: session.username, role: session.role, pos, ts: now });
  } else {
    cursors.delete(session.userId);
  }
  const list = [];
  for (const [userId, entry] of cursors) {
    if (now - entry.ts > CURSOR_TTL_MS) {
      cursors.delete(userId);
      continue;
    }
    if (userId === session.userId) continue;
    list.push({ id: userId, username: entry.username, role: entry.role, ...entry.pos });
  }
  res.json({ cursors: list });
});

// Leichtgewichtiger Sammel-Endpunkt fürs Live-Polling: Daten-Version (für
// Echtzeit-Updates), aktueller Enthüllungs-Status, die Liste der gerade
// aktiven Benutzer und die eigenen Benutzerdaten in einer Anfrage. Letzteres
// lässt z. B. Rollenänderungen durch den Admin ohne Neu-Login sofort greifen.
app.get("/api/state", (req, res) => {
  const session = getSession(req);
  if (session) markPresence(session);
  const active = revealActive();
  res.json({
    version: getDataVersion(),
    reveal: { active, until: active ? revealUntil : null },
    online: onlineUsers(),
    me: session
      ? { id: session.userId, username: session.username, role: session.role }
      : null,
  });
});

app.post("/api/reveal", requireAdmin, (req, res) => {
  revealUntil = req.body?.active ? Date.now() + REVEAL_MAX_MS : 0;
  const active = revealActive();
  res.json({ active, until: active ? revealUntil : null });
});

// ---------- Tasks ----------

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function validDates(start, end) {
  return DATE_RE.test(start) && DATE_RE.test(end) && start <= end;
}


// Prüft Unterzeilen-Position und Kollisionen mit anderen Aufgaben derselben Zeile.
// Gibt bei Fehler eine Meldung zurück, sonst null.
function checkPlacement({ laneId, rowIndex, rowSpan, start, end, excludeTaskId = null }) {
  const lane = db.prepare("SELECT sub_rows FROM lanes WHERE id = ?").get(laneId);
  if (!lane) return "Zeile existiert nicht";
  if (
    !Number.isInteger(rowIndex) || !Number.isInteger(rowSpan) ||
    rowIndex < 0 || rowSpan < 1 || rowIndex + rowSpan > lane.sub_rows
  ) {
    return `Position passt nicht: Zeile hat ${lane.sub_rows} Unterzeile(n)`;
  }
  const conflict = db
    .prepare(
      `SELECT title FROM tasks
       WHERE lane_id = ? AND (? IS NULL OR id != ?)
         AND NOT (end_date < ? OR start_date > ?)
         AND NOT (row_index + row_span <= ? OR row_index >= ?)
       LIMIT 1`
    )
    .get(laneId, excludeTaskId, excludeTaskId, start, end, rowIndex, rowIndex + rowSpan);
  if (conflict) {
    return `Belegt durch „${conflict.title}“ – kein Platz in dieser Unterzeile`;
  }
  return null;
}

function presentTasksForSession(tasks, session) {
  // Admins und Beobachter sehen immer alles; alle anderen nur während
  // einer aktiven Enthüllung.
  if (canSeeAll(session.role) || revealActive()) return tasks;
  // Sonst erhalten Clients alle Aufgaben, die den sichtbaren Bereich
  // überlappen (am Rand schneidet das Frontend sie ab).
  // Aufgaben komplett außerhalb verlassen den Server gar nicht.
  return tasks.filter((t) => taskVisibleForUser(t));
}

function requireTaskAccess(task, session, res) {
  if (!task) {
    res.status(404).json({ error: "Nicht gefunden" });
    return false;
  }
  if (!isAdmin(session.role) && !taskVisibleForUser(task)) {
    // Kein Hinweis, dass die Aufgabe existiert
    res.status(404).json({ error: "Nicht gefunden" });
    return false;
  }
  return true;
}

function validateTaskDatesForSession(start, end, session, res) {
  if (!validDates(start, end)) {
    res.status(400).json({ error: "Ungültiger Zeitraum" });
    return false;
  }
  if (!isAdmin(session.role)) {
    const err = assertDatesInWindow(start, end);
    if (err) {
      res.status(403).json({ error: err });
      return false;
    }
  }
  return true;
}

app.get("/api/tasks", (req, res) => {
  const session = getSession(req);
  const tasks = db.prepare("SELECT * FROM tasks ORDER BY start_date").all();
  res.json(presentTasksForSession(tasks, session));
});

// Farblegende für UI und spätere KI-/Analytics-Auswertungen
app.get("/api/task-colors", (_req, res) => {
  res.json(TASK_COLORS);
});

app.post("/api/tasks", requireWrite, (req, res) => {
  const session = getSession(req);
  const {
    lane_id,
    title,
    start_date,
    end_date,
    color = DEFAULT_TASK_COLOR,
    notes = "",
    fixed = 1,
    row_index = 0,
    row_span = 1,
  } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: "Titel fehlt" });
  if (!isValidTaskColor(color)) return res.status(400).json({ error: "Ungültige Farbe" });
  const resolvedColor = resolveTaskColor(color);
  if (!validateTaskDatesForSession(start_date, end_date, session, res)) return;
  const placementError = checkPlacement({
    laneId: lane_id,
    rowIndex: row_index,
    rowSpan: row_span,
    start: start_date,
    end: end_date,
  });
  if (placementError) return res.status(400).json({ error: placementError });
  const info = db
    .prepare(
      "INSERT INTO tasks (lane_id, title, start_date, end_date, color, notes, fixed, row_index, row_span) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .run(lane_id, title.trim(), start_date, end_date, resolvedColor, notes, fixed ? 1 : 0, row_index, row_span);
  const created = db.prepare("SELECT * FROM tasks WHERE id = ?").get(info.lastInsertRowid);
  recordHistory("task", "create", null, created);
  res.json(created);
});

app.put("/api/tasks/:id", requireWrite, (req, res) => {
  const session = getSession(req);
  const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(req.params.id);
  if (!requireTaskAccess(task, session, res)) return;
  const {
    lane_id = task.lane_id,
    title = task.title,
    start_date = task.start_date,
    end_date = task.end_date,
    color = task.color,
    notes = task.notes,
    done = task.done,
    fixed = task.fixed ?? 1,
    row_index = task.row_index ?? 0,
    row_span = task.row_span ?? 1,
  } = req.body;
  if (!validateTaskDatesForSession(start_date, end_date, session, res)) return;
  if (!isValidTaskColor(color)) return res.status(400).json({ error: "Ungültige Farbe" });
  const resolvedColor = resolveTaskColor(color);
  const placementError = checkPlacement({
    laneId: lane_id,
    rowIndex: row_index,
    rowSpan: row_span,
    start: start_date,
    end: end_date,
    excludeTaskId: task.id,
  });
  if (placementError) return res.status(400).json({ error: placementError });
  db.prepare(
    `UPDATE tasks SET lane_id = ?, title = ?, start_date = ?, end_date = ?,
     color = ?, notes = ?, done = ?, fixed = ?, row_index = ?, row_span = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(lane_id, title, start_date, end_date, resolvedColor, notes, done ? 1 : 0, fixed ? 1 : 0, row_index, row_span, task.id);
  const updated = db.prepare("SELECT * FROM tasks WHERE id = ?").get(task.id);
  recordHistory("task", "update", task, updated);
  res.json(updated);
});

app.delete("/api/tasks/:id", requireWrite, (req, res) => {
  const session = getSession(req);
  const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(req.params.id);
  if (!requireTaskAccess(task, session, res)) return;
  db.prepare("DELETE FROM tasks WHERE id = ?").run(req.params.id);
  recordHistory("task", "delete", task, null);
  res.json({ ok: true });
});

// ---------- Rückgängig (nur Admin) ----------

app.get("/api/undo", requireAdmin, (_req, res) => {
  res.json({ count: historyCount() });
});

app.post("/api/undo", requireAdmin, (_req, res) => {
  const result = undoLast();
  if (!result) return res.status(400).json({ error: "Nichts zum Rückgängigmachen" });
  res.json({ ok: true, ...result });
});

// ---------- Statisches Frontend ----------

const distDir = path.resolve("dist");
app.use(express.static(distDir));
app.get(/^(?!\/api).*/, (_req, res) => {
  res.sendFile(path.join(distDir, "index.html"));
});

app.listen(PORT, () => {
  console.log(`FM2 Roadmap läuft auf Port ${PORT}`);
});
