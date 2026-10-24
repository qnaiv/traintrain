// 外の視点：一定の大きさの台座の上を、景色が流れていく。編成は必ず全部入る縮尺にする。

import { CAR_LEN, type Scenery } from './data.ts';
import { carsOnPlatform, loadOfCar, mulberry32, randomLook, slotsPerCar, type Game, type Look } from './game.ts';
import { C30, hash, INK, Iso, shade } from './iso.ts';
import { drawPerson } from './people.ts';
import { decksOf } from './seats.ts';

const W0 = -11;
const W1 = 11;
const AHEAD = 30;
const BEHIND = 8;
const DEPTH = 3.6;
const CELL = 8;

type Band = [number, number, number, string, string];
const FRONT: Band[] = [
  [2.0, 5.6, 0, '#C8DFA8', '#9CC07F'],
  [5.6, 6.4, 0, '#E6DCC8', '#C9BBA2'],
  [6.4, 9.0, 0, '#BDB4A6', '#9A9184'],
  [9.0, 11, 0, '#C8DFA8', '#9CC07F'],
];
const BANDS: Record<Scenery, Band[]> = {
  coast: [
    [-11, -6.0, -0.35, '#9CC7D6', '#7FB0C2'],
    [-6.0, -3.3, 0, '#EAD9B0', '#D9C493'],
    [-3.3, -2.0, 0, '#C8DFA8', '#9CC07F'],
    [-2.0, 2.0, 0, '#DCCFB6', '#B9AC93'],
    ...FRONT,
  ],
  town: [[-11, -2.0, 0, '#C8DFA8', '#9CC07F'], [-2.0, 2.0, 0, '#DCCFB6', '#B9AC93'], ...FRONT],
  street: [
    [-11, -4.2, 0, '#C8DFA8', '#9CC07F'],
    [-4.2, -2.6, 0, '#E6DCC8', '#C9BBA2'],
    [-2.6, 2.0, 0, '#BDB4A6', '#9A9184'],
    ...FRONT,
  ],
};

const ROOFS = ['#E4553A', '#3F62CF', '#E9B23E', '#6B655C', '#4E9E7E', '#F08E78'];
const WALLS = ['#FFFDF6', '#F3D27F', '#F7CCC5', '#FFFDF6', '#CFE6EE', '#EDE6D8'];
const CAR_COLORS = ['#6FC3A0', '#F0A79C', '#E9B23E', '#8299E0', '#F08E78'];
export const carColor = (k: number) => CAR_COLORS[k % CAR_COLORS.length];

const lookCache = new Map<number, Look>();
function lookOf(seed: number): Look {
  let l = lookCache.get(seed);
  if (!l) {
    l = randomLook(mulberry32(seed * 7919 + 13));
    lookCache.set(seed, l);
  }
  return l;
}

export interface ExtResult {
  /** 電車の画面上の範囲（タップ判定用） */
  train: { x0: number; y0: number; x1: number; y1: number };
  /** この描画で使った投影（障害のタップ判定などに使う） */
  iso: Iso;
}

/** 試作などで、台座の上に物を足すための口 */
export interface ExtOpts {
  /** 先頭より先に見せる距離 [m] */
  ahead?: number;
  /** 物の描画キューに足す（奥・線路・手前の順で並べ替えられる） */
  extra?: (iso: Iso, put: (x: number, y: number, f: () => void) => void) => void;
  /** 拡大率（1 = ふだん。大きいほど寄る） */
  zoom?: number;
  /** 寄ったときに中心にしたい x [m] */
  focus?: number;
  /** すべての上に描く */
  after?: (iso: Iso) => void;
}

let smoothS = 0;

