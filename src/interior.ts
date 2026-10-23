// 車内の視点：1両だけを大きく。車体のガワを外した見た目で、二階建ては真上に浮かせる。

import { CAR_LEN, DEST_COLORS } from './data.ts';
import { carColor } from './exterior.ts';
import { carsOnPlatform, type Game, type Passenger } from './game.ts';
import { C30, INK, Iso, shade } from './iso.ts';
import { drawPerson, type Facing, type PersonHit } from './people.ts';
import { decksOf, doorXs, DOOR_HALF, type SlotDef } from './seats.ts';

const L = CAR_LEN;
const W = 2.6;
const DECK_GAP = 5.6;
const MOQ = '#6FBF95';
const MOQ_BACK = '#5DAA84';
const BENCH = '#B3A68E';
const FLOOR = '#EADFC8';

export interface DragState {
  id: number;
  sx: number;
  sy: number;
}

export interface InteriorHit {
  id: number;
  sx: number;
  sy: number;
  r: number;
}

let slide = 0;
let lastFocus = -1;

/** 車両を切り替えたときの横すべりアニメ */
export function noteFocusChange(from: number, to: number): void {
  if (from >= 0 && from !== to) slide = to > from ? 1 : -1;
}

export function drawInterior(
  ctx: CanvasRenderingContext2D,
  g: Game,
  focus: number,
  w: number,
  top: number,
  bottom: number,
  drag: DragState | null,
  dt: number,
): InteriorHit[] {
  if (lastFocus !== focus) lastFocus = focus;
  slide *= Math.pow(0.001, dt);
  if (Math.abs(slide) < 0.002) slide = 0;

  const decks = decksOf(g.stats);
  const needH = (L + W) * 0.5 + 2.4 + (decks - 1) * DECK_GAP + 2.4;
  const byW = (w - 24) / ((L + W) * C30);
  const byH = (bottom - top - 16) / needH;
  const s = Math.max(8, Math.min(byW, byH, 40));
  // 車両の中心を画面の中央に。二階の分だけ上へずらす
  const midZ = ((decks - 1) * DECK_GAP) / 2 + 0.6;
  const cxs = w / 2 + slide * w * 0.9;
  const cys = (top + bottom) / 2 - 6;
  const iso = new Iso(ctx, s, cxs - (L / 2) * C30 * s, cys - (L / 2) * 0.5 * s + midZ * s);

  // 線路（走っていると枕木が流れる）
  const off = ((g.x % 1.2) + 1.2) % 1.2;
  iso.rectZ(-6, L + 6, -1.9, 1.9, -1.32, '#E6DCC8', 0);
  for (let x = -6 - off; x < L + 6; x += 1.2) iso.rectZ(x, x + 0.42, -1.5, 1.5, -1.3, '#D6CBB6', 0);
  iso.rectZ(-6, L + 6, -0.72, -0.56, -1.22, '#B9B0A2', 0);
  iso.rectZ(-6, L + 6, 0.56, 0.72, -1.22, '#B9B0A2', 0);

  // 次の駅（停車中はこの駅）でドアが開くか
  const st = g.line.stations[g.target];
  const opens = focus < carsOnPlatform(g);
  if (opens) {
    iso.poly([[-0.4, 1.9, -0.02], [L + 0.4, 1.9, -0.02], [L + 0.4, 3.4, -0.02], [-0.4, 3.4, -0.02]], 'rgba(166,220,195,0.55)', 1.4);
    iso.label(L / 2 + 1, 3.2, 0, `${st.name}でドアが開く`, 13, '#2E6B53');
  } else {
    ctx.setLineDash([6, 4]);
    iso.poly([[-0.4, 1.9, -0.02], [L + 0.4, 1.9, -0.02], [L + 0.4, 3.1, -0.02], [-0.4, 3.1, -0.02]], 'rgba(228,85,58,0.14)', 1.8, '#B53E28');
    ctx.setLineDash([]);
    iso.label(L / 2 + 1, 3.0, 0, `${st.name}ではドアが開かない`, 13, '#B53E28');
  }

  const color = carColor(focus);
  const people = g.passengers.filter((p) => p.car === focus);
  const hits: InteriorHit[] = [];
  for (let d = 0; d < decks; d++) {
    const Z = d * DECK_GAP;
    if (d > 0) {
      ctx.setLineDash([4, 5]);
      for (const [cx, cy] of [[0, -1.3], [L, -1.3], [L, 1.3], [0, 1.3]] as [number, number][]) {
        iso.line([cx, cy, Z - DECK_GAP + 0.34], [cx, cy, Z - 0.3], '#9A8064', 1.3);
      }
      ctx.setLineDash([]);
    }
    drawDeck(iso, g, d, Z, color, people, drag, hits);
    if (d > 0) iso.label(1.2, -1.6, Z + 2.6, `${d + 1}階`, 13, '#5A5045');
  }
  iso.label(L + 1.4, 0.4, -0.6, `${focus + 1}号車`, 15, INK);

  // 持ち上げている人（指のところ）
  if (drag) {
    const p = g.passengers.find((q) => q.id === drag.id);
    if (p) {
      const fs = Math.min(s, 26);
      const di = new Iso(ctx, fs, drag.sx, drag.sy + 1.4 * fs);
      drawPerson(di, 0, 0, 0, p.look, { pose: 'stand', facing: 0, lift: 0.25 });
      tag(ctx, drag.sx, drag.sy - 0.25 * fs - 1.9 * fs, p, g, 0);
    }
  }
  return hits;
}

