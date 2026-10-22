// キャンバス描画：斜め俯瞰（アイソメ）。列車は左上から右下へ走り、車両は断面で中が見える。

import { CAR_LEN } from './data.ts';
import { capacity, carsOnPlatform, load, type Game } from './game.ts';
import { drawApproach, drawDwellPanel, drawRouteStrip, PANEL_H, STRIP_H } from './panels.ts';

const INK = '#1F1B16';
const PAPER = '#F5EFE3';
const CARD = '#FFFDF6';
const CAR_COLORS = ['#6FC3A0', '#F0A79C', '#E9B23E', '#8299E0', '#F08E78'];
const PEOPLE = ['#6FC3A0', '#F0A79C', '#E9B23E', '#8299E0', '#F08E78', '#B98A5E', '#3A3631'];

// 寸法 [m]（見やすさ優先で実物より太め・高め）
const CW = 6; // 車体の幅
const UNDER_Z = 0.5; // 床下機器の下端
const FLOOR_Z = 1.3; // 床の高さ（＝ホームの高さ）
const DECK_H = 3.4; // 1階分の高さ
const GAP = 0.8; // 車両間のすき間
const PLAT_Y0 = CW + 0.4; // ホームは手前側
const PLAT_Y1 = CW + 10;
const POLE_SPACING = 40;
const C = 0.866;

type V3 = [number, number, number];

export function draw(ctx: CanvasRenderingContext2D, g: Game, w: number, h: number): void {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.restore();
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, w, h);

  const portrait = h > w * 1.1;
  const sceneTop = STRIP_H + PANEL_H + 8;
  // 1画面に見せる距離。編成が長くなるほど引く
  const minView = portrait ? 40 : 80;
  const viewMeters = Math.max(minView, Math.min(340, g.stats.cars * CAR_LEN * 0.6));
  const s = w / (C * viewMeters);
  const ax = w * (portrait ? 0.6 : 0.62);
  const ay = sceneTop + (h - sceneTop) * (portrait ? 0.6 : 0.58);
  const ox = g.x;
  const P = (x: number, y: number, z: number): [number, number] => [
    ax + (x - ox - y) * C * s,
    ay + (x - ox + y) * 0.5 * s - z * s,
  ];
  const r = new Renderer(ctx, P, s);

  const xa = g.x - viewMeters * 2.2;
  const xb = g.x + viewMeters * 1.4;

  drawGround(r, xa, xb);
  drawPoles(r, xa, xb);
  drawTrain(r, g);
  drawStations(r, g, xa, xb);

  // 上部の情報（背景を敷いてから描く）
  ctx.fillStyle = 'rgba(245,239,227,0.94)';
  ctx.fillRect(0, STRIP_H, w, PANEL_H + 6);
  drawRouteStrip(ctx, g, w);
  if (g.phase === 'running') drawApproach(ctx, g, w, STRIP_H + 8);
  else if (g.phase === 'dwell' || g.phase === 'adjust') drawDwellPanel(ctx, g, w, STRIP_H + 8);
}

class Renderer {
  ctx: CanvasRenderingContext2D;
  P: (x: number, y: number, z: number) => [number, number];
  s: number;
  constructor(ctx: CanvasRenderingContext2D, P: (x: number, y: number, z: number) => [number, number], s: number) {
    this.ctx = ctx;
    this.P = P;
    this.s = s;
  }
  poly(pts: V3[], fill: string | null, stroke = true, lw = 1.6): void {
    const c = this.ctx;
    c.beginPath();
    pts.forEach((p, i) => {
      const [sx, sy] = this.P(p[0], p[1], p[2]);
      if (i === 0) c.moveTo(sx, sy);
      else c.lineTo(sx, sy);
    });
    c.closePath();
    if (fill) {
      c.fillStyle = fill;
      c.fill();
    }
    if (stroke) {
      c.strokeStyle = INK;
      c.lineWidth = lw;
      c.lineJoin = 'round';
      c.stroke();
    }
  }
  /** x が一定の面（右下向き） */
  qx(x: number, y0: number, y1: number, z0: number, z1: number, fill: string | null, stroke = true): void {
    this.poly([[x, y0, z0], [x, y1, z0], [x, y1, z1], [x, y0, z1]], fill, stroke);
  }
  /** y が一定の面（左下向き＝長い側面） */
  qy(y: number, x0: number, x1: number, z0: number, z1: number, fill: string | null, stroke = true): void {
    this.poly([[x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1]], fill, stroke);
  }
  /** z が一定の面（上面） */
  qz(z: number, x0: number, x1: number, y0: number, y1: number, fill: string | null, stroke = true): void {
    this.poly([[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]], fill, stroke);
  }
  line(a: V3, b: V3, color = INK, lw = 2): void {
    const c = this.ctx;
    const [x0, y0] = this.P(...a);
    const [x1, y1] = this.P(...b);
    c.strokeStyle = color;
    c.lineWidth = lw;
    c.beginPath();
    c.moveTo(x0, y0);
    c.lineTo(x1, y1);
    c.stroke();
  }
}

