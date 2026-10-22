// キャンバス描画（横から見た図）。手描きインク風は後回し、まずは読みやすさ優先。

import { CAR_LEN } from './data.ts';
import { capacity, carsOnPlatform, load, type Game } from './game.ts';

const INK = '#1F1B16';
const PAPER = '#F5EFE3';
const CARD = '#FFFDF6';
const CAR_COLORS = ['#6FC3A0', '#F0A79C', '#E9B23E', '#8299E0', '#F08E78'];
const POLE_SPACING = 50;

export function draw(ctx: CanvasRenderingContext2D, g: Game, w: number, h: number): void {
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, w, h);

  // 1画面に見せる距離。編成が長くなったら少し引く
  // スマホの縦画面では寄りぎみ、編成が長くなるほど引く
  const minView = w < 600 ? 85 : 150;
  const viewMeters = Math.max(minView, Math.min(420, g.stats.cars * CAR_LEN * 1.15));
  const ppm = w / viewMeters;
  const frontScreen = w * 0.62;
  const toX = (m: number) => frontScreen + (m - g.x) * ppm;
  const groundY = Math.round(h * 0.8);
  const carH = Math.max(34, Math.min(80, h * 0.17, ppm * 20 * 0.75));

  drawBackdrop(ctx, w, groundY);

  // 架線柱（流れる景色）
  ctx.strokeStyle = '#9A8064';
  ctx.lineWidth = 2;
  const first = Math.floor((g.x - viewMeters) / POLE_SPACING) * POLE_SPACING;
  for (let m = first; m < g.x + viewMeters; m += POLE_SPACING) {
    const sx = toX(m);
    if (sx < -10 || sx > w + 10) continue;
    ctx.beginPath();
    ctx.moveTo(sx, groundY);
    ctx.lineTo(sx, groundY - carH * 1.9);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(0, groundY - carH * 1.75);
  ctx.lineTo(w, groundY - carH * 1.75);
  ctx.stroke();

  // 駅（見えている範囲のものだけ）
  g.pos.forEach((P, i) => {
    const st = g.line.stations[i];
    const startM = P - st.platformCars * CAR_LEN;
    const x0 = toX(startM);
    const x1 = toX(P + 3);
    if (x1 < -40 || x0 > w + 40) return;
    // ホーム
    ctx.fillStyle = '#E6DCC8';
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2;
    const platTop = groundY - carH * 0.32;
    ctx.fillRect(x0, platTop, x1 - x0, groundY - platTop);
    ctx.strokeRect(x0, platTop, x1 - x0, groundY - platTop);
    ctx.fillStyle = '#E9B23E';
    ctx.fillRect(x0, platTop, x1 - x0, 4);
    // 駅名標
    const signW = Math.max(70, st.name.length * 16 + 20);
    const signX = (x0 + x1) / 2 - signW / 2;
    const signY = groundY - carH * 2.5;
    ctx.fillStyle = INK;
    ctx.fillRect((x0 + x1) / 2 - 2, signY + 26, 4, groundY - carH * 0.32 - signY - 26);
    roundRect(ctx, signX, signY, signW, 28, 5, CARD);
    ctx.fillStyle = INK;
    ctx.font = '900 15px "Zen Maru Gothic", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(st.name, signX + signW / 2, signY + 14);
    // 停止位置目標
    const sx = toX(P);
    ctx.fillStyle = INK;
    ctx.fillRect(sx - 2, groundY - carH * 1.45, 4, carH * 1.13);
    roundRect(ctx, sx - 18, groundY - carH * 1.45 - 18, 36, 20, 4, i === g.target ? '#E4553A' : CARD);
    ctx.fillStyle = i === g.target ? CARD : INK;
    ctx.font = '900 12px "Zen Maru Gothic", sans-serif';
    ctx.fillText('停', sx, groundY - carH * 1.45 - 8);
    // 待っている客
    if (i === g.target && (g.phase === 'dwell' || g.phase === 'adjust')) {
      drawCrowd(ctx, g.waiting, x0 + 6, x1 - 6, platTop, carH);
    }
  });

  // レール
  ctx.fillStyle = '#DCCFB6';
  ctx.fillRect(0, groundY, w, h - groundY);
  ctx.fillStyle = INK;
  ctx.fillRect(0, groundY + 2, w, 3);

  drawTrain(ctx, g, toX, ppm, groundY, carH);
}

