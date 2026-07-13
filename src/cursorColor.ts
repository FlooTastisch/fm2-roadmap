/** Kräftige, gut unterscheidbare Farben für Live-Cursor und Avatar-Ringe.
 *  Die Zuordnung über die Benutzer-ID ist deterministisch – jeder Client
 *  sieht denselben Benutzer in derselben Farbe. */
const CURSOR_COLORS = [
  "#e11d48", // Rot
  "#7c3aed", // Violett
  "#0891b2", // Türkis
  "#16a34a", // Grün
  "#d97706", // Orange
  "#db2777", // Pink
  "#2563eb", // Blau
  "#65a30d", // Oliv
];

export function cursorColor(userId: number) {
  return CURSOR_COLORS[userId % CURSOR_COLORS.length];
}
