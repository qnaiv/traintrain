// キャンバス上部の情報（路線ストリップ・停止メーター・停車パネル）

import { alightCount, capacity, carsOnPlatform, load, type Game } from './game.ts';

const INK = '#1F1B16';
const CARD = '#FFFDF6';
const SUB = '#5A5045';

export const STRIP_H = 50;
export const PANEL_H = 112;

export function drawRouteStrip(ctx: CanvasRenderingContext2D, g: Game, w: number): void {
  const hh = STRIP_H;
  ctx.fillStyle = CARD;
  ctx.fillRect(0, 0, w, hh);
  ctx.fillStyle = INK;
  ctx.fillRect(0, hh - 2, w, 2);
  const total = g.pos[g.pos.length - 1];
  const x0 = 24;
  const x1 = w - 24;
  const y = 17;
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
    const show = i === 0 || i === g.pos.length - 1 || i === g.target || w > 600;
    if (show) {
      ctx.fillStyle = i === g.target ? '#B53E28' : SUB;
      ctx.font = `${i === g.target ? 900 : 700} 11px "Zen Maru Gothic", sans-serif`;
      ctx.fillText(g.line.stations[i].name, Math.min(w - 30, Math.max(30, sx)), y + 10);
    }
  });
  const tx = toS(g.x);
  ctx.fillStyle = '#E9B23E';
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(tx - 9, y - 8, 18, 16, 4);
  ctx.fill();
  ctx.stroke();
}

export function drawApproach(ctx: CanvasRenderingContext2D, g: Game, w: number, top: number): void {
  const remain = g.pos[g.target] - g.x;
  const st = g.line.stations[g.target];
  const pad = 16;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = SUB;
  ctx.font = '700 12px "Zen Maru Gothic", sans-serif';
  ctx.fillText(`次は ${st.name}　ホーム${st.platformCars}両分／編成${g.stats.cars}両`, pad, top);
  ctx.fillStyle = remain < 0 ? '#B53E28' : INK;
  ctx.font = '38px "Dela Gothic One", sans-serif';
  ctx.fillText(remain >= 0 ? `${remain.toFixed(1)}m` : `+${(-remain).toFixed(1)}m`, pad, top + 16);
  ctx.textAlign = 'right';
  ctx.fillStyle = INK;
  ctx.font = '24px "Dela Gothic One", sans-serif';
  ctx.fillText(`${Math.round(g.v * 3.6)}km/h`, w - pad, top + 26);

  // 停止位置メーター
  const R = 80;
  const bx0 = pad;
  const bw = w - pad * 2;
  const by = top + 64;
  const bh = 24;
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
  ctx.fillStyle = '#F7CCC5';
  ctx.fillRect(xStop, by, bw - (xStop - bx0), bh);
  ctx.fillStyle = '#F3D27F';
  ctx.fillRect(xStop - 2 * scale, by, 4 * scale, bh);
  ctx.fillStyle = '#6FC3A0';
  ctx.fillRect(xStop - 0.5 * scale, by, Math.max(2, scale), bh);
  ctx.fillStyle = 'rgba(31,27,22,0.35)';
  for (let m = 10; m <= R; m += 10) ctx.fillRect(xStop - m * scale, by + bh * 0.6, 1.5, bh * 0.4);
  // ブレーキの強さ（バーの下地）
  ctx.fillStyle = 'rgba(228,85,58,0.25)';
  ctx.fillRect(bx0, by, bw * g.brake * 0.82, bh * 0.25);
  const tx = Math.max(bx0 + 6, Math.min(bx0 + bw - 6, xStop - remain * scale));
  ctx.fillStyle = INK;
  ctx.fillRect(tx - 3, by, 6, bh);
  ctx.restore();
  ctx.fillStyle = INK;
  ctx.fillRect(xStop - 1, by - 5, 2, bh + 10);
  ctx.textBaseline = 'top';
  ctx.font = '900 11px "Zen Maru Gothic", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('停止位置', xStop, by + bh + 4);
  if (remain > R) {
    ctx.textAlign = 'left';
    ctx.fillText(`→ まだ先（あと${Math.round(remain)}m）`, bx0 + 4, by + bh + 4);
  }
}

export function drawDwellPanel(ctx: CanvasRenderingContext2D, g: Game, w: number, top: number): void {
  const pad = 16;
  const st = g.line.stations[g.target];
  const cd = g.dep[g.target] - g.time;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = SUB;
  ctx.font = '700 12px "Zen Maru Gothic", sans-serif';
  ctx.fillText(g.phase === 'adjust' ? `${st.name}　停止位置を直しています…` : `${st.name}　停車中`, pad, top);

  const cut = g.stats.cars - carsOnPlatform(g);
  const cap = capacity(g);
  const ld = load(g);
  const warns: string[] = [];
  if (cut > 0) warns.push(`${cut}両ドアカット`);
  if (ld >= cap && g.waiting > 0) warns.push('満員！');
  if (warns.length) {
    ctx.textAlign = 'right';
    ctx.font = '900 12px "Zen Maru Gothic", sans-serif';
    ctx.fillStyle = '#B53E28';
    ctx.fillText(warns.join('　'), w - pad, top);
    ctx.textAlign = 'left';
  }

  ctx.font = '38px "Dela Gothic One", sans-serif';
  ctx.fillStyle = cd >= 0 ? INK : '#B53E28';
  const s = Math.abs(Math.round(cd));
  const t = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  ctx.fillText(cd >= 0 ? `発車まで ${t}` : `遅れ +${t}`, pad, top + 16);

  const alight = alightCount(g);
  ctx.font = '700 13px "Zen Maru Gothic", sans-serif';
  ctx.fillStyle = INK;
  ctx.fillText(`降車あと${alight}人　乗車待ち${g.waiting}人　車内${ld}/${cap}人`, pad, top + 64);
  const by = top + 84;
  const bw = w - pad * 2;
  ctx.fillStyle = CARD;
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(pad, by, bw, 14, 7);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = ld >= cap ? '#E4553A' : '#6FC3A0';
  ctx.beginPath();
  ctx.roundRect(pad, by, bw * Math.min(1, cap > 0 ? ld / cap : 0), 14, 7);
  ctx.fill();
}