function drawGround(r: Renderer, xa: number, xb: number): void {
  r.qz(0, xa, xb, -1.4, CW + 0.6, '#DCCFB6', false);
  const start = Math.floor(xa / 2.4) * 2.4;
  for (let x = start; x < xb; x += 2.4) r.qz(0.02, x, x + 0.7, -0.6, CW - 0.2, '#9A8064', false);
  r.line([xa, 1.4, 0.08], [xb, 1.4, 0.08], INK, 2.4);
  r.line([xa, CW - 1.4, 0.08], [xb, CW - 1.4, 0.08], INK, 2.4);
}

function drawPoles(r: Renderer, xa: number, xb: number): void {
  const start = Math.floor(xa / POLE_SPACING) * POLE_SPACING;
  for (let x = start; x < xb; x += POLE_SPACING) {
    r.line([x, -2.4, 0], [x, -2.4, 9.4], '#9A8064', 3);
    r.line([x, -2.4, 9], [x, CW / 2, 9], '#9A8064', 2);
  }
  r.line([xa, CW / 2, 8.8], [xb, CW / 2, 8.8], '#9A8064', 1.5);
}

function drawStations(r: Renderer, g: Game, xa: number, xb: number): void {
  const ctx = r.ctx;
  g.pos.forEach((stop, i) => {
    const st = g.line.stations[i];
    const x0 = stop - st.platformCars * CAR_LEN;
    const x1 = stop + 14; // 停止位置の先にも少しホームを延ばす（駅名標を置く）
    if (x1 < xa || x0 > xb) return;
    // ホーム（手前側）
    r.qz(FLOOR_Z, x0, x1, PLAT_Y0, PLAT_Y1, '#E6DCC8');
    r.qz(FLOOR_Z + 0.01, x0, x1, PLAT_Y0 + 0.5, PLAT_Y0 + 0.9, '#E9B23E', false);
    r.qy(PLAT_Y1, x0, x1, 0, FLOOR_Z, '#C9BBA2');
    r.qx(x1, PLAT_Y0, PLAT_Y1, 0, FLOOR_Z, '#A8987D');

    // 待っている客
    if (i === g.target && (g.phase === 'dwell' || g.phase === 'adjust')) {
      const shown = Math.min(g.waiting, 60);
      const pts: V3[] = [];
      for (let k = 0; k < shown; k++) {
        const px = x0 + 2 + hrand(i * 17 + 3, k) * (stop - x0 - 3);
        const py = PLAT_Y0 + 2.2 + hrand(i * 29 + 7, k) * 6.5;
        pts.push([px, py, FLOOR_Z]);
      }
      pts.sort((a, b) => a[0] + a[1] - (b[0] + b[1]));
      pts.forEach((p, k) => drawPerson(r, p, PEOPLE[Math.floor(hrand(i, k * 3) * PEOPLE.length)], 1));
      if (g.waiting > shown) {
        const [sx, sy] = r.P(x0 + 4, PLAT_Y1 - 1, FLOOR_Z + 3);
        label(ctx, sx, sy, `×${g.waiting}`, CARD);
      }
    }

    // 停止位置の目印
    r.line([stop, PLAT_Y0 + 0.6, FLOOR_Z], [stop, PLAT_Y0 + 0.6, FLOOR_Z + 4], INK, 3);
    const [mx, my] = r.P(stop, PLAT_Y0 + 0.6, FLOOR_Z + 4);
    label(ctx, mx, my, '停', i === g.target ? '#E4553A' : CARD, i === g.target ? CARD : INK);
    // 駅名標（停止位置の先）
    r.line([x1 - 2, PLAT_Y1 - 1.5, FLOOR_Z], [x1 - 2, PLAT_Y1 - 1.5, FLOOR_Z + 5], INK, 3);
    const [nx, ny] = r.P(x1 - 2, PLAT_Y1 - 1.5, FLOOR_Z + 5);
    label(ctx, nx, ny, st.name, CARD, INK, 15);
  });
}

