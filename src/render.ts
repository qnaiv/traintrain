// キャンバス描画（横から見た図）。手描きインク風は後回し、まずは読みやすさ優先。

import { CAR_LEN } from './data.ts';
import { capacity, carsOnPlatform, load, type Game } from './game.ts';

const INK = '#1F1B16';
const PAPER = '#F5EFE3';
const CARD = '#FFFDF6';
const CAR_COLORS = ['#6FC3A0', '#F0A79C', '#E9B23E', '#8299E0', '#F08E78'];
const POLE_SPACING = 50;

export function draw(ctx: CanvasRenderingContext2D, g: Game, w: number, h: number): void {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.restore();
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, w, h);

  const portrait = h > w * 1.1;
  // 上：路線ストリップ、その下：停止メーター／停車パネル、下：車両の横図
  const stripH = 56;
  const panelTop = stripH + 8;
  const panelH = portrait ? Math.min(230, h * 0.34) : Math.min(150, h * 0.3);

  // 1画面に見せる距離。スマホ縦は寄りぎみ、編成が長くなるほど引く
  const minView = portrait ? 62 : 150;
  const viewMeters = Math.max(minView, Math.min(420, g.stats.cars * CAR_LEN * 1.15));
  const ppm = w / viewMeters;
  const frontScreen = w * 0.62;
  const toX = (m: number) => frontScreen + (m - g.x) * ppm;
  const groundY = Math.round(h * (portrait ? 0.86 : 0.82));
  const carH = Math.max(34, Math.min(110, h * 0.2, ppm * 20 * 0.8));

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

  drawTrain(ctx, g, toX, ppm, groundY, carH, groundY - (panelTop + panelH) - 24);

  drawRouteStrip(ctx, g, w, stripH);
  if (g.phase === 'running') drawApproach(ctx, g, w, panelTop, panelH);
  else if (g.phase === 'dwell' || g.phase === 'adjust') drawDwellPanel(ctx, g, w, panelTop, panelH);
}

function drawRouteStrip(ctx: CanvasRenderingContext2D, g: Game, w: number, hh: number): void {
  ctx.fillStyle = CARD;
  ctx.fillRect(0, 0, w, hh);
  ctx.fillStyle = INK;
  ctx.fillRect(0, hh - 2, w, 2);
  const total = g.pos[g.pos.length - 1];
  const x0 = 24;
  const x1 = w - 24;
  const y = 20;
  const toS = (m: number) => x0 + (m / total) * (x1 - x0);
  ctx.fillStyle = '#C9BBA2';
  ctx.fillRect(x0, y - 3, x1 - x0, 6);
  ctx.fillStyle = INK;
  ctx.fillRect(x0, y - 3, Math.max(0, toS(g.x) - x0), 6);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  g.pos.forEach((P, i) => {
    const sx = toS(P);
    const passed = i < g.target || (i === g.target && g.phase !== 'running');
    ctx.beginPath();
    ctx.arc(sx, y, i === g.target ? 7 : 5, 0, Math.PI * 2);
    ctx.fillStyle = i === g.target ? '#E4553A' : passed ? INK : CARD;
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2;
    ctx.stroke();
    const name = g.line.stations[i].name;
    const show = i === 0 || i === g.pos.length - 1 || i === g.target || w > 600;
    if (show) {
      ctx.fillStyle = i === g.target ? '#B53E28' : '#5A5045';
      ctx.font = `${i === g.target ? 900 : 700} 11px "Zen Maru Gothic", sans-serif`;
      ctx.fillText(name, Math.min(w - 30, Math.max(30, sx)), y + 10);
    }
  });
  // 自分の列車
  const tx = toS(g.x);
  ctx.fillStyle = '#E9B23E';
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(tx - 9, y - 8, 18, 16, 4);
  ctx.fill();
  ctx.stroke();
}