export function drawExterior(ctx: CanvasRenderingContext2D, g: Game, w: number, top: number, bottom: number, opts: ExtOpts = {}): ExtResult {
  const trainLen = g.stats.cars * CAR_LEN;
  const xb0 = g.x + (opts.ahead ?? AHEAD);
  const xa0 = g.x - trainLen - BEHIND;
  // ズーム：見える長さを 1/zoom に。寄るほど注目点（focus）へ中心を寄せる
  const zoom = Math.max(0.5, Math.min(3, opts.zoom ?? 1));
  const c0 = (xa0 + xb0) / 2;
  const pull = Math.max(0, Math.min(1, 1 - 1 / zoom));
  const cz = c0 + ((opts.focus ?? c0) - c0) * pull;
  const half = (xb0 - xa0) / 2 / zoom;
  const xa = cz - half;
  const xb = cz + half;
  const Lv = xb - xa;
  // 幅は編成と前後の余白が収まるように、高さは台座全体が収まるように
  const byW = (w - 40) / ((Lv + 6) * C30);
  const byH = (bottom - top - 30) / ((Lv + (W1 - W0)) * 0.5 + DEPTH + 7);
  // 寄るときは台座の奥・手前がはみ出してもいい（電車を大きく見せる）
  const target = Math.min((w < 600 ? 6.4 : 9) * zoom, byW, byH * Math.max(1, zoom));
  smoothS = smoothS === 0 ? target : smoothS + (target - smoothS) * 0.08;
  const s = smoothS;
  const cx = (xa + xb) / 2;
  const cy = (top + bottom) / 2 + 6 + Math.max(0, zoom - 1) * 14;
  const iso = new Iso(ctx, s, w / 2 - cx * C30 * s, cy - cx * 0.5 * s);
  iso.clipX0 = xa;
  iso.clipX1 = xb;
  iso.clipY0 = W0;
  iso.clipY1 = W1;
  const t = g.time;

  // 景色の区間
  const segs = segments(g, xa, xb);
  const kindAt = (x: number): Scenery => (segs.find((sg) => x >= sg[0] && x < sg[1]) ?? segs[segs.length - 1])[2];

  // 台座の影と側面
  const sa = iso.P(xa, W1, -DEPTH);
  const sb = iso.P(xb, W1, -DEPTH);
  const sc = iso.P(xb, W0, -DEPTH);
  ctx.fillStyle = 'rgba(31,27,22,0.12)';
  ctx.beginPath();
  ctx.moveTo(sa[0] + 6, sa[1] + 10);
  ctx.lineTo(sb[0] + 6, sb[1] + 10);
  ctx.lineTo(sc[0] + 6, sc[1] + 10);
  ctx.lineTo(sc[0], sc[1]);
  ctx.lineTo(sb[0], sb[1]);
  ctx.lineTo(sa[0], sa[1]);
  ctx.closePath();
  ctx.fill();
  iso.rectX(xb, W0, W1, -DEPTH, -2.8, '#8E6640');
  iso.rectY(W1, xa, xb, -DEPTH, -2.8, '#7A5636');
  iso.rectX(xb, W0, W1, -2.8, 0, '#B98A5E');
  iso.rectY(W1, xa, xb, -2.8, 0, '#A57A50');
  for (const b of BANDS[kindAt(xb - 0.01)]) {
    iso.rectX(xb, b[0], b[1], b[2] - 0.55, b[2], b[4], 0);
    if (b[2] < 0) iso.rectX(xb, b[0], b[1], -1.4, b[2], '#6FA0B3', 0);
  }
  iso.rectY(W1, xa, xb, -0.55, 0, '#9CC07F', iso.lw * 0.6);
  for (let i = Math.floor(xa / 6); i < xb / 6; i++) {
    const sx = i * 6 + hash(i, 9) * 4;
    const dz = hash(i, 8) * 0.6;
    iso.rectY(W1, sx, sx + 0.8, -2.2 - dz, -1.95 - dz, '#8E6640', 0);
  }

  // 上面
  for (const [a, b, kind] of segs) {
    const sub = new Iso(ctx, s, iso.ox, iso.oy);
    sub.clipX0 = a;
    sub.clipX1 = b;
    sub.clipY0 = W0;
    sub.clipY1 = W1;
    for (const band of BANDS[kind]) sub.rectZ(a, b, band[0], band[1], band[2], band[3], 0);
    if (kind === 'coast') {
      const shift = (t * 0.6) % 6;
      for (let i = Math.floor(a / 6) - 1; i < b / 6 + 1; i++) {
        const wx = i * 6 + hash(i, 21) * 5 - shift;
        const wy = -10.7 + hash(i, 22) * 4.4;
        sub.rectZ(wx, wx + 2.2, wy, wy + 0.22, -0.33, '#E6F2F5', 0);
      }
      sub.rectZ(a, b, -6.3, -6.0, -0.33, '#FFFDF6', 0);
    }
    if (kind !== 'street') {
      for (let x = Math.ceil(a / 1.2) * 1.2; x < b; x += 1.2) sub.rectZ(x, x + 0.42, -1.5, 1.5, 0.05, '#9A8064', 0);
    }
  }
  iso.poly([[xa, W0, 0], [xb, W0, 0], [xb, W1, 0], [xa, W1, 0]], null);
  iso.rectZ(xa, xb, -0.72, -0.56, 0.18, '#6B655C', 0);
  iso.rectZ(xa, xb, 0.56, 0.72, 0.18, '#6B655C', 0);
  for (let rd = Math.ceil(xa / 4) * 4; rd < xb; rd += 4) iso.rectZ(rd, rd + 2, 7.64, 7.76, 0.01, '#FFFDF6', 0);

  // ホーム（平たいので先に描く）
  g.pos.forEach((stop, i) => {
    const st = g.line.stations[i];
    const p0 = stop - st.platformCars * CAR_LEN - 0.5;
    const p1 = stop + 4;
    if (!iso.inX(p0, p1)) return;
    iso.box(p0, p1, 2.1, 5.3, 0, 1.05, '#E6DCC8');
    iso.rectZ(p0, p1, 2.35, 2.55, 1.06, '#E9B23E', 0);
  });

  // ここから物（奥・線路・手前の3層で描く順を決める）
  const put = (x: number, y: number, f: () => void) => {
    const layer = y < -1.6 ? 0 : y > 1.6 ? 2 : 1;
    iso.push(layer * 1e6 + x + y, f);
  };

  for (let i = Math.floor(xa / CELL); i <= Math.floor(xb / CELL); i++) {
    const x = i * CELL;
    const kind = kindAt(x + CELL / 2);
    // 奥側
    if (kind === 'coast') {
      if (hash(i, 41) < 0.55) {
        const ux = x + hash(i, 42) * CELL;
        const uy = -5.6 + hash(i, 43) * 1.8;
        put(ux, uy, () => umbrella(iso, ux, uy, ['#E4553A', '#3F62CF', '#E9B23E'][i % 3]));
      }
      for (let k = 0; k < 2; k++) {
        if (hash(i, 50 + k) < 0.6) {
          const px = x + hash(i, 52 + k) * CELL;
          const py = -5.8 + hash(i, 54 + k) * 2.2;
          put(px, py, () => drawPerson(iso, px, py, 0, lookOf(i * 10 + k), { pose: 'stand', facing: 2 }));
        }
      }
      if (hash(i, 61) < 0.18) {
        const bx = x + hash(i, 62) * 4 - ((t * 0.8) % CELL);
        const by = -10.4 + hash(i, 63) * 2.4;
        put(bx, by, () => boat(iso, bx, by, i % 2 ? '#E4553A' : '#3F62CF'));
      }
    } else {
      const backY1 = kind === 'street' ? -4.6 : -5.5 - hash(i, 83) * 1.5;
      if (hash(i, 81) < 0.25) put(x + 4, -7, () => tree(iso, x + 4, -7, i));
      else {
        const hx1 = x + 7 + hash(i, 82);
        put(x + 4, -8, () => house(iso, x + 0.5, hx1, -11.5, backY1, 3 + hash(i, 84) * 3, WALLS[Math.floor(hash(i, 85) * 6)], ROOFS[Math.floor(hash(i, 86) * 6)]));
      }
    }
    // 手前
    const kindF = hash(i, 91);
    if (kindF < 0.35) {
      put(x + 3, 10.2, () => tree(iso, x + 3, 10.2, i + 7));
      if (kindF < 0.15) put(x + 6.5, 10.4, () => tree(iso, x + 6.5, 10.4, i + 9));
    } else if (kindF < 0.5) {
      put(x + 4, 9.8, () => iso.box(x + 0.5, x + 7.5, 9.4, 10.2, 0, 0.9, '#4E9E7E'));
    } else {
      const hx1 = x + 6.4 + hash(i, 92);
      put(x + 3, 10.5, () => house(iso, x + 0.6, hx1, 9.6, 11.9, 2.3 + hash(i, 93) * 1.6, WALLS[Math.floor(hash(i, 94) * 6)], ROOFS[Math.floor(hash(i, 95) * 6)]));
    }
  }

  // 架線柱とフェンス
  for (let px = Math.ceil(xa / 24) * 24 - 6; px < xb + 1; px += 24) put(px, -2.7, () => pole(iso, px));
  const onPlatformX = (x: number) =>
    g.pos.some((stop, i) => x > stop - g.line.stations[i].platformCars * CAR_LEN - 1 && x < stop + 5);
  for (let fx = Math.ceil(xa / 3) * 3; fx < xb; fx += 3) {
    if (onPlatformX(fx) || kindAt(fx) === 'street') continue;
    put(fx, 2.5, () => iso.box(fx - 0.08, fx + 0.08, 2.42, 2.58, 0, 1.0, '#FFFDF6', { lw: iso.lw * 0.6 }));
  }

  // 駅の小物と待っている客
  g.pos.forEach((stop, i) => {
    const st = g.line.stations[i];
    const p0 = stop - st.platformCars * CAR_LEN - 0.5;
    if (!iso.inX(p0, stop + 6)) return;
    put(stop - 7, 4.95, () => {
      iso.box(stop - 9.2, stop - 9, 4.85, 5.05, 1.05, 3.0, '#3A3631');
      iso.box(stop - 5.0, stop - 4.8, 4.85, 5.05, 1.05, 3.0, '#3A3631');
      iso.box(stop - 9.4, stop - 4.6, 4.88, 5.02, 2.35, 3.25, '#FFFDF6');
      if (iso.inX(stop - 9, stop - 5)) iso.label(stop - 7, 5.0, 2.8, st.name, Math.max(9, Math.min(12, s * 2)));
    });
    put(stop - 15, 4.6, () => iso.box(stop - 16.5, stop - 13.5, 4.4, 4.9, 1.05, 1.5, '#8E6640'));
    put(stop - 1.6, 4.7, () => {
      iso.box(stop - 2.3, stop - 1.0, 4.2, 5.2, 1.05, 3.0, '#E4553A');
      iso.rectY(5.2, stop - 2.1, stop - 1.2, 2.0, 2.8, '#CFE6EE', iso.lw * 0.6);
    });
    put(stop, 2.6, () => {
      iso.box(stop - 0.08, stop + 0.08, 2.6, 2.76, 1.05, 2.4, '#3A3631');
      iso.box(stop - 0.08, stop + 0.08, 2.3, 3.06, 2.4, 3.0, i === g.target ? '#E4553A' : '#FFFDF6');
    });
    let n = 0;
    if (i === g.target) n = g.phase === 'running' ? Math.round(st.demand * 0.8) : g.waiting;
    else if (i > g.target) n = Math.round(st.demand * 0.5);
    else n = 3;
    for (let k = 0; k < Math.min(n, 60); k++) {
      const px = p0 + 1.5 + hash(i * 97 + k, 31) * (stop - p0 - 4);
      const py = 3.0 + hash(i * 97 + k, 32) * 2.0;
      if (!iso.inX(px - 0.3, px + 0.3)) continue;
      put(px, py, () => drawPerson(iso, px, py, 1.05, lookOf(i * 1000 + k), { pose: 'stand', facing: 3 }));
    }
  });

  // 道路の車（一定の速さで流れる）
  for (let lane = 0; lane < 2; lane++) {
    const speed = lane ? -9 : 11;
    const gap = 26;
    const off = (t * speed) % gap;
    for (let k = Math.floor((xa - off) / gap) - 1; k <= Math.ceil((xb - off) / gap); k++) {
      if (hash(k, 70 + lane) < 0.35) continue;
      const ax = k * gap + off + hash(k, 72) * 6;
      const y0 = lane ? 7.85 : 6.55;
      put(ax + 2, y0 + 0.5, () => {
        iso.box(ax, ax + 4, y0, y0 + 1.05, 0.25, 1.05, ['#3F62CF', '#FFFDF6', '#E9B23E', '#E4553A', '#6FC3A0'][Math.floor(hash(k, 74 + lane) * 5)]);
        iso.box(ax + 0.9, ax + 2.8, y0 + 0.08, y0 + 0.97, 1.05, 1.6, '#CFE6EE');
      });
    }
  }

  // 電車
  const atStation = g.phase === 'dwell' || g.phase === 'adjust';
  const onPlat = atStation ? carsOnPlatform(g) : g.stats.cars;
  const decks = decksOf(g.stats);
  const bob = g.v > 0.5 ? Math.sin(t * 9) * 0.03 : 0;
  const per = slotsPerCar(g);
  let tx0 = Infinity;
  let ty0 = Infinity;
  let tx1 = -Infinity;
  let ty1 = -Infinity;
  for (let k = 0; k < g.stats.cars; k++) {
    const x1 = g.x - k * CAR_LEN - (k ? 0.3 : 0);
    const x0 = g.x - (k + 1) * CAR_LEN + 0.3;
    const load = per > 0 ? loadOfCar(g, k) / per : 0;
    put((x0 + x1) / 2, 0, () =>
      car(iso, x0, x1, bob, carColor(k), {
        lead: k === 0,
        decks,
        doors: g.stats.doorsPerCar,
        ac: Math.min(4, g.stats.levels['cooler'] ?? 0),
        panta: k % 2 === 0,
        load,
        open: atStation && k < onPlat ? g.doorAnim : 0,
        cut: atStation && k >= onPlat,
      }),
    );
    const top = 0.95 + 2.9 * decks + 0.8;
    for (const [px, py, pz] of [
      [x0, W0 * 0 - 1.3, 0],
      [x0, 1.3, 0],
      [x1, -1.3, top],
      [x1, 1.3, 0],
      [x0, -1.3, top],
    ] as [number, number, number][]) {
      const [sx, sy] = iso.P(px, py, pz);
      tx0 = Math.min(tx0, sx);
      tx1 = Math.max(tx1, sx);
      ty0 = Math.min(ty0, sy);
      ty1 = Math.max(ty1, sy);
    }
  }
  opts.extra?.(iso, put);
  iso.flush();

  // 架線
  const wz = Math.max(6.8, 0.95 + 2.9 * decks + 1.6);
  iso.line([xa, 0, wz], [xb, 0, wz], '#6B655C', Math.max(0.8, iso.lw * 0.8));
  opts.after?.(iso);
  return { train: { x0: tx0 - 6, y0: ty0 - 6, x1: tx1 + 6, y1: ty1 + 6 }, iso };
}

