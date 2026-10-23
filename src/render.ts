// 描画のまとめ役。上部の情報パネルと、外の視点（台座）を描く。

import { drawExterior, type ExtResult } from './exterior.ts';
import type { Game } from './game.ts';
import { drawInterior, drawInteriorHeader, type DragState, type InteriorHit } from './interior.ts';
import { drawApproach, drawDwellPanel, drawRouteStrip, PANEL_H, STRIP_H } from './panels.ts';

const PAPER = '#F5EFE3';

export interface View {
  mode: 'out' | 'in';
  focus: number;
  drag: DragState | null;
  dt: number;
}

export interface DrawResult {
  ext: ExtResult | null;
  hits: InteriorHit[];
}

export function draw(ctx: CanvasRenderingContext2D, g: Game, w: number, h: number, v: View): DrawResult {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.restore();
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, w, h);

  const top = STRIP_H + PANEL_H + 4;
  if (v.mode === 'in') {
    const hits = drawInterior(ctx, g, v.focus, w, top, h - 6, v.drag, v.dt);
    drawRouteStrip(ctx, g, w);
    drawInteriorHeader(ctx, g, w, STRIP_H + 10);
    return { ext: null, hits };
  }
  const res = drawExterior(ctx, g, w, top, h - 6);

  drawRouteStrip(ctx, g, w);
  if (g.phase === 'running') drawApproach(ctx, g, w, STRIP_H + 8);
  else if (g.phase === 'dwell' || g.phase === 'adjust') drawDwellPanel(ctx, g, w, STRIP_H + 8);
  return { ext: res, hits: [] };
}
