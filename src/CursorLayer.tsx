import { Fragment, useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { CursorFocus, CursorPos, Lane, RemoteCursor, Task } from "./types";
import type { DayInfo } from "./dates";
import { diffDays } from "./dates";
import { cursorColor } from "./cursorColor";
import { BAR_INSET, DAY_W, laneMetrics } from "./timelineMetrics";

/** Sende-/Abhol-Intervall. Zusammen mit der CSS-Transition auf dem Cursor
 *  ergibt das eine flüssige Bewegung ohne Websocket-Infrastruktur. */
const POLL_MS = 250;

interface Props {
  days: DayInfo[];
  rangeStart: string;
  labelW: number;
  lanes: Lane[];
  tasks: Task[];
  /** Scroll-Container der Timeline */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** Gesamter Timeline-Inhalt (für Y-Koordinaten) */
  innerRef: React.RefObject<HTMLDivElement | null>;
  /** Zeilen-Elemente für Fokus-Umrandungen */
  laneRowRefs: React.MutableRefObject<Map<number, HTMLDivElement>>;
  watchedIds: Set<number>;
  /** Eigener Fokus (geöffnetes Modal) an andere melden */
  focus: CursorFocus | null;
}

/** Berechnet die Bildschirm-Rect für eine Aufgabe oder Zellauswahl */
function focusRect(
  focus: CursorFocus,
  tasks: Task[],
  lanes: Lane[],
  days: DayInfo[],
  rangeStart: string,
  labelW: number,
  laneRowRefs: Map<number, HTMLDivElement>
): { left: number; top: number; width: number; height: number } | null {
  if (focus.kind === "task") {
    const task = tasks.find((t) => t.id === focus.taskId);
    if (!task) return null;
    const lane = lanes.find((l) => l.id === task.lane_id);
    const laneEl = laneRowRefs.get(task.lane_id);
    if (!lane || !laneEl) return null;
    const startIdx = diffDays(rangeStart, task.start_date);
    const span = diffDays(task.start_date, task.end_date) + 1;
    const clampedStart = Math.max(startIdx, 0);
    const clampedSpan = Math.min(startIdx + span, days.length) - clampedStart;
    if (clampedSpan <= 0) return null;
    const subRows = Math.max(1, lane.sub_rows ?? 1);
    const m = laneMetrics(!!lane.compact);
    const rowIndex = Math.min(task.row_index ?? 0, subRows - 1);
    const rowSpan = Math.max(1, Math.min(task.row_span ?? 1, subRows - rowIndex));
    return {
      left: labelW + clampedStart * DAY_W + BAR_INSET,
      top: laneEl.offsetTop + m.lanePad + rowIndex * m.subH,
      width: clampedSpan * DAY_W - BAR_INSET * 2,
      height: rowSpan * m.barH + (rowSpan - 1) * m.barGap,
    };
  }
  const lane = lanes.find((l) => l.id === focus.lane);
  const laneEl = laneRowRefs.get(focus.lane);
  if (!lane || !laneEl) return null;
  const startIdx = diffDays(rangeStart, focus.start);
  const endIdx = diffDays(rangeStart, focus.end);
  if (startIdx < 0 || endIdx >= days.length) return null;
  const m = laneMetrics(!!lane.compact);
  const rowIndex = Math.min(focus.rowIndex, (lane.sub_rows ?? 1) - 1);
  const rowSpan = Math.max(1, focus.rowSpan);
  return {
    left: labelW + startIdx * DAY_W + 1,
    top: laneEl.offsetTop + m.lanePad + rowIndex * m.subH - 1,
    width: (endIdx - startIdx + 1) * DAY_W - 2,
    height: rowSpan * m.barH + (rowSpan - 1) * m.barGap + 2,
  };
}

/**
 * Live-Cursor à la Figma/Miro: Position raster-basiert (Datum + absolute Y),
 * Fokus-Markierung wenn jemand eine Aufgabe/Zelle anklickt.
 */
export function CursorLayer({
  days,
  rangeStart,
  labelW,
  lanes,
  tasks,
  containerRef,
  innerRef,
  laneRowRefs,
  watchedIds,
  focus,
}: Props) {
  const [remote, setRemote] = useState<RemoteCursor[]>([]);
  const posRef = useRef<CursorPos | null>(null);
  const lastDayRef = useRef<{ d: string; df: number } | null>(null);
  const focusRef = useRef(focus);
  focusRef.current = focus;

  // Zeiger über der gesamten Timeline verfolgen – nicht nur über einzelne
  // Lane-Zellen (sonst Flackern an Trennlinien und unterhalb der letzten Zeile).
  useEffect(() => {
    const scrollEl = containerRef.current;
    const innerEl = innerRef.current;
    if (!scrollEl || !innerEl) return;

    const onMove = (e: PointerEvent) => {
      const innerRect = innerEl.getBoundingClientRect();
      const y = e.clientY - innerRect.top;

      const daysLeft = innerRect.left + labelW;
      if (e.clientX >= daysLeft) {
        const dayFloat = (e.clientX - daysLeft) / DAY_W;
        const idx = Math.floor(dayFloat);
        if (idx >= 0 && idx < days.length) {
          lastDayRef.current = { d: days[idx].iso, df: dayFloat - idx };
        }
      }

      if (lastDayRef.current) {
        posRef.current = { ...lastDayRef.current, y: Math.max(0, y) };
      }
    };
    const onLeave = () => {
      posRef.current = null;
    };

    scrollEl.addEventListener("pointermove", onMove);
    scrollEl.addEventListener("pointerleave", onLeave);
    return () => {
      scrollEl.removeEventListener("pointermove", onMove);
      scrollEl.removeEventListener("pointerleave", onLeave);
    };
  }, [containerRef, innerRef, days, labelW]);

  // Melden + Abholen
  useEffect(() => {
    let stopped = false;
    const tick = async () => {
      try {
        const pos = document.hidden ? null : posRef.current;
        const r = await api.cursors(pos, focusRef.current);
        if (!stopped) setRemote(r.cursors);
      } catch {
        /* ignorieren */
      }
    };
    tick();
    const id = window.setInterval(tick, POLL_MS);
    return () => {
      stopped = true;
      window.clearInterval(id);
    };
  }, []);

  const visible = remote.filter((c) => watchedIds.has(c.id));
  if (visible.length === 0) return null;

  return (
    <div className="cursor-layer">
      {visible.map((c) => {
        const color = cursorColor(c.id);
        const dayIdx = diffDays(rangeStart, c.d);
        const showCursor = dayIdx >= 0 && dayIdx < days.length;
        const x = labelW + (dayIdx + c.df) * DAY_W;
        const rect = c.focus
          ? focusRect(c.focus, tasks, lanes, days, rangeStart, labelW, laneRowRefs.current)
          : null;

        return (
          <Fragment key={c.id}>
            {rect && (
              <div
                className="remote-focus"
                style={{
                  left: rect.left,
                  top: rect.top,
                  width: rect.width,
                  height: rect.height,
                  borderColor: color,
                  boxShadow: `0 0 0 1px ${color}55, 0 0 8px ${color}44`,
                }}
              />
            )}
            {showCursor && (
              <div
                className="remote-cursor"
                style={{ transform: `translate(${x}px, ${c.y}px)` }}
              >
                <svg width="18" height="20" viewBox="0 0 18 20">
                  <path
                    d="M1 1 L16 11.5 L9 12.5 L5.5 19 Z"
                    fill={color}
                    stroke="#fff"
                    strokeWidth="1.2"
                  />
                </svg>
                <span className="remote-cursor-label" style={{ background: color }}>
                  {c.username}
                </span>
              </div>
            )}
          </Fragment>
        );
      })}
    </div>
  );
}
