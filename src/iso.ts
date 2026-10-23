// クォータービュー（等角投影）の描画の土台。
// x: 進行方向（画面の右下へ）、y: 横方向（+ が手前＝左下へ）、z: 高さ。

export const C30 = Math.cos(Math.PI / 6);
export const INK = '#1F1B16';

export type V3 = [number, number, number];

const shadeCache = new Map<string, string>();
/** 色を暗く（k<1）／明るく（k>1）する */
export function shade(hex: string, k: number): string {
  const key = hex + k;
  const hit = shadeCache.get(key);
  if (hit) return hit;
  let r: number, g: number, b: number;
  if (hex[0] === '#') {
    const n = parseInt(hex.slice(1), 16);
    r = (n >> 16) & 255;
    g = (n >> 8) & 255;
    b = n & 255;
  } else {
    const m = hex.match(/[\d.]+/g) ?? ['0', '0', '0'];
    r = +m[0];
    g = +m[1];
    b = +m[2];
  }
  const f = (c: number) => Math.max(0, Math.min(255, Math.round(k <= 1 ? c * k : c + (255 - c) * (k - 1))));
  const out = `rgb(${f(r)},${f(g)},${f(b)})`;
  shadeCache.set(key, out);
  return out;
}

export function hash(a: number, b = 0): number {
  let x = (Math.imul(a | 0, 73856093) ^ Math.imul((b | 0) + 0x9e37, 19349663)) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 1274126177) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 2246822519) >>> 0;
  return ((x ^ (x >>> 15)) >>> 0) / 4294967296;
}

export interface BoxStyle {
  top?: string;
  /** x 面（右下向き）の色 */
  sx?: string;
  /** y 面（左下向き）の色 */
  sy?: string;
  lw?: number;
  stroke?: boolean;
}

/** 投影と描画。描画順は呼び出し側で決める（queue を使う） */
export class Iso {
  ctx: CanvasRenderingContext2D;
  s: number;
  ox: number;
  oy: number;
  /** 線の太さの基準 */
  lw: number;
  /** x の描画範囲（台座の切り口） */
  clipX0 = -Infinity;
  clipX1 = Infinity;
  clipY0 = -Infinity;
  clipY1 = Infinity;
  private q: { k: number; f: () => void }[] = [];

  constructor(ctx: CanvasRenderingContext2D, s: number, ox: number, oy: number) {
    this.ctx = ctx;
    this.s = s;
    this.ox = ox;
    this.oy = oy;
    this.lw = Math.max(0.7, Math.min(2.2, s * 0.13));
  }

  P(x: number, y: number, z: number): [number, number] {
    return [this.ox + (x - y) * C30 * this.s, this.oy + (x + y) * 0.5 * this.s - z * this.s];
  }

  /** 逆投影：画面座標と高さ z から床の (x, y) */
  unP(sx: number, sy: number, z = 0): [number, number] {
    const a = (sx - this.ox) / (C30 * this.s); // x - y
    const b = (sy - this.oy + z * this.s) / (0.5 * this.s); // x + y
    return [(a + b) / 2, (b - a) / 2];
  }

  /** 奥行き（大きいほど手前） */
  depth(x: number, y: number, z: number): number {
    return x + y + z * 0.5;
  }

  push(k: number, f: () => void): void {
    this.q.push({ k, f });
  }

  flush(): void {
    this.q.sort((a, b) => a.k - b.k);
    for (const it of this.q) it.f();
    this.q = [];
  }

  poly(pts: V3[], fill: string | null, lw: number | null = this.lw, stroke = INK): void {
    if (this.clipX0 > -Infinity || this.clipX1 < Infinity || this.clipY0 > -Infinity || this.clipY1 < Infinity) {
      pts = clipAxis(pts, 0, this.clipX0, true);
      pts = clipAxis(pts, 0, this.clipX1, false);
      pts = clipAxis(pts, 1, this.clipY0, true);
      pts = clipAxis(pts, 1, this.clipY1, false);
      if (pts.length < 3) return;
    }
    const c = this.ctx;
    c.beginPath();
    for (let i = 0; i < pts.length; i++) {
      const [sx, sy] = this.P(pts[i][0], pts[i][1], pts[i][2]);
      if (i === 0) c.moveTo(sx, sy);
      else c.lineTo(sx, sy);
    }
    c.closePath();
    if (fill) {
      c.fillStyle = fill;
      c.fill();
    }
    if (lw && lw > 0) {
      c.strokeStyle = stroke;
      c.lineWidth = lw;
      c.lineJoin = 'round';
      c.stroke();
    }
  }

  rectZ(x0: number, x1: number, y0: number, y1: number, z: number, fill: string | null, lw: number | null = this.lw): void {
    [x0, x1] = this.cx(x0, x1);
    [y0, y1] = this.cy(y0, y1);
    if (x1 <= x0 || y1 <= y0) return;
    this.poly([[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]], fill, lw);
  }

  rectY(y: number, x0: number, x1: number, z0: number, z1: number, fill: string | null, lw: number | null = this.lw): void {
    [x0, x1] = this.cx(x0, x1);
    if (x1 <= x0 || y < this.clipY0 || y > this.clipY1) return;
    this.poly([[x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1]], fill, lw);
  }

