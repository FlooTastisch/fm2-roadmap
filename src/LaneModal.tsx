import { useState } from "react";
import type { Lane } from "./types";
import { mcHeadUrl } from "./mcHead";
import { DEFAULT_TASK_COLOR, TASK_COLORS, pickTaskColor } from "./taskColors";

interface Props {
  lane: Lane | null; // null = neue Zeile
  onSave: (data: Partial<Lane>) => void;
  onDelete?: () => void;
  onClose: () => void;
  onMove?: (direction: -1 | 1) => void;
  allowHide?: boolean;
}

export function LaneModal({ lane, onSave, onDelete, onClose, onMove, allowHide = false }: Props) {
  const [name, setName] = useState(lane?.name ?? "");
  const [kind, setKind] = useState<Lane["kind"]>(lane?.kind ?? "person");
  const [color, setColor] = useState(pickTaskColor(lane?.color ?? DEFAULT_TASK_COLOR));
  const [weekendOff, setWeekendOff] = useState(!!lane?.weekend_off);
  const [subRows, setSubRows] = useState(lane?.sub_rows ?? 2);
  const [compact, setCompact] = useState(!!lane?.compact);
  const [hidden, setHidden] = useState(!!lane?.hidden);
  const [mcName, setMcName] = useState(lane?.mc_name ?? "");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    onSave({
      name: name.trim(),
      kind,
      color: kind === "section" ? pickTaskColor(color) : color,
      weekend_off: weekendOff ? 1 : 0,
      sub_rows: subRows,
      compact: compact ? 1 : 0,
      mc_name: kind === "person" ? mcName.trim() : "",
      ...(allowHide ? { hidden: hidden ? 1 : 0 } : {}),
    });
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2>{lane ? "Zeile bearbeiten" : "Neue Zeile"}</h2>

        <label>
          Name
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="z. B. Mitarbeitername oder 'Releases'"
          />
        </label>

        <label>
          Typ
          <select value={kind} onChange={(e) => setKind(e.target.value as Lane["kind"])}>
            <option value="person">Person / Team</option>
            <option value="section">Bereich (z. B. Events, Releases)</option>
          </select>
        </label>

        {kind === "person" && (
          <label>
            Minecraft-Name (Kopf-Avatar)
            <input
              value={mcName}
              onChange={(e) => setMcName(e.target.value)}
              placeholder="z. B. Jeani_"
            />
            {mcName.trim() && (
              <img className="mc-head-preview" src={mcHeadUrl(mcName)} alt="" draggable={false} />
            )}
          </label>
        )}

        {kind === "section" && (
          <label>
            Farbe
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
                  onClick={() => setColor(c.hex)}
                >
                  <span className="swatch-abbrev">{c.abbrev}</span>
                </button>
              ))}
            </div>
          </label>
        )}

        <label>
          Unterzeilen (1–10)
          <input
            type="number"
            min={1}
            max={10}
            value={subRows}
            onChange={(e) => setSubRows(Math.max(1, Math.min(10, Number(e.target.value) || 1)))}
          />
        </label>

        <label className="check">
          <input
            type="checkbox"
            checked={compact}
            onChange={(e) => setCompact(e.target.checked)}
          />
          Kompakte Unterzeilen (ca. 25 % niedriger)
        </label>

        <label className="check">
          <input
            type="checkbox"
            checked={weekendOff}
            onChange={(e) => setWeekendOff(e.target.checked)}
          />
          Wochenende markieren (Sa/So grau hervorheben)
        </label>

        {lane && allowHide && (
          <label className="check">
            <input
              type="checkbox"
              checked={hidden}
              onChange={(e) => setHidden(e.target.checked)}
            />
            Ausblenden (Daten bleiben erhalten – z. B. ehemalige Mitarbeiter)
          </label>
        )}

        {lane && onMove && (
          <label>
            Position
            <div className="move-buttons">
              <button type="button" onClick={() => onMove(-1)}>
                ↑ Nach oben
              </button>
              <button type="button" onClick={() => onMove(1)}>
                ↓ Nach unten
              </button>
            </div>
          </label>
        )}

        <div className="modal-actions">
          {lane && onDelete && (
            <button
              type="button"
              className="danger"
              onClick={() => {
                if (confirm("Zeile und alle zugehörigen Aufgaben endgültig löschen? (Nur wenn wirklich nötig – sonst „Ausblenden“ nutzen)")) onDelete();
              }}
            >
              Löschen
            </button>
          )}
          <span className="spacer" />
          <button type="button" onClick={onClose}>
            Abbrechen
          </button>
          <button type="submit" className="primary">
            Speichern
          </button>
        </div>
      </form>
    </div>
  );
}
