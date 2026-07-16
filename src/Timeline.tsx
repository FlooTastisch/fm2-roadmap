import { useMemo, useRef, useState, useEffect, useCallback } from "react";
import type { CursorFocus, Lane, Task } from "./types";
import {
  DayInfo,
  MONTHS,
  WEEKDAYS_SHORT,
  addDays,
  clampDateRange,
  diffDays,
  isoWeek,
  todayISO,
  visibleRange,
} from "./dates";
import { mcHeadUrl } from "./mcHead";
import { CursorLayer } from "./CursorLayer";
import { BAR_INSET, laneMetrics, laneRowHeight } from "./timelineMetrics";

interface CreateSelectState {
  laneId: number;
  anchorIdx: number;
  currentIdx: number;
  anchorRow: number;
  currentRow: number;
}

interface DragState {
  taskId: number;
  mode: "move" | "resize-start" | "resize-end" | "resize-top" | "resize-bottom";
  startClientX: number;
  startClientY: number;
  origStart: string;
  origEnd: string;
  origLaneId: number;
  origRowIndex: number;
  rowSpan: number;
  // Unterzeile innerhalb der Aufgabe, an der gegriffen wurde
  grabRowOffset: number;
  moved: boolean;
}

interface Props {
  lanes: Lane[];
  tasks: Task[];
  days: DayInfo[];
  rangeStart: string;
  /** Breite einer Tageskachel in px (normal oder vergrößert) */
  dayWidth: number;
  onTaskClick: (task: Task) => void;
  onTaskChange: (id: number, data: Partial<Task>) => void;
  onCreateRange: (
    laneId: number,
    startDate: string,
    endDate: string,
    rowIndex: number,
    rowSpan: number
  ) => void;
  onEditLane: (lane: Lane) => void;
  onTaskDelete?: (task: Task) => void;
  readOnly?: boolean;
  isAdmin?: boolean;
  /** Sieht das komplette Raster (Admin & Beobachter) */
  fullView?: boolean;
  /** Admin hat die Verschleierung temporär für alle aufgehoben */
  revealed?: boolean;
  /** Meldet, ob gerade ein Drag/Auswahl läuft (damit Live-Reloads warten) */
  onInteractingChange?: (active: boolean) => void;
  /** Benutzer, deren Live-Cursor angezeigt werden (Auswahl über die Presence-Leiste) */
  watchedCursorIds: Set<number>;
  /** Eigener Fokus (geöffnetes Modal) für andere sichtbar machen */
  cursorFocus: CursorFocus | null;
}

const LABEL_W = 150;

function isMacOS() {
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform);
}

/** ⌘ auf dem Mac, Strg unter Windows – nicht Strg+Klick auf dem Mac (Kontextmenü). */
function isDeleteModifier(e: { metaKey: boolean; ctrlKey: boolean }) {
  return isMacOS() ? e.metaKey : e.ctrlKey;
}

function BlurOverlays({
  restrict,
  passthrough,
  visibleMinIdx,
  visibleMaxIdx,
  dayCount,
  dayWidth,
}: {
  restrict: boolean;
  /** Admin: Schleier nur optisch, Klicks/Drag gehen hindurch */
  passthrough: boolean;
  visibleMinIdx: number;
  visibleMaxIdx: number;
  dayCount: number;
  dayWidth: number;
}) {
  if (!restrict) return null;
  const cls = "tl-blur-zone" + (passthrough ? " passthrough" : "");
  return (
    <>
      {visibleMinIdx > 0 && (
        <div className={cls + " left"} style={{ width: visibleMinIdx * dayWidth }} />
      )}
      {visibleMaxIdx < dayCount - 1 && (
        <div
          className={cls + " right"}
          style={{
            left: (visibleMaxIdx + 1) * dayWidth,
            width: (dayCount - visibleMaxIdx - 1) * dayWidth,
          }}
        />
      )}
    </>
  );
}