function drawBackdrop(ctx: CanvasRenderingContext2D, w: number, groundY: number): void {
  ctx.fillStyle = '#F2D9A6';
  ctx.beginPath();
  ctx.arc(w * 0.82, groundY * 0.32, Math.min(w, groundY) * 0.22, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#C9BBA2';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, groundY * 0.7);
  ctx.quadraticCurveTo(w * 0.25, groundY * 0.5, w * 0.45, groundY * 0.66);
  ctx.quadraticCurveTo(w * 0.7, groundY * 0.48, w, groundY * 0.62);
  ctx.stroke();
}

function drawCrowd(
  ctx: CanvasRenderingContext2D,
  n: number,
  x0: number,
  x1: number,
  platTop: number,
  carH: number,
): void {
  if (n <= 0) return;
  const shown = Math.min(n, 40);
  const span = Math.max(1, x1 - x0);
  const r = Math.max(3, carH * 0.07);
  for (let k = 0; k < shown; k++) {
    const px = x0 + ((k * 0.618 * span) % span);
    const py = platTop - r * 2.2 - (k % 3) * r * 0.9;
    ctx.fillStyle = CAR_COLORS[k % CAR_COLORS.length];
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(px - r, py, r * 2, r * 2.6, r);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#F3D9B8';
    ctx.beginPath();
    ctx.arc(px, py - r * 0.9, r * 0.9, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.fillStyle = INK;
  ctx.font = '900 14px "Zen Maru Gothic", sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';
  ctx.fillText(`待ち ${n}人`, x0, platTop - r * 6.2);
}

function drawTrain(
  ctx: CanvasRenderingContext2D,
  g: Game,
  toX: (m: number) => number,
  ppm: number,
  groundY: number,
  carH: number,
): void {
  const cars = g.stats.cars;
  const doors = g.stats.doorsPerCar;
  const bottom = groundY - 6;
  const top = bottom - carH;
  const fillRatio = capacity(g) > 0 ? load(g) / capacity(g) : 0;
  const atStation = g.phase === 'dwell' || g.phase === 'adjust';
  const onPlat = atStation ? carsOnPlatform(g) : cars;
  const w = ctx.canvas.width / (window.devicePixelRatio || 1);

  for (let k = 0; k < cars; k++) {
    const right = toX(g.x - k * CAR_LEN);
    const left = toX(g.x - (k + 1) * CAR_LEN) + 2;
    if (right < -5 || left > w + 5) continue;
    const width = right - left;
    const color = CAR_COLORS[k % CAR_COLORS.length];

    // 車体
    ctx.fillStyle = color;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    if (k === 0) ctx.roundRect(left, top, width, carH, [6, 14, 6, 6]);
    else ctx.roundRect(left, top, width, carH, 6);
    ctx.fill();
    ctx.stroke();
    // 帯
    ctx.fillStyle = CARD;
    ctx.fillRect(left + 1, bottom - carH * 0.3, width - 2, carH * 0.07);

    // ドアと窓
    const spacing = CAR_LEN / doors;
    const doorW = Math.min(1.6, spacing * 0.55) * ppm;
    const doorH = carH * 0.78;
    for (let j = 0; j < doors; j++) {
      const cx = left + (j + 0.5) * spacing * ppm;
      // 窓（ドアの間）
      if (j < doors - 1) {
        const wx = left + (j + 1) * spacing * ppm;
        const ww = spacing * ppm - doorW - 6;
        if (ww > 6) {
          ctx.fillStyle = '#FFF3CF';
          ctx.fillRect(wx - ww / 2, top + carH * 0.14, ww, carH * 0.3);
          ctx.strokeStyle = INK;
          ctx.lineWidth = 1.4;
          ctx.strokeRect(wx - ww / 2, top + carH * 0.14, ww, carH * 0.3);
          // 混み具合（頭の数）
          const heads = Math.round(fillRatio * Math.max(1, ww / 8));
          for (let hh = 0; hh < heads; hh++) {
            ctx.fillStyle = '#F3D9B8';
            ctx.beginPath();
            ctx.arc(wx - ww / 2 + 5 + hh * 8, top + carH * 0.38, 3.2, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
      ctx.fillStyle = shade(color);
      ctx.fillRect(cx - doorW / 2, bottom - doorH, doorW, doorH);
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1.4;
      ctx.strokeRect(cx - doorW / 2, bottom - doorH, doorW, doorH);
      if (atStation && g.doorAnim > 0 && k < onPlat) {
        const gap = doorW * g.doorAnim * 0.9;
        ctx.fillStyle = '#2B2F45';
        ctx.fillRect(cx - gap / 2, bottom - doorH + 1, gap, doorH - 2);
      }
    }

    // 先頭車の顔
    if (k === 0) {
      ctx.fillStyle = '#FFF3CF';
      ctx.fillRect(right - Math.min(26, width * 0.18), top + carH * 0.12, Math.min(20, width * 0.14), carH * 0.32);
      ctx.strokeStyle = INK;
      ctx.strokeRect(right - Math.min(26, width * 0.18), top + carH * 0.12, Math.min(20, width * 0.14), carH * 0.32);
      ctx.fillStyle = '#FFE48A';
      ctx.beginPath();
      ctx.arc(right - 6, bottom - carH * 0.18, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    // ドアカット（ホーム外の車両）
    if (atStation && k >= onPlat) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(left, top, width, carH);
      ctx.clip();
      ctx.strokeStyle = 'rgba(31,27,22,0.35)';
      ctx.lineWidth = 4;
      for (let s = left - carH; s < right; s += 12) {
        ctx.beginPath();
        ctx.moveTo(s, bottom);
        ctx.lineTo(s + carH, top);
        ctx.stroke();
      }
      ctx.restore();
    }

    // 車輪
    ctx.fillStyle = INK;
    for (const fx of [0.18, 0.32, 0.68, 0.82]) {
      ctx.beginPath();
      ctx.arc(left + width * fx, bottom + 2, Math.max(3, carH * 0.08), 0, Math.PI * 2);
      ctx.fill();
    }
    // 連結器
    if (k < cars - 1) ctx.fillRect(left - 4, bottom - carH * 0.35, 6, 5);
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, fill: string) {
  ctx.fillStyle = fill;
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
  ctx.stroke();
}

function shade(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * 0.78);
  const gg = Math.round(((n >> 8) & 255) * 0.78);
  const b = Math.round((n & 255) * 0.78);
  return `rgb(${r},${gg},${b})`;
}