  rectX(x: number, y0: number, y1: number, z0: number, z1: number, fill: string | null, lw: number | null = this.lw): void {
    [y0, y1] = this.cy(y0, y1);
    if (y1 <= y0 || x < this.clipX0 || x > this.clipX1) return;
    this.poly([[x, y0, z0], [x, y1, z0], [x, y1, z1], [x, y0, z1]], fill, lw);
  }

  /** 箱。見える3面（x+、y+、上）を描く。台座の範囲で切り取る */
  box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, color: string, st: BoxStyle = {}): void {
    [x0, x1] = this.cx(x0, x1);
    [y0, y1] = this.cy(y0, y1);
    if (x1 <= x0 || y1 <= y0) return;
    const lw = st.stroke === false ? 0 : st.lw ?? this.lw;
    this.poly([[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]], st.sx ?? shade(color, 0.74), lw);
    this.poly([[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], st.sy ?? shade(color, 0.87), lw);
    this.poly([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], st.top ?? color, lw);
  }

  /** 縦の円柱（手すりなど）。上から見た円は楕円になる */
  cylinder(x: number, y: number, z0: number, z1: number, r: number, color: string, lw = this.lw): void {
    if (x < this.clipX0 || x > this.clipX1) return;
    const c = this.ctx;
    const [bx, by] = this.P(x, y, z0);
    const [, ty] = this.P(x, y, z1);
    const rx = r * this.s * 1.22;
    const ry = r * this.s * 0.7;
    c.beginPath();
    c.ellipse(bx, by, rx, ry, 0, 0, Math.PI);
    c.lineTo(bx - rx, ty);
    c.ellipse(bx, ty, rx, ry, 0, Math.PI, 0, true);
    c.closePath();
    c.fillStyle = color;
    c.fill();
    if (lw > 0) {
      c.strokeStyle = INK;
      c.lineWidth = lw;
      c.stroke();
    }
    c.beginPath();
    c.ellipse(bx, ty, rx, ry, 0, 0, Math.PI * 2);
    c.fillStyle = shade(color, 1.18);
    c.fill();
    if (lw > 0) c.stroke();
  }

  /** 画面座標の楕円 */
  ell(cx: number, cy: number, rx: number, ry: number, fill: string | null, lw = 0, stroke = INK): void {
    const c = this.ctx;
    c.beginPath();
    c.ellipse(cx, cy, Math.max(0.3, rx), Math.max(0.3, ry), 0, 0, Math.PI * 2);
    if (fill) {
      c.fillStyle = fill;
      c.fill();
    }
    if (lw > 0) {
      c.strokeStyle = stroke;
      c.lineWidth = lw;
      c.stroke();
    }
  }

  /** 縁取りつきの文字 */
  label(x: number, y: number, z: number, text: string, size = 11, fill = INK, halo = '#FFFDF6'): void {
    const [sx, sy] = this.P(x, y, z);
    const c = this.ctx;
    c.font = `900 ${size}px "Zen Maru Gothic", sans-serif`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.lineJoin = 'round';
    c.strokeStyle = halo;
    c.lineWidth = 3.5;
    c.strokeText(text, sx, sy);
    c.fillStyle = fill;
    c.fillText(text, sx, sy);
  }

  /** x 範囲が描画範囲にかかっているか */
  inX(x0: number, x1: number): boolean {
    return x1 > this.clipX0 + 0.2 && x0 < this.clipX1 - 0.2;
  }

  /** 床に落ちる影（楕円） */
  shadow(x: number, y: number, z: number, r: number, alpha = 0.18): void {
    const [sx, sy] = this.P(x, y, z);
    const c = this.ctx;
    c.fillStyle = `rgba(31,27,22,${alpha})`;
    c.beginPath();
    c.ellipse(sx, sy, r * this.s * 1.25, r * this.s * 0.72, 0, 0, Math.PI * 2);
    c.fill();
  }

  line(a: V3, b: V3, color = INK, lw = this.lw): void {
    const c = this.ctx;
    const [x0, y0] = this.P(a[0], a[1], a[2]);
    const [x1, y1] = this.P(b[0], b[1], b[2]);
    c.strokeStyle = color;
    c.lineWidth = lw;
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(x0, y0);
    c.lineTo(x1, y1);
    c.stroke();
  }

  private cx(a: number, b: number): [number, number] {
    return [Math.max(a, this.clipX0), Math.min(b, this.clipX1)];
  }

  private cy(a: number, b: number): [number, number] {
    return [Math.max(a, this.clipY0), Math.min(b, this.clipY1)];
  }
}

function clipAxis(p: V3[], axis: 0 | 1, val: number, keepGreater: boolean): V3[] {
  if (!isFinite(val)) return p;
  const out: V3[] = [];
  for (let i = 0; i < p.length; i++) {
    const a = p[i];
    const b = p[(i + 1) % p.length];
    const ia = keepGreater ? a[axis] >= val : a[axis] <= val;
    const ib = keepGreater ? b[axis] >= val : b[axis] <= val;
    if (ia) out.push(a);
    if (ia !== ib) {
      const t = (val - a[axis]) / (b[axis] - a[axis]);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
    }
  }
  return out;
}