function drawDeck(iso: Iso, g: Game, deck: number, Z: number, color: string, people: Passenger[], drag: DragState | null, hits: InteriorHit[]): void {
  const lower = deck === 0;
  const doors = lower ? doorXs(g.stats) : [];
  const slots = g.layout;
  // 台車と床下
  if (lower) {
    iso.box(1.6, 3.8, -1.0, 1.0, Z - 1.0, Z - 0.42, '#2B2824');
    iso.box(L - 3.8, L - 1.6, -1.0, 1.0, Z - 1.0, Z - 0.42, '#2B2824');
    const motors = Math.min(4, 1 + (g.stats.levels['motor'] ?? 0));
    for (let m = 0; m < motors; m++) iso.box(4.6 + m * 0.75, 5.2 + m * 0.75, -0.8, 0.8, Z - 0.75, Z - 0.3, '#6B655C');
    const spin = g.x / 0.45;
    for (const wx of [2.1, 3.3, L - 3.3, L - 2.1]) {
      const [px, py] = iso.P(wx, 1.02, Z - 0.92);
      iso.ell(px, py, 0.36 * iso.s, 0.36 * iso.s, '#3A3631', iso.lw);
      iso.ell(px + Math.cos(spin) * 0.18 * iso.s, py + Math.sin(spin) * 0.18 * iso.s, 0.07 * iso.s, 0.07 * iso.s, '#9A9184', 0);
    }
    if ((g.stats.levels['brake'] ?? 0) > 0) {
      for (const wx of [2.7, L - 2.7]) iso.box(wx - 0.18, wx + 0.18, 1.0, 1.08, Z - 1.05, Z - 0.75, '#E4553A', { lw: iso.lw * 0.7 });
    }
  }
  // 床
  iso.box(0, L, -1.3, 1.3, Z - 0.28, Z, color, { top: FLOOR, sx: shade(color, 0.72), sy: shade(color, 0.88) });
  for (let sl = 2; sl < L; sl += 2) iso.line([sl, -1.25, Z + 0.002], [sl, 1.25, Z + 0.002], 'rgba(31,27,22,0.12)', 1);
  for (const d of doors) {
    iso.rectZ(d - DOOR_HALF, d + DOOR_HALF, 1.04, 1.3, Z + 0.004, '#E9B23E', 0);
    iso.rectZ(d - DOOR_HALF, d + DOOR_HALF, -1.3, -1.04, Z + 0.004, '#E9B23E', 0);
  }
  // 奥の腰壁と座席
  iso.box(0, L, -1.3, -1.2, Z, Z + 0.32, color, { lw: iso.lw * 0.8 });
  const segs = benchSegments(slots, deck);
  for (const [a, b] of segs) {
    iso.box(a, b, -1.2, -0.78, Z, Z + 0.4, BENCH, { lw: iso.lw * 0.8 });
    iso.box(a, b, -1.2, -0.74, Z + 0.4, Z + 0.52, MOQ, { lw: iso.lw * 0.8 });
    iso.box(a, b, -1.2, -1.05, Z + 0.52, Z + 1.0, MOQ_BACK, { lw: iso.lw * 0.8 });
  }
  const mine = people.filter((p) => slots[p.slot]?.deck === deck);
  const rowOf = (p: Passenger) => slots[p.slot]?.row ?? 1;
  const drawP = (p: Passenger) => {
    if (drag && drag.id === p.id) {
      const sl = slots[p.slot];
      iso.ctx.setLineDash([3, 3]);
      const [ex, ey] = iso.P(sl.x, sl.y, Z + 0.01);
      iso.ell(ex, ey, 0.4 * iso.s * 1.22, 0.4 * iso.s * 0.7, null, 1.8, '#9A8064');
      iso.ctx.setLineDash([]);
      return;
    }
    personAt(iso, g, p, slots[p.slot], Z, hits);
  };
  mine.filter((p) => rowOf(p) === 0).sort((a, b) => slots[a.slot].x - slots[b.slot].x).forEach(drawP);
  // 通路の立ち客と手すり
  const mid: { d: number; f: () => void }[] = [];
  for (const p of mine) if (rowOf(p) === 1 || rowOf(p) === 2) mid.push({ d: slots[p.slot].x + slots[p.slot].y, f: () => drawP(p) });
  for (const [a, b] of segs) {
    for (const [px, py] of [[a - 0.05, -0.72], [b + 0.05, -0.72], [a - 0.05, 0.72], [b + 0.05, 0.72]] as [number, number][]) {
      mid.push({ d: px + py + (py > 0 ? 0.4 : 0), f: () => pole(iso, px, py, Z) });
    }
  }
  mid.sort((a, b) => a.d - b.d).forEach((m) => m.f());
  for (const [a, b] of segs) {
    iso.box(a, b, 0.78, 1.2, Z, Z + 0.4, BENCH, { lw: iso.lw * 0.8 });
    iso.box(a, b, 0.74, 1.2, Z + 0.4, Z + 0.52, MOQ, { lw: iso.lw * 0.8 });
  }
  mine.filter((p) => rowOf(p) === 3).sort((a, b) => slots[a.slot].x - slots[b.slot].x).forEach(drawP);
  // 手前の背もたれは低め（奥の通路が隠れないように）
  for (const [a, b] of segs) iso.box(a, b, 1.08, 1.2, Z + 0.52, Z + 0.74, MOQ_BACK, { lw: iso.lw * 0.8 });
  // 手前の腰壁（ドアのところは切れている）
  let px0 = 0;
  for (const c of [...doors.map((d) => [d - DOOR_HALF, d + DOOR_HALF]), [L, L]]) {
    if (c[0] - px0 > 0.05) iso.box(px0, c[0], 1.2, 1.3, Z, Z + 0.32, color, { lw: iso.lw * 0.8 });
    px0 = c[1];
  }
  iso.box(L - 0.1, L, -1.2, 1.2, Z, Z + 0.32, color, { lw: iso.lw * 0.8 });
  // 吊り手
  for (const ry of [-0.72, 0.72]) {
    iso.line([0.4, ry, Z + 2.05], [L - 0.4, ry, Z + 2.05], '#9A9184', Math.max(1, iso.s * 0.07));
    for (let sx = 1.0; sx < L - 0.6; sx += 1.3) {
      iso.line([sx, ry, Z + 2.05], [sx, ry, Z + 1.82], '#9A9184', 1);
      const [rx, rpy] = iso.P(sx, ry, Z + 1.76);
      iso.ell(rx, rpy, 0.07 * iso.s, 0.07 * iso.s, null, 1.3, '#FFFDF6');
    }
  }
}