function segments(g: Game, xa: number, xb: number): [number, number, Scenery][] {
  const out: [number, number, Scenery][] = [];
  const n = g.line.sections.length;
  for (let i = -1; i <= n; i++) {
    const a = i < 0 ? -1e6 : g.pos[i];
    const b = i >= n ? 1e6 : g.pos[i + 1];
    const kind = g.line.scenery[Math.max(0, Math.min(n - 1, i))];
    const lo = Math.max(a, xa);
    const hi = Math.min(b, xb);
    if (hi > lo) out.push([lo, hi, kind]);
  }
  return out;
}

function tree(iso: Iso, x: number, y: number, seed: number): void {
  if (!iso.inX(x - 1.4, x + 1.4)) return;
  const c = hash(seed, 3) < 0.5 ? '#6FC3A0' : '#4E9E7E';
  iso.shadow(x, y, 0, 1.2, 0.15);
  iso.box(x - 0.22, x + 0.22, y - 0.22, y + 0.22, 0, 1.4, '#8E6640');
  iso.box(x - 1.2, x + 1.2, y - 1.2, y + 1.2, 1.4, 3.0, c);
  iso.box(x - 0.7, x + 0.7, y - 0.7, y + 0.7, 3.0, 4.0, shade(c, 1.08));
}

