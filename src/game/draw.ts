// 試作 v0.7 の描画：外（台座＋障害）、中（1両）、上のバー。

import { CAR_LEN, DEST_COLORS } from '../data.ts';
import { carColor, drawExterior, type ExtResult } from '../exterior.ts';
import type { Game } from '../game.ts';
import { C30, INK, Iso, hash, shade } from '../iso.ts';
import { drawPerson, type Facing } from '../people.ts';
import {
  curveV,
  chuteSlack,
  workV,
  obsTag,
  FLOOD_V,
  WORK_EVAC,
  WORK_REACH,
  KINDS,
  LINE,
  OBS_INFO,
  POS,
  STOP_HI,
  STOP_LO,
  WAVE_PERIOD,
  PLAT_HI,
  PLAT_LO,
  brakeShock,
  flight,
  matWidth,
  spotZ,
  spotWorldX,
  launchBoost,
  cannonReady,
  jumpPlan,
  jumpVz,
  threat,
  ghostX,
  WAVE_UP,
  waveUp,
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
    stats: { cars: r.cars, doorsPerCar: 2, levels: { capacity: r.decks - 1, cooler: 1 } },
    waiting: 0,
    doorAnim: r.doorAnim,
    layout: new Array(5),
    passengers: r.pax.map((p) => ({ car: r.spots[p.spot]?.car ?? 0 })),
    lift: r.z,
  } as unknown as Game;
}

