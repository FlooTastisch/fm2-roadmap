export type Role = "admin" | "editor" | "viewer";

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

export function roleLabel(role: Role) {
  switch (role) {
    case "admin":
      return "Administrator";
    case "editor":
      return "Bearbeiten";
    case "viewer":
      return "Nur lesen";
  }
}