function drawApproach(ctx: CanvasRenderingContext2D, g: Game, w: number, top: number, hh: number): void {
  const remain = g.pos[g.target] - g.x;
  const st = g.line.stations[g.target];
  const pad = 16;
  // 見出し
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#5A5045';
  ctx.font = '700 13px "Zen Maru Gothic", sans-serif';
  ctx.fillText(`次は ${st.name}　ホーム${st.platformCars}両分／編成${g.stats.cars}両`, pad, top);
  // 大きな数字
  const big = Math.min(54, hh * 0.28);
  ctx.fillStyle = remain < 0 ? '#B53E28' : INK;
  ctx.font = `${big}px "Dela Gothic One", sans-serif`;
  const distText = remain >= 0 ? `${remain.toFixed(1)}m` : `+${(-remain).toFixed(1)}m`;
  ctx.fillText(distText, pad, top + 22);
  ctx.textAlign = 'right';
  ctx.font = `${big * 0.6}px "Dela Gothic One", sans-serif`;
  ctx.fillStyle = INK;
  ctx.fillText(`${Math.round(g.v * 3.6)}km/h`, w - pad, top + 22 + big * 0.3);

  // 停止位置メーター
  const R = 80;
  const bx0 = pad;
  const bw = w - pad * 2;
  const by = top + 22 + big + 18;
  const bh = Math.max(26, hh * 0.18);
  const scale = (bw * 0.82) / R;
  const xStop = bx0 + bw * 0.82;
  ctx.fillStyle = CARD;
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(bx0, by, bw, bh, 8);
  ctx.fill();
  ctx.stroke();
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(bx0, by, bw, bh, 8);
  ctx.clip();
  // オーバーラン側
  ctx.fillStyle = '#F7CCC5';
  ctx.fillRect(xStop, by, bw - (xStop - bx0), bh);
  // 許容ゾーン
  ctx.fillStyle = '#F3D27F';
  ctx.fillRect(xStop - 2 * scale, by, 4 * scale, bh);
  ctx.fillStyle = '#6FC3A0';
  ctx.fillRect(xStop - 0.5 * scale, by, Math.max(2, scale), bh);
  // 目盛り
  ctx.fillStyle = 'rgba(31,27,22,0.35)';
  for (let m = 10; m <= R; m += 10) ctx.fillRect(xStop - m * scale, by + bh * 0.65, 1.5, bh * 0.35);
  // 列車の先頭
  const tx = Math.max(bx0 + 6, Math.min(bx0 + bw - 6, xStop - remain * scale));
  ctx.fillStyle = INK;
  ctx.fillRect(tx - 3, by, 6, bh);
  ctx.restore();
  ctx.fillStyle = INK;
  ctx.fillRect(xStop - 1, by - 6, 2, bh + 12);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.font = '900 11px "Zen Maru Gothic", sans-serif';
  ctx.fillText('停止位置', xStop, by + bh + 6);
  if (remain > R) {
    ctx.textAlign = 'left';
    ctx.fillText(`→ まだ先（あと${Math.round(remain)}m）`, bx0 + 4, by + bh + 6);
  }
  // ブレーキの強さ
  const brY = by + bh + 24;
  if (brY + 12 < top + hh + 30) {
    ctx.textAlign = 'left';
    ctx.font = '700 12px "Zen Maru Gothic", sans-serif';
    ctx.fillStyle = '#5A5045';
    ctx.fillText('ブレーキ', bx0, brY);
    const gx = bx0 + 56;
    const gw = Math.min(200, bw - 60);
    ctx.fillStyle = CARD;
    ctx.strokeStyle = INK;
    ctx.beginPath();
    ctx.roundRect(gx, brY, gw, 12, 6);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#E4553A';
    ctx.beginPath();
    ctx.roundRect(gx, brY, gw * g.brake, 12, 6);
    ctx.fill();
  }
}

function drawDwellPanel(ctx: CanvasRenderingContext2D, g: Game, w: number, top: number, hh: number): void {
  const pad = 16;
  const st = g.line.stations[g.target];
  const cd = g.dep[g.target] - g.time;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#5A5045';
  ctx.font = '700 13px "Zen Maru Gothic", sans-serif';
  ctx.fillText(g.phase === 'adjust' ? `${st.name}　停止位置を直しています…` : `${st.name}　停車中`, pad, top);
  const big = Math.min(54, hh * 0.28);
  ctx.font = `${big}px "Dela Gothic One", sans-serif`;
  ctx.fillStyle = cd >= 0 ? INK : '#B53E28';
  const s = Math.abs(Math.round(cd));
  const t = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  ctx.fillText(cd >= 0 ? `発車まで ${t}` : `遅れ +${t}`, pad, top + 22);

  // 乗降の進み具合
  const alight = g.onboard[g.target];
  const cap = capacity(g);
  const ld = load(g);
  let y = top + 22 + big + 14;
  const bw = w - pad * 2;
  const rows: [string, number, number, string][] = [
    [`降車 あと${alight}人`, alight, Math.max(alight, 1), '#8299E0'],
    [`乗車待ち ${g.waiting}人`, g.waiting, Math.max(g.waiting, ld, 1), '#E9B23E'],
    [`車内 ${ld}/${cap}人`, ld, Math.max(cap, 1), ld >= cap ? '#E4553A' : '#6FC3A0'],
  ];
  const cut = g.stats.cars - carsOnPlatform(g);
  const warns: string[] = [];
  if (cut > 0) warns.push(`${cut}両ドアカット`);
  if (ld >= cap && g.waiting > 0) warns.push('満員！');
  if (warns.length) {
    ctx.textAlign = 'right';
    ctx.font = '900 13px "Zen Maru Gothic", sans-serif';
    ctx.fillStyle = '#B53E28';
    ctx.fillText(warns.join('　'), w - pad, top);
    ctx.textAlign = 'left';
  }
  for (const [label, v, max, color] of rows) {
    if (y + 18 > top + hh + 40) break;
    ctx.font = '700 13px "Zen Maru Gothic", sans-serif';
    ctx.fillStyle = INK;
    ctx.fillText(label, pad, y);
    const gx = pad + 120;
    const gw = bw - 120;
    ctx.fillStyle = CARD;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(gx, y + 1, gw, 14, 7);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(gx, y + 1, gw * Math.min(1, v / max), 14, 7);
    ctx.fill();
    y += 24;
  }
}