function house(iso: Iso, x0: number, x1: number, y0: number, y1: number, h: number, wall: string, roof: string): void {
  const cx0 = Math.max(x0, iso.clipX0);
  const cx1 = Math.min(x1, iso.clipX1);
  const cy0 = Math.max(y0, iso.clipY0);
  const cy1 = Math.min(y1, iso.clipY1);
  if (cx1 - cx0 < 0.6 || cy1 - cy0 < 0.6) return;
  iso.box(cx0, cx1, cy0, cy1, 0, h, wall);
  const n = Math.max(1, Math.floor((x1 - x0) / 2.2));
  for (let i = 0; i < n; i++) {
    const wx = x0 + ((i + 0.5) * (x1 - x0)) / n;
    if (wx - 0.45 > cx0 && wx + 0.45 < cx1) iso.rectY(cy1, wx - 0.45, wx + 0.45, h * 0.42, h * 0.75, '#CFE6EE', iso.lw * 0.7);
  }
  if (cx1 === x1) iso.rectX(cx1, (cy0 + cy1) / 2 - 0.5, (cy0 + cy1) / 2 + 0.5, 0, Math.min(2.1, h * 0.6), shade(wall, 0.6), iso.lw * 0.7);
  const ym = (y0 + y1) / 2;
  const zr = h + (y1 - y0) * 0.38;
  const o = 0.35;
  if (ym > iso.clipY1) return;
  iso.poly([[cx0, y0 - o, h], [cx1, y0 - o, h], [cx1, ym, zr], [cx0, ym, zr]], shade(roof, 0.82));
  iso.poly([[cx1, y0, h], [cx1, y1, h], [cx1, ym, zr]], shade(wall, 0.8));
  iso.poly([[cx0, ym, zr], [cx1, ym, zr], [cx1, y1 + o, h], [cx0, y1 + o, h]], roof);
}

