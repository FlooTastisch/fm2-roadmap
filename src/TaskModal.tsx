import { useState } from "react";
import type { Lane, Task } from "./types";
import { TASK_COLORS, pickTaskColor } from "./taskColors";

interface Props {
  task: Task | null;
  initial: { lane_id: number; start_date: string; end_date: string };
  lanes: Lane[];
  readOnly?: boolean;
  onSave: (data: Partial<Task>) => void;
  onDelete?: () => void;
  onClose: () => void;
}

export function TaskModal({ task, initial, lanes, readOnly = false, onSave, onDelete, onClose }: Props) {
  const [title, setTitle] = useState(task?.title ?? "");
  const [laneId, setLaneId] = useState(task?.lane_id ?? initial.lane_id);
  const [start, setStart] = useState(task?.start_date ?? initial.start_date);
  const [end, setEnd] = useState(task?.end_date ?? initial.end_date);
  const [color, setColor] = useState(pickTaskColor(task?.color));
  const [notes, setNotes] = useState(task?.notes ?? "");
  const [done, setDone] = useState(!!task?.done);
  const [fixed, setFixed] = useState(task ? task.fixed !== 0 : true);
  const [error, setError] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return setError("Bitte einen Titel eingeben.");
    if (start > end) return setError("Das Startdatum liegt nach dem Enddatum.");
    onSave({
      title: title.trim(),
      lane_id: laneId,
      start_date: start,
      end_date: end,
      color,
      notes,
      done: done ? 1 : 0,
      fixed: fixed ? 1 : 0,
    });
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2>{readOnly ? "Aufgabe ansehen" : task ? "Aufgabe bearbeiten" : "Neue Aufgabe"}</h2>

        <label>
          Titel
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="z. B. Sommer Event Testing"
            readOnly={readOnly}
          />
        </label>

        <label>
          Zeile
          <select value={laneId} onChange={(e) => setLaneId(Number(e.target.value))} disabled={readOnly}>
            {lanes.map((l) => (
              <option key={l.id} value={l.id}>
                {l.kind === "section" ? `📌 ${l.name}` : l.name}
              </option>
            ))}
          </select>
        </label>

        <div className="row2">
          <label>
            Von
            <input type="date" value={start} onChange={(e) => setStart(e.target.value)} readOnly={readOnly} />
          </label>
          <label>
            Bis (einschließlich)
            <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} readOnly={readOnly} />
          </label>
        </div>

        <label>
          Farbe / Projekt
          <div className="palette">
            {TASK_COLORS.map((c) => (
              <button
                key={c.hex}
                type="button"
                className={"swatch" + (c.hex === color ? " active" : "")}
                style={{ background: c.hex }}
                title={
                  c.description ??
                  (c.projects.length ? `${c.label} (${c.projects.join(", ")})` : c.label)
                }
                onClick={() => !readOnly && setColor(c.hex)}
                disabled={readOnly}
              >
                <span className="swatch-abbrev">{c.abbrev}</span>
              </button>
            ))}
          </div>
        </label>

        <label>
          Notizen
          <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} readOnly={readOnly} />
        </label>

        <label className="check">
          <input type="checkbox" checked={fixed} onChange={(e) => setFixed(e.target.checked)} disabled={readOnly} />
          Fix (verbindlich – ohne Streifen)
        </label>

        {task && (
          <label className="check">
            <input type="checkbox" checked={done} onChange={(e) => setDone(e.target.checked)} disabled={readOnly} />
            Erledigt
          </label>
        )}

        {error && <p className="error">{error}</p>}

        <div className="modal-actions">
          {task && onDelete && !readOnly && (
            <button
              type="button"
              className="danger"
              onClick={() => {
                if (confirm("Aufgabe wirklich löschen?")) onDelete();
              }}
            >
              Löschen
            </button>
          )}
          <span className="spacer" />
          <button type="button" onClick={onClose}>
            {readOnly ? "Schließen" : "Abbrechen"}
          </button>
          {!readOnly && (
            <button type="submit" className="primary">
              Speichern
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
