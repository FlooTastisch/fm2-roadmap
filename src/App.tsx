import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import type { CursorFocus, Lane, OnlineUser, Task, User } from "./types";
import { canSeeAll, canWrite, roleLabel } from "./types";
import { Presence } from "./Presence";
import { Timeline } from "./Timeline";
import { TaskModal } from "./TaskModal";
import { LaneModal } from "./LaneModal";
import { UsersModal } from "./UsersModal";
import { addDays, buildDays, diffDays, startOfWeek, todayISO, visibleRange } from "./dates";
import { DAY_W, DAY_W_WIDE } from "./timelineMetrics";

const WEEKS_BEFORE = 4;
const WEEKS_TOTAL = 30;

type ModalState =
  | { type: "none" }
  | {
      type: "task-new";
      laneId: number;
      start_date: string;
      end_date: string;
      rowIndex: number;
      rowSpan: number;
    }
  | { type: "task-edit"; task: Task }
  | { type: "lane-new" }
  | { type: "lane-edit"; lane: Lane }
  | { type: "users" };

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");

  const [authView, setAuthView] = useState<"login" | "register">(() =>
    window.location.pathname.replace(/\/+$/, "").toLowerCase() === "/register"
      ? "register"
      : "login"
  );
  const [regUsername, setRegUsername] = useState("");
  const [regBirthdate, setRegBirthdate] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [regPassword2, setRegPassword2] = useState("");
  const [regError, setRegError] = useState("");
  const [regBusy, setRegBusy] = useState(false);
  // Zweiter Schritt: nach erfolgreicher Verifizierung Passwort setzen
  const [regToken, setRegToken] = useState<string | null>(null);
  const [regVerifiedName, setRegVerifiedName] = useState("");

  const [lanes, setLanes] = useState<Lane[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [modal, setModal] = useState<ModalState>({ type: "none" });
  const [rangeOffset, setRangeOffset] = useState(0);
  const [undoCount, setUndoCount] = useState(0);
  const [toast, setToast] = useState("");
  const [showHidden, setShowHidden] = useState(false);
  // Vergrößerte Tageskacheln (doppelte Breite) – Einstellung pro Benutzer/Gerät,
  // überlebt Reloads via localStorage
  const [wideTiles, setWideTiles] = useState(
    () => localStorage.getItem("roadmap:wideTiles") === "1"
  );
  const toggleWideTiles = useCallback(() => {
    setWideTiles((v) => {
      localStorage.setItem("roadmap:wideTiles", v ? "0" : "1");
      return !v;
    });
  }, []);
  const [reveal, setReveal] = useState<{ active: boolean; until: number | null }>({
    active: false,
    until: null,
  });
  const [online, setOnline] = useState<OnlineUser[]>([]);

  // Live-Cursor: Wessen Zeiger wird angezeigt? Standard: nur Admins.
  // Über Klick auf einen Presence-Avatar lässt sich das pro Benutzer
  // umschalten; die Auswahl überlebt Reloads (localStorage).
  const [cursorOverrides, setCursorOverrides] = useState<Record<number, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem("roadmap:cursorWatch") ?? "{}");
    } catch {
      return {};
    }
  });

  // Effektive Auswahl: explizite Umschaltung gewinnt, sonst gilt der
  // Standard „Admin-Cursor sichtbar". Der eigene Cursor wird nie angezeigt.
  const watchedCursorIds = useMemo(() => {
    const set = new Set<number>();
    for (const u of online) {
      if (user && u.id === user.id) continue;
      if (cursorOverrides[u.id] ?? u.role === "admin") set.add(u.id);
    }
    return set;
  }, [online, cursorOverrides, user]);

  // Solange ein Aufgaben-Modal offen ist, an andere melden, was gerade bearbeitet wird
  const cursorFocus = useMemo((): CursorFocus | null => {
    if (modal.type === "task-edit") return { kind: "task", taskId: modal.task.id };
    if (modal.type === "task-new") {
      return {
        kind: "range",
        lane: modal.laneId,
        start: modal.start_date,
        end: modal.end_date,
        rowIndex: modal.rowIndex,
        rowSpan: modal.rowSpan,
      };
    }
    return null;
  }, [modal]);

  const toggleCursorWatch = useCallback(
    (id: number) => {
      setCursorOverrides((prev) => {
        const next = { ...prev, [id]: !watchedCursorIds.has(id) };
        localStorage.setItem("roadmap:cursorWatch", JSON.stringify(next));
        return next;
      });
    },
    [watchedCursorIds]
  );
  const revealActiveRef = useRef(false);
  const versionRef = useRef(0);
  const staleRef = useRef(false);
  const interactingRef = useRef(false);

  const writable = user ? canWrite(user.role) : false;
  const isAdmin = user?.role === "admin";
  // Vollsicht: Admin und Beobachter sehen das komplette Raster ohne Sichtfenster
  const fullView = user ? canSeeAll(user.role) : false;

  const hiddenLaneCount = useMemo(() => lanes.filter((l) => l.hidden).length, [lanes]);

  const visibleLanes = useMemo(
    () => (isAdmin && showHidden ? lanes : lanes.filter((l) => !l.hidden)),
    [lanes, showHidden, isAdmin]
  );

  const visibleLaneIds = useMemo(() => new Set(visibleLanes.map((l) => l.id)), [visibleLanes]);

  const visibleTasks = useMemo(
    () => tasks.filter((t) => visibleLaneIds.has(t.lane_id)),
    [tasks, visibleLaneIds]
  );

  const refreshUndoCount = useCallback(async () => {
    if (user?.role !== "admin") return;
    try {
      const r = await api.undoCount();
      setUndoCount(r.count);
    } catch {
      /* ignorieren */
    }
  }, [user]);

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 4000);
  }, []);

  // Benutzer ohne Vollsicht und ohne aktive Enthüllung sehen ausschließlich ihr
  // Sichtfenster und können nicht darüber hinaus scrollen. Admins und Beobachter –
  // und während einer Enthüllung alle – sehen das volle Raster mit Navigation.
  const clampToWindow = !fullView && !reveal.active;

  const rangeStart = useMemo(() => {
    const today = todayISO();
    if (clampToWindow) return visibleRange(today).min;
    return addDays(startOfWeek(today), (rangeOffset - WEEKS_BEFORE) * 7);
  }, [clampToWindow, rangeOffset]);

  const dayCount = useMemo(() => {
    if (!clampToWindow) return WEEKS_TOTAL * 7;
    const { min, max } = visibleRange(todayISO());
    return diffDays(min, max) + 1;
  }, [clampToWindow]);

  const days = useMemo(() => buildDays(rangeStart, dayCount), [rangeStart, dayCount]);

  const reload = useCallback(async () => {
    const [l, t] = await Promise.all([api.lanes(), api.tasks()]);
    setLanes(l);
    setTasks(t);
    refreshUndoCount();
  }, [refreshUndoCount]);

  useEffect(() => {
    api
      .me()
      .then((r) => setUser(r.authed && r.user ? r.user : null))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
    const onUnauthorized = () => setUser(null);
    window.addEventListener("roadmap:unauthorized", onUnauthorized);
    return () => window.removeEventListener("roadmap:unauthorized", onUnauthorized);
  }, []);

  useEffect(() => {
    if (user) reload();
  }, [user, reload]);

  // Live-Updates: In kurzen Abständen den Sammel-Endpunkt abfragen. Ändert ein
  // anderer Client Zeilen/Aufgaben, steigt die Daten-Version – dann laden alle
  // offenen Clients neu. Ebenso wird der Enthüllungs-Status verteilt (Admin hebt
  // Verschleierung auf / sie läuft nach 10 Minuten ab). Läuft gerade ein Drag
  // oder eine Auswahl, wird das Neuladen bis zum Ende der Interaktion aufgeschoben.
  const handleInteractingChange = useCallback(
    (active: boolean) => {
      interactingRef.current = active;
      if (!active && staleRef.current) {
        staleRef.current = false;
        reload();
      }
    },
    [reload]
  );

  useEffect(() => {
    if (!user) return;
    let stopped = false;
    const check = async () => {
      try {
        const s = await api.state();
        if (stopped) return;
        const revealChanged = s.reveal.active !== revealActiveRef.current;
        revealActiveRef.current = s.reveal.active;
        setReveal(s.reveal);
        setOnline(s.online ?? []);

        // Rollenänderung durch den Admin sofort übernehmen (ohne Neu-Login).
        // Bei unveränderten Daten bleibt das State-Objekt identisch (kein Re-Render).
        if (s.me) {
          const me = s.me;
          setUser((prev) =>
            prev && (prev.role !== me.role || prev.username !== me.username)
              ? { ...prev, username: me.username, role: me.role }
              : prev
          );
        }

        const firstRun = versionRef.current === 0;
        const versionChanged = s.version !== versionRef.current;
        versionRef.current = s.version;

        // Erste Runde nur initialisieren – die Daten wurden bereits geladen.
        if (firstRun) return;

        if (versionChanged || revealChanged) {
          if (interactingRef.current) staleRef.current = true;
          else reload();
        }
      } catch {
        /* ignorieren – nächster Versuch beim folgenden Intervall */
      }
    };
    check();
    const id = window.setInterval(check, 2000);
    return () => {
      stopped = true;
      window.clearInterval(id);
      setOnline([]);
    };
  }, [user, reload]);

  const toggleReveal = useCallback(async () => {
    try {
      const r = await api.setReveal(!revealActiveRef.current);
      revealActiveRef.current = r.active;
      setReveal(r);
      showToast(
        r.active
          ? "Verschleierung aufgehoben – alle sehen jetzt alles (max. 10 Minuten)"
          : "Verschleierung wieder aktiv"
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Umschalten fehlgeschlagen");
    }
  }, [showToast]);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoginError("");
    try {
      const res = await api.login(username.trim(), password);
      setUser(res.user);
      setPassword("");
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : "Anmeldung fehlgeschlagen");
    }
  }

  function switchAuthView(view: "login" | "register") {
    setLoginError("");
    setRegError("");
    setRegToken(null);
    setRegPassword("");
    setRegPassword2("");
    setAuthView(view);
    const path = view === "register" ? "/register" : "/";
    window.history.replaceState(null, "", path);
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    setRegError("");
    if (!regUsername.trim()) return setRegError("Bitte deinen Benutzernamen eingeben.");
    if (!regBirthdate) return setRegError("Bitte dein Geburtsdatum auswählen.");
    setRegBusy(true);
    try {
      const res = await api.registerVerify(regUsername.trim(), regBirthdate);
      setRegVerifiedName(res.username);
      setRegPassword("");
      setRegPassword2("");
      setRegToken(res.token);
    } catch (err) {
      setRegError(err instanceof Error ? err.message : "Verifizierung fehlgeschlagen");
    } finally {
      setRegBusy(false);
    }
  }

  async function handleSetPassword(e: React.FormEvent) {
    e.preventDefault();
    setRegError("");
    if (!regToken) return;
    if (regPassword.length < 6)
      return setRegError("Das Passwort muss mindestens 6 Zeichen haben.");
    if (regPassword !== regPassword2)
      return setRegError("Die beiden Passwörter stimmen nicht überein.");
    setRegBusy(true);
    try {
      const res = await api.registerComplete(regToken, regPassword);
      window.history.replaceState(null, "", "/");
      setRegToken(null);
      setRegPassword("");
      setRegPassword2("");
      setUser(res.user);
    } catch (err) {
      setRegError(err instanceof Error ? err.message : "Passwort konnte nicht gesetzt werden");
    } finally {
      setRegBusy(false);
    }
  }

  const handleTaskChange = useCallback(
    async (id: number, data: Partial<Task>) => {
      if (!writable) return;
      setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...data } : t)));
      try {
        const saved = await api.updateTask(id, data);
        setTasks((prev) => prev.map((t) => (t.id === id ? saved : t)));
        refreshUndoCount();
      } catch (err) {
        showToast(err instanceof Error ? err.message : "Änderung nicht möglich");
        reload();
      }
    },
    [reload, writable, refreshUndoCount, showToast]
  );

  const handleUndo = useCallback(async () => {
    try {
      const result = await api.undo();
      setUndoCount(result.remaining);
      showToast(result.undone);
      await reload();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Rückgängig fehlgeschlagen");
    }
  }, [reload, showToast]);

  if (loading) return <div className="center-page">Lädt …</div>;

  if (!user) {
    if (authView === "register") {
      return (
        <div className="center-page">
          <form className="login-card" onSubmit={handleVerify}>
            <h1>FM2 network GmbH</h1>
            <p>
              Schritt 1 von 2 – Verifizierung
            </p>
            <p className="reg-info">
              Mit deinem Geburtsdatum bestätigst du, dass du wirklich die richtige Person bist.
            </p>
            <label className="field-label">
              Benutzername (dein Minecraft-Name)
              <input
                autoFocus
                placeholder="Dein Minecraft-Name"
                value={regUsername}
                onChange={(e) => setRegUsername(e.target.value)}
                autoComplete="username"
              />
            </label>
            <label className="field-label">
              Geburtsdatum
              <input
                type="date"
                value={regBirthdate}
                onChange={(e) => setRegBirthdate(e.target.value)}
                max="2020-12-31"
              />
            </label>
            {!regToken && regError && <p className="error">{regError}</p>}
            <button type="submit" className="primary" disabled={regBusy || !!regToken}>
              {regBusy && !regToken ? "Wird geprüft …" : "Weiter"}
            </button>
            <button type="button" className="link-button" onClick={() => switchAuthView("login")}>
              Ich habe schon ein Passwort – zur Anmeldung
            </button>
          </form>

          {regToken && (
            <div className="modal-backdrop" onClick={() => setRegToken(null)}>
              <form
                className="modal reg-modal"
                onClick={(e) => e.stopPropagation()}
                onSubmit={handleSetPassword}
              >
                <h2>Schritt 2 von 2 – Passwort festlegen</h2>
                <p className="reg-info">
                  Verifiziert als <strong>{regVerifiedName}</strong>. Lege jetzt dein
                  persönliches Passwort fest.
                </p>
                <label className="field-label">
                  Passwort (mind. 6 Zeichen)
                  <input
                    autoFocus
                    type="password"
                    placeholder="Neues Passwort"
                    value={regPassword}
                    onChange={(e) => setRegPassword(e.target.value)}
                    autoComplete="new-password"
                  />
                </label>
                <label className="field-label">
                  Passwort bestätigen
                  <input
                    type="password"
                    placeholder="Passwort wiederholen"
                    value={regPassword2}
                    onChange={(e) => setRegPassword2(e.target.value)}
                    autoComplete="new-password"
                  />
                </label>
                {regError && <p className="error">{regError}</p>}
                <div className="modal-actions">
                  <button type="button" onClick={() => setRegToken(null)}>
                    Zurück
                  </button>
                  <span className="spacer" />
                  <button type="submit" className="primary" disabled={regBusy}>
                    {regBusy ? "Wird gespeichert …" : "Passwort festlegen & anmelden"}
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      );
    }

    return (
      <div className="center-page">
        <form className="login-card" onSubmit={handleLogin}>
          <h1>FM2 network GmbH</h1>
          <p>Roadmap – bitte anmelden</p>
          <input
            autoFocus
            placeholder="Benutzername"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
          />
          <input
            type="password"
            placeholder="Passwort"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
          {loginError && <p className="error">{loginError}</p>}
          <button type="submit" className="primary">
            Anmelden
          </button>
          <button type="button" className="link-button" onClick={() => switchAuthView("register")}>
            Zum ersten Mal hier? Passwort festlegen
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-left">
          <h1>Roadmap – FM2 network GmbH</h1>
          <span className="user-chip">
            {user.username} · {roleLabel(user.role)}
          </span>
          <Presence
            online={online}
            selfId={user.id}
            watchedIds={watchedCursorIds}
            onToggleCursor={toggleCursorWatch}
          />
        </div>
        <div className="topbar-actions">
          {!clampToWindow && (
            <>
              <button onClick={() => setRangeOffset((o) => o - 4)}>← Früher</button>
              <button onClick={() => setRangeOffset(0)}>Heute</button>
              <button onClick={() => setRangeOffset((o) => o + 4)}>Später →</button>
              <span className="divider" />
            </>
          )}
          {isAdmin && hiddenLaneCount > 0 && (
            <button
              onClick={() => setShowHidden((v) => !v)}
              title={
                showHidden
                  ? "Ausgeblendete Zeilen verbergen"
                  : `${hiddenLaneCount} ausgeblendete Zeile(n) einblenden`
              }
              className={showHidden ? "active-toggle" : ""}
            >
              {showHidden ? "Ausgeblendete verbergen" : `Ausgeblendete (${hiddenLaneCount})`}
            </button>
          )}
          {isAdmin && (
            <button
              onClick={toggleReveal}
              className={reveal.active ? "reveal-on" : ""}
              title={
                reveal.active
                  ? "Alle Benutzer sehen gerade die komplette Roadmap – klicken, um wieder zu verschleiern"
                  : "Verschleierung für alle Benutzer temporär aufheben (endet automatisch nach 10 Minuten)"
              }
            >
              {reveal.active
                ? `Blur wieder aktivieren (noch ${Math.max(
                    1,
                    Math.ceil(((reveal.until ?? 0) - Date.now()) / 60000)
                  )} min)`
                : "Blur aufheben"}
            </button>
          )}
          {isAdmin && (
            <button
              onClick={handleUndo}
              disabled={undoCount === 0}
              title={
                undoCount === 0
                  ? "Keine Schritte zum Rückgängigmachen"
                  : `${undoCount} Schritt(e) können rückgängig gemacht werden`
              }
            >
              ↩ Rückgängig{undoCount > 0 ? ` (${undoCount})` : ""}
            </button>
          )}
          {writable && (
            <button className="primary" onClick={() => setModal({ type: "lane-new" })}>
              + Zeile
            </button>
          )}
          {isAdmin && (
            <button onClick={() => setModal({ type: "users" })}>Benutzer</button>
          )}
          <button
            onClick={toggleWideTiles}
            className={wideTiles ? "active-toggle" : ""}
            title={
              wideTiles
                ? "Tageskacheln wieder auf normale Breite verkleinern"
                : "Tageskacheln doppelt so breit anzeigen (bessere Lesbarkeit)"
            }
          >
            {wideTiles ? "Normale Kacheln" : "Vergrößerte Kacheln"}
          </button>
          <button
            onClick={() => {
              api.logout().then(() => setUser(null));
            }}
          >
            Abmelden
          </button>
        </div>
      </header>

      <Timeline
        lanes={visibleLanes}
        tasks={visibleTasks}
        days={days}
        rangeStart={rangeStart}
        dayWidth={wideTiles ? DAY_W_WIDE : DAY_W}
        readOnly={!writable}
        isAdmin={isAdmin}
        fullView={fullView}
        revealed={reveal.active}
        watchedCursorIds={watchedCursorIds}
        cursorFocus={cursorFocus}
        onInteractingChange={handleInteractingChange}
        onTaskClick={(task) => setModal({ type: "task-edit", task })}
        onTaskChange={handleTaskChange}
        onCreateRange={(laneId, start_date, end_date, rowIndex, rowSpan) => {
          if (writable)
            setModal({ type: "task-new", laneId, start_date, end_date, rowIndex, rowSpan });
        }}
        onEditLane={(lane) => {
          if (writable) setModal({ type: "lane-edit", lane });
        }}
        onTaskDelete={
          writable
            ? async (task) => {
                await api.deleteTask(task.id);
                setTasks((prev) => prev.filter((t) => t.id !== task.id));
                refreshUndoCount();
              }
            : undefined
        }
      />

      {toast && <div className="toast">{toast}</div>}

      <footer className="hint">
        {writable
          ? isAdmin
            ? "Tipp: Auf eine freie Stelle klicken oder mehrere Tage markieren (ziehen), um eine Aufgabe anzulegen. Balken ziehen zum Verschieben, an den Rändern ziehen zum Verlängern/Verkürzen."
            : "Tipp: Auf eine freie Stelle klicken oder mehrere Tage markieren (ziehen), um eine Aufgabe anzulegen. Bereiche außerhalb von 2 Wochen Vergangenheit / 60 Tage Zukunft sind ausgeblendet."
          : fullView
            ? "Du hast Leserechte für die komplette Roadmap. Der Schleier markiert den Bereich, den die übrigen Benutzer gerade sehen."
            : "Du hast nur Leserechte. Bereiche außerhalb deines Sichtfensters (2 Wochen zurück, 60 Tage voraus) sind ausgeblendet."}
      </footer>

      {modal.type === "task-new" && writable && (
        <TaskModal
          task={null}
          initial={{ lane_id: modal.laneId, start_date: modal.start_date, end_date: modal.end_date }}
          lanes={visibleLanes}
          onClose={() => setModal({ type: "none" })}
          onSave={async (data) => {
            try {
              const created = await api.createTask({
                ...data,
                row_index: modal.rowIndex,
                row_span: modal.rowSpan,
              });
              setTasks((prev) => [...prev, created]);
              setModal({ type: "none" });
              refreshUndoCount();
            } catch (err) {
              showToast(err instanceof Error ? err.message : "Anlegen fehlgeschlagen");
            }
          }}
        />
      )}

      {modal.type === "task-edit" && (
        <TaskModal
          task={modal.task}
          initial={{
            lane_id: modal.task.lane_id,
            start_date: modal.task.start_date,
            end_date: modal.task.end_date,
          }}
          lanes={lanes}
          readOnly={!writable}
          onClose={() => setModal({ type: "none" })}
          onSave={async (data) => {
            await handleTaskChange(modal.task.id, data);
            setModal({ type: "none" });
          }}
          onDelete={
            writable
              ? async () => {
                  await api.deleteTask(modal.task.id);
                  setTasks((prev) => prev.filter((t) => t.id !== modal.task.id));
                  setModal({ type: "none" });
                  refreshUndoCount();
                }
              : undefined
          }
        />
      )}

      {modal.type === "lane-new" && writable && (
        <LaneModal
          lane={null}
          allowHide={isAdmin}
          onClose={() => setModal({ type: "none" })}
          onSave={async (data) => {
            const created = await api.createLane(data);
            setLanes((prev) => [...prev, created]);
            setModal({ type: "none" });
            refreshUndoCount();
          }}
        />
      )}

      {modal.type === "lane-edit" && writable && (
        <LaneModal
          lane={modal.lane}
          allowHide={isAdmin}
          onClose={() => setModal({ type: "none" })}
          onSave={async (data) => {
            const saved = await api.updateLane(modal.lane.id, data);
            setLanes((prev) => prev.map((l) => (l.id === modal.lane.id ? saved : l)));
            setModal({ type: "none" });
            refreshUndoCount();
          }}
          onDelete={async () => {
            await api.deleteLane(modal.lane.id);
            setLanes((prev) => prev.filter((l) => l.id !== modal.lane.id));
            setTasks((prev) => prev.filter((t) => t.lane_id !== modal.lane.id));
            setModal({ type: "none" });
            refreshUndoCount();
          }}
          onMove={async (direction) => {
            const idx = lanes.findIndex((l) => l.id === modal.lane.id);
            const target = idx + direction;
            if (target < 0 || target >= lanes.length) return;
            const next = [...lanes];
            [next[idx], next[target]] = [next[target], next[idx]];
            setLanes(next);
            await api.reorderLanes(next.map((l) => l.id));
            refreshUndoCount();
          }}
        />
      )}

      {modal.type === "users" && isAdmin && (
        <UsersModal currentUserId={user.id} onClose={() => setModal({ type: "none" })} />
      )}
    </div>
  );
}