function umbrella(iso: Iso, x: number, y: number, color: string): void {
  if (!iso.inX(x - 1, x + 1)) return;
  iso.box(x - 0.05, x + 0.05, y - 0.05, y + 0.05, 0, 2.0, '#FFFDF6', { lw: iso.lw * 0.5 });
  const [sx, sy] = iso.P(x, y, 2.0);
  iso.ell(sx, sy, 1.25 * iso.s, 0.62 * iso.s, color, iso.lw * 0.7);
}

function boat(iso: Iso, x: number, y: number, color: string): void {
  if (!iso.inX(x, x + 4)) return;
  iso.box(x, x + 4, y, y + 1.5, -0.35, 0.25, '#FFFDF6');
  iso.box(x + 1, x + 2.6, y + 0.25, y + 1.25, 0.25, 1.1, color);
}

function pole(iso: Iso, x: number): void {
  if (!iso.inX(x - 0.3, x + 0.3)) return;
  iso.box(x - 0.18, x + 0.18, -2.88, -2.52, 0, 7.4, '#9A8064');
  iso.box(x - 0.1, x + 0.1, -2.7, 0.3, 6.9, 7.15, '#9A8064');
}

interface CarOpts {
  lead: boolean;
  decks: number;
  doors: number;
  ac: number;
  panta: boolean;
  load: number;
  open: number;
  cut: boolean;
}