function drawBackdrop(ctx: CanvasRenderingContext2D, w: number, groundY: number): void {
  ctx.fillStyle = '#F2D9A6';
  ctx.beginPath();
  ctx.arc(w * 0.85, groundY * 0.62, Math.min(w, groundY) * 0.12, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#C9BBA2';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, groundY * 0.82);
  ctx.quadraticCurveTo(w * 0.25, groundY * 0.7, w * 0.45, groundY * 0.8);
  ctx.quadraticCurveTo(w * 0.7, groundY * 0.68, w, groundY * 0.78);
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
  maxH: number,
): void {
  const cars = g.stats.cars;
  const doors = g.stats.doorsPerCar;
  const bottom = groundY - 6;
  // 二階建て化を重ねるほど背が高くなる（画面に入る範囲で）
  const decks = 1 + (g.stats.levels['capacity'] ?? 0);
  const bodyH = Math.min(maxH, carH * (1 + 0.62 * (decks - 1)));
  const top = bottom - bodyH;
  const ratio = capacity(g) > 0 ? load(g) / capacity(g) : 0;
  const atStation = g.phase === 'dwell' || g.phase === 'adjust';
  const onPlat = atStation ? carsOnPlatform(g) : cars;
  const w = ctx.canvas.width / (window.devicePixelRatio || 1);

  for (let k = 0; k < cars; k++) {
    const right = toX(g.x - k * CAR_LEN);
    const left = toX(g.x - (k + 1) * CAR_LEN) + 2;
    if (right < -5 || left > w + 5) continue;
    const width = right - left;
    const color = CAR_COLORS[k % CAR_COLORS.length];

    // 車体（外枠）
    ctx.fillStyle = color;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    if (k === 0) ctx.roundRect(left, top, width, bodyH, [6, 16, 6, 6]);
    else ctx.roundRect(left, top, width, bodyH, 6);
    ctx.fill();
    ctx.stroke();

    // 屋根の機器（冷房強化の数だけ増える）
    const acN = Math.min(8, g.stats.levels['cooler'] ?? 0);
    for (let a = 0; a < acN; a++) {
      const aw = Math.min(18, width / (acN + 1) - 4);
      const ax = left + ((a + 1) * width) / (acN + 1) - aw / 2;
      ctx.fillStyle = '#CFE6EE';
      ctx.fillRect(ax, top - 7, aw, 7);
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1.4;
      ctx.strokeRect(ax, top - 7, aw, 7);
    }
    // 床下の機器（高出力モーターの数だけ増える）
    const motorN = Math.min(6, g.stats.levels['motor'] ?? 0);
    for (let a = 0; a < motorN; a++) {
      const mw = Math.min(16, width / (motorN + 2));
      const mx = left + width * 0.38 + a * (mw + 3) - (motorN * (mw + 3)) / 2 + width * 0.12;
      ctx.fillStyle = '#3A3631';
      ctx.fillRect(mx, bottom - 2, mw, 6);
    }

    // 断面（車内）
    const inL = left + 5;
    const inR = right - (k === 0 ? 10 : 5);
    const inTop = top + 7;
    const floorY = bottom - Math.max(8, carH * 0.16);
    const inW = inR - inL;
    ctx.fillStyle = '#FFF7E6';
    ctx.fillRect(inL, inTop, inW, floorY - inTop);
    const deckH = (floorY - inTop) / decks;

    const spacing = CAR_LEN / doors;
    const doorW = Math.min(1.6, spacing * 0.55) * ppm;
    const doorXs: number[] = [];
    for (let j = 0; j < doors; j++) doorXs.push(left + (j + 0.5) * spacing * ppm);

    for (let d = 0; d < decks; d++) {
      const fy = floorY - d * deckH; // この階の床
      const cy = fy - deckH; // この階の天井
      // 座席（ドアの間）
      ctx.fillStyle = '#C9B79C';
      const seatH = Math.max(3, deckH * 0.1);
      ctx.fillRect(inL, fy - seatH * 2.2, inW, seatH);
      // 乗客
      const fh = Math.min(deckH * 0.72, 34);
      const fw = fh * 0.42;
      const perRow = Math.max(1, Math.floor(inW / (fw * 1.3)));
      const slots = perRow * 2;
      const count = Math.round(ratio * slots);
      for (let p = 0; p < count; p++) {
        const row = p % 2; // 0: 手前、1: 奥
        const idx = Math.floor(p / 2);
        const jx = (hrand(k * 131 + d, p) - 0.5) * fw * 0.5;
        const px = inL + fw * 0.7 + ((idx + (row ? 0.5 : 0)) * (inW - fw * 1.4)) / perRow + jx;
        if (px > inR - fw * 0.5) continue;
        const scale = row ? 0.86 : 1;
        drawPerson(ctx, px, fy - 1 - (row ? fh * 0.08 : 0), fh * scale, PEOPLE[Math.floor(hrand(k, p * 7 + d) * PEOPLE.length)], row === 1);
      }
      // 階の床
      ctx.fillStyle = INK;
      ctx.fillRect(inL, fy - 1, inW, 2);
      if (d > 0) {
        // 2階以上の窓枠
        ctx.strokeStyle = shade(color);
        ctx.lineWidth = 2;
        ctx.strokeRect(inL + 1, cy + 1, inW - 2, deckH - 2);
      }
    }

    // ドア（1階だけ）
    const doorH = Math.min(deckH * 0.86, carH * 0.8);
    for (const cx of doorXs) {
      const open = atStation && g.doorAnim > 0 && k < onPlat ? g.doorAnim : 0;
      const half = doorW / 2;
      const slide = half * open * 0.95;
      ctx.fillStyle = shade(color);
      ctx.globalAlpha = 0.85;
      ctx.fillRect(cx - half - slide, floorY - doorH, half, doorH);
      ctx.fillRect(cx + slide, floorY - doorH, half, doorH);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1.4;
      ctx.strokeRect(cx - half - slide, floorY - doorH, half, doorH);
      ctx.strokeRect(cx + slide, floorY - doorH, half, doorH);
    }
    // 外枠をもう一度（断面の縁）
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    if (k === 0) ctx.roundRect(left, top, width, bodyH, [6, 16, 6, 6]);
    else ctx.roundRect(left, top, width, bodyH, 6);
    ctx.stroke();
    ctx.fillStyle = CARD;
    ctx.fillRect(left + 1, floorY + 2, width - 2, Math.max(3, carH * 0.05));

    // 先頭車の顔
    if (k === 0) {
      ctx.fillStyle = '#FFF3CF';
      ctx.fillRect(right - 10, top + 8, 7, bodyH * 0.3);
      ctx.strokeStyle = INK;
      ctx.strokeRect(right - 10, top + 8, 7, bodyH * 0.3);
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
      ctx.rect(left, top, width, bodyH);
      ctx.clip();
      ctx.strokeStyle = 'rgba(31,27,22,0.35)';
      ctx.lineWidth = 4;
      for (let s = left - bodyH; s < right; s += 12) {
        ctx.beginPath();
        ctx.moveTo(s, bottom);
        ctx.lineTo(s + bodyH, top);
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

const PEOPLE = ['#6FC3A0', '#F0A79C', '#E9B23E', '#8299E0', '#F08E78', '#B98A5E', '#3A3631'];

function hrand(a: number, b: number): number {
  let x = (Math.imul(a + 1, 73856093) ^ Math.imul(b + 1, 19349663)) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 1274126177) >>> 0;
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

function drawPerson(ctx: CanvasRenderingContext2D, x: number, feetY: number, h: number, color: string, back: boolean): void {
  const headR = h * 0.17;
  const bodyW = h * 0.36;
  const bodyH = h * 0.58;
  ctx.globalAlpha = back ? 0.75 : 1;
  ctx.fillStyle = color;
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.roundRect(x - bodyW / 2, feetY - bodyH, bodyW, bodyH, bodyW / 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#F3D9B8';
  ctx.beginPath();
  ctx.arc(x, feetY - bodyH - headR * 0.9, headR, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.globalAlpha = 1;
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
