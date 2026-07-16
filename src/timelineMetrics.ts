/** Normale und vergrößerte Breite der Tageskacheln (umschaltbar pro Benutzer) */
export const DAY_W = 26;
export const DAY_W_WIDE = 52;
export const LANE_PAD = 3;
/** Horizontaler Innenabstand der Aufgaben-Balken (links + rechts, symmetrisch) */
export const BAR_INSET = 2;

/** Maße für normale und kompakte Unterzeilen (ca. 25 % niedriger) */
export function laneMetrics(compact: boolean) {
  if (compact) {
    return { barH: 14, barGap: 2, lanePad: 2, subH: 16, fontSize: 10 };
  }
  return { barH: 18, barGap: 3, lanePad: LANE_PAD, subH: 21, fontSize: 11 };
}

export function laneRowHeight(subRows: number, compact: boolean) {
  const m = laneMetrics(compact);
  return m.lanePad * 2 + subRows * m.barH + (subRows - 1) * m.barGap;
}
