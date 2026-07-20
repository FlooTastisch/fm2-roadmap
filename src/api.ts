import type { CursorFocus, CursorPos, Lane, OnlineUser, RemoteCursor, Role, Task, User } from "./types";

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (res.status === 401) {
    window.dispatchEvent(new Event("roadmap:unauthorized"));
    throw new Error("Nicht angemeldet");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error || `Fehler ${res.status}`);
  }
  return res.json();
}

export const api = {
  me: () => request<{ authed: boolean; user?: User }>("/api/me"),
  login: (username: string, password: string) =>
    request<{ ok: boolean; user: User }>("/api/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),
  logout: () => request<{ ok: boolean }>("/api/logout", { method: "POST" }),

  registerVerify: (username: string, birthdate: string) =>
    request<{ ok: boolean; token: string; username: string }>("/api/register/verify", {
      method: "POST",
      body: JSON.stringify({ username, birthdate }),
    }),
  registerComplete: (token: string, password: string) =>
    request<{ ok: boolean; user: User }>("/api/register/complete", {
      method: "POST",
      body: JSON.stringify({ token, password }),
    }),

  users: () => request<User[]>("/api/users"),
  createUser: (data: { username: string; password: string; role: Role }) =>
    request<User>("/api/users", { method: "POST", body: JSON.stringify(data) }),
  updateUser: (id: number, data: { role?: Role; password?: string }) =>
    request<User>(`/api/users/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteUser: (id: number) =>
    request<{ ok: boolean }>(`/api/users/${id}`, { method: "DELETE" }),

  lanes: () => request<Lane[]>("/api/lanes"),
  createLane: (data: Partial<Lane>) =>
    request<Lane>("/api/lanes", { method: "POST", body: JSON.stringify(data) }),
  updateLane: (id: number, data: Partial<Lane>) =>
    request<Lane>(`/api/lanes/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  reorderLanes: (ids: number[]) =>
    request<{ ok: boolean }>("/api/lanes/reorder", {
      method: "POST",
      body: JSON.stringify({ ids }),
    }),
  deleteLane: (id: number) =>
    request<{ ok: boolean }>(`/api/lanes/${id}`, { method: "DELETE" }),

  undoCount: () => request<{ count: number }>("/api/undo"),
  undo: () =>
    request<{ ok: boolean; undone: string; remaining: number }>("/api/undo", {
      method: "POST",
    }),

  reveal: () => request<{ active: boolean; until: number | null }>("/api/reveal"),
  setReveal: (active: boolean) =>
    request<{ active: boolean; until: number | null }>("/api/reveal", {
      method: "POST",
      body: JSON.stringify({ active }),
    }),

  state: () =>
    request<{
      version: number;
      reveal: { active: boolean; until: number | null };
      online: OnlineUser[];
      /** Eigene aktuelle Benutzerdaten – Rollenänderungen greifen so sofort */
      me: User | null;
      /** Eigene Cursor-Freigabe (Opt-in, max. 60 Minuten) */
      cursorShare: { active: boolean; until: number | null };
      /** Benutzer-IDs, die ihren Cursor gerade teilen */
      sharingIds: number[];
    }>("/api/state"),

  /** Eigene Cursor-Position melden (null = Zeiger nicht über dem Raster)
   *  und die frischen Positionen der anderen abholen */
  cursors: (pos: CursorPos | null, focus?: CursorFocus | null) =>
    request<{ cursors: RemoteCursor[] }>("/api/cursors", {
      method: "POST",
      body: JSON.stringify({ pos, focus: focus ?? null }),
    }),

  setCursorShare: (active: boolean) =>
    request<{ active: boolean; until: number | null }>("/api/cursor-share", {
      method: "POST",
      body: JSON.stringify({ active }),
    }),

  tasks: () => request<Task[]>("/api/tasks"),
  createTask: (data: Partial<Task>) =>
    request<Task>("/api/tasks", { method: "POST", body: JSON.stringify(data) }),
  updateTask: (id: number, data: Partial<Task>) =>
    request<Task>(`/api/tasks/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteTask: (id: number) =>
    request<{ ok: boolean }>(`/api/tasks/${id}`, { method: "DELETE" }),
};
