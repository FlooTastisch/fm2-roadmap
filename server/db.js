import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { hashPassword } from "./auth.js";

const dataDir = process.env.DATA_DIR || path.resolve("data");
fs.mkdirSync(dataDir, { recursive: true });

export const db = new Database(path.join(dataDir, "roadmap.db"));
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'editor', 'observer', 'viewer')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS lanes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'person',
    color TEXT NOT NULL DEFAULT '#e8eaed',
    sort_order INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lane_id INTEGER NOT NULL REFERENCES lanes(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#4a90d9',
    notes TEXT NOT NULL DEFAULT '',
    done INTEGER NOT NULL DEFAULT 0,
    fixed INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_tasks_lane ON tasks(lane_id);

  -- Änderungs-Historie für die Rückgängig-Funktion (max. 30 Schritte)
  CREATE TABLE IF NOT EXISTS history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity TEXT NOT NULL,
    action TEXT NOT NULL,
    before_json TEXT,
    after_json TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Migration: Wochenend-Sperre pro Zeile
const laneCols = db.prepare("PRAGMA table_info(lanes)").all();
if (!laneCols.some((c) => c.name === "weekend_off")) {
  db.exec("ALTER TABLE lanes ADD COLUMN weekend_off INTEGER NOT NULL DEFAULT 0");
}

// Migration: Fix-Status pro Aufgabe (1 = verbindlich, 0 = vorläufig mit Streifen)
const taskCols = db.prepare("PRAGMA table_info(tasks)").all();
if (!taskCols.some((c) => c.name === "fixed")) {
  db.exec("ALTER TABLE tasks ADD COLUMN fixed INTEGER NOT NULL DEFAULT 1");
}

// Migration: feste Unterzeilen pro Zeile und feste Positionen pro Aufgabe
if (!laneCols.some((c) => c.name === "sub_rows")) {
  db.exec("ALTER TABLE lanes ADD COLUMN sub_rows INTEGER NOT NULL DEFAULT 2");
}

// Migration: kompakte Unterzeilen (ca. 25 % niedriger)
if (!laneCols.some((c) => c.name === "compact")) {
  db.exec("ALTER TABLE lanes ADD COLUMN compact INTEGER NOT NULL DEFAULT 0");
  db.exec("UPDATE lanes SET compact = 1 WHERE kind = 'section'");
}

// Migration: Zeilen ausblenden statt löschen (z. B. ehemalige Mitarbeiter)
if (!laneCols.some((c) => c.name === "hidden")) {
  db.exec("ALTER TABLE lanes ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0");
}

// Migration: Minecraft-Kopf neben Mitarbeiternamen
if (!laneCols.some((c) => c.name === "mc_name")) {
  db.exec("ALTER TABLE lanes ADD COLUMN mc_name TEXT NOT NULL DEFAULT ''");
}

// Migration: Geburtsdatum für die Selbstregistrierung (Passwort selbst setzen)
const userCols = db.prepare("PRAGMA table_info(users)").all();
if (!userCols.some((c) => c.name === "birthdate")) {
  db.exec("ALTER TABLE users ADD COLUMN birthdate TEXT NOT NULL DEFAULT ''");
}

// Migration: Zeitpunkt der letzten Anmeldung (für die Admin-Übersicht,
// wer sich schon registriert bzw. eingeloggt hat)
if (!userCols.some((c) => c.name === "last_login")) {
  db.exec("ALTER TABLE users ADD COLUMN last_login TEXT");
}

// Migration: neue Rolle 'observer' (Vollsicht ohne Schreib-/Admin-Rechte).
// SQLite kann CHECK-Constraints nicht ändern – Tabelle einmalig neu aufbauen,
// falls die alte Constraint 'observer' noch nicht erlaubt.
const usersTableSql =
  db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'").get()?.sql ?? "";
if (!usersTableSql.includes("'observer'")) {
  db.transaction(() => {
    db.exec(`
      CREATE TABLE users_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('admin', 'editor', 'observer', 'viewer')),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        birthdate TEXT NOT NULL DEFAULT '',
        last_login TEXT
      );
      INSERT INTO users_new (id, username, password_hash, role, created_at, birthdate, last_login)
        SELECT id, username, password_hash, role, created_at, birthdate, last_login FROM users;
      DROP TABLE users;
      ALTER TABLE users_new RENAME TO users;
    `);
  })();
  console.log("Migration: Rolle 'observer' in users-Tabelle erlaubt.");
}
if (!taskCols.some((c) => c.name === "row_index")) {
  db.exec("ALTER TABLE tasks ADD COLUMN row_index INTEGER NOT NULL DEFAULT 0");
  db.exec("ALTER TABLE tasks ADD COLUMN row_span INTEGER NOT NULL DEFAULT 1");

  // Bestehende Aufgaben einmalig überlappungsfrei auf Unterzeilen verteilen
  // (gleicher Algorithmus wie die bisherige automatische Stapelung im Frontend)
  const lanes = db.prepare("SELECT id FROM lanes").all();
  const updateTask = db.prepare("UPDATE tasks SET row_index = ? WHERE id = ?");
  const updateLane = db.prepare("UPDATE lanes SET sub_rows = ? WHERE id = ?");
  const packAll = db.transaction(() => {
    for (const lane of lanes) {
      const tasks = db
        .prepare("SELECT id, start_date, end_date FROM tasks WHERE lane_id = ? ORDER BY start_date, id")
        .all(lane.id);
      const levelEnds = [];
      for (const t of tasks) {
        let level = levelEnds.findIndex((end) => end < t.start_date);
        if (level === -1) {
          level = levelEnds.length;
          levelEnds.push(t.end_date);
        } else {
          levelEnds[level] = t.end_date;
        }
        updateTask.run(level, t.id);
      }
      updateLane.run(Math.max(2, levelEnds.length), lane.id);
    }
  });
  packAll();
  console.log("Migration: Aufgaben auf feste Unterzeilen verteilt.");
}

// Beim ersten Start: Admin-Account aus Umgebungsvariablen anlegen
const userCount = db.prepare("SELECT COUNT(*) AS c FROM users").get().c;
if (userCount === 0) {
  const username = process.env.ROADMAP_ADMIN_USER || "admin";
  const password =
    process.env.ROADMAP_ADMIN_PASSWORD || process.env.ROADMAP_PASSWORD || "changeme";
  if (password === "changeme") {
    console.warn(
      "WARNUNG: Kein Admin-Passwort gesetzt – Standard 'changeme' für Benutzer 'admin'!"
    );
  }
  db.prepare(
    "INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'admin')"
  ).run(username, hashPassword(password));
  console.log(`Admin-Account angelegt: ${username}`);
}

// Vorangelegte Team-Accounts (nur Leserechte). Passwort wird per Selbstregistrierung
// (Benutzername + Geburtsdatum) vom Nutzer selbst gesetzt. Bereits vorhandene
// Accounts oder gesetzte Passwörter werden nie überschrieben.
//
// WICHTIG: Die echten Namen/Geburtsdaten stehen NICHT im Code (öffentliches Repo),
// sondern in einer separaten, nicht eingecheckten Datei. Pfad per SEED_MEMBERS_FILE
// überschreibbar, Standard: seed-members.json im Projektverzeichnis. Format siehe
// seed-members.example.json.
const seedFile = process.env.SEED_MEMBERS_FILE || path.resolve("seed-members.json");
let seedMemberList = [];
try {
  if (fs.existsSync(seedFile)) {
    const parsed = JSON.parse(fs.readFileSync(seedFile, "utf8"));
    if (Array.isArray(parsed)) seedMemberList = parsed;
  }
} catch (err) {
  console.warn(`Konnte ${seedFile} nicht lesen: ${err.message}`);
}

if (seedMemberList.length > 0) {
  const findUser = db.prepare("SELECT id, birthdate FROM users WHERE username = ? COLLATE NOCASE");
  const insertMember = db.prepare(
    "INSERT INTO users (username, password_hash, role, birthdate) VALUES (?, '', 'viewer', ?)"
  );
  const setBirthdate = db.prepare("UPDATE users SET birthdate = ? WHERE id = ?");
  const seedMembers = db.transaction(() => {
    let created = 0;
    for (const m of seedMemberList) {
      const username = String(m?.username ?? "").trim();
      const birthdate = String(m?.birthdate ?? "").trim();
      if (!username || !birthdate) continue;
      const existing = findUser.get(username);
      if (!existing) {
        insertMember.run(username, birthdate);
        created++;
      } else if (!existing.birthdate) {
        // Account existierte schon (z. B. aus Testphase) ohne Geburtsdatum → nachtragen
        setBirthdate.run(birthdate, existing.id);
      }
    }
    if (created > 0) console.log(`Selbstregistrierung: ${created} Team-Account(s) vorangelegt.`);
  });
  seedMembers();
}

const laneCount = db.prepare("SELECT COUNT(*) AS c FROM lanes").get().c;
if (laneCount === 0) {
  const insertLane = db.prepare(
    "INSERT INTO lanes (name, kind, color, sort_order) VALUES (?, ?, ?, ?)"
  );
  insertLane.run("Eventzeitleiste", "section", "#b3a7d6", 0);
  insertLane.run("Releases", "section", "#f6c96b", 1);
}