export function Timeline({
  lanes,
  tasks,
  days,
  rangeStart,
  dayWidth,
  onTaskClick,
  onTaskChange,
  onCreateRange,
  onEditLane,
  onTaskDelete,
  readOnly = false,
  isAdmin = false,
  fullView = false,
  revealed = false,
  onInteractingChange,
  watchedCursorIds,
  cursorFocus,
}: Props) {
  // Alle Pixelrechnungen in der Komponente basieren auf der umschaltbaren Breite
  const DAY_W = dayWidth;
  const gridWidth = days.length * DAY_W;
  const today = todayISO();
  const todayIdx = diffDays(rangeStart, today);
  const { min: visibleMin, max: visibleMax } = visibleRange(today);
  const visibleMinIdx = Math.max(0, diffDays(rangeStart, visibleMin));
  const visibleMaxIdx = Math.min(days.length - 1, diffDays(rangeStart, visibleMax));
  // Der Blur-Schleier ist reine Kontrollanzeige für Benutzer mit Vollsicht
  // (Admin & Beobachter): Er zeigt an, welchen Bereich die übrigen Benutzer
  // gerade sehen. Klicks und Drag gehen hindurch. Benutzer ohne Vollsicht
  // bekommen keinen Blur mehr – ihr Raster ist stattdessen in App fest auf das
  // Sichtfenster beschränkt, sodass es außerhalb nichts zu zeigen gibt.
  // Bearbeitungsgrenzen gelten für Nicht-Admins weiterhin (der Server lehnt
  // Änderungen außerhalb des Fensters ohnehin ab).
  const restrictVisibility = fullView && !revealed;
  const restrictEditing = !isAdmin;
  const scrollRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const laneRowRefs = useRef(new Map<number, HTMLDivElement>());

  const [drag, setDrag] = useState<DragState | null>(null);
  const [createSelect, setCreateSelect] = useState<CreateSelectState | null>(null);
  // Vorschau während des Ziehens (noch nicht gespeichert)
  const [preview, setPreview] = useState<{
    start: string;
    end: string;
    laneId: number;
    rowIndex: number;
    rowSpan: number;
  } | null>(null);
  const [hover, setHover] = useState<{ task: Task; x: number; y: number } | null>(null);
  const [deleteModifier, setDeleteModifier] = useState(false);

  const canQuickDelete = !readOnly && !!onTaskDelete;

  const lanesById = useMemo(() => new Map(lanes.map((l) => [l.id, l])), [lanes]);

  useEffect(() => {
    if (!canQuickDelete) return;
    const sync = (e: KeyboardEvent | MouseEvent) => setDeleteModifier(isDeleteModifier(e));
    const reset = () => setDeleteModifier(false);
    window.addEventListener("keydown", sync);
    window.addEventListener("keyup", sync);
    window.addEventListener("blur", reset);
    return () => {
      window.removeEventListener("keydown", sync);
      window.removeEventListener("keyup", sync);
      window.removeEventListener("blur", reset);
    };
  }, [canQuickDelete]);

  // Laufende Interaktion (Drag/Auswahl) melden, damit Live-Reloads nicht
  // mitten hineingrätschen.
  useEffect(() => {
    onInteractingChange?.(!!drag || !!createSelect);
  }, [drag, createSelect, onInteractingChange]);

  // Beim ersten Rendern zur aktuellen Woche scrollen
  useEffect(() => {
    if (scrollRef.current && todayIdx > 0) {
      scrollRef.current.scrollLeft = Math.max(0, (todayIdx - 7) * DAY_W);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Beim Umschalten der Kachelbreite die Scroll-Position proportional anpassen,
  // damit derselbe Zeitraum sichtbar bleibt
  const prevDayWidthRef = useRef(DAY_W);
  useEffect(() => {
    const prev = prevDayWidthRef.current;
    if (prev !== DAY_W && scrollRef.current) {
      scrollRef.current.scrollLeft = (scrollRef.current.scrollLeft / prev) * DAY_W;
    }
    prevDayWidthRef.current = DAY_W;
  }, [DAY_W]);

  const tasksByLane = useMemo(() => {
    const map = new Map<number, Task[]>();
    for (const lane of lanes) map.set(lane.id, []);
    for (const t of tasks) {
      // Drag-Vorschau anwenden
      const effective =
        drag && preview && t.id === drag.taskId
          ? {
              ...t,
              start_date: preview.start,
              end_date: preview.end,
              lane_id: preview.laneId,
              row_index: preview.rowIndex,
              row_span: preview.rowSpan,
            }
          : t;
      map.get(effective.lane_id)?.push(effective);
    }
    return map;
  }, [tasks, lanes, drag, preview]);

  // Unterzeile aus der Y-Position innerhalb einer Zeile ermitteln
  const rowFromClientY = useCallback(
    (laneId: number, clientY: number): number => {
      const lane = lanesById.get(laneId);
      const rect = laneRowRefs.current.get(laneId)?.getBoundingClientRect();
      const subRows = lane?.sub_rows ?? 1;
      const m = laneMetrics(!!lane?.compact);
      if (!rect) return 0;
      const raw = Math.floor((clientY - rect.top - m.lanePad) / m.subH);
      return Math.max(0, Math.min(subRows - 1, raw));
    },
    [lanesById]
  );

  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      if (!drag) return;
      const dayDelta = Math.round((e.clientX - drag.startClientX) / DAY_W);
      const durDays = diffDays(drag.origStart, drag.origEnd);
      let start = drag.origStart;
      let end = drag.origEnd;
      let laneId = drag.origLaneId;
      let rowIndex = drag.origRowIndex;
      let rowSpan = drag.rowSpan;

      if (drag.mode === "move") {
        start = addDays(drag.origStart, dayDelta);
        end = addDays(drag.origEnd, dayDelta);
        // Zeile unter dem Zeiger finden
        for (const [id, el] of laneRowRefs.current) {
          const rect = el.getBoundingClientRect();
          if (e.clientY >= rect.top && e.clientY <= rect.bottom) {
            laneId = id;
            break;
          }
        }
        // Unterzeile unter dem Zeiger (Griff-Versatz berücksichtigen)
        const subRows = lanesById.get(laneId)?.sub_rows ?? 1;
        const pointerRow = rowFromClientY(laneId, e.clientY);
        rowIndex = Math.max(
          0,
          Math.min(subRows - drag.rowSpan, pointerRow - drag.grabRowOffset)
        );
      } else if (drag.mode === "resize-start") {
        start = addDays(drag.origStart, Math.min(dayDelta, durDays));
      } else if (drag.mode === "resize-end") {
        end = addDays(drag.origEnd, Math.max(dayDelta, -durDays));
      } else if (drag.mode === "resize-top") {
        // Obere Kante vertikal ziehen: Unterkante bleibt fest
        const bottom = drag.origRowIndex + drag.rowSpan - 1;
        const pointerRow = rowFromClientY(drag.origLaneId, e.clientY);
        rowIndex = Math.max(0, Math.min(bottom, pointerRow));
        rowSpan = bottom - rowIndex + 1;
      } else {
        // Untere Kante vertikal ziehen: Oberkante bleibt fest
        const subRows = lanesById.get(drag.origLaneId)?.sub_rows ?? 1;
        const pointerRow = rowFromClientY(drag.origLaneId, e.clientY);
        const bottom = Math.max(drag.origRowIndex, Math.min(subRows - 1, pointerRow));
        rowSpan = bottom - drag.origRowIndex + 1;
      }

      if (
        dayDelta !== 0 ||
        laneId !== drag.origLaneId ||
        rowIndex !== drag.origRowIndex ||
        rowSpan !== drag.rowSpan
      ) {
        setDrag((d) => (d ? { ...d, moved: true } : d));
      }
      let nextStart = start;
      let nextEnd = end;
      if (restrictEditing) {
        const clamped = clampDateRange(start, end, today);
        if (!clamped) return;
        nextStart = clamped.start;
        nextEnd = clamped.end;
      }
      setPreview({ start: nextStart, end: nextEnd, laneId, rowIndex, rowSpan });
    },
    [drag, restrictEditing, today, lanesById, rowFromClientY, DAY_W]
  );

  const onPointerUp = useCallback(() => {
    if (!drag) return;
    const task = tasks.find((t) => t.id === drag.taskId);
    if (task && drag.moved && preview) {
      onTaskChange(task.id, {
        start_date: preview.start,
        end_date: preview.end,
        lane_id: preview.laneId,
        row_index: preview.rowIndex,
        row_span: preview.rowSpan,
      });
    } else if (task && !drag.moved) {
      onTaskClick(task);
    }
    setDrag(null);
    setPreview(null);
  }, [drag, preview, tasks, onTaskChange, onTaskClick]);

  useEffect(() => {
    if (!drag) return;
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [drag, onPointerMove, onPointerUp]);

  function startDrag(
    e: React.PointerEvent,
    task: Task,
    mode: DragState["mode"]
  ) {
    if (readOnly || task.redacted) return;
    // Rechtsklick / Zwei-Finger-Klick (Touchpad) soll nichts auswählen oder verschieben
    if (e.button !== 0) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    // Mac: Strg+Klick öffnet das Kontextmenü – nicht als Drag/Löschen werten
    if (isMacOS() && e.ctrlKey) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (mode === "move" && isDeleteModifier(e) && onTaskDelete) {
      e.preventDefault();
      e.stopPropagation();
      setHover(null);
      onTaskDelete(task);
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    setHover(null);
    const rowIndex = task.row_index ?? 0;
    const rowSpan = task.row_span ?? 1;
    const pointerRow = rowFromClientY(task.lane_id, e.clientY);
    setDrag({
      taskId: task.id,
      mode,
      startClientX: e.clientX,
      startClientY: e.clientY,
      origStart: task.start_date,
      origEnd: task.end_date,
      origLaneId: task.lane_id,
      origRowIndex: rowIndex,
      rowSpan,
      grabRowOffset: Math.max(0, Math.min(rowSpan - 1, pointerRow - rowIndex)),
      moved: false,
    });
    setPreview({
      start: task.start_date,
      end: task.end_date,
      laneId: task.lane_id,
      rowIndex,
      rowSpan,
    });
  }

  function dayIdxFromClientX(laneId: number, clientX: number): number {
    const rect = laneRowRefs.current.get(laneId)?.getBoundingClientRect();
    if (!rect) return 0;
    return Math.max(0, Math.min(days.length - 1, Math.floor((clientX - rect.left) / DAY_W)));
  }

  const onCreatePointerMove = useCallback(
    (e: PointerEvent) => {
      if (!createSelect) return;
      let idx = dayIdxFromClientX(createSelect.laneId, e.clientX);
      if (restrictEditing) {
        idx = Math.max(visibleMinIdx, Math.min(visibleMaxIdx, idx));
      }
      const row = rowFromClientY(createSelect.laneId, e.clientY);
      setCreateSelect((s) => (s ? { ...s, currentIdx: idx, currentRow: row } : s));
    },
    [createSelect, restrictEditing, visibleMinIdx, visibleMaxIdx, rowFromClientY]
  );

  const onCreatePointerUp = useCallback(() => {
    if (!createSelect) return;
    let startIdx = Math.min(createSelect.anchorIdx, createSelect.currentIdx);
    let endIdx = Math.max(createSelect.anchorIdx, createSelect.currentIdx);
    if (restrictEditing) {
      startIdx = Math.max(startIdx, visibleMinIdx);
      endIdx = Math.min(endIdx, visibleMaxIdx);
      if (startIdx > endIdx) {
        setCreateSelect(null);
        return;
      }
    }
    const rowIndex = Math.min(createSelect.anchorRow, createSelect.currentRow);
    const rowSpan = Math.abs(createSelect.currentRow - createSelect.anchorRow) + 1;
    onCreateRange(createSelect.laneId, days[startIdx].iso, days[endIdx].iso, rowIndex, rowSpan);
    setCreateSelect(null);
  }, [createSelect, days, onCreateRange, restrictEditing, visibleMinIdx, visibleMaxIdx]);

  useEffect(() => {
    if (!createSelect) return;
    window.addEventListener("pointermove", onCreatePointerMove);
    window.addEventListener("pointerup", onCreatePointerUp);
    window.addEventListener("pointercancel", onCreatePointerUp);
    return () => {
      window.removeEventListener("pointermove", onCreatePointerMove);
      window.removeEventListener("pointerup", onCreatePointerUp);
      window.removeEventListener("pointercancel", onCreatePointerUp);
    };
  }, [createSelect, onCreatePointerMove, onCreatePointerUp]);

  function startCreateSelect(e: React.PointerEvent, laneId: number) {
    if (readOnly || e.button !== 0 || drag) return;
    const idx = dayIdxFromClientX(laneId, e.clientX);
    if (restrictEditing && (idx < visibleMinIdx || idx > visibleMaxIdx)) return;
    const row = rowFromClientY(laneId, e.clientY);
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    setCreateSelect({ laneId, anchorIdx: idx, currentIdx: idx, anchorRow: row, currentRow: row });
  }

  // Monats- und KW-Segmente für die Kopfzeilen
  const monthSegments = useMemo(() => {
    const segs: { label: string; span: number }[] = [];
    for (const d of days) {
      const label = `${MONTHS[d.month]} ${d.year}`;
      const last = segs[segs.length - 1];
      if (last && last.label === label) last.span++;
      else segs.push({ label, span: 1 });
    }
    return segs;
  }, [days]);

  const weekSegments = useMemo(() => {
    const segs: { label: string; span: number }[] = [];
    for (const d of days) {
      const last = segs[segs.length - 1];
      if (last && d.weekdayIdx !== 0) last.span++;
      else segs.push({ label: `KW ${isoWeek(d.iso)}`, span: 1 });
    }
    return segs;
  }, [days]);

  // Nur vertikale Tageslinien – kein Wochenend-Ton (Sa/So nur bei weekend_off als #CCC-Zellen)
  const gridBg = {
    backgroundImage: `
      repeating-linear-gradient(to right,
        var(--grid-line) 0px, var(--grid-line) 1px,
        transparent 1px, transparent ${DAY_W}px)
    `,
  };

  return (
    <div
      className={"timeline" + (deleteModifier && canQuickDelete ? " delete-modifier" : "")}
      ref={scrollRef}
      onMouseMove={(e) => canQuickDelete && setDeleteModifier(isDeleteModifier(e))}
    >
      <div className="tl-inner" ref={innerRef} style={{ width: gridWidth + LABEL_W }}>
        {/* Kopfzeilen */}
        <div className="tl-row tl-head-row" style={{ top: 0 }}>
          <div className="tl-label tl-corner" />
          <div className="tl-days tl-days-layered" style={{ width: gridWidth }}>
            {monthSegments.map((s, i) => (
              <div key={i} className="tl-month" style={{ width: s.span * DAY_W }}>
                {s.label}
              </div>
            ))}
            <BlurOverlays
              dayWidth={DAY_W}
              restrict={restrictVisibility}
              passthrough={fullView}
              visibleMinIdx={visibleMinIdx}
              visibleMaxIdx={visibleMaxIdx}
              dayCount={days.length}
            />
          </div>
        </div>
        <div className="tl-row tl-head-row" style={{ top: 22 }}>
          <div className="tl-label tl-corner" />
          <div className="tl-days tl-days-layered" style={{ width: gridWidth }}>
            {weekSegments.map((s, i) => (
              <div key={i} className="tl-week" style={{ width: s.span * DAY_W }}>
                {s.span >= 3 ? s.label : ""}
              </div>
            ))}
            <BlurOverlays
              dayWidth={DAY_W}
              restrict={restrictVisibility}
              passthrough={fullView}
              visibleMinIdx={visibleMinIdx}
              visibleMaxIdx={visibleMaxIdx}
              dayCount={days.length}
            />
          </div>
        </div>
        <div className="tl-row tl-head-row tl-head-days" style={{ top: 40 }}>
          <div className="tl-label tl-corner" />
          <div className="tl-days tl-days-layered" style={{ width: gridWidth }}>
            {days.map((d) => (
              <div
                key={d.iso}
                className={
                  "tl-day" +
                  (d.isWeekend ? " weekend" : "") +
                  (d.iso === today ? " today" : "")
                }
                style={{ width: DAY_W }}
              >
                <span className="wd">{WEEKDAYS_SHORT[d.weekdayIdx]}</span>
                <span className="dm">{d.dayOfMonth}</span>
              </div>
            ))}
            <BlurOverlays
              dayWidth={DAY_W}
              restrict={restrictVisibility}
              passthrough={fullView}
              visibleMinIdx={visibleMinIdx}
              visibleMaxIdx={visibleMaxIdx}
              dayCount={days.length}
            />
          </div>
        </div>

        {/* Zeilen */}
        {lanes.map((lane, i) => {
          const laneTasks = tasksByLane.get(lane.id) ?? [];
          const subRows = Math.max(1, lane.sub_rows ?? 1);
          const compact = !!lane.compact;
          const m = laneMetrics(compact);
          const rowHeight = laneRowHeight(subRows, compact);
          // Trennlinien: dick zwischen Bereichen und erster Person, dünner zwischen Personen
          const next = lanes[i + 1];
          const sep =
            lane.kind === "section" && next?.kind === "person"
              ? " sep-heavy"
              : lane.kind === "person" && next?.kind === "person"
                ? " sep-medium"
                : "";
          return (
            <div className={"tl-row" + sep + (lane.hidden ? " lane-hidden" : "")} key={lane.id}>
              <div
                className={`tl-label ${lane.kind === "section" ? "section" : ""}`}
                style={{
                  height: rowHeight,
                  background: lane.kind === "section" ? lane.color : undefined,
                }}
                onClick={() => !readOnly && onEditLane(lane)}
                title={
                  readOnly
                    ? lane.name
                    : lane.hidden
                      ? `${lane.name} (ausgeblendet) – Klicken zum Bearbeiten`
                      : "Klicken zum Bearbeiten"
                }
              >
                {lane.kind === "person" && lane.mc_name?.trim() && (
                  <img
                    className="tl-mc-head"
                    src={mcHeadUrl(lane.mc_name)}
                    alt=""
                    loading="lazy"
                    draggable={false}
                  />
                )}
                <span className="tl-label-name">
                  {lane.hidden ? `${lane.name} (ausgeblendet)` : lane.name}
                </span>
              </div>
              <div
                className={"tl-days tl-lane" + (readOnly ? " readonly" : "")}
                ref={(el) => {
                  if (el) laneRowRefs.current.set(lane.id, el);
                  else laneRowRefs.current.delete(lane.id);
                }}
                style={{
                  width: gridWidth,
                  height: rowHeight,
                  ...gridBg,
                }}
                onPointerDown={(e) => startCreateSelect(e, lane.id)}
              >
                {/* Unterzeilen-Raster */}
                {Array.from({ length: subRows - 1 }, (_, ri) => (
                  <div
                    key={`sub-${ri}`}
                    className="tl-subrow-line"
                    style={{ top: m.lanePad + (ri + 1) * m.subH - m.barGap / 2 - 0.5 }}
                  />
                ))}
                {/* Gesperrte Wochenenden: graue Zellen mit Sa/So-Beschriftung */}
                {!!lane.weekend_off &&
                  days.map((d, di) =>
                    d.isWeekend ? (
                      <div
                        key={d.iso}
                        className="tl-weekend-locked"
                        style={{ left: di * DAY_W, width: DAY_W }}
                      >
                        {WEEKDAYS_SHORT[d.weekdayIdx]}
                      </div>
                    ) : null
                  )}
                {createSelect?.laneId === lane.id && (
                  <div
                    className="tl-select-preview"
                    style={{
                      left:
                        Math.min(createSelect.anchorIdx, createSelect.currentIdx) * DAY_W,
                      width:
                        (Math.abs(createSelect.currentIdx - createSelect.anchorIdx) + 1) *
                          DAY_W -
                        2,
                      top:
                        m.lanePad +
                        Math.min(createSelect.anchorRow, createSelect.currentRow) * m.subH -
                        1,
                      height:
                        (Math.abs(createSelect.currentRow - createSelect.anchorRow) + 1) *
                          m.barH +
                        Math.abs(createSelect.currentRow - createSelect.anchorRow) * m.barGap +
                        2,
                    }}
                  />
                )}
                {todayIdx >= 0 && todayIdx < days.length && (
                  <div
                    className="tl-today-marker"
                    style={{ left: todayIdx * DAY_W, width: DAY_W }}
                  />
                )}
                {laneTasks.map((t) => {
                  const startIdx = diffDays(rangeStart, t.start_date);
                  const span = diffDays(t.start_date, t.end_date) + 1;
                  const clampedStart = Math.max(startIdx, 0);
                  const clampedSpan = Math.min(startIdx + span, days.length) - clampedStart;
                  if (clampedSpan <= 0) return null;
                  const rowIndex = Math.min(t.row_index ?? 0, subRows - 1);
                  const rowSpan = Math.max(1, Math.min(t.row_span ?? 1, subRows - rowIndex));
                  const isRedacted = !!t.redacted;
                  return (
                    <div
                      key={t.id}
                      className={
                        "tl-bar" +
                        (compact ? " compact" : "") +
                        (t.done ? " done" : "") +
                        (!t.fixed ? " tentative" : "") +
                        (readOnly ? " readonly" : "") +
                        (isRedacted ? " redacted" : "")
                      }
                      style={{
                        left: clampedStart * DAY_W + BAR_INSET,
                        width: clampedSpan * DAY_W - BAR_INSET * 2,
                        top: m.lanePad + rowIndex * m.subH,
                        height: rowSpan * m.barH + (rowSpan - 1) * m.barGap,
                        background: t.color,
                        fontSize: m.fontSize,
                      }}
                      onPointerDown={(e) => startDrag(e, t, "move")}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (readOnly && !isRedacted) onTaskClick(t);
                      }}
                      onMouseMove={(e) => {
                        if (drag || isRedacted) return;
                        setHover({ task: t, x: e.clientX, y: e.clientY });
                      }}
                      onMouseLeave={() => setHover(null)}
                    >
                      {!isRedacted && (
                        <>
                          <div
                            className="tl-handle left"
                            onPointerDown={(e) => startDrag(e, t, "resize-start")}
                          />
                          <span className="tl-bar-title">{t.title}</span>
                          <div
                            className="tl-handle right"
                            onPointerDown={(e) => startDrag(e, t, "resize-end")}
                          />
                          {subRows > 1 && (
                            <>
                              <div
                                className="tl-handle-v top"
                                onPointerDown={(e) => startDrag(e, t, "resize-top")}
                              />
                              <div
                                className="tl-handle-v bottom"
                                onPointerDown={(e) => startDrag(e, t, "resize-bottom")}
                              />
                            </>
                          )}
                        </>
                      )}
                    </div>
                  );
                })}
                <BlurOverlays
                  dayWidth={DAY_W}
                  restrict={restrictVisibility}
                  passthrough={fullView}
                  visibleMinIdx={visibleMinIdx}
                  visibleMaxIdx={visibleMaxIdx}
                  dayCount={days.length}
                />
              </div>
            </div>
          );
        })}
        <CursorLayer
          days={days}
          rangeStart={rangeStart}
          labelW={LABEL_W}
          dayWidth={DAY_W}
          lanes={lanes}
          tasks={tasks}
          containerRef={scrollRef}
          innerRef={innerRef}
          laneRowRefs={laneRowRefs}
          watchedIds={watchedCursorIds}
          focus={cursorFocus}
        />
      </div>
      {hover && !drag && (
        <div
          className="tl-tooltip"
          style={{
            left: Math.min(hover.x + 14, window.innerWidth - 340),
            top: Math.min(hover.y + 16, window.innerHeight - 120),
          }}
        >
          <div className="tt-title">{hover.task.title}</div>
          {hover.task.notes && <div className="tt-notes">{hover.task.notes}</div>}
        </div>
      )}
    </div>
  );
}