function car(iso: Iso, x0: number, x1: number, bob: number, color: string, o: CarOpts): void {
  const top = 0.95 + 2.9 * o.decks + bob;
  const L = x1 - x0;
  const zb = 0.95 + bob;
  iso.box(x0 + 1.4, x0 + 3.8, -1.05, 1.05, 0.12, 0.72, '#24211D');
  iso.box(x1 - 3.8, x1 - 1.4, -1.05, 1.05, 0.12, 0.72, '#24211D');
  for (const wx of [x0 + 1.9, x0 + 3.3, x1 - 3.3, x1 - 1.9]) {
    if (!iso.inX(wx - 0.4, wx + 0.4)) continue;
    const [px, py] = iso.P(wx, 1.06, 0.45);
    iso.ell(px, py, 0.42 * iso.s, 0.42 * iso.s, '#3A3631', iso.lw * 0.6);
  }
  iso.box(x0 + 0.6, x1 - 0.6, -1.15, 1.15, 0.6, zb, '#3A3631');
  iso.box(x0, x1, -1.3, 1.3, zb, top, color);
  iso.rectY(1.3, x0, x1, zb + 0.3, zb + 0.55, '#FFFDF6', 0);
  const dxs: number[] = [];
  for (let j = 0; j < o.doors; j++) dxs.push(x0 + ((j + 0.5) * L) / o.doors);
  const dw = Math.min(0.6, (L / o.doors) * 0.3);
  for (let d = 0; d < o.decks; d++) {
    const zf = zb + d * 2.9;
    const edges: number[] = [x0 + 0.5];
    if (d === 0) for (const dx of dxs) edges.push(dx - dw - 0.15, dx + dw + 0.15);
    edges.push(x1 - 0.5);
    for (let e = 0; e + 1 < edges.length; e += 2) {
      if (edges[e + 1] - edges[e] < 0.6) continue;
      iso.rectY(1.3, edges[e], edges[e + 1], zf + 1.55, zf + 2.45, '#CFE6EE', iso.lw * 0.7);
      const nh = Math.round(((edges[e + 1] - edges[e]) / 0.8) * o.load);
      for (let h = 0; h < nh; h++) {
        const hx = edges[e] + 0.4 + h * 0.8;
        if (hx > edges[e + 1] - 0.3 || !iso.inX(hx - 0.2, hx + 0.2)) continue;
        const [sx, sy] = iso.P(hx, 1.3, zf + 2.02);
        iso.ell(sx, sy, 0.22 * iso.s, 0.22 * iso.s, '#F3D9B8', iso.lw * 0.5);
      }
    }
  }
  for (const dx of dxs) {
    iso.rectY(1.3, dx - dw, dx + dw, zb + 0.1, zb + 2.35, shade(color, 0.8), iso.lw * 0.7);
    if (o.open > 0) iso.rectY(1.3, dx - dw * 0.85 * o.open, dx + dw * 0.85 * o.open, zb + 0.15, zb + 2.3, '#2B2F45', 0);
  }
  if (o.cut) for (let hx = x0 + 0.3; hx < x1 - 0.4; hx += 1.0) iso.rectY(1.31, hx, hx + 0.4, zb + 0.03, zb + 0.29, 'rgba(31,27,22,0.55)', 0);
  iso.box(x0 + 0.25, x1 - 0.25, -1.15, 1.15, top, top + 0.24, '#EDE6D8');
  for (let a = 0; a < o.ac; a++) {
    const ax = x0 + 1.2 + (a * (L - 3.2)) / Math.max(1, o.ac - 0.0001);
    iso.box(ax, ax + 1.5, -0.8, 0.8, top + 0.24, top + 0.75, '#CFE6EE');
  }
  if (o.panta) {
    const px = x0 + L * 0.3;
    iso.box(px - 0.6, px + 0.6, -0.5, 0.5, top + 0.24, top + 0.42, '#6B655C');
    if (iso.inX(px - 0.6, px + 0.6)) {
      iso.line([px - 0.5, 0, top + 0.42], [px, 0, top + 1.5]);
      iso.line([px + 0.5, 0, top + 0.42], [px, 0, top + 1.5]);
      iso.line([px, -0.9, top + 1.5], [px, 0.9, top + 1.5], INK, iso.lw * 1.2);
    }
  }
  if (o.lead) {
    iso.rectX(x1, -1.0, 1.0, zb + 1.6, zb + 2.6, '#CFE6EE', iso.lw * 0.7);
    iso.rectX(x1, -0.5, 0.5, zb + 2.67, zb + 2.89, '#3A3631', 0);
    if (iso.inX(x1 - 0.1, x1)) {
      for (const yy of [-0.85, 0.85]) {
        const [lx, ly] = iso.P(x1, yy, zb + 0.8);
        iso.ell(lx, ly, 0.2 * iso.s, 0.2 * iso.s, '#FFE48A', iso.lw * 0.6);
      }
    }
  } else iso.box(x1, x1 + 0.6, -0.65, 0.65, zb + 0.25, zb + 2.45, '#3A3631');
}
