// 1両の中の席（立ち位置を含む）の並び。強化（二階建て・ドア増設・定員）に合わせて作り直す。

import { CAR_LEN } from './data.ts';
import type { Stats } from './upgrades.ts';

export interface SlotDef {
  deck: number;
  /** 車両の後端からの位置 [m] */
  x: number;
  /** 車両の中心線からの横位置 [m]（+ がホーム側） */
  y: number;
  /** 座席なら true、立ち位置なら false */
  seat: boolean;
  row: number;
}

const ROW_Y = [-0.88, -0.3, 0.3, 0.88];
export const DOOR_HALF = 0.62;

export function decksOf(st: Stats): number {
  return 1 + (st.levels['capacity'] ?? 0);
}

export function doorXs(st: Stats): number[] {
  const n = st.doorsPerCar;
  const out: number[] = [];
  for (let j = 0; j < n; j++) out.push(((j + 0.5) * CAR_LEN) / n);
  return out;
}

export function inDoorZone(x: number, doors: number[]): boolean {
  return doors.some((d) => Math.abs(d - x) < DOOR_HALF + 0.1);
}

export function layoutKey(st: Stats): string {
  return `${decksOf(st)}/${st.doorsPerCar}/${st.capPerCar}`;
}

export function buildLayout(st: Stats): SlotDef[] {
  const decks = decksOf(st);
  const perDeck = Math.ceil(st.capPerCar / decks);
  const cols = Math.max(4, Math.ceil(perDeck / 4));
  const span = CAR_LEN - 1.2;
  const dx = span / cols;
  const doors = doorXs(st);
  const out: SlotDef[] = [];
  for (let d = 0; d < decks; d++) {
    const cells: (SlotDef & { p: number; c: number })[] = [];
    for (let c = 0; c < cols; c++) {
      const x = 0.6 + (c + 0.5) * dx;
      for (let r = 0; r < 4; r++) {
        const wall = r === 0 || r === 3;
        // 二階には乗降ドアがないので座席を置ける
        const door = d === 0 && inDoorZone(x, doors);
        const seat = wall && !door;
        const p = seat ? 0 : wall ? 2 : 1;
        cells.push({ deck: d, x, y: ROW_Y[r], seat, row: r, p, c });
      }
    }
    cells.sort((a, b) => a.p - b.p || Math.abs(a.x - CAR_LEN / 2) - Math.abs(b.x - CAR_LEN / 2) || a.row - b.row);
    for (const cell of cells.slice(0, perDeck)) out.push({ deck: cell.deck, x: cell.x, y: cell.y, seat: cell.seat, row: cell.row });
  }
  return out;
}