function drawTrain(r: Renderer, g: Game): void {
  const cars = g.stats.cars;
  const doors = g.stats.doorsPerCar;
  const decks = 1 + (g.stats.levels['capacity'] ?? 0);
  const topZ = FLOOR_Z + DECK_H * decks + 0.3;
  const ratio = capacity(g) > 0 ? load(g) / capacity(g) : 0;
  const atStation = g.phase === 'dwell' || g.phase === 'adjust';
  const onPlat = atStation ? carsOnPlatform(g) : cars;
  const acN = Math.min(6, g.stats.levels['cooler'] ?? 0);
  const motorN = Math.min(4, g.stats.levels['motor'] ?? 0);

  for (let k = cars - 1; k >= 0; k--) {
    const x0 = g.x - (k + 1) * CAR_LEN + GAP / 2;
    const x1 = g.x - k * CAR_LEN - GAP / 2;
    const color = CAR_COLORS[k % CAR_COLORS.length];
    const len = x1 - x0;

    // 連結部の幌
    if (k < cars - 1) r.qy(CW / 2 + 1, x0 - GAP, x0, FLOOR_Z, FLOOR_Z + 2.6, '#3A3631', false);

    // 床下
    r.qy(CW - 0.3, x0 + 1, x1 - 1, UNDER_Z, FLOOR_Z, '#3A3631', false);
    for (let m = 0; m < motorN; m++) {
      const mx = x0 + len * 0.3 + m * 2.2;
      r.qy(CW - 0.25, mx, mx + 1.8, UNDER_Z + 0.1, FLOOR_Z - 0.1, '#24211D', false);
    }

    // 奥の壁（内側）と窓
    r.qy(0, x0, x1, FLOOR_Z, topZ, tint(color, 0.55));
    const bay = len / doors;
    for (let d = 0; d < decks; d++) {
      const zf = FLOOR_Z + d * DECK_H;
      for (let j = 0; j < doors; j++) {
        const wx0 = x0 + j * bay + bay * 0.22;
        const wx1 = x0 + (j + 1) * bay - bay * 0.22;
        if (wx1 - wx0 > 0.8) r.qy(0.01, wx0, wx1, zf + 1.3, zf + 2.7, '#CFE6EE', true);
      }
    }

    // 各階：床・座席・乗客
    for (let d = 0; d < decks; d++) {
      const zf = FLOOR_Z + d * DECK_H;
      r.qz(zf, x0, x1, 0, CW, '#E8D6B5');
      r.qz(zf + 0.7, x0 + 0.4, x1 - 0.4, 0, 1.1, '#C9B79C');
      r.qy(1.1, x0 + 0.4, x1 - 0.4, zf, zf + 0.7, '#B3A07F');
      const perRow = Math.max(1, Math.floor((len - 1.6) / 1.7));
      const slots = perRow * 2;
      const count = Math.round(ratio * slots);
      const pts: [V3, string][] = [];
      for (let p = 0; p < count; p++) {
        const row = p % 2;
        const idx = Math.floor(p / 2);
        const px = x0 + 1.2 + ((idx + (row ? 0.5 : 0)) * (len - 2.2)) / perRow + (hrand(k * 7 + d, p) - 0.5) * 0.6;
        const py = row ? 2.1 : 4.2;
        pts.push([[Math.min(x1 - 0.8, px), py, zf], PEOPLE[Math.floor(hrand(k + 11, p * 5 + d) * PEOPLE.length)]]);
      }
      pts.sort((a, b) => a[0][0] + a[0][1] - (b[0][0] + b[0][1]));
      for (const [pt, col] of pts) drawPerson(r, pt, col, 0.92);
    }

    // 手前の腰壁と柱（上は抜いて中を見せる）
    r.qy(CW, x0, x1, FLOOR_Z - 0.3, FLOOR_Z + 0.8, color);
    r.qy(CW, x0, x0 + 0.5, FLOOR_Z + 0.8, topZ, color);
    r.qy(CW, x1 - 0.5, x1, FLOOR_Z + 0.8, topZ, color);
    r.qy(CW, x0, x1, topZ - 0.45, topZ, color);
    for (let d = 1; d < decks; d++) r.qy(CW, x0, x1, FLOOR_Z + d * DECK_H - 0.25, FLOOR_Z + d * DECK_H + 0.25, color);

    // ドア（1階・手前側）
    const open = atStation && k < onPlat ? g.doorAnim : 0;
    for (let j = 0; j < doors; j++) {
      const xc = x0 + (j + 0.5) * bay;
      const half = Math.min(0.75, bay * 0.28);
      const slide = half * open * 0.95;
      r.ctx.globalAlpha = 0.82;
      r.qy(CW + 0.02, xc - half - slide, xc - slide, FLOOR_Z + 0.8, FLOOR_Z + 2.7, shade(color));
      r.qy(CW + 0.02, xc + slide, xc + half + slide, FLOOR_Z + 0.8, FLOOR_Z + 2.7, shade(color));
      r.ctx.globalAlpha = 1;
    }
    // ドアカット（ホーム外の車両）
    if (atStation && k >= onPlat) {
      r.ctx.globalAlpha = 0.55;
      for (let hx = x0; hx < x1 - 0.8; hx += 1.2) r.qy(CW + 0.03, hx, hx + 0.5, FLOOR_Z - 0.3, FLOOR_Z + 0.8, INK, false);
      r.ctx.globalAlpha = 1;
    }

    // 天井の一部と屋根の機器
    r.qz(topZ, x0, x1, 0, CW * 0.3, shade(color));
    r.poly([[x0, 0, topZ], [x1, 0, topZ], [x1, CW, topZ], [x0, CW, topZ]], null, true, 1.6);
    for (let a = 0; a < acN; a++) {
      const bx = x0 + 1.5 + a * ((len - 3) / Math.max(1, acN));
      box(r, bx, bx + 2, 0.2, CW * 0.3 - 0.1, topZ, topZ + 0.8, '#CFE6EE');
    }

    // 前の妻面（右下向き）
    r.qx(x1, 0, CW, UNDER_Z, topZ, k === 0 ? color : shade(color));
    if (k === 0) {
      r.qx(x1 + 0.01, 0.8, CW - 0.8, FLOOR_Z + 1.3, FLOOR_Z + 2.7, '#FFF3CF');
      r.qx(x1 + 0.01, 0, CW, FLOOR_Z + 0.2, FLOOR_Z + 0.5, CARD, false);
      for (const yy of [1.2, CW - 1.2]) {
        const [hx, hy] = r.P(x1 + 0.02, yy, FLOOR_Z + 0.9);
        r.ctx.fillStyle = '#FFE48A';
        r.ctx.strokeStyle = INK;
        r.ctx.lineWidth = 1.5;
        r.ctx.beginPath();
        r.ctx.arc(hx, hy, Math.max(2.5, 0.35 * r.s), 0, Math.PI * 2);
        r.ctx.fill();
        r.ctx.stroke();
      }
    } else {
      r.qx(x1 + 0.01, CW / 2 - 0.8, CW / 2 + 0.8, FLOOR_Z, FLOOR_Z + 2.4, '#3A3631', false);
    }

    // 車輪（手前側）
    for (const fx of [2.4, 4.4, len - 4.4, len - 2.4]) {
      const [wx, wy] = r.P(x0 + fx, CW - 0.2, UNDER_Z);
      r.ctx.fillStyle = INK;
      r.ctx.beginPath();
      r.ctx.ellipse(wx, wy, 0.55 * r.s, 0.45 * r.s, 0, 0, Math.PI * 2);
      r.ctx.fill();
    }
  }
}

