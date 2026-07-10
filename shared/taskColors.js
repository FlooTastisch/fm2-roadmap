/**
 * Offizielle Task-Farben der FM2-Roadmap.
 * Zentrale Quelle für UI, API-Validierung und spätere KI-/Analytics-Auswertungen.
 */
export const TASK_COLORS = [
  {
    hex: "#6FA8DC",
    abbrev: "BB",
    label: "BlockBande",
    projects: ["BlockBande"],
    signal: false,
  },
  {
    hex: "#FFD965",
    abbrev: "LCB",
    label: "Landania CityBuild",
    projects: ["Landania CityBuild"],
    signal: false,
  },
  {
    hex: "#F6B26A",
    abbrev: "LR",
    label: "Landania Realms",
    projects: ["Landania Realms"],
    signal: false,
  },
  {
    hex: "#B8E1CC",
    abbrev: "LR+CB",
    label: "Landania Realms & CityBuild",
    projects: ["Landania Realms", "Landania CityBuild"],
    signal: false,
  },
  {
    hex: "#B4A7D6",
    abbrev: "BB·LR·LCB",
    label: "BlockBande, Landania Realms & Landania CityBuild",
    projects: ["BlockBande", "Landania Realms", "Landania CityBuild"],
    signal: false,
  },
  {
    hex: "#ff0000",
    abbrev: "SIG",
    label: "Sondermarkierung",
    projects: [],
    signal: true,
    description:
      "Signalfarbe für Sondermarkierungen – keine feste Projektzuordnung über die Farbe",
  },
  {
    hex: "#CCCCCC",
    abbrev: "ABW",
    label: "Abwesenheit",
    projects: [],
    signal: false,
    description: "Feiertage, Urlaub und andere Abwesenheiten",
  },
];

export const DEFAULT_TASK_COLOR = TASK_COLORS[0].hex;

const HEX_ALIASES = {
  "#f00": "#ff0000",
  "#ccc": "#cccccc",
};

export function normalizeTaskColorHex(color) {
  const raw = String(color ?? "").trim().toLowerCase();
  if (!raw) return DEFAULT_TASK_COLOR.toLowerCase();
  const withHash = raw.startsWith("#") ? raw : `#${raw}`;
  return HEX_ALIASES[withHash] ?? withHash;
}

const ALLOWED = new Set(TASK_COLORS.map((c) => c.hex.toLowerCase()));

export function isValidTaskColor(color) {
  return ALLOWED.has(normalizeTaskColorHex(color));
}

export function taskColorByHex(color) {
  const norm = normalizeTaskColorHex(color);
  return TASK_COLORS.find((c) => c.hex.toLowerCase() === norm) ?? null;
}

export function resolveTaskColor(color) {
  return taskColorByHex(color)?.hex ?? DEFAULT_TASK_COLOR;
}
