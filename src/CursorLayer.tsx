import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { CursorPos, RemoteCursor } from "./types";
import type { DayInfo } from "./dates";
import { diffDays } from "./dates";
import { cursorColor } from "./cursorColor";

/** Sende-/Abhol-Intervall. Zusammen mit der CSS-Transition auf dem Cursor
 *  ergibt das eine flüssige Bewegung ohne Websocket-Infrastruktur. */
const POLL_MS = 250;

interface Props {
  days: DayInfo[];
  rangeStart: string;
  dayW: number;
  labelW: number;
  /** Scroll-Container der Timeline (für das Pointer-Tracking) */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** Zeilen-Elemente, um Zeiger-Position ↔ Raster-Position umzurechnen */
  laneRowRefs: React.MutableRefObject<Map<number, HTMLDivElement>>;
  /** Benutzer, deren Cursor angezeigt werden sollen */
  watchedIds: Set<number>;
}

/**
 * Live-Cursor à la Figma/Miro: Die eigene Zeiger-Position wird raster-basiert
 * (Datum + Zeile + Anteil) an den Server gemeldet und die der anderen abgeholt.
 * Dadurch stimmt die Position auch bei unterschiedlichen Scroll-Positionen,
 * Fenstergrößen und Sichtfenstern. Gerendert wird in Inhalts-Koordinaten des
 * Scroll-Containers, sodass die Cursor beim Scrollen natürlich mitwandern.
 */
export function CursorLayer({
  days,
  rangeStart,
  dayW,
  labelW,
  containerRef,
  laneRowRefs,
  watchedIds,
}: Props) {
  const [remote, setRemote] = useState<RemoteCursor[]>([]);
  const posRef = useRef<CursorPos | null>(null);

  // Eigene Zeiger-Position über dem Raster verfolgen
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onMove = (e: PointerEvent) => {
      for (const [laneId, laneEl] of laneRowRefs.current) {
        const rect = laneEl.getBoundingClientRect();
        if (
          e.clientY >= rect.top &&
          e.clientY <= rect.bottom &&
          e.clientX >= rect.left &&
          e.clientX <= rect.right
        ) {
          const dayFloat = (e.clientX - rect.left) / dayW;
          const idx = Math.floor(dayFloat);
          if (idx < 0 || idx >= days.length) break;
          posRef.current = {
            d: days[idx].iso,
            df: dayFloat - idx,
            lane: laneId,
            lf: (e.clientY - rect.top) / rect.height,
          };
          return;
        }
      }
      posRef.current = null;
    };
    const onLeave = () => {
      posRef.current = null;
    };

    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", onLeave);
    return () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeave);
    };
  }, [containerRef, laneRowRefs, days, dayW]);

  // Melden + Abholen in einem Rutsch
  useEffect(() => {
    let stopped = false;
    const tick = async () => {
      try {
        // Tab im Hintergrund: eigene Position löschen, nichts abholen
        const pos = document.hidden ? null : posRef.current;
        const r = await api.cursors(pos);
        if (!stopped) setRemote(r.cursors);
      } catch {
        /* ignorieren – nächster Versuch beim folgenden Intervall */
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
        const laneEl = laneRowRefs.current.get(c.lane);
        if (!laneEl) return null;
        const dayIdx = diffDays(rangeStart, c.d);
        if (dayIdx < 0 || dayIdx >= days.length) return null;
        const x = labelW + (dayIdx + c.df) * dayW;
        const y = laneEl.offsetTop + c.lf * laneEl.offsetHeight;
        const color = cursorColor(c.id);
        return (
          <div
            key={c.id}
            className="remote-cursor"
            style={{ transform: `translate(${x}px, ${y}px)` }}
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
        );
      })}
    </div>
  );
}