function personAt(iso: Iso, g: Game, p: Passenger, sl: SlotDef, Z: number, hits: InteriorHit[]): void {
  const facing: Facing = sl.seat ? (sl.row === 0 ? 2 : 3) : p.face ? 1 : 0;
  const fy = sl.seat ? (sl.row === 0 ? 0.55 : -0.55) : 0;
  const [mx, my] = iso.P(sl.x, sl.y + fy, Z + 0.006);
  iso.ell(mx, my, 0.2 * iso.s * 1.22, 0.2 * iso.s * 0.7, DEST_COLORS[p.dest] ?? '#B9B0A2', iso.lw * 0.8);
  const pop = Math.min(1, Math.max(0, (g.time - p.t) / 0.35));
  const h: PersonHit = drawPerson(iso, sl.x, sl.y, Z, p.look, { pose: sl.seat ? 'sit' : 'stand', facing, pop });
  hits.push({ id: p.id, sx: h.sx, sy: h.sy, r: h.r });
  if (p.dest === g.target) tag(iso.ctx, h.hx, h.hy - h.hr * 2.3, p, g, Math.sin(g.time * 5 + p.id) * 2);
}

/** 次で降りる客の頭の上の札 */
function tag(ctx: CanvasRenderingContext2D, x: number, y: number, p: Passenger, g: Game, bob: number): void {
  const stuck = p.car >= carsOnPlatform(g) && p.dest === g.target;
  const name = g.line.stations[p.dest]?.name ?? '';
  const text = name.slice(0, 1) + (stuck ? '！' : '');
  const bg = stuck ? '#E4553A' : DEST_COLORS[p.dest] ?? '#E9B23E';
  const fg = stuck ? '#FFFDF6' : INK;
  y -= bob;
  ctx.font = '900 12px "Zen Maru Gothic", sans-serif';
  const tw = Math.max(22, ctx.measureText(text).width + 12);
  ctx.beginPath();
  ctx.moveTo(x - tw / 2, y - 18);
  ctx.lineTo(x + tw / 2, y - 18);
  ctx.lineTo(x + tw / 2, y);
  ctx.lineTo(x + 4, y);
  ctx.lineTo(x, y + 5);
  ctx.lineTo(x - 4, y);
  ctx.lineTo(x - tw / 2, y);
  ctx.closePath();
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1.6;
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.fillStyle = fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y - 8.5);
}

