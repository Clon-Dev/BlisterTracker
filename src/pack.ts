import { addDays, cycleLength, isTaken, slot, weekday, type DayKind, type Plan } from "../shared/schedule";

export type CellState = "taken" | "missed" | "today" | "future" | "past";
export type Cell = { day: string; kind: DayKind; state: CellState };

/** One cell per day of the pack containing `today` (pills, then break days), for the blister view. */
export function packCells(p: Plan, today: string) {
  const { packStart } = slot(p, today);
  const cells: Cell[] = Array.from({ length: cycleLength(p) }, (_, i) => {
    const day = addDays(packStart, i);
    const kind = slot(p, day).kind;
    const when = day < today ? "past" : day === today ? "today" : "future";
    const state: CellState = kind === "break" ? when : isTaken(p, day) ? "taken" : when === "past" ? "missed" : when;
    return { day, kind, state };
  });
  return { cells, startWeekday: weekday(packStart) };
}

/** Pill days of the past `days` days (excluding today) that were not marked. */
export function missedDays(p: Plan, today: string, days: number) {
  return Array.from({ length: days }, (_, i) => addDays(today, -(i + 1)))
    .filter((d) => slot(p, d).kind !== "break" && !isTaken(p, d));
}
