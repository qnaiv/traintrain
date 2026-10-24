// トップ画面の走行映像：本物のルールで、自動で運転する（射出・停車・乗車まで見せる）

import {
  KINDS,
  POS,
  N_ST,
  canReverse,
  depart,
  flight,
  kmh,
  launchBoost,
  moveToLevel,
  newRun,
  nextObstacle,
  setNotch,
  spotWorldX,
  spotZ,
  tapObstacle,
  togglePick,
  treeNeed,
  curveV,
  workV,
  FLOOD_V,
  waveUp,
  update,
  type Meta,
  type Run,
} from './state.ts';

let dwellT = 0;
let launched = -1;
let boarded = -1;

/** 映像用のラン（貯金や図鑑には触らない） */
export function makeDemo(meta: Meta): Run {
  const m = structuredClone(meta);
  m.loadout = 'normal';
  const r = newRun(m, false);
  r.demo = true;
  r.offer = null;
  r.delayLimit = 9999;
  dwellT = 0;
  launched = -1;
  boarded = -1;
  return r;
}

/** 停車中：屋根に次の駅で降りる客を2人、車内に先へ行く客を2人 */
function board(r: Run) {
  const st = r.target;
  const next = st + 1;
  const light = r.candidates.filter((c) => KINDS[c.kind].size === 1);
  const roof = light.slice(0, 2);
  for (const c of roof) {
    c.dest = next;
    c.kind = 'tour';
  }
  const inner = light.slice(2, 4);
  for (const c of inner) {
    c.dest = Math.min(N_ST - 1, next + 1);
    if (c.kind === 'kid' || c.kind === 'vip' || c.kind === 'old') c.kind = 'sal';
  }
  for (const c of [...roof, ...inner]) togglePick(r, c.id);
  for (const c of roof) moveToLevel(r, c.id, 0, 2);
}

/** 自動運転を1コマ進める。終わったら false */
export function stepDemo(r: Run, dt: number): boolean {
  if (r.phase === 'clear' || r.phase === 'over') return false;
  if (r.phase === 'dwell') {
    dwellT += dt;
    if (dwellT > 0.6 && boarded !== r.target) {
      boarded = r.target;
      board(r);
    }
    if (dwellT > 2.6) {
      dwellT = 0;
      depart(r);
    }
    update(r, dt);
    return true;
  }
  // 障害
  const o = nextObstacle(r);
  const k = kmh(r.v);
  let n = 6;
  if (o) {
    const d = o.x - r.x;
    if ((o.kind === 'deer' || o.kind === 'pole' || o.kind === 'work') && d < 45) tapObstacle(r, o);
    // 倒木はぎりぎりの速さで（速すぎると屋根の客が飛ぶ）
    if (o.kind === 'tree' && d < 160) n = k < treeNeed(r) + 2 ? 7 : k > treeNeed(r) + 6 ? 3 : 4;
    if (o.kind === 'curve' && d < 60) n = k > curveV(r) - 2 ? 2 : 5;
    if (o.kind === 'work' && o.taps > 0 && d < 90) n = k > workV(r) - 2 ? 2 : 5;
    if (o.kind === 'flood' && d < 110) n = k > FLOOD_V - 2 ? 2 : 5;
    if (o.kind === 'wave' && d < 40 && waveUp(r.time)) n = 2;
  }
  // 駅：屋根の客を×2マットへ射出してから止まる
  const st = r.target;
  const stop = POS[st] - 4;
  const mat = r.mats[st];
  const roof = r.pax.filter((p) => p.dest === st && r.spots[p.spot]?.deck === 2);
  // 駅の手前にまだ障害があるうちは、駅の操作はしない
  const clearAhead = !o || o.x > POS[st];
  if (roof.length && launched !== st && r.v > 5 && clearAhead) {
    const p = roof[0];
    const f = flight(r.v, spotZ(r, p.spot), p.kind, launchBoost(r, p, 1));
    const land = spotWorldX(r, p.spot) + f.dist;
    if (land >= mat.x - 0.5 && land <= POS[st] + 2) {
      launched = st;
      setNotch(r, 0);
      r.notch = 2;
    }
  }
  const dist = stop - r.x;
  r.reverse = canReverse(r);
  if (clearAhead && launched === st) {
    // 射出したら非常ブレーキのまま止まる（行き過ぎたらバック）
    r.notch = r.v > 0.3 ? 0 : 4;
  } else {
    if (clearAhead && !roof.length && dist < (r.v * r.v) / (2 * 1.4) + 4) n = dist > 0 || r.v > 0.5 ? 2 : 4;
    // 射出まではそこそこの速さ（36〜41km/h）で駅に近づく
    if (clearAhead && roof.length && dist < 240) n = k < 37 ? 6 : k > 41 ? 3 : 4;
    if (r.notch !== n && r.notch !== 0) setNotch(r, n);
    else if (r.notch === 0) r.notch = n;
  }
  const steps = Math.ceil(dt / 0.02);
  for (let i = 0; i < steps; i++) update(r, dt / steps);
  return true;
}
