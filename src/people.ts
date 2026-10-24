// 乗客の人形。箱と球でつくるおもちゃのような見た目。

import type { Look } from './game.ts';
import { INK, Iso, shade } from './iso.ts';

export type Facing = 0 | 1 | 2 | 3; // 0:+x 1:-x 2:+y 3:-y
const FX = [1, -1, 0, 0];
const FY = [0, 0, 1, -1];

export interface PersonOpts {
  pose: 'stand' | 'sit';
  facing: Facing;
  /** 持ち上げている高さ（ドラッグ中） */
  lift?: number;
  /** 登場アニメ 0..1 */
  pop?: number;
  alpha?: number;
}

export interface PersonHit {
  sx: number;
  sy: number;
  r: number;
  /** 頭の中心と半径（吹き出しの位置合わせ用） */
  hx: number;
  hy: number;
  hr: number;
}

interface Part {
  d: number;
  f: () => void;
}

/** 人形を描く。戻り値は当たり判定用の画面上の位置 */
export function drawPerson(iso: Iso, x: number, y: number, z: number, look: Look, o: PersonOpts): PersonHit {
  const s = iso.s;
  const ctx = iso.ctx;
  const pop = o.pop ?? 1;
  const lift = o.lift ?? 0;
  const k = pop < 1 ? 0.6 + 0.4 * easeOutBack(pop) : 1;
  const zb = z + lift;
  ctx.globalAlpha = o.alpha ?? 1;

  // 床の影
  iso.shadow(x, y, z, 0.32 * k, lift > 0 ? 0.12 : 0.2);

  if (s < 7) {
    // 遠景用の簡略版
    const h = o.pose === 'sit' ? 0.9 : 1.25;
    iso.box(x - 0.2, x + 0.2, y - 0.2, y + 0.2, zb, zb + h * k, look.shirt, { lw: iso.lw * 0.7 });
    const [hx, hy] = iso.P(x, y, zb + (h + 0.22) * k);
    ctx.fillStyle = look.skin;
    ctx.strokeStyle = INK;
    ctx.lineWidth = iso.lw * 0.7;
    ctx.beginPath();
    ctx.arc(hx, hy, Math.max(1.2, 0.2 * s), 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.globalAlpha = 1;
    return { sx: hx, sy: hy, r: Math.max(6, 0.5 * s), hx, hy, hr: Math.max(1.2, 0.2 * s) };
  }

  const fx = FX[o.facing];
  const fy = FY[o.facing];
  const px = -fy;
  const py = fx;
  const lw = iso.lw * 0.75;
  const parts: Part[] = [];
  const sc = k;

  /** 向きに沿った箱。a: 前後方向の中心、b: 左右方向の中心 */
  const pbox = (a: number, b: number, depth: number, width: number, z0: number, z1: number, color: string) => {
    const cx = x + (fx * a + px * b) * sc;
    const cy = y + (fy * a + py * b) * sc;
    const hx = (Math.abs(fx) * depth + Math.abs(px) * width) * 0.5 * sc;
    const hy = (Math.abs(fy) * depth + Math.abs(py) * width) * 0.5 * sc;
    const Z0 = zb + z0 * sc;
    const Z1 = zb + z1 * sc;
    parts.push({
      d: cx + cy + (Z0 + Z1) * 0.25,
      f: () => iso.box(cx - hx, cx + hx, cy - hy, cy + hy, Z0, Z1, color, { lw }),
    });
  };

  const sit = o.pose === 'sit';
  const pants = look.pants;
  const shirt = look.shirt;
  let headZ: number;
  if (sit) {
    // 太もも（前へ）とすね（下へ）
    pbox(0.16, -0.1, 0.44, 0.15, 0.4, 0.56, pants);
    pbox(0.16, 0.1, 0.44, 0.15, 0.4, 0.56, pants);
    pbox(0.36, -0.1, 0.14, 0.13, 0.0, 0.44, pants);
    pbox(0.36, 0.1, 0.14, 0.13, 0.0, 0.44, pants);
    pbox(0.43, -0.1, 0.16, 0.13, 0.0, 0.07, '#3A3631');
    pbox(0.43, 0.1, 0.16, 0.13, 0.0, 0.07, '#3A3631');
    pbox(-0.08, 0, 0.24, 0.4, 0.52, 1.08, shirt);
    pbox(0.0, -0.26, 0.14, 0.1, 0.62, 1.04, shade(shirt, 0.92));
    pbox(0.0, 0.26, 0.14, 0.1, 0.62, 1.04, shade(shirt, 0.92));
    pbox(0.14, -0.24, 0.22, 0.1, 0.56, 0.66, shade(shirt, 0.92));
    pbox(0.14, 0.24, 0.22, 0.1, 0.56, 0.66, shade(shirt, 0.92));
    headZ = 1.27;
  } else {
    pbox(0, -0.09, 0.16, 0.14, 0.04, 0.8, pants);
    pbox(0, 0.09, 0.16, 0.14, 0.04, 0.8, pants);
    pbox(0.04, -0.09, 0.22, 0.15, 0.0, 0.07, '#3A3631');
    pbox(0.04, 0.09, 0.22, 0.15, 0.0, 0.07, '#3A3631');
    pbox(0, 0, 0.24, 0.42, 0.76, 1.36, shirt);
    pbox(0, -0.27, 0.13, 0.1, 0.86, 1.32, shade(shirt, 0.92));
    pbox(0, 0.27, 0.13, 0.1, 0.86, 1.32, shade(shirt, 0.92));
    pbox(0, -0.27, 0.11, 0.09, 0.76, 0.86, look.skin);
    pbox(0, 0.27, 0.11, 0.09, 0.76, 0.86, look.skin);
    headZ = 1.56;
  }
  // かばん
  if (look.bag === 1) pbox(sit ? -0.3 : -0.2, 0, 0.14, 0.3, sit ? 0.6 : 0.86, sit ? 0.98 : 1.26, '#8E6640');
  else if (look.bag === 2) pbox(0.02, 0.36, 0.26, 0.1, sit ? 0.5 : 0.62, sit ? 0.82 : 0.94, '#E9B23E');
  // 首
  pbox(sit ? -0.08 : 0, 0, 0.1, 0.1, sit ? 1.06 : 1.34, sit ? 1.12 : 1.4, look.skin);

  parts.sort((a, b) => a.d - b.d);
  for (const p of parts) p.f();

  // 頭
  const hz = zb + headZ * sc;
  const hxW = x + (sit ? -0.08 * fx : 0) * sc;
  const hyW = y + (sit ? -0.08 * fy : 0) * sc;
  const [hx, hy] = iso.P(hxW, hyW, hz);
  const r = 0.19 * s * sc;
  // 顔の向きの画面上の方向
  const [ax, ay] = iso.P(fx, fy, 0);
  const [bx, by] = iso.P(0, 0, 0);
  let dx = ax - bx;
  let dy = ay - by;
  const dl = Math.hypot(dx, dy) || 1;
  dx /= dl;
  dy /= dl;
  const toward = o.facing === 0 || o.facing === 2;

  // 長い髪（頭の後ろ）
  if (look.hairStyle === 1) {
    ctx.fillStyle = look.hair;
    ctx.strokeStyle = INK;
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.roundRect(hx - r * 0.95 - dx * r * 0.2, hy - r * 0.2, r * 1.9, r * 1.55, r * 0.5);
    ctx.fill();
    ctx.stroke();
  }
  ctx.fillStyle = look.skin;
  ctx.strokeStyle = INK;
  ctx.lineWidth = lw;
  ctx.beginPath();
  ctx.arc(hx, hy, r, 0, Math.PI * 2);
  ctx.fill();
  // 髪（頭の形で切り抜く）
  ctx.save();
  ctx.beginPath();
  ctx.arc(hx, hy, r * 1.04, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = look.hat ? '#E4553A' : look.hair;
  ctx.beginPath();
  if (look.hairStyle === 3 && !look.hat) {
    ctx.arc(hx - dx * r * 0.5, hy - r * 0.62, r * 0.8, 0, Math.PI * 2);
  } else if (toward) {
    ctx.arc(hx - dx * r * 0.42, hy - dy * r * 0.42 - r * 0.42, r * 1.02, 0, Math.PI * 2);
  } else {
    ctx.arc(hx + dx * r * 0.05, hy + dy * r * 0.05 - r * 0.1, r * 1.04, 0, Math.PI * 2);
  }
  ctx.fill();
  ctx.restore();
  ctx.beginPath();
  ctx.arc(hx, hy, r, 0, Math.PI * 2);
  ctx.strokeStyle = INK;
  ctx.lineWidth = lw;
  ctx.stroke();
  // お団子
  if (look.hairStyle === 2 && !look.hat) {
    ctx.fillStyle = look.hair;
    ctx.beginPath();
    ctx.arc(hx - dx * r * 0.55, hy - r * 0.95, r * 0.42, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  // 帽子のつば
  if (look.hat) {
    ctx.fillStyle = shade('#E4553A', 0.85);
    ctx.beginPath();
    ctx.ellipse(hx + dx * r * 0.55, hy + dy * r * 0.55 - r * 0.3, Math.max(0.01, r * 0.62), Math.max(0.01, r * 0.28), Math.atan2(dy, dx), 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  // 顔
  if (toward) {
    const ex = hx + dx * r * 0.42;
    const ey = hy + dy * r * 0.42 + r * 0.08;
    const qx = -dy;
    const qy = dx;
    ctx.fillStyle = INK;
    for (const sgn of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(ex + qx * r * 0.33 * sgn, ey + qy * r * 0.12 * sgn, Math.max(0.9, r * 0.1), Math.max(1.1, r * 0.14), 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(240,142,120,0.55)';
    for (const sgn of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(ex + qx * r * 0.55 * sgn + dx * r * 0.05, ey + r * 0.32, r * 0.13, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
  return { sx: hx, sy: hy + r * 2.2, r: Math.max(16, r * 3.0), hx, hy, hr: r };
}

function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}
