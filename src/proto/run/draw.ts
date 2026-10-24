// 試作 v0.7 の描画：外（台座＋障害）、中（1両）、上のバー。

import { CAR_LEN, DEST_COLORS } from '../../data.ts';
import { drawExterior, type ExtResult } from '../../exterior.ts';
import type { Game } from '../../game.ts';
import { C30, INK, Iso, hash, shade } from '../../iso.ts';
import { drawPerson, type Facing } from '../../people.ts';
import {
  CURVE_V,
  KINDS,
  LINE,
  OBS_INFO,
  POS,
  SPOTS,
  STOP_HI,
  STOP_LO,
  effTol,
  nextObstacle,
  predictShock,
  treeNeed,
  type Obstacle,
  type Pax,
  type Run,
} from './state.ts';

export interface Hit {
  kind: 'obstacle' | 'pax' | 'train' | 'spot';
  ref: unknown;
  x: number;
  y: number;
  r: number;
}

function fakeGame(r: Run): Game {
  return {
    line: LINE,
    pos: POS,
    phase: r.phase === 'dwell' ? 'dwell' : 'running',
    target: Math.min(r.target, LINE.stations.length - 1),
    time: r.time,
    v: r.v,
    x: r.x,
    stats: { cars: 1, doorsPerCar: 2, levels: {} },
    waiting: 0,
    doorAnim: r.doorAnim,
    layout: new Array(5),
    passengers: r.pax.map(() => ({ car: 0 })),
  } as unknown as Game;
}

function look(p: Pax) {
  const l = p.look;
  if (p.kind === 'sumo') return { ...l, shirt: '#F0C9A0', pants: '#3A3631', skin: '#F0C9A0', hairStyle: 2, hat: 0, bag: 0, hair: '#24211D' };
  if (p.kind === 'stu') return { ...l, shirt: '#2D3550', pants: '#2D3550', hat: 0 };
  if (p.kind === 'old') return { ...l, shirt: '#B9B0A2', pants: '#6B655C', hair: '#E6E1D8', hairStyle: 2, hat: 0 };
  if (p.kind === 'vip') return { ...l, shirt: '#B98ADB', pants: '#3A3631', hat: 0, bag: 1 };
  if (p.kind === 'kid') return { ...l, shirt: '#E9B23E', hat: 1 };
  return { ...l, shirt: '#FFFDF6', pants: '#4A4540', bag: 1 };
}
const scaleOf = (p: Pax) => (p.kind === 'sumo' ? 1.35 : p.kind === 'kid' ? 0.72 : 1);

/** 拡大した人形（大きさの違う客） */
function sized(iso: Iso, x: number, y: number, z: number, p: Pax, pose: 'stand' | 'sit', facing: Facing, k: number, lift = 0) {
  const sub = new Iso(iso.ctx, iso.s * k, 0, 0);
  const [px, py] = iso.P(x, y, z);
  const [qx, qy] = sub.P(0, 0, 0);
  sub.ox = px - qx;
  sub.oy = py - qy;
  sub.lw = iso.lw;
  return drawPerson(sub, 0, 0, 0, look(p), { pose, facing, lift });
}

export function pill(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, bg: string, fg = INK, size = 12) {
  ctx.font = `900 ${size}px "Zen Maru Gothic", sans-serif`;
  const w = ctx.measureText(text).width + 16;
  const h = size + 10;
  ctx.beginPath();
  ctx.roundRect(x - w / 2, y - h / 2, w, h, h / 2);
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y + 0.5);
}

