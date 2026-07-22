export type Role = "admin" | "editor" | "observer" | "viewer";

export interface User {
  id: number;
  username: string;
  role: Role;
  created_at?: string;
  /** true = Passwort gesetzt (Selbstregistrierung abgeschlossen oder vom Admin angelegt) */
  registered?: boolean;
  /** Zeitpunkt der letzten Anmeldung (UTC, "YYYY-MM-DD HH:MM:SS") oder null */
  last_login?: string | null;
}

/** Benutzer, der die Roadmap gerade geöffnet hat (Live-Presence) */
export interface OnlineUser {
  id: number;
  username: string;
  role: Role;
}

/** Wie der Live-Cursor eines anderen Benutzers dargestellt wird. */
export type CursorDisplayMode = "off" | "action" | "always";

/** Raster-basierte Cursor-Position: Datum + absolute Y-Position im Timeline-Inhalt.
 *  Y in Pixeln ab Oberkante von .tl-inner – funktioniert auch über Trennlinien
 *  und unterhalb der letzten Zeile, ohne an einzelne Lane-Zellen gebunden zu sein. */
export interface CursorPos {
  /** Tag (ISO), über dem der Zeiger steht */
  d: string;
  /** Anteil innerhalb des Tages (0..1) */
  df: number;
  /** Y-Position in Pixeln ab Oberkante des Timeline-Inhalts */
  y: number;
}

/** Was ein anderer Benutzer gerade anklickt / bearbeitet (sichtbar solange Modal offen) */
export type CursorFocus =
  | { kind: "task"; taskId: number }
  | {
      kind: "range";
      lane: number;
      start: string;
      end: string;
      rowIndex: number;
      rowSpan: number;
    };

/** Live-Cursor eines anderen Benutzers */
export interface RemoteCursor extends CursorPos {
  id: number;
  username: string;
  role: Role;
  focus?: CursorFocus | null;
}

export interface Lane {
  id: number;
  name: string;
  kind: "section" | "person";
  color: string;
  sort_order: number;
  weekend_off: number;
  sub_rows: number;
  compact: number;
  hidden: number;
  /** Minecraft-Benutzername für den Kopf-Avatar (nur bei kind=person) */
  mc_name: string;
}

export interface Task {
  id: number;
  lane_id: number;
  title: string;
  start_date: string;
  end_date: string;
  color: string;
  notes: string;
  done: number;
  fixed: number;
  row_index: number;
  row_span: number;
  redacted?: boolean;
}

export function canWrite(role: Role) {
  return role === "admin" || role === "editor";
}

/** Sieht die komplette Roadmap ohne Sichtfenster-Begrenzung (Admin & Beobachter) */
export function canSeeAll(role: Role) {
  return role === "admin" || role === "observer";
}

export function roleLabel(role: Role) {
  switch (role) {
    case "admin":
      return "Administrator";
    case "editor":
      return "Bearbeiten";
    case "observer":
      return "Beobachter";
    case "viewer":
      return "Nur lesen";
  }
}