function look(p: Pax) {
  const l = p.look;
  if (p.kind === 'sumo') return { ...l, shirt: '#F0C9A0', pants: '#3A3631', skin: '#F0C9A0', hairStyle: 2, hat: 0, bag: 0, hair: '#24211D' };
  if (p.kind === 'stu') return { ...l, shirt: '#2D3550', pants: '#2D3550', hat: 0 };
  if (p.kind === 'old') return { ...l, shirt: '#B9B0A2', pants: '#6B655C', hair: '#E6E1D8', hairStyle: 2, hat: 0 };
  if (p.kind === 'vip') return { ...l, shirt: '#B98ADB', pants: '#3A3631', hat: 0, bag: 1 };
  if (p.kind === 'kid') return { ...l, shirt: '#E9B23E', hat: 1 };
  if (p.kind === 'bride') return { ...l, shirt: '#FFFFFF', pants: '#FFFFFF', hairStyle: 2, hat: 0, bag: 0, dress: true };
  if (p.kind === 'carp') return { ...l, shirt: '#E9A23E', pants: '#5E6E8C', hat: 1, hatColor: '#F3D27F', bag: 0 };
  if (p.kind === 'tour') return { ...l, shirt: '#7EC8E3', pants: '#E9DCC0', hat: 1, hatColor: '#FFF4DA', bag: 2, camera: true };
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
export function drawOutside(ctx: CanvasRenderingContext2D, r: Run, w: number, top: number, bottom: number, hits: Hit[], zoom = 1): ExtResult {
  const g = fakeGame(r);
  const sec = r.phase === 'dwell' ? r.target : r.target - 1;
  const obs = r.obstacles[sec] ?? [];
  const labels: (() => void)[] = [];
  // ジャンプの着地点まで見えるように前を広げる
  const jp0 = jumpPlan(r);
  const res = drawExterior(ctx, g, w, top, bottom, {
    ahead: jp0 ? Math.max(46, Math.min(80, jp0.land - r.x + 10)) : 46,
    zoom,
    // 停車中は編成の真ん中、走行中は先頭の少し先を中心に寄る
    focus: r.phase === 'dwell' ? r.x - (r.cars * 12) / 2 : r.x + 4,
    extra: (iso, put) => {
      for (const o of obs) drawObstacle(iso, put, r, o, labels, hits);
      // 着地マット
      for (let i = 1; i < LINE.stations.length; i++) {
        const m = r.mats[i];
        const mw = matWidth(r);
        if (!iso.inX(m.x - mw, m.x + mw)) continue;
        put(m.x, 3.7, () => {
          iso.box(m.x - mw / 2, m.x + mw / 2, 2.6, 4.9, 1.05, 1.28, i === r.target ? '#E4553A' : '#F08E78', { top: i === r.target ? '#F2C94C' : '#F3D27F' });
          iso.label(m.x, 3.75, 1.35, '×2', 13, INK);
        });
      }
      // ゴースト列車（ダイヤどおりの位置）
      if (r.phase === "running" && !r.demo) {
        const gx = ghostX(r.clock);
        if (iso.inX(gx - 12, gx) && Math.abs(gx - r.x) > 1) {
          put(gx - 6, 0.01, () => {
            ctx.globalAlpha = 0.32;
            iso.box(gx - 11.7, gx - 0.3, -1.3, 1.3, 0.95, 3.85, '#8299E0', { lw: iso.lw * 0.8 });
            ctx.globalAlpha = 1;
          });
          labels.push(() => {
            const [lx, ly] = iso.P(gx - 6, 0, 5.2);
            pill(ctx, lx, ly, 'ダイヤ', '#CFD8F5', '#2C47A0', 10);
          });
        }
      }
      // ホームの候補
      if (r.phase === 'dwell') {
        const stop = POS[r.target];
        r.candidates.forEach((c, i) => {
          const x = stop - 21 + i * 2.6;
          const y = 3.1 + (i % 2) * 0.9;
          const picked = r.picked.has(c.id);
          if (picked) return; // もう車内にいる
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
      // 屋根の上の客
      const top = 0.95 + 2.9 * r.decks + 0.24 + r.z;
      if (r.roof) {
        const riders = r.pax.filter((p) => r.spots[p.spot]?.deck === 2);
        const x1 = r.x - 0.3;
        iso.box(x1 - 10.5, x1 - 1.5, -1.1, -1.0, top, top + 0.5, '#9A9184', { lw: iso.lw * 0.6 });
        for (const p of riders) {
          const sp = r.spots[p.spot];
          const wx = r.x - 12 + sp.x;
          sized(iso, wx, sp.y, top, p, 'stand', 0, scaleOf(p) * 1.0);
        }
        iso.box(x1 - 10.5, x1 - 1.5, 1.0, 1.1, top, top + 0.5, '#9A9184', { lw: iso.lw * 0.6 });
      }
      // ロケット
      if (r.mods.has('rocket')) {
        const rx = r.x - r.cars * CAR_LEN + 0.6;
        const z0 = top;
        iso.cylinder(rx + 2.2, 0, z0, z0 + 0.1, 0.1, '#6B655C');
        iso.box(rx, rx + 4.4, -0.55, 0.55, z0, z0 + 1.1, '#E4553A', { top: '#F08E78' });
        iso.box(rx + 4.4, rx + 5.0, -0.35, 0.35, z0 + 0.2, z0 + 0.9, '#FFFDF6');
        if (r.phase === 'running' && r.notch > 4) {
          const f = 1.6 + Math.sin(r.time * 40) * 0.5 + (r.notch - 4) * 1.0;
          iso.poly([[rx, -0.45, z0 + 0.1], [rx - f, 0, z0 + 0.55], [rx, 0.45, z0 + 1.0]], '#E9B23E', iso.lw);
          iso.poly([[rx, -0.25, z0 + 0.3], [rx - f * 0.6, 0, z0 + 0.55], [rx, 0.25, z0 + 0.8]], '#E4553A', 0);
        }
      }
      // 予測の放物線（駅が近いとき、今急ブレーキしたら）
      const stopX = POS[Math.min(r.target, LINE.stations.length - 1)];
      if (r.phase === 'running' && r.v > 2 && stopX - r.x < (r.air ? 200 : 130) && stopX - r.x > -10) {
        const sh = brakeShock(r);
        const flyers = r.pax.filter((p) => sh > effTol(r, p, true));
        const seen = new Set<string>();
        const boost = r.mods.has('rocket') ? 1.5 : 1;
        const mat = r.mats[r.target];
        for (const p of flyers) {
          const z = spotZ(r, p.spot);
          const f = flight(r.v, z, p.kind, launchBoost(r, p, boost));
          const x0 = spotWorldX(r, p.spot);
          const key = `${Math.round(x0 + f.dist)}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const wrong = p.dest !== r.target;
          ctx.fillStyle = wrong ? '#B53E28' : INK;
          for (let k = 1; k < 14; k++) {
            const t = (f.t * k) / 14;
            const [px, py] = iso.P(x0 + f.vx * t, 0, z + f.vz * t - (9.8 * t * t) / 2);
            ctx.beginPath();
            ctx.arc(px, py, 2.1, 0, Math.PI * 2);
            ctx.fill();
          }
          const lx = x0 + f.dist;
          const onPlat = lx >= stopX + PLAT_LO && lx <= stopX + PLAT_HI;
          const onMat = onPlat && Math.abs(lx - mat.x) <= matWidth(r) / 2;
          const [cx, cy] = iso.P(lx, 0.4, onPlat ? 1.07 : 0);
          ctx.setLineDash([5, 4]);
          iso.ell(cx, cy, 1.3 * iso.s * 1.22, 1.3 * iso.s * 0.7, wrong ? 'rgba(228,85,58,0.35)' : onMat ? 'rgba(111,195,160,0.65)' : onPlat ? 'rgba(233,178,62,0.5)' : 'rgba(228,85,58,0.3)', 2.4, wrong ? '#B53E28' : onMat ? '#2E6B53' : onPlat ? '#8A5D00' : '#B53E28');
          ctx.setLineDash([]);
          iso.label(lx, 0.4, onPlat ? 1.9 : 0.9, wrong ? `${KINDS[p.kind].ch}✕` : KINDS[p.kind].ch, 11, wrong ? '#B53E28' : INK);
        }
      }
      // 人間大砲の予測（ジャンプの瞬間に屋根の客が飛ぶ）
      const co = cannonReady(r);
      if (co) {
        const lift0 = r.z;
        const st = Math.min(r.target, LINE.stations.length - 1);
        const matC = r.mats[st];
        for (const p of r.pax) {
          if (r.spots[p.spot]?.deck !== 2 || p.dest !== st) continue;
          const z = spotZ(r, p.spot) - lift0 + co.apexZ;
          const f = flight(r.v, z, p.kind, launchBoost(r, p, 1.2));
          const x0 = co.apexX - (r.x - spotWorldX(r, p.spot));
          ctx.fillStyle = '#B98ADB';
          for (let k = 1; k < 16; k++) {
            const t = (f.t * k) / 16;
            const [px, py] = iso.P(x0 + f.vx * t, 0, z + f.vz * t - (9.8 * t * t) / 2);
            ctx.beginPath();
            ctx.arc(px, py, 2.1, 0, Math.PI * 2);
            ctx.fill();
          }
          const lx = x0 + f.dist;
          const onPlat = lx >= POS[st] + PLAT_LO && lx <= POS[st] + PLAT_HI;
          const onMat = onPlat && Math.abs(lx - matC.x) <= matWidth(r) / 2;
          const [cx, cy] = iso.P(lx, 0.4, onPlat ? 1.07 : 0);
          ctx.setLineDash([5, 4]);
          iso.ell(cx, cy, 1.3 * iso.s * 1.22, 1.3 * iso.s * 0.7, onMat ? 'rgba(111,195,160,0.65)' : onPlat ? 'rgba(233,178,62,0.5)' : 'rgba(185,138,219,0.35)', 2.4, onMat ? '#2E6B53' : onPlat ? '#8A5D00' : '#7A4FA0');
          ctx.setLineDash([]);
        }
        const [tx, ty] = iso.P(co.apexX, 0, co.apexZ + 7);
        tagAt(ctx, tx, ty, r.meta.combos.cannon ? '人間大砲' : '頂点で何かが起きる…？', '#E8D8F4');
      }
      // ジャンプ：踏み切り台と着地の予測
      const jp = jumpPlan(r);
      if (jp) {
        if (!r.air) {
          // 黄色い踏み切り台（線路の上）
          const rx = jp.from;
          iso.poly([[rx - 5, -0.9, 0.3], [rx, -0.9, 1.5], [rx, 0.9, 1.5], [rx - 5, 0.9, 0.3]], '#F3D27F', iso.lw);
          iso.poly([[rx, -0.9, 0.3], [rx, -0.9, 1.5], [rx, 0.9, 1.5], [rx, 0.9, 0.3]], '#C9A04A', iso.lw);
        }
        // 電車の先頭の軌道（点線）
        const vz = r.air ? r.vz : jumpVz(r.v);
        const z0 = r.air ? r.z : 0;
        const T = (vz + Math.sqrt(vz * vz + 2 * 9.8 * z0)) / 9.8;
        ctx.fillStyle = 'rgba(46,107,83,0.85)';
        for (let k = 1; k < 18; k++) {
          const t = (T * k) / 18;
          const [px, py] = iso.P(jp.from + r.v * t, 0, 1 + z0 + vz * t - 4.9 * t * t);
          ctx.beginPath();
          ctx.arc(px, py, 1.9, 0, Math.PI * 2);
          ctx.fill();
        }
        const [lx, ly] = iso.P(jp.land, 0, 0.5);
        ctx.setLineDash([6, 4]);
        iso.ell(lx, ly, 2.4 * iso.s * 1.22, 1.2 * iso.s * 0.7, 'rgba(111,195,160,0.35)', 2.4, '#2E6B53');
        ctx.setLineDash([]);
        const sec2 = r.phase === 'dwell' ? r.target : r.target - 1;
        const over = (r.obstacles[sec2] ?? []).filter((o) => o.state === 'wait' && o.x + o.len > jp.from && o.x < jp.land).length;
        labels.push(() => tagAt(ctx, lx, ly - 18, over ? `着地（${over}つ飛び越え）` : '着地', '#DDF3E6'));
      }
      // 飛んでいる客
      for (const f of r.fliers) {
        const t = Math.min(r.time - f.t, f.tLand);
        const landed = r.time - f.t >= f.tLand;
        const x = f.x + f.vx * t;
        const zAir = Math.max(0, f.z + f.vz * t - (9.8 * t * t) / 2);
        const slack = chuteSlack(r);
        const onPlat = POS.some((pos, i) => i > 0 && f.landX >= pos + PLAT_LO - slack && f.landX <= pos + PLAT_HI + slack);
        if (landed && !onPlat) {
          const k = (r.time - f.t - f.tLand) / 1.2;
          const [sx, sy] = iso.P(f.landX, 0.4, 0);
          ctx.globalAlpha = Math.max(0, 1 - k);
          iso.ell(sx, sy, 8 + k * 30, 3 + k * 12, 'rgba(255,253,246,0.9)', 1.4);
          ctx.globalAlpha = 1;
          continue;
        }
        const h = sized(iso, landed ? f.landX : x, landed ? 0.6 : 0, landed ? 1.05 : zAir, f.pax, 'stand', landed ? 3 : ((Math.floor(t * 12) % 4) as Facing), scaleOf(f.pax) * (landed ? 1 : 1.6));
        if (!landed) tagAt(ctx, h.hx + 24, h.hy - 14, 'わ〜っ！', '#FFFDF6');
      }
      // 着地の結果
      for (const p of r.pops) {
        const k = (r.time - p.t) / 2.6;
        ctx.globalAlpha = 1 - k * k;
        coinLabel(ctx, iso, p.x, 6 + k * 3, p.text, 17, p.good ? '#2E6B53' : '#B53E28');
        ctx.globalAlpha = 1;
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
  // ジャンプで越える障害は、突破のヒントを出さない（電車と重ならないように）
  const jp = jumpPlan(r);
  const L: (() => void)[] = jp && o.x + o.len > jp.from && o.x < jp.land ? [] : labels;
  const ctx = iso.ctx;
  const age = r.time - o.t;
  const x = o.x;
  if (!iso.inX(x - 8, x + o.len + 8)) return;
  const next = nextObstacle(r) === o;
  if (o.kind === 'tree') {
    const rubble = LINE.scenery.includes('tunnel');
    const [c1, c2, c3] = rubble ? ['#A9A196', '#C9C2B6', '#8A8278'] : ['#8E6640', '#6FC3A0', '#4E9E7E'];
    if (o.state === 'wait') {
      put(x, -1, () => {
        if (rubble) {
          // 天井から落ちたコンクリート片と鉄筋
          iso.box(x - 1.2, x + 0.6, -2.4, 0.2, 0.1, 1.3, c1);
          iso.box(x - 0.4, x + 1.4, 0.0, 2.6, 0.1, 0.9, c2);
          iso.box(x - 0.9, x + 0.3, -1.0, 1.0, 1.3, 2.0, c3);
          iso.line([x - 0.5, -1.6, 1.3], [x + 0.6, -2.4, 2.8], '#7A4A32', iso.lw * 1.3);
          iso.line([x + 0.4, 1.0, 0.9], [x + 1.6, 1.6, 2.4], '#7A4A32', iso.lw * 1.3);
        } else {
          iso.box(x - 0.45, x + 0.45, -6.2, 2.8, 0.1, 0.95, c1);
          iso.box(x - 0.5, x + 0.5, -7.0, -6.0, 0, 1.4, c1);
          iso.box(x - 1.7, x + 1.5, -0.6, 2.2, 0.5, 1.9, c2);
          iso.box(x - 1.1, x + 1.2, 1.9, 3.4, 0.4, 1.5, c3);
        }
      });
      if (next) L.push(() => {
        const [sx, sy] = iso.P(x, -1, 5.5);
        pill(ctx, sx, sy - 14, `${treeNeed(r)}km/h以上で突き破れ`, '#E9B23E', INK, 11);
      });
    } else if (age < 1.2) {
      // 木っ端（ガレキなら石くず）
      for (let i = 0; i < 12; i++) {
        const bx = x + 2 + hash(i, 3) * 10 * (age + 0.2);
        const by = -3 + hash(i, 4) * 6;
        const bz = 0.4 + hash(i, 5) * 5 * Math.sin(Math.min(1, age / 1.2) * Math.PI);
        put(bx, by, () => iso.box(bx - 0.3, bx + 0.3, by - 0.15, by + 0.15, bz, bz + 0.3, i % 3 ? c1 : c2, { lw: iso.lw * 0.6 }));
      }
    } else if (o.state === 'hit' && r.v < 0.1) {
      put(x, -1, () => iso.box(x - 0.45, x + 0.45, 3.0, 6.0, 0.05, 0.8, c1));
    }
  } else if (o.kind === 'work') {
    // 工事区間：柵とコーン、線路の上の作業員（警笛で端へ退く）
    const evac = o.state !== 'wait' ? 1 : o.taps === 0 ? Math.min(1, (r.time - o.t) / WORK_EVAC) : 0;
    put(x - 3, 2.6, () => {
      for (const cx of [x - 4, x - 1.5, x + 9, x + 11.5]) {
        iso.box(cx - 0.35, cx + 0.35, 2.3, 2.9, 0, 0.25, '#E4553A');
        iso.box(cx - 0.22, cx + 0.22, 2.4, 2.8, 0.25, 1.1, '#F39800', { top: '#FFFDF6' });
      }
      iso.box(x - 0.2, x + 8.2, 2.5, 2.7, 0.7, 1.15, '#F3D27F');
      for (let k = 0; k < 8; k += 2) iso.box(x + k, x + k + 1, 2.48, 2.72, 0.7, 1.15, '#3A3631', { lw: iso.lw * 0.5 });
    });
    for (let i = 0; i < 2; i++) {
      const wx = x + 2 + i * 3.5;
      const wy = -0.8 + i * 1.4 + evac * (3.6 - i * 0.4);
      put(wx, wy, () => worker(iso, wx, wy, o.state === 'wait' && o.taps > 0 ? Math.sin(r.time * 6 + i) : 0, evac > 0 && evac < 1 ? Math.sin(r.time * 22) * 0.15 : 0));
    }
    if (o.state === 'wait' && o.taps > 0) {
      const [cx, cy] = iso.P(x + 3.5, 0, 1);
      const rr = 3 * iso.s;
      const reach = o.x - r.x <= WORK_REACH;
      if (reach || r.phase !== 'running') hits.push({ kind: 'obstacle', ref: o, x: cx, y: cy, r: Math.max(44, rr * 1.2) });
      if (next) L.push(() => {
        if (reach) {
          ctx.setLineDash([7, 5]);
          iso.ell(cx, cy, rr, rr * 0.58, 'rgba(228,85,58,0.12)', 2.4, '#E4553A');
          ctx.setLineDash([]);
        }
        pill(ctx, cx, cy - rr * 0.6 - 16, reach ? `タップで警笛！ あと${o.taps}回` : `${workV(r)}km/h以下で通過／近づいて警笛`, reach ? '#E4553A' : '#FFFDF6', reach ? '#FFFDF6' : INK, 12);
      });
    }
  } else if (o.kind === 'slope') {
    // 坂：勾配標と、坂の区間の線路わきの帯
    const up = (o.dir ?? 1) > 0;
    put(x, 2.2, () => {
      iso.box(x - 0.08, x + 0.08, 2.1, 2.3, 0, 2.4, '#3A3631');
      iso.box(x - 0.1, x + 0.1, 1.6, 2.8, 2.0, 2.9, '#FFFDF6');
      iso.line([x, 1.75, up ? 2.15 : 2.75], [x, 2.65, up ? 2.75 : 2.15], '#3A3631', iso.lw * 1.6);
    });
    put(x + o.len / 2, -2.4, () => {
      const n = Math.ceil(o.len / 4);
      const col = up ? '228,85,58' : '91,184,201';
      for (let k = 0; k < n; k++) {
        const t = k / n;
        const a0 = 0.45 + 0.45 * (up ? t : 1 - t);
        // 線路わきの帯と、レールの間の「く」の字（坂の向き）
        iso.rectZ(x + k * 4, x + k * 4 + 2.6, -2.6, -2.1, 0.06, `rgba(${col},${a0})`, 0);
        iso.rectZ(x + k * 4, x + k * 4 + 2.6, 2.1, 2.6, 0.06, `rgba(${col},${a0})`, 0);
        const cx = x + k * 4 + 1.3;
        const tip = up ? 0.7 : -0.7;
        iso.line([cx - tip, -0.9, 0.25], [cx + tip, 0, 0.25], `rgba(${col},${a0 + 0.1})`, iso.lw * 2.2);
        iso.line([cx + tip, 0, 0.25], [cx - tip, 0.9, 0.25], `rgba(${col},${a0 + 0.1})`, iso.lw * 2.2);
      }
    });
    if (next) L.push(() => {
      const [sx, sy] = iso.P(x + o.len / 2, 0, 4);
      pill(ctx, sx, sy - 10, up ? '上り坂：速さが落ちる' : '下り坂：勝手に速くなる', up ? '#F3D27F' : '#CFE6EE', INK, 11);
    });
  } else if (o.kind === 'flood') {
    // 浸水区間：線路が水につかっている
    put(x + o.len / 2, -2, () => {
      iso.rectZ(x - 1, x + o.len + 1, -3.4, 3.4, 0.32, 'rgba(91,184,201,0.55)', 0);
      for (let i = 0; i < 9; i++) {
        const fx = x + ((i * 4.7 + r.time * 2) % o.len);
        const fy = -2.6 + hash(i, 7) * 5.2;
        iso.rectZ(fx, fx + 1.4, fy, fy + 0.12, 0.34, 'rgba(255,253,246,0.8)', 0);
      }
      if (o.state === 'hit' && r.time - o.t < 1.2) {
        const k = (r.time - o.t) / 1.2;
        for (let i = 0; i < 10; i++) {
          const bx = o.t ? r.x + hash(i, 2) * 4 : x;
          const by = -2 + hash(i, 3) * 4;
          const bz = 0.4 + Math.sin(k * Math.PI) * (2 + hash(i, 4) * 3);
          iso.box(bx - 0.25, bx + 0.25, by - 0.25, by + 0.25, bz, bz + 0.4, '#5BB8C9', { top: '#CFE6EE', lw: iso.lw * 0.5 });
        }
      }
    });
    if (next) L.push(() => {
      const [sx, sy] = iso.P(x + o.len / 2, 0, 4);
      pill(ctx, sx, sy - 10, `浸水区間 ${FLOOD_V}km/h以下でそろそろと`, '#5BB8C9', '#FFFDF6', 12);
    });
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
      L.push(() => {
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
        L.push(() => {
          ctx.setLineDash([7, 5]);
          iso.ell(cx, cy, rr, rr * 0.6, 'rgba(228,85,58,0.1)', 2.2, '#E4553A');
          ctx.setLineDash([]);
          pill(ctx, cx, cy - rr * 0.6 - 16, 'タップで警笛！', '#E4553A', '#FFFDF6', 12);
        });
      }
    }
  } else if (o.kind === 'wave') {
    const ph = r.time % WAVE_PERIOD;
    const up = waveUp(r.time);
    const k = up ? Math.sin((ph / WAVE_UP) * Math.PI) : 0;
    put(x + o.len / 2, -2, () => {
      iso.rectZ(x - 2, x + o.len + 2, -9.5, 2.5, 0.25, 'rgba(91,184,201,' + (0.15 + k * 0.35) + ')', 0);
      if (k > 0.05) {
        iso.box(x, x + o.len, -9 + k * 4, -3 + k * 5.5, 0.2, 0.2 + k * 3.6, '#5BB8C9', { top: '#CFE6EE' });
        for (let i = 0; i < 5; i++) {
          const fx = x + (i + 0.5) * (o.len / 5);
          iso.box(fx - 0.9, fx + 0.9, -3.3 + k * 5.5, -2.9 + k * 5.5, 0.2 + k * 3.6, 0.6 + k * 3.8, '#FFFDF6', { lw: iso.lw * 0.6 });
        }
      }
    });
    if (next) L.push(() => {
      const [sx, sy] = iso.P(x + o.len / 2, 0, 5);
      pill(ctx, sx, sy - 10, up ? '波が来ている！' : `波が引いた！ 今のうち（${(WAVE_PERIOD - ph).toFixed(1)}秒）`, up ? '#E4553A' : '#6FC3A0', up ? '#FFFDF6' : INK, 12);
    });
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
        ctx.fillText(String(curveV(r)), px, py + 0.5);
      });
    }
    put(x + o.len / 2, -1.5, () => {
      for (let k = 0; k < o.len; k += 1) iso.rectZ(x + k, x + k + 1, -1.9, -1.5, 0.21, k % 2 ? '#1F1B16' : '#E9B23E', 0);
      for (let k = 0; k < o.len; k += 1) iso.rectZ(x + k, x + k + 1, 1.5, 1.9, 0.21, k % 2 ? '#1F1B16' : '#E9B23E', 0);
    });
    if (next) L.push(() => {
      const [sx, sy] = iso.P(x + o.len / 2, 0, 5.0);
      pill(ctx, sx, sy - 10, `急カーブ ${curveV(r)}km/h以下で通過`, '#FFFDF6', INK, 11);
    });
  }
}

/** 作業員（ヘルメットと反射ベスト）。wave は旗振り、shake は慌てて走る揺れ */
function worker(iso: Iso, x: number, y: number, wave: number, shake: number) {
  const z = Math.abs(shake);
  iso.box(x - 0.18, x + 0.18, y - 0.22, y + 0.22, z, z + 0.8, '#3A3631');
  iso.box(x - 0.24, x + 0.24, y - 0.3, y + 0.3, z + 0.8, z + 1.55, '#F39800');
  iso.box(x - 0.24, x + 0.24, y - 0.31, y + 0.31, z + 1.1, z + 1.22, '#F3D27F', { lw: iso.lw * 0.4 });
  iso.box(x - 0.17, x + 0.17, y - 0.17, y + 0.17, z + 1.55, z + 1.9, '#F0C9A0');
  iso.box(x - 0.23, x + 0.23, y - 0.23, y + 0.23, z + 1.9, z + 2.08, '#F3D27F');
  if (wave) iso.line([x, y + 0.3, z + 1.45], [x + wave * 0.4, y + 0.6, z + 2.4], '#E4553A', iso.lw * 1.6);
}

function deer(iso: Iso, x: number, y: number, hop: number) {
  const z = Math.max(0, hop);
  iso.box(x - 0.5, x + 0.5, y - 0.2, y + 0.2, 0.9 + z, 1.5 + z, '#B98A5E');
  for (const [lx, ly] of [[-0.4, -0.12], [-0.4, 0.12], [0.4, -0.12], [0.4, 0.12]]) iso.box(x + lx - 0.06, x + lx + 0.06, y + ly - 0.06, y + ly + 0.06, z, 0.9 + z, '#8E6640', { lw: iso.lw * 0.5 });
  iso.box(x + 0.45, x + 0.8, y - 0.14, y + 0.14, 1.4 + z, 2.0 + z, '#B98A5E');
  iso.line([x + 0.6, y, 2.0 + z], [x + 0.5, y - 0.3, 2.6 + z], INK, iso.lw);
  iso.line([x + 0.7, y, 2.0 + z], [x + 0.8, y + 0.3, 2.6 + z], INK, iso.lw);
}

// ---------------- 上のバー：上段に全駅、下段に今の区間 ----------------
export const BAR_H = 58;
export function drawBar(ctx: CanvasRenderingContext2D, r: Run, w: number, y: number) {
  const pad = 18;
  const n = LINE.stations.length;
  const st = Math.min(r.target, n - 1);
  const x0 = pad;
  const x1 = w - pad;
  const total = POS[n - 1];
  const mapAll = (x: number) => x0 + (Math.max(0, Math.min(total, x)) / total) * (x1 - x0);
  // 上段の背景（タップで路線図）
  ctx.fillStyle = 'rgba(255,253,246,0.85)';
  ctx.beginPath();
  ctx.roundRect(6, y - 10, w - 12, 46, 12);
  ctx.fill();
  ctx.strokeStyle = 'rgba(31,27,22,0.25)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  // 線
  ctx.strokeStyle = INK;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x0, y + 4);
  ctx.lineTo(x1, y + 4);
  ctx.stroke();
  ctx.strokeStyle = '#6FC3A0';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x0, y + 4);
  ctx.lineTo(mapAll(r.x), y + 4);
  ctx.stroke();
  // 降りる人の数
  const counts = LINE.stations.map((_, i) => r.pax.filter((p) => p.dest === i).length);
  LINE.stations.forEach((s, i) => {
    const sx = mapAll(POS[i]);
    const passed = i < st || (i === st && r.phase === 'dwell');
    ctx.beginPath();
    ctx.arc(sx, y + 4, i === st ? 6 : 4.5, 0, Math.PI * 2);
    ctx.fillStyle = i === st ? '#E9B23E' : passed ? '#6FC3A0' : '#FFFDF6';
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1.8;
    ctx.stroke();
    ctx.fillStyle = passed && i !== st ? '#9A9184' : INK;
    ctx.font = `900 ${i === st ? 10.5 : 9.5}px "Zen Maru Gothic", sans-serif`;
    ctx.textAlign = i === 0 ? 'left' : i === n - 1 ? 'right' : 'center';
    ctx.textBaseline = 'alphabetic';
    const label = s.name.length > 4 && i !== st ? s.name.slice(0, 3) + '…' : s.name;
    ctx.fillText(label, sx + (i === 0 ? -6 : i === n - 1 ? 6 : 0), y - 1);
    // 降りる客の点
    const c = counts[i];
    for (let k = 0; k < Math.min(c, 4); k++) {
      ctx.beginPath();
      ctx.arc(sx - (Math.min(c, 4) - 1) * 4 + k * 8, y + 19, 3.3, 0, Math.PI * 2);
      ctx.fillStyle = DEST_COLORS[i];
      ctx.fill();
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
    if (c > 4) {
      ctx.fillStyle = INK;
      ctx.font = '900 9px "Zen Maru Gothic", sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(`+${c - 4}`, sx + 14, y + 22);
    }
  });
  // ゴーストと自分
  const gx = mapAll(ghostX(r.clock));
  ctx.globalAlpha = 0.45;
  ctx.fillStyle = '#8299E0';
  ctx.beginPath();
  ctx.roundRect(gx - 7, y - 1, 14, 10, 3);
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1.2;
  ctx.setLineDash([2, 2]);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
  const tx = mapAll(r.x);
  ctx.fillStyle = '#6FC3A0';
  ctx.beginPath();
  ctx.roundRect(tx - 8, y - 2, 16, 12, 3);
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = INK;
  ctx.font = '900 9px "Zen Maru Gothic", sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText('タップで路線図・ダイヤ', x1 + 6, y + 31);

}

/** 今の区間の障害バー（下のパネルの小さなキャンバスに描く） */
export function drawSection(ctx: CanvasRenderingContext2D, r: Run, w: number, yb: number) {
  const pad = 18;
  const n = LINE.stations.length;
  const st = Math.min(r.target, n - 1);
  const sec = r.phase === 'dwell' ? r.target : r.target - 1;
  const x0 = pad;
  const x1 = w - pad;
  const a = POS[Math.max(0, sec)];
  const b = POS[Math.min(n - 1, sec + 1)];
  const map = (x: number) => x0 + ((x - a) / (b - a)) * (x1 - x0);
  ctx.lineWidth = 2;
  ctx.strokeStyle = INK;
  ctx.fillStyle = '#FFFDF6';
  ctx.beginPath();
  ctx.roundRect(x0, yb, x1 - x0, 9, 5);
  ctx.fill();
  ctx.stroke();
  const px = Math.max(x0, Math.min(x1, map(r.phase === 'dwell' ? a : r.x)));
  ctx.fillStyle = '#6FC3A0';
  ctx.beginPath();
  ctx.roundRect(x0, yb, Math.max(9, px - x0), 9, 5);
  ctx.fill();
  ctx.stroke();
  // ゴースト（区間内にいるとき）
  const g = ghostX(r.clock);
  if (r.phase === 'running' && g >= a && g <= b) {
    const gxx = map(g);
    ctx.globalAlpha = 0.6;
    ctx.fillStyle = '#8299E0';
    ctx.beginPath();
    ctx.moveTo(gxx, yb - 2);
    ctx.lineTo(gxx - 6, yb - 10);
    ctx.lineTo(gxx + 6, yb - 10);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  for (const o of r.obstacles[sec] ?? []) {
    const ox = map(o.x);
    const done = o.state !== 'wait';
    ctx.globalAlpha = done ? 0.35 : 1;
    ctx.beginPath();
    ctx.arc(ox, yb + 4.5, 13, 0, Math.PI * 2);
    ctx.fillStyle = o.kind === 'pole' || o.kind === 'deer' || o.kind === 'work' ? '#FBE3DC' : o.kind === 'tree' ? '#FFF4DA' : o.kind === 'wave' || o.kind === 'flood' ? '#CFE6EE' : '#FFFDF6';
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.stroke();
    ctx.fillStyle = INK;
    ctx.font = '900 12px "Zen Maru Gothic", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(OBS_INFO[o.kind].ch, ox, yb + 5);
    ctx.font = '900 10px "Zen Maru Gothic", sans-serif';
    const sub = obsTag(r, o);
    ctx.fillText(sub, ox, yb + 27);
    ctx.globalAlpha = 1;
  }
  const sx = map(b);
  ctx.beginPath();
  ctx.arc(sx - 6, yb + 4.5, 11, 0, Math.PI * 2);
  ctx.fillStyle = '#E9B23E';
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.fillStyle = INK;
  ctx.font = '900 11px "Zen Maru Gothic", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('駅', sx - 6, yb + 5);
  ctx.textAlign = 'right';
  const name = LINE.stations[Math.min(n - 1, sec + 1)].name;
  if (r.phase === 'running') {
    const d = POS[st] + STOP_LO - r.x;
    const msg = d > 0 ? `${name} あと${Math.round(d)}m` : r.x <= POS[st] + STOP_HI ? `${name} 停止範囲内！` : '行き過ぎ！ バックで戻れる';
    ctx.fillStyle = d <= 0 && r.x <= POS[st] + STOP_HI ? '#2E6B53' : INK;
    ctx.fillText(msg, x1, yb + 27);
  } else ctx.fillText(`次 ${name}`, x1, yb + 27);
}

// ---------------- 中（1両ずつ。二階建て・屋根の上は上に浮かせて見せる） ----------------
const UZ = 4.6;
export function drawInside(ctx: CanvasRenderingContext2D, r: Run, w: number, top: number, bottom: number, drag: { id: number; sx: number; sy: number } | null, hits: Hit[], focus = 0, deck = 0) {
  const L = CAR_LEN;
  // 1度に見せるのは1つの段だけ（段はタブで切り替え）
  const levels = [deck];
  const lift = (d: number) => levels.indexOf(d) * UZ;
  const extraH = (levels.length - 1) * UZ;
  const s = Math.max(10, Math.min((w - 20) / ((L + 2.6) * C30), (bottom - top - 40) / ((L + 2.6) * 0.5 + 4.2 + extraH), 40));
  const iso = new Iso(ctx, s, 0, 0);
  const [cx, cy] = iso.P(L / 2, 0, 0.7 + extraH / 2);
  iso.ox = w / 2 - cx;
  iso.oy = (top + bottom) / 2 - cy + 0.6 * s;
  const color = carColor(focus);
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
  const threatNow = threat(r);
  const nextStop = r.phase === 'dwell' ? r.target + 1 : r.target;
  const badges: (() => void)[] = [];
  const o = nextObstacle(r);
  const shock = o ? predictShock(r, o, o.kind === 'tree' ? Math.max(r.v, (treeNeed(r) + 2) / 3.6) : r.v) : 0;

  for (const d of levels) {
    const Z = lift(d);
    const mine = r.spots.map((sp, i) => ({ sp, i })).filter(({ sp }) => sp.car === focus && sp.deck === d);
    // 上の段は点線で下の段とつなぐ
    if (levels.length > 1 && d > 0) {
      ctx.setLineDash([4, 5]);
      for (const [px, py] of [[0, -1.3], [L, -1.3], [L, 1.3], [0, 1.3]] as [number, number][]) iso.line([px, py, Z - UZ + 0.4], [px, py, Z - 0.3], '#9A8064', 1.2);
      ctx.setLineDash([]);
    }
    // 床
    if (d === 2) iso.box(0.2, L - 0.2, -1.15, 1.15, Z - 0.24, Z, '#EDE6D8', { top: '#F2ECDF' });
    else iso.box(0, L, -1.3, 1.3, Z - 0.28, Z, color, { top: '#EADFC8', sx: shade(color, 0.72), sy: shade(color, 0.88) });
    for (let x = 2; x < L; x += 2) iso.line([x, -1.15, Z + 0.002], [x, 1.15, Z + 0.002], 'rgba(31,27,22,0.12)', 1);
    const doors = d === 0 ? [3, 9] : [];
    for (const dx of doors) {
      iso.rectZ(dx - 0.62, dx + 0.62, 1.04, 1.3, Z + 0.004, '#E9B23E', 0);
      iso.rectZ(dx - 0.62, dx + 0.62, -1.3, -1.04, Z + 0.004, '#E9B23E', 0);
    }
    // 立ち位置
    for (const { sp, i } of mine) {
      const [mx, my] = iso.P(sp.x, sp.y, Z + (sp.kind === 'seat' ? 0.53 : 0.006));
      hits.push({ kind: 'spot', ref: i, x: mx, y: my, r: 0.9 * s });
      if (sp.kind === 'seat') continue;
      const occ = r.pax.some((p) => p.spot === i);
      ctx.setLineDash(occ ? [] : [4, 3]);
      iso.ell(mx, my, 0.42 * s * 1.22, 0.42 * s * 0.7, sp.kind === 'strap' ? 'rgba(91,184,201,0.25)' : 'rgba(31,27,22,0.04)', 1.4, sp.kind === 'strap' ? '#3F8FA3' : '#9A9184');
      ctx.setLineDash([]);
    }
    // 奥の壁と座席
    if (d === 2) {
      iso.box(0.2, L - 0.2, -1.15, -1.05, Z, Z + 0.5, '#9A9184', { lw: iso.lw * 0.6 });
    } else {
      iso.box(0, L, -1.3, -1.2, Z, Z + 0.32, color, { lw: iso.lw * 0.8 });
      const seatXs = mine.filter(({ sp }) => sp.kind === 'seat').map(({ sp }) => sp.x);
      if (seatXs.length) {
        const b0 = Math.min(...seatXs) - 0.6;
        const b1 = Math.max(...seatXs) + 0.6;
        iso.box(b0, b1, -1.2, -0.78, Z, Z + 0.4, '#B3A68E', { lw: iso.lw * 0.8 });
        iso.box(b0, b1, -1.2, -0.74, Z + 0.4, Z + 0.52, '#6FBF95', { lw: iso.lw * 0.8 });
        iso.box(b0, b1, -1.2, -1.05, Z + 0.52, Z + 1.0, '#5DAA84', { lw: iso.lw * 0.8 });
      }
    }
    // 人と手すり（奥から）
    const items: { d: number; f: () => void }[] = [];
    for (const p of r.pax) {
      if (drag && drag.id === p.id) continue;
      const sp = r.spots[p.spot];
      if (!sp || sp.car !== focus || sp.deck !== d) continue;
      items.push({
        d: sp.x + sp.y,
        f: () => {
          const seat = sp.kind === 'seat';
          const tol = effTol(r, p);
          const danger = threatNow > 0 && threatNow > tol && !r.airbag;
          const [mx, my] = iso.P(sp.x, sp.y + (seat ? 0.55 : 0), Z + 0.006);
          iso.ell(mx, my, 0.3 * s * 1.22, 0.3 * s * 0.7, DEST_COLORS[p.dest] ?? '#B9B0A2', threatNow > 0 ? 3 : iso.lw * 0.8, threatNow > 0 ? (danger ? '#E4553A' : '#2E8F62') : INK);
          const h = sized(iso, sp.x, sp.y, Z, p, seat ? 'sit' : 'stand', seat ? 2 : 0, scaleOf(p));
          hits.push({ kind: 'pax', ref: p, x: h.hx, y: h.hy + h.hr * 2.5, r: Math.max(22, h.hr * 3.4) });
          const left = p.dest - nextStop + 1;
          badges.push(() => {
            const bx = h.hx;
            const by = h.hy - h.hr * 1.4 - 12;
            if (left <= 1) {
              tagAt(ctx, bx, by + 8 - Math.abs(Math.sin(r.time * 5)) * 3, '降', DEST_COLORS[p.dest] ?? '#FFFDF6', INK);
            } else {
              ctx.beginPath();
              ctx.arc(bx, by, 9, 0, Math.PI * 2);
              ctx.fillStyle = DEST_COLORS[p.dest] ?? '#FFFDF6';
              ctx.fill();
              ctx.strokeStyle = INK;
              ctx.lineWidth = 1.6;
              ctx.stroke();
              ctx.fillStyle = INK;
              ctx.font = '900 11px "Zen Maru Gothic", sans-serif';
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              ctx.fillText(String(left), bx, by + 0.5);
            }
            if (danger) {
              ctx.fillStyle = '#E4553A';
              ctx.font = '900 13px "Zen Maru Gothic", sans-serif';
              ctx.fillText('!', bx + 13, by - 2);
            }
          });
        },
      });
    }
    for (const dx of doors) {
      for (const [px, py] of [[dx - 0.72, -0.72], [dx + 0.72, -0.72], [dx - 0.72, 0.72], [dx + 0.72, 0.72]] as [number, number][]) {
        items.push({
          d: px + py + (py > 0 ? 0.3 : 0),
          f: () => {
            iso.line([px, py, Z], [px, py, Z + 2.05], INK, 0.12 * s + 1.4);
            iso.line([px, py, Z], [px, py, Z + 2.05], '#D8D2C6', Math.max(0.5, 0.12 * s - 0.4));
          },
        });
      }
    }
    items.sort((a, b) => a.d - b.d).forEach((i) => i.f());
    // 手前の腰壁・手すり
    if (d === 2) {
      iso.box(0.2, L - 0.2, 1.05, 1.15, Z, Z + 0.5, '#9A9184', { lw: iso.lw * 0.6 });
      iso.label(L / 2, 1.6, Z + 0.2, '屋根の上：耐衝撃−20・運賃×2', 11, '#B53E28');
    } else {
      let px0 = 0;
      for (const dx of [...doors, L + 0.62]) {
        if (dx - 0.62 - px0 > 0.05) iso.box(px0, dx - 0.62, 1.2, 1.3, Z, Z + 0.32, color, { lw: iso.lw * 0.8 });
        px0 = dx + 0.62;
      }
      if (d === 1) iso.label(L / 2, 1.7, Z + 0.1, '2階：耐衝撃−10', 11, '#8A5D00');
    }
    // つり革（1階）
    if (d === 0) {
      iso.line([0.4, 0.4, 2.05], [L - 0.4, 0.4, 2.05], '#9A9184', Math.max(1, s * 0.07));
      for (const { sp } of mine) {
        if (sp.kind !== 'strap') continue;
        iso.line([sp.x, sp.y, 2.05], [sp.x, sp.y, 1.8], '#3F8FA3', 1.6);
        const [rx, ry] = iso.P(sp.x, sp.y, 1.72);
        iso.ell(rx, ry, 0.09 * s, 0.09 * s, null, 2.2, '#3F8FA3');
      }
      iso.label(9.9, 1.05, 0.02, 'つり革 −10', 11, '#3F8FA3');
      iso.label(2.2, -0.6, 0.02, '通路 ±0', 11, '#5A5045');
    }
  }
  if (r.cars > 1) iso.label(L - 1.0, 1.9, -0.5, `${focus + 1}号車`, 14, INK);
  badges.forEach((f) => f());
  // 持ち上げている客
  if (drag) {
    const p = r.pax.find((q) => q.id === drag.id);
    if (p) {
      const sub = new Iso(ctx, s * scaleOf(p), drag.sx, drag.sy + 1.2 * s);
      sub.lw = iso.lw;
      drawPerson(sub, 0, 0, 0, look(p), { pose: 'stand', facing: 0, lift: 0.2 });
    }
    // 降ろすゾーン：電車の上側（レバーや段のタブから離す）
    const z = ejectZone(w, top);
    const over = drag.sx >= z.x && drag.sx <= z.x + z.w && drag.sy >= z.y && drag.sy <= z.y + z.h;
    ctx.setLineDash([8, 6]);
    ctx.beginPath();
    ctx.roundRect(z.x, z.y, z.w, z.h, 14);
    ctx.fillStyle = over ? 'rgba(228,85,58,0.35)' : 'rgba(228,85,58,0.12)';
    ctx.fill();
    ctx.strokeStyle = '#B53E28';
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#8A1F0E';
    ctx.font = '900 13px "Zen Maru Gothic", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(r.phase === 'running' ? 'ここで離すと窓から降ろす' : 'ここで離すと降りてもらう', z.x + z.w / 2, z.y + z.h / 2 - 8);
    ctx.font = '800 11px "Zen Maru Gothic", sans-serif';
    ctx.fillText('信頼が減る', z.x + z.w / 2, z.y + z.h / 2 + 10);
  }
  return { shock, obstacle: o };
}

/** 車内画面の「降ろす」エリア：上端（路線の帯の下）、右上の「外へ」ボタンは避ける */
export function ejectZone(w: number, top: number) {
  return { x: 12, y: top + 6, w: w - 24 - 110, h: 56 };
}

export { hash };

/** "¢12" をコインのアイコン付きで描く */
function coinLabel(ctx: CanvasRenderingContext2D, iso: Iso, x: number, z: number, text: string, size: number, fill: string) {
  const [sx, sy] = iso.P(x, 0, z);
  const parts = text.split(/(¢\d+)/).filter(Boolean);
  ctx.font = `900 ${size}px "Zen Maru Gothic", sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.lineJoin = 'round';
  const cw = size * 0.95;
  const widths = parts.map((p) => (p.startsWith('¢') ? cw + 3 + ctx.measureText(p.slice(1)).width : ctx.measureText(p).width));
  let cx = sx - widths.reduce((a, b) => a + b, 0) / 2;
  parts.forEach((p, i) => {
    let t = p;
    if (p.startsWith('¢')) {
      const r = cw / 2;
      ctx.beginPath();
      ctx.arc(cx + r, sy, r, 0, Math.PI * 2);
      ctx.fillStyle = '#F2C94C';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = INK;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx + r, sy, r * 0.55, 0, Math.PI * 2);
      ctx.strokeStyle = '#D49A1C';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      cx += cw + 3;
      t = p.slice(1);
    }
    ctx.strokeStyle = '#FFFDF6';
    ctx.lineWidth = 3.5;
    ctx.strokeText(t, cx, sy);
    ctx.fillStyle = fill;
    ctx.fillText(t, cx, sy);
    cx += ctx.measureText(t).width;
    void i;
  });
}