// ---------------- 外 ----------------
export function drawOutside(ctx: CanvasRenderingContext2D, r: Run, w: number, top: number, bottom: number, hits: Hit[]): ExtResult {
  const g = fakeGame(r);
  const sec = r.phase === 'dwell' ? r.target : r.target - 1;
  const obs = r.obstacles[sec] ?? [];
  const labels: (() => void)[] = [];
  const res = drawExterior(ctx, g, w, top, bottom, {
    ahead: 46,
    extra: (iso, put) => {
      for (const o of obs) drawObstacle(iso, put, r, o, labels, hits);
      // ホームの候補
      if (r.phase === 'dwell') {
        const stop = POS[r.target];
        r.candidates.forEach((c, i) => {
          const x = stop - 21 + i * 2.6;
          const y = 3.1 + (i % 2) * 0.9;
          const picked = r.picked.has(c.id);
          put(x, y, () => {
            if (picked) {
              const [cx, cy] = iso.P(x, y, 1.07);
              iso.ell(cx, cy, 0.6 * iso.s * 1.22 * scaleOf(c), 0.6 * iso.s * 0.7 * scaleOf(c), 'rgba(111,195,160,0.7)', 1.5, '#2E8F62');
            }
            const h = sized(iso, x, y, 1.05, c, 'stand', 3, scaleOf(c));
            labels.push(() => tagAt(ctx, h.hx, h.hy - h.hr * 1.6 - 4, KINDS[c.kind].ch + (picked ? '✓' : ''), picked ? '#6FC3A0' : c.kind === 'vip' ? '#E9B23E' : '#FFFDF6'));
          });
        });
      }
    },
    after: (iso) => {
      // 吹っ飛ぶ客
      for (const f of r.fliers) {
        const u = Math.min(1, (r.time - f.t) / 1.6);
        const x = f.x + u * 6;
        const y = 1.0 - u * 10;
        const z = 3.2 + Math.sin(u * Math.PI) * 9 - u * 3.6;
        if (u < 1) {
          for (let k = 1; k < 6; k++) {
            const uu = u - k * 0.06;
            if (uu <= 0) break;
            const [dx, dy] = iso.P(f.x + uu * 6, 1.0 - uu * 10, 3.2 + Math.sin(uu * Math.PI) * 9 - uu * 3.6 + 1);
            iso.ell(dx, dy, 2, 2, INK, 0);
          }
          const h = sized(iso, x, y, z, f.pax, 'stand', ((Math.floor(u * 10) % 4) as Facing), scaleOf(f.pax) * 1.5);
          tagAt(ctx, h.hx + 30, h.hy - 18, 'わ〜っ！', '#FFFDF6');
        } else {
          const [sx, sy] = iso.P(f.x + 6, -9, -0.3);
          const k = (r.time - f.t - 1.6) / 0.6;
          ctx.globalAlpha = Math.max(0, 1 - k);
          iso.ell(sx, sy, 10 + k * 26, 4 + k * 10, 'rgba(255,253,246,0.9)', 1.4);
          ctx.globalAlpha = 1;
        }
      }
      labels.forEach((f) => f());
    },
  });
  return res;
}

function tagAt(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, bg: string, fg = INK) {
  ctx.font = '900 11px "Zen Maru Gothic", sans-serif';
  const w = Math.max(20, ctx.measureText(text).width + 10);
  ctx.beginPath();
  ctx.moveTo(x - w / 2, y - 16);
  ctx.lineTo(x + w / 2, y - 16);
  ctx.lineTo(x + w / 2, y);
  ctx.lineTo(x + 4, y);
  ctx.lineTo(x, y + 5);
  ctx.lineTo(x - 4, y);
  ctx.lineTo(x - w / 2, y);
  ctx.closePath();
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y - 7.5);
}

