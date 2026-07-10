import {
  DEFAULT_TASK_COLOR,
  TASK_COLORS,
  isValidTaskColor,
  normalizeTaskColorHex,
  resolveTaskColor,
  taskColorByHex,
} from "../shared/taskColors.js";

export type TaskColorDef = (typeof TASK_COLORS)[number];

export {
  TASK_COLORS,
  DEFAULT_TASK_COLOR,
  isValidTaskColor,
  normalizeTaskColorHex,
  resolveTaskColor,
  taskColorByHex,
};

export function pickTaskColor(value: string | undefined) {
  return resolveTaskColor(value);
}