function pole(iso: Iso, x: number, y: number, Z: number): void {
  const w = 0.12 * iso.s;
  iso.line([x, y, Z], [x, y, Z + 2.05], INK, w + 1.4);
  iso.line([x, y, Z], [x, y, Z + 2.05], '#D8D2C6', Math.max(0.5, w - 0.4));
}

/** 座席の並び（ドアのところで切れる）。両端の x の組 */
function benchSegments(slots: SlotDef[], deck: number): [number, number][] {
  const xs = slots.filter((s) => s.deck === deck && s.row === 0).sort((a, b) => a.x - b.x);
  const all = [...new Set(slots.filter((s) => s.deck === deck).map((s) => s.x))].sort((a, b) => a - b);
  const seatX = new Set(xs.filter((s) => s.seat).map((s) => s.x));
  const half = all.length > 1 ? (all[1] - all[0]) / 2 : 0.65;
  const segs: [number, number][] = [];
  let cur: [number, number] | null = null;
  for (const x of all) {
    if (seatX.has(x)) {
      if (!cur) cur = [x - half, x + half];
      else cur[1] = x + half;
    } else if (cur) {
      segs.push(cur);
      cur = null;
    }
  }
  if (cur) segs.push(cur);
  return segs;
}

/** 車内のヘッダー（次の駅と、降りる駅の色の凡例） */
export function drawInteriorHeader(ctx: CanvasRenderingContext2D, g: Game, w: number, top: number): void {
  const st = g.line.stations[g.target];
  const pad = 16;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#5A5045';
  ctx.font = '700 12px "Zen Maru Gothic", sans-serif';
  const remain = g.pos[g.target] - g.x;
  ctx.fillText(
    g.phase === 'running' ? `次は ${st.name}　あと${Math.max(0, Math.round(remain))}m・${Math.round(g.v * 3.6)}km/h` : `${st.name}　停車中`,
    pad,
    top,
  );
  ctx.fillStyle = INK;
  ctx.font = '26px "Dela Gothic One", sans-serif';
  ctx.fillText('車内', pad, top + 18);
  // 凡例
  let x = pad;
  const y = top + 62;
  ctx.font = '900 11px "Zen Maru Gothic", sans-serif';
  ctx.fillStyle = '#5A5045';
  ctx.fillText('降りる駅', x, y - 6);
  x += 56;
  for (let i = g.target; i < g.line.stations.length; i++) {
    if (i === 0) continue;
    const name = g.line.stations[i].name;
    const tw = ctx.measureText(name).width;
    if (x + tw + 22 > w - pad) break;
    ctx.beginPath();
    ctx.arc(x + 6, y, 6, 0, Math.PI * 2);
    ctx.fillStyle = DEST_COLORS[i];
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = INK;
    ctx.fillText(name, x + 16, y - 6);
    x += tw + 28;
  }
  ctx.fillStyle = '#5A5045';
  ctx.font = '700 11px "Zen Maru Gothic", sans-serif';
  ctx.fillText('人を下の車両ボタンへドラッグすると移せる', pad, y + 14);
}