function drawObstacle(iso: Iso, put: (x: number, y: number, f: () => void) => void, r: Run, o: Obstacle, labels: (() => void)[], hits: Hit[]) {
  const ctx = iso.ctx;
  const age = r.time - o.t;
  const x = o.x;
  if (!iso.inX(x - 8, x + o.len + 8)) return;
  const next = nextObstacle(r) === o;
  if (o.kind === 'tree') {
    if (o.state === 'wait') {
      put(x, -1, () => {
        iso.box(x - 0.45, x + 0.45, -6.2, 2.8, 0.1, 0.95, '#8E6640');
        iso.box(x - 0.5, x + 0.5, -7.0, -6.0, 0, 1.4, '#8E6640');
        iso.box(x - 1.7, x + 1.5, -0.6, 2.2, 0.5, 1.9, '#6FC3A0');
        iso.box(x - 1.1, x + 1.2, 1.9, 3.4, 0.4, 1.5, '#4E9E7E');
      });
      if (next) labels.push(() => {
        const [sx, sy] = iso.P(x, -1, 5.5);
        pill(ctx, sx, sy - 26, `${treeNeed(r)}km/h以上で突き破れ`, '#E9B23E', INK, 11);
        pill(ctx, sx, sy - 2, `今のままなら衝撃 ≈${predictShock(r, o)}`, '#FFFDF6', '#B53E28', 10);
      });
    } else if (age < 1.2) {
      // 木っ端
      for (let i = 0; i < 12; i++) {
        const bx = x + 2 + hash(i, 3) * 10 * (age + 0.2);
        const by = -3 + hash(i, 4) * 6;
        const bz = 0.4 + hash(i, 5) * 5 * Math.sin(Math.min(1, age / 1.2) * Math.PI);
        put(bx, by, () => iso.box(bx - 0.3, bx + 0.3, by - 0.15, by + 0.15, bz, bz + 0.3, i % 3 ? '#8E6640' : '#6FC3A0', { lw: iso.lw * 0.6 }));
      }
    } else if (o.state === 'hit' && r.v < 0.1) {
      put(x, -1, () => iso.box(x - 0.45, x + 0.45, 3.0, 6.0, 0.05, 0.8, '#8E6640'));
    }
  } else if (o.kind === 'pole') {
    if (o.state === 'wait') {
      put(x, 0.5, () => {
        iso.box(x - 0.2, x + 0.2, -2.9, -2.5, 0, 2.2, '#9A8064');
        iso.box(x - 0.22, x + 0.22, -2.4, 4.2, 0.18, 0.6, '#9A8064');
        iso.box(x - 0.1, x + 0.1, 3.0, 3.2, 0.6, 1.3, '#9A8064');
        iso.line([x, -2.7, 2.2], [x - 2, -1.0, 6.8], '#3A3631', iso.lw * 1.2);
      });
      const [cx, cy] = iso.P(x, 0.5, 0.6);
      const rr = 3.2 * iso.s;
      hits.push({ kind: 'obstacle', ref: o, x: cx, y: cy, r: Math.max(44, rr * 1.2) });
      labels.push(() => {
        ctx.setLineDash([7, 5]);
        iso.ell(cx, cy, rr, rr * 0.58, 'rgba(228,85,58,0.12)', 2.4, '#E4553A');
        ctx.setLineDash([]);
        const pulse = 1 + Math.sin(r.time * 10) * 0.06;
        iso.ell(cx, cy, rr * 0.65 * pulse, rr * 0.38 * pulse, null, 1.6, '#E4553A');
        pill(ctx, cx, cy + rr * 0.58 + 16, `連打！ ${o.need - o.taps} / ${o.need}`, '#E4553A', '#FFFDF6', 13);
      });
    } else if (age < 0.8) {
      const k = age / 0.8;
      put(x, 4, () => iso.box(x - 0.22, x + 0.22, 3.4 + k * 2, 6.6 + k * 2, 0.18, 0.6, '#9A8064'));
    } else {
      put(x, 6, () => iso.box(x - 0.22, x + 0.22, 5.4, 8.6, 0.05, 0.47, '#9A8064'));
    }
  } else if (o.kind === 'deer') {
    const run = o.state === 'cleared' ? Math.min(1, age / 0.9) : 0;
    if (run < 1 && o.state !== 'hit') {
      for (let i = 0; i < 3; i++) {
        const dx = x + (i - 1) * 1.4;
        const dy = -0.6 + i * 0.6 + run * 9 * (i % 2 ? 1 : -1);
        put(dx, dy, () => deer(iso, dx, dy, run > 0 ? Math.sin(r.time * 20) * 0.2 : 0));
      }
      if (o.state === 'wait') {
        const [cx, cy] = iso.P(x, 0, 1);
        const rr = 2.6 * iso.s;
        hits.push({ kind: 'obstacle', ref: o, x: cx, y: cy, r: Math.max(44, rr * 1.2) });
        labels.push(() => {
          ctx.setLineDash([7, 5]);
          iso.ell(cx, cy, rr, rr * 0.6, 'rgba(228,85,58,0.1)', 2.2, '#E4553A');
          ctx.setLineDash([]);
          pill(ctx, cx, cy - rr * 0.6 - 16, 'タップで警笛！', '#E4553A', '#FFFDF6', 12);
        });
      }
    }
  } else if (o.kind === 'curve') {
    // 速度制限の標識と、区間の印
    for (const sx of [x, x + o.len]) {
      put(sx, 2.0, () => {
        iso.box(sx - 0.1, sx + 0.1, 1.95, 2.15, 0, 3.0, '#3A3631');
        const [px, py] = iso.P(sx, 2.0, 3.8);
        iso.ell(px, py, Math.max(9, 1.0 * iso.s), Math.max(9, 1.0 * iso.s), '#FFFDF6', 3, '#E4553A');
        ctx.fillStyle = INK;
        ctx.font = `900 ${Math.max(9, iso.s * 1.0)}px "Zen Maru Gothic", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(CURVE_V), px, py + 0.5);
      });
    }
    put(x + o.len / 2, -1.5, () => {
      for (let k = 0; k < o.len; k += 1) iso.rectZ(x + k, x + k + 1, -1.9, -1.5, 0.21, k % 2 ? '#1F1B16' : '#E9B23E', 0);
      for (let k = 0; k < o.len; k += 1) iso.rectZ(x + k, x + k + 1, 1.5, 1.9, 0.21, k % 2 ? '#1F1B16' : '#E9B23E', 0);
    });
    if (next) labels.push(() => {
      const [sx, sy] = iso.P(x + o.len / 2, 0, 5.0);
      pill(ctx, sx, sy - 10, `急カーブ ${CURVE_V}km/h以下で通過`, '#FFFDF6', INK, 11);
    });
  }
}

function deer(iso: Iso, x: number, y: number, hop: number) {
  const z = Math.max(0, hop);
  iso.box(x - 0.5, x + 0.5, y - 0.2, y + 0.2, 0.9 + z, 1.5 + z, '#B98A5E');
  for (const [lx, ly] of [[-0.4, -0.12], [-0.4, 0.12], [0.4, -0.12], [0.4, 0.12]]) iso.box(x + lx - 0.06, x + lx + 0.06, y + ly - 0.06, y + ly + 0.06, z, 0.9 + z, '#8E6640', { lw: iso.lw * 0.5 });
  iso.box(x + 0.45, x + 0.8, y - 0.14, y + 0.14, 1.4 + z, 2.0 + z, '#B98A5E');
  iso.line([x + 0.6, y, 2.0 + z], [x + 0.5, y - 0.3, 2.6 + z], INK, iso.lw);
  iso.line([x + 0.7, y, 2.0 + z], [x + 0.8, y + 0.3, 2.6 + z], INK, iso.lw);
}

// ---------------- 上のバー（この先の障害と駅） ----------------
export function drawBar(ctx: CanvasRenderingContext2D, r: Run, w: number, y: number) {
  const pad = 16;
  const st = Math.min(r.target, LINE.stations.length - 1);
  const sec = r.phase === 'dwell' ? r.target : r.target - 1;
  const a = POS[Math.max(0, sec)];
  const b = POS[Math.min(LINE.stations.length - 1, sec + 1)];
  const x0 = pad;
  const x1 = w - pad;
  const map = (x: number) => x0 + ((x - a) / (b - a)) * (x1 - x0);
  ctx.lineWidth = 2;
  ctx.strokeStyle = INK;
  ctx.fillStyle = '#FFFDF6';
  ctx.beginPath();
  ctx.roundRect(x0, y, x1 - x0, 9, 5);
  ctx.fill();
  ctx.stroke();
  const px = Math.max(x0, Math.min(x1, map(r.phase === 'dwell' ? a : r.x)));
  ctx.fillStyle = '#6FC3A0';
  ctx.beginPath();
  ctx.roundRect(x0, y, Math.max(9, px - x0), 9, 5);
  ctx.fill();
  ctx.stroke();
  for (const o of r.obstacles[sec] ?? []) {
    const ox = map(o.x);
    const done = o.state !== 'wait';
    ctx.globalAlpha = done ? 0.35 : 1;
    ctx.beginPath();
    ctx.arc(ox, y + 4.5, 12, 0, Math.PI * 2);
    ctx.fillStyle = o.kind === 'pole' || o.kind === 'deer' ? '#FBE3DC' : o.kind === 'tree' ? '#FFF4DA' : '#FFFDF6';
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = INK;
    ctx.font = '900 12px "Zen Maru Gothic", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(OBS_INFO[o.kind].ch, ox, y + 5);
    ctx.font = '700 10px "Zen Maru Gothic", sans-serif';
    const sub = o.kind === 'tree' ? `${treeNeed(r)}↑` : o.kind === 'curve' ? `${CURVE_V}↓` : o.kind === 'pole' ? `連打${o.need}` : 'タップ';
    ctx.fillText(sub, ox, y + 27);
    ctx.globalAlpha = 1;
  }
  // 駅
  const sx = map(b);
  ctx.beginPath();
  ctx.arc(sx - 6, y + 4.5, 11, 0, Math.PI * 2);
  ctx.fillStyle = '#E9B23E';
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = INK;
  ctx.font = '900 11px "Zen Maru Gothic", sans-serif';
  ctx.fillText('駅', sx - 6, y + 5);
  ctx.textAlign = 'right';
  ctx.font = '700 10px "Zen Maru Gothic", sans-serif';
  ctx.fillText(LINE.stations[Math.min(LINE.stations.length - 1, sec + 1)].name, x1, y + 27);
  // 停止範囲の案内
  if (r.phase === 'running') {
    const d = POS[st] + STOP_LO - r.x;
    ctx.textAlign = 'left';
    ctx.font = '700 11px "Zen Maru Gothic", sans-serif';
    ctx.fillText(d > 0 ? `${LINE.stations[st].name}の停止範囲まで ${Math.round(d)}m` : r.x <= POS[st] + STOP_HI ? '停止範囲内。止まれば停車' : 'オーバーラン！', x0, y - 10);
  }
}

// ---------------- 中 ----------------
export function drawInside(ctx: CanvasRenderingContext2D, r: Run, w: number, top: number, bottom: number, drag: { id: number; sx: number; sy: number } | null, hits: Hit[]) {
  const L = CAR_LEN;
  const s = Math.max(12, Math.min((w - 20) / ((L + 2.6) * C30), (bottom - top - 40) / ((L + 2.6) * 0.5 + 4.2), 40));
  const iso = new Iso(ctx, s, 0, 0);
  const [cx, cy] = iso.P(L / 2, 0, 0.7);
  iso.ox = w / 2 - cx;
  iso.oy = (top + bottom) / 2 - cy + 0.6 * s;
  const color = '#6FC3A0';
  // 線路
  const off = ((r.x % 1.2) + 1.2) % 1.2;
  iso.rectZ(-6, L + 6, -1.9, 1.9, -1.32, '#E6DCC8', 0);
  for (let x = -6 - off; x < L + 6; x += 1.2) iso.rectZ(x, x + 0.42, -1.5, 1.5, -1.3, '#D6CBB6', 0);
  iso.rectZ(-6, L + 6, -0.72, -0.56, -1.22, '#B9B0A2', 0);
  iso.rectZ(-6, L + 6, 0.56, 0.72, -1.22, '#B9B0A2', 0);
  // 台車
  iso.box(1.6, 3.8, -1.0, 1.0, -1.0, -0.42, '#2B2824');
  iso.box(L - 3.8, L - 1.6, -1.0, 1.0, -1.0, -0.42, '#2B2824');
  for (const wx of [2.1, 3.3, L - 3.3, L - 2.1]) {
    const [px, py] = iso.P(wx, 1.02, -0.92);
    iso.ell(px, py, 0.36 * s, 0.36 * s, '#3A3631', iso.lw);
    iso.ell(px + Math.cos(r.x / 0.45) * 0.18 * s, py + Math.sin(r.x / 0.45) * 0.18 * s, 0.07 * s, 0.07 * s, '#9A9184', 0);
  }
  // 床
  iso.box(0, L, -1.3, 1.3, -0.28, 0, color, { top: '#EADFC8', sx: shade(color, 0.72), sy: shade(color, 0.88) });
  for (let x = 2; x < L; x += 2) iso.line([x, -1.25, 0.002], [x, 1.25, 0.002], 'rgba(31,27,22,0.12)', 1);
  const doors = [3, 9];
  for (const d of doors) {
    iso.rectZ(d - 0.62, d + 0.62, 1.04, 1.3, 0.004, '#E9B23E', 0);
    iso.rectZ(d - 0.62, d + 0.62, -1.3, -1.04, 0.004, '#E9B23E', 0);
  }
  // 立ち位置の目印
  SPOTS.forEach((sp, i) => {
    const [mx, my] = iso.P(sp.x, sp.y, sp.kind === 'seat' ? 0.53 : 0.006);
    const occ = r.pax.some((p) => p.spot === i);
    hits.push({ kind: 'spot', ref: i, x: mx, y: my, r: 0.9 * s });
    if (sp.kind === 'seat') return;
    ctx.setLineDash(occ ? [] : [4, 3]);
    iso.ell(mx, my, 0.42 * s * 1.22, 0.42 * s * 0.7, sp.kind === 'strap' ? 'rgba(91,184,201,0.25)' : 'rgba(31,27,22,0.04)', 1.4, sp.kind === 'strap' ? '#3F8FA3' : '#9A9184');
    ctx.setLineDash([]);
  });
  // 奥の壁と座席（2つだけ）
  iso.box(0, L, -1.3, -1.2, 0, 0.32, color, { lw: iso.lw * 0.8 });
  const b0 = 4.6;
  const b1 = 7.4;
  iso.box(b0, b1, -1.2, -0.78, 0, 0.4, '#B3A68E', { lw: iso.lw * 0.8 });
  iso.box(b0, b1, -1.2, -0.74, 0.4, 0.52, '#6FBF95', { lw: iso.lw * 0.8 });
  iso.box(b0, b1, -1.2, -1.05, 0.52, 1.0, '#5DAA84', { lw: iso.lw * 0.8 });
  // 人と手すり（奥から）
  const items: { d: number; f: () => void }[] = [];
  const badges: (() => void)[] = [];
  const o = nextObstacle(r);
  const shock = o ? predictShock(r, o, o.kind === 'tree' ? Math.max(r.v, (treeNeed(r) + 2) / 3.6) : r.v) : 0;
  for (const p of r.pax) {
    if (drag && drag.id === p.id) continue;
    const sp = SPOTS[p.spot];
    if (!sp) continue;
    items.push({
      d: sp.x + sp.y,
      f: () => {
        const seat = sp.kind === 'seat';
        const [mx, my] = iso.P(sp.x, sp.y + (seat ? 0.55 : 0), 0.006);
        iso.ell(mx, my, 0.2 * s * 1.22, 0.2 * s * 0.7, DEST_COLORS[p.dest] ?? '#B9B0A2', iso.lw * 0.8);
        const h = sized(iso, sp.x, sp.y, 0, p, seat ? 'sit' : 'stand', seat ? 2 : 0, scaleOf(p));
        hits.push({ kind: 'pax', ref: p, x: h.hx, y: h.hy + h.hr * 2.5, r: Math.max(22, h.hr * 3.4) });
        const tol = effTol(r, p);
        const ok = !o || shock <= tol;
        badges.push(() => tagAt(ctx, h.hx, h.hy - h.hr * 1.5 - 4, `${KINDS[p.kind].name} ${tol}${o ? (ok ? ' ◯' : ' ✕') : ''}`, ok ? '#6FC3A0' : '#E4553A', ok ? INK : '#FFFDF6'));
      },
    });
  }
  for (const d of doors) {
    for (const [px, py] of [[d - 0.72, -0.72], [d + 0.72, -0.72], [d - 0.72, 0.72], [d + 0.72, 0.72]] as [number, number][]) {
      items.push({
        d: px + py + (py > 0 ? 0.3 : 0),
        f: () => {
          iso.line([px, py, 0], [px, py, 2.05], INK, 0.12 * s + 1.4);
          iso.line([px, py, 0], [px, py, 2.05], '#D8D2C6', Math.max(0.5, 0.12 * s - 0.4));
        },
      });
    }
  }
  items.sort((a, b) => a.d - b.d).forEach((i) => i.f());
  // 手前の腰壁
  let px0 = 0;
  for (const d of [...doors, L + 0.62]) {
    if (d - 0.62 - px0 > 0.05) iso.box(px0, d - 0.62, 1.2, 1.3, 0, 0.32, color, { lw: iso.lw * 0.8 });
    px0 = d + 0.62;
  }
  // つり革
  iso.line([0.4, 0.4, 2.05], [L - 0.4, 0.4, 2.05], '#9A9184', Math.max(1, s * 0.07));
  for (const sp of SPOTS) {
    if (sp.kind !== 'strap') continue;
    iso.line([sp.x, sp.y, 2.05], [sp.x, sp.y, 1.8], '#3F8FA3', 1.6);
    const [rx, ry] = iso.P(sp.x, sp.y, 1.72);
    iso.ell(rx, ry, 0.09 * s, 0.09 * s, null, 2.2, '#3F8FA3');
  }
  // 床の文字
  iso.label(6, -1.15, 1.3, `座席 −${r.mods.has('belt') ? 50 : 20}`, 11, '#2E8F62');
  iso.label(8.8, 1.05, 0.02, 'つり革 −10', 11, '#3F8FA3');
  iso.label(2.2, -0.6, 0.02, '通路 ±0', 11, '#5A5045');
  badges.forEach((f) => f());
  // 持ち上げている客
  if (drag) {
    const p = r.pax.find((q) => q.id === drag.id);
    if (p) {
      const sub = new Iso(ctx, s * scaleOf(p), drag.sx, drag.sy + 1.2 * s);
      sub.lw = iso.lw;
      drawPerson(sub, 0, 0, 0, look(p), { pose: 'stand', facing: 0, lift: 0.2 });
    }
  }
  return { shock, obstacle: o };
}

export { hash };