function box(r: Renderer, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, fill: string): void {
  r.qy(y1, x0, x1, z0, z1, shade(fill));
  r.qx(x1, y0, y1, z0, z1, shade(fill, 0.65));
  r.qz(z1, x0, x1, y0, y1, fill);
}

function drawPerson(r: Renderer, p: V3, color: string, scale: number): void {
  const [x, y] = r.P(p[0], p[1], p[2]);
  const h = 2.3 * r.s * scale;
  const ctx = r.ctx;
  const bodyW = h * 0.36;
  const bodyH = h * 0.58;
  const headR = h * 0.17;
  ctx.fillStyle = color;
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.roundRect(x - bodyW / 2, y - bodyH, bodyW, bodyH, bodyW / 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#F3D9B8';
  ctx.beginPath();
  ctx.arc(x, y - bodyH - headR * 0.9, headR, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

function label(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, bg: string, fg = INK, size = 12): void {
  ctx.font = `900 ${size}px "Zen Maru Gothic", sans-serif`;
  const tw = ctx.measureText(text).width;
  const bw = tw + 14;
  const bh = size + 10;
  ctx.fillStyle = bg;
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(x - bw / 2, y - bh, bw, bh, 5);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y - bh / 2 + 1);
}

function hrand(a: number, b: number): number {
  let x = (Math.imul(a + 1, 73856093) ^ Math.imul(b + 1, 19349663)) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 1274126177) >>> 0;
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

function shade(hex: string, k = 0.78): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${Math.round(((n >> 16) & 255) * k)},${Math.round(((n >> 8) & 255) * k)},${Math.round((n & 255) * k)})`;
}

function tint(hex: string, t: number): string {
  const n = parseInt(hex.slice(1), 16);
  const m = (c: number) => Math.round(c + (255 - c) * t);
  return `rgb(${m((n >> 16) & 255)},${m((n >> 8) & 255)},${m(n & 255)})`;
}
