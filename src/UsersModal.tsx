import { useEffect, useState } from "react";
import { api } from "./api";
import type { Role, User } from "./types";
import { roleLabel } from "./types";

// SQLite liefert die Zeit als "YYYY-MM-DD HH:MM:SS" in UTC.
function formatLastLogin(value?: string | null) {
  if (!value) return null;
  const iso = value.includes("T") ? value : value.replace(" ", "T") + "Z";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

interface Props {
  currentUserId: number;
  onClose: () => void;
}

export function UsersModal({ currentUserId, onClose }: Props) {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<Role>("viewer");

  const [editId, setEditId] = useState<number | null>(null);
  const [editRole, setEditRole] = useState<Role>("viewer");
  const [editPassword, setEditPassword] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      setUsers(await api.users());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Laden fehlgeschlagen");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      const created = await api.createUser({
        username: newUsername.trim(),
        password: newPassword,
        role: newRole,
      });
      setUsers((prev) => [...prev, created].sort((a, b) => a.username.localeCompare(b.username)));
      setNewUsername("");
      setNewPassword("");
      setNewRole("viewer");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Anlegen fehlgeschlagen");
    }
  }

  async function handleSaveEdit(user: User) {
    setError("");
    try {
      const data: { role?: Role; password?: string } = {};
      if (editRole !== user.role) data.role = editRole;
      if (editPassword) data.password = editPassword;
      if (!data.role && !data.password) {
        setEditId(null);
        return;
      }
      const saved = await api.updateUser(user.id, data);
      setUsers((prev) => prev.map((u) => (u.id === saved.id ? saved : u)));
      setEditId(null);
      setEditPassword("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Speichern fehlgeschlagen");
    }
  }

  async function handleDelete(user: User) {
    if (!confirm(`Benutzer „${user.username}" wirklich löschen?`)) return;
    setError("");
    try {
      await api.deleteUser(user.id);
      setUsers((prev) => prev.filter((u) => u.id !== user.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Löschen fehlgeschlagen");
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <h2>Benutzerverwaltung</h2>

        {loading ? (
          <p>Lädt …</p>
        ) : (
          <div className="users-list">
            {users.map((user) => (
              <div key={user.id} className="user-row">
                <div className="user-info">
                  <strong>{user.username}</strong>
                  <span className="role-badge">{roleLabel(user.role)}</span>
                  {user.id === currentUserId && <span className="you-badge">Du</span>}
                  <span
                    className={`status-badge ${
                      user.registered ? "status-ok" : "status-pending"
                    }`}
                    title={
                      user.registered
                        ? "Passwort gesetzt – Account ist aktiv"
                        : "Hat sich noch nicht registriert (kein Passwort gesetzt)"
                    }
                  >
                    {user.registered ? "Registriert" : "Nicht registriert"}
                  </span>
                  {user.registered && (
                    <span className="user-meta">
                      {formatLastLogin(user.last_login)
                        ? `Zuletzt online: ${formatLastLogin(user.last_login)}`
                        : "Noch nie eingeloggt"}
                    </span>
                  )}
                </div>
                {editId === user.id ? (
                  <div className="user-edit">
                    <select
                      value={editRole}
                      onChange={(e) => setEditRole(e.target.value as Role)}
                      disabled={user.role === "admin" && user.id === currentUserId}
                    >
                      <option value="admin">Administrator</option>
                      <option value="editor">Bearbeiten</option>
                      <option value="observer">Beobachter (alles sehen, nur lesen)</option>
                      <option value="viewer">Nur lesen</option>
                    </select>
                    <input
                      type="password"
                      placeholder="Neues Passwort (optional)"
                      value={editPassword}
                      onChange={(e) => setEditPassword(e.target.value)}
                    />
                    <button type="button" className="primary" onClick={() => handleSaveEdit(user)}>
                      Speichern
                    </button>
                    <button type="button" onClick={() => setEditId(null)}>
                      Abbrechen
                    </button>
                  </div>
                ) : (
                  <div className="user-actions">
                    <button
                      type="button"
                      onClick={() => {
                        setEditId(user.id);
                        setEditRole(user.role);
                        setEditPassword("");
                      }}
                    >
                      Bearbeiten
                    </button>
                    {user.id !== currentUserId && (
                      <button type="button" className="danger" onClick={() => handleDelete(user)}>
                        Löschen
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <form className="user-create" onSubmit={handleCreate}>
          <h3>Neuen Benutzer anlegen</h3>
          <div className="row2">
            <label>
              Benutzername
              <input
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                required
              />
            </label>
            <label>
              Passwort
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                minLength={6}
                required
              />
            </label>
          </div>
          <label>
            Rechte
            <select value={newRole} onChange={(e) => setNewRole(e.target.value as Role)}>
              <option value="editor">Bearbeiten (lesen & schreiben)</option>
              <option value="observer">Beobachter (alles sehen, nur lesen)</option>
              <option value="viewer">Nur lesen</option>
            </select>
          </label>
          <button type="submit" className="primary">
            Benutzer anlegen
          </button>
        </form>

        {error && <p className="error">{error}</p>}

        <div className="modal-actions">
          <span className="spacer" />
          <button type="button" onClick={onClose}>
            Schließen
          </button>
        </div>
      </div>
    </div>
  );
}
