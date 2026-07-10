export interface TaskColorDef {
  hex: string;
  abbrev: string;
  label: string;
  projects: string[];
  signal: boolean;
  description?: string;
}

export const TASK_COLORS: TaskColorDef[];
export const DEFAULT_TASK_COLOR: string;

export function normalizeTaskColorHex(color: string | undefined | null): string;
export function isValidTaskColor(color: string | undefined | null): boolean;
export function taskColorByHex(color: string | undefined | null): TaskColorDef | null;
export function resolveTaskColor(color: string | undefined | null): string;
