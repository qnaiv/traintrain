// ゲームの状態と更新。DOM には触らない（シミュレーションからも動かせるように）。

import { CAR_LEN, type LineDef } from './data.ts';
import { defaultStats, rollOffer, type Stats, type UpgradeDef } from './upgrades.ts';

export type Phase = 'running' | 'adjust' | 'dwell' | 'clear' | 'over';

export const DWELL_NOMINAL = 18; // 時刻表上の停車時間 [s]
export const DELAY_LIMIT = 300; // 遅れの上限 [s]
const STOP_WINDOW_BEFORE = 60; // 停止位置の手前これ以内で止まったら停車扱い [m]
const PASS_DISTANCE = 150; // 停止位置をこれ以上過ぎたら通過扱い [m]
const BOARD_RATE_PER_DOOR = 0.8; // 1枚のドアから1秒に乗り降りできる人数
const THROUGH_RATE = 0.25; // ドアカット車両の通り抜け乗降の効率
const BASE_VMAX = 20; // [m/s]
const BASE_ACCEL = 1.1; // [m/s^2]

export interface Toast {
  text: string;
  ttl: number;
  kind: 'good' | 'bad' | 'info';
}

export interface Game {
  line: LineDef;
  stats: Stats;
  rand: () => number;
  phase: Phase;
  time: number;
  x: number;
  v: number;
  brake: number;
  held: boolean;
  target: number;
  pos: number[];
  arr: number[];
  dep: number[];
  lastDepTime: number;
  trust: number;
  money: number;
  delay: number;
  onboard: number[];
  waiting: number;
  doorAnim: number;
  doorsWant: boolean;
  departQueued: boolean;
  adjustTimer: number;
  flowAcc: number;
  offer: UpgradeDef[] | null;
  toasts: Toast[];
  carried: number;
  leftBehind: number;
  perfect: number;
  overReason: string;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function nominalRun(dist: number): number {
  return dist / 15 + 6;
}

export function newGame(line: LineDef, seed = Date.now()): Game {
  const pos: number[] = [0];
  for (const d of line.sections) pos.push(pos[pos.length - 1] + d);
  const n = line.stations.length;
  const arr: number[] = new Array(n).fill(0);
  const dep: number[] = new Array(n).fill(0);
  dep[0] = 25;
  for (let i = 1; i < n; i++) {
    arr[i] = dep[i - 1] + nominalRun(line.sections[i - 1]);
    dep[i] = arr[i] + DWELL_NOMINAL;
  }
  const g: Game = {
    line,
    stats: defaultStats(),
    rand: mulberry32(seed),
    phase: 'dwell',
    time: 0,
    x: 0,
    v: 0,
    brake: 0,
    held: false,
    target: 0,
    pos,
    arr,
    dep,
    lastDepTime: 0,
    trust: 100,
    money: 0,
    delay: 0,
    onboard: new Array(n).fill(0),
    waiting: 0,
    doorAnim: 0,
    doorsWant: false,
    departQueued: false,
    adjustTimer: 0,
    flowAcc: 0,
    offer: null,
    toasts: [],
    carried: 0,
    leftBehind: 0,
    perfect: 0,
    overReason: '',
  };
  g.waiting = spawnWaiting(g, 0);
  toast(g, `${line.stations[0].name}駅。ドアを開けて客を乗せよう`, 'info');
  return g;
}

// ---- 派生値 ----

export function capacity(g: Game): number {
  return g.stats.cars * g.stats.capPerCar;
}

export function load(g: Game): number {
  return g.onboard.reduce((a, b) => a + b, 0);
}

export function weightFactor(g: Game): number {
  return 1 + (g.stats.cars - 2) * 0.07;
}

export function vmax(g: Game): number {
  return BASE_VMAX * g.stats.speedMul;
}

export function isTerminal(g: Game): boolean {
  return g.target === g.line.stations.length - 1;
}

export function carsOnPlatform(g: Game): number {
  return Math.min(g.stats.cars, g.line.stations[g.target].platformCars);
}

export function doorCutCars(g: Game): number {
  return g.stats.cars - carsOnPlatform(g);
}

/** 停車駅の発車まで（running 中は到着予定まで）の残り秒。負なら遅れ */
export function countdown(g: Game): number {
  if (g.phase === 'running') return g.arr[g.target] - g.time;
  return g.dep[g.target] - g.time;
}

function flowRate(g: Game): number {
  const d = g.stats.doorsPerCar;
  return (carsOnPlatform(g) * d + doorCutCars(g) * d * THROUGH_RATE) * BOARD_RATE_PER_DOOR;
}

// ---- 操作 ----

export function setBrake(g: Game, held: boolean): void {
  g.held = held;
}

export function toggleDoors(g: Game): void {
  if (g.phase !== 'dwell') return;
  g.doorsWant = !g.doorsWant;
  if (g.doorsWant) g.departQueued = false;
}

export function canDepart(g: Game): boolean {
  return g.phase === 'dwell' && !isTerminal(g) && !g.doorsWant && g.doorAnim <= 0;
}

/** 発車ボタン。ドアが開いていれば閉めてから自動で発車する */
export function requestDepart(g: Game): void {
  if (g.phase !== 'dwell' || isTerminal(g)) return;
  if (canDepart(g)) depart(g);
  else {
    g.doorsWant = false;
    g.departQueued = true;
  }
}

export function depart(g: Game): void {
  if (!canDepart(g)) return;
  g.departQueued = false;
  const left = g.waiting;
  if (left > 0) {
    g.trust -= left * 0.4;
    g.leftBehind += left;
    toast(g, `${left}人を積み残した（信頼 −${fmt1(left * 0.4)}）`, 'bad');
  }
  if (g.time < g.dep[g.target] - 1) {
    g.trust -= 3;
    toast(g, '早発！（信頼 −3）', 'bad');
  }
  if (g.stats.cooler > 0) g.trust += g.stats.cooler;
  if (g.stats.pack > 0) g.trust -= g.stats.pack;
  g.waiting = 0;
  g.lastDepTime = g.time;
  g.target += 1;
  g.phase = 'running';
  g.v = 0;
  g.brake = 0;
  g.offer = rollOffer(g.rand);
  clampTrust(g);
}

export function chooseOffer(g: Game, idx: number): void {
  if (!g.offer || !g.offer[idx]) return;
  const u = g.offer[idx];
  const title = u.name(g.stats);
  u.apply(g.stats);
  g.stats.levels[u.id] = (g.stats.levels[u.id] ?? 0) + 1;
  toast(g, `魔改造：${title} Lv.${g.stats.levels[u.id]}`, 'good');
  g.offer = null;
}

export function dismissOffer(g: Game): void {
  g.offer = null;
}

// ---- 更新 ----

export function update(g: Game, dt: number): void {
  if (g.phase === 'clear' || g.phase === 'over') return;
  g.time += dt;
  for (const t of g.toasts) t.ttl -= dt;
  g.toasts = g.toasts.filter((t) => t.ttl > 0);

  if (g.phase === 'running') updateRunning(g, dt);
  else if (g.phase === 'adjust') {
    g.adjustTimer -= dt;
    if (g.adjustTimer <= 0) {
      g.x = g.pos[g.target];
      g.phase = 'dwell';
    }
  } else if (g.phase === 'dwell') updateDwell(g, dt);

  g.delay = Math.max(0, -countdown(g));
  if (g.phase === 'dwell' || g.phase === 'adjust' || g.phase === 'running') {
    if (g.trust <= 0) gameOver(g, '信頼がなくなった');
    else if (g.delay > DELAY_LIMIT) gameOver(g, '遅れが5分を超えた');
  }
}

function updateRunning(g: Game, dt: number): void {
  const w = weightFactor(g);
  g.brake = g.held ? Math.min(1, g.brake + dt / 1.0) : Math.max(0, g.brake - dt / 0.35);
  if (g.held || g.brake > 0) {
    const decel = ((0.15 + g.brake * 1.8) * g.stats.brakeMul) / w;
    g.v = Math.max(0, g.v - decel * dt);
  } else {
    const accel = (BASE_ACCEL * g.stats.speedMul) / w;
    g.v = Math.min(vmax(g), g.v + accel * dt);
  }
  g.x += g.v * dt;

  const P = g.pos[g.target];
  if (g.v <= 0 && g.x >= P - STOP_WINDOW_BEFORE && g.x <= P + PASS_DISTANCE) {
    arrive(g);
  } else if (g.x > P + PASS_DISTANCE) {
    passThrough(g);
  }
}

function arrive(g: Game): void {
  const P = g.pos[g.target];
  let err = g.x - P; // 正ならオーバーラン
  const a = Math.abs(err);
  g.offer = null;
  if (g.stats.snap > 0 && a > 0.5 && a <= g.stats.snap) {
    toast(g, `定位置停止装置で補正（${fmtSigned(err)}m）`, 'info');
    err = 0;
  }
  const e = Math.abs(err);
  if (e <= 0.5) {
    g.trust += 2;
    g.perfect += 1;
    toast(g, 'ぴったり！（信頼 +2）', 'good');
  } else if (e <= 2) {
    toast(g, `良（${fmtSigned(err)}m）`, 'info');
  } else if (e <= 10) {
    g.trust -= 3;
    toast(g, err > 0 ? `オーバーラン ${fmt1(e)}m（信頼 −3）` : `手前停止 ${fmt1(e)}m（信頼 −3）`, 'bad');
  } else {
    g.trust -= 8;
    toast(g, err > 0 ? `大幅オーバーラン ${fmt1(e)}m（信頼 −8）` : `だいぶ手前 ${fmt1(e)}m（信頼 −8）`, 'bad');
  }
  clampTrust(g);

  g.v = 0;
  g.brake = 0;
  g.doorsWant = false;
  g.departQueued = false;
  g.doorAnim = 0;
  g.flowAcc = 0;
  g.waiting = spawnWaiting(g, g.target);
  if (e > 2) {
    g.phase = 'adjust';
    g.adjustTimer = e > 10 ? 12 : 4;
  } else {
    g.x = P;
    g.phase = 'dwell';
  }
  const cut = doorCutCars(g);
  if (cut > 0) toast(g, `ホームは${carsOnPlatform(g)}両分。${cut}両がドアカット`, 'bad');
  if (isTerminal(g)) toast(g, '終点です。全員降ろそう', 'info');
}

function passThrough(g: Game): void {
  const st = g.line.stations[g.target];
  if (isTerminal(g)) {
    gameOver(g, '終点の車止めを突き破った');
    return;
  }
  const stranded = g.onboard[g.target];
  g.onboard[g.target + 1] += stranded;
  g.onboard[g.target] = 0;
  const penalty = 15 + stranded * 0.5;
  g.trust -= penalty;
  toast(g, `${st.name}を通過してしまった（信頼 −${fmt1(penalty)}）`, 'bad');
  clampTrust(g);
  g.lastDepTime = g.time;
  g.target += 1;
}

function updateDwell(g: Game, dt: number): void {
  const doorTime = 2.5 * g.stats.doorTimeMul;
  if (g.doorsWant) g.doorAnim = Math.min(1, g.doorAnim + dt / doorTime);
  else g.doorAnim = Math.max(0, g.doorAnim - dt / doorTime);
  if (g.departQueued && canDepart(g)) {
    depart(g);
    return;
  }

  if (g.doorAnim >= 1) {
    g.flowAcc += flowRate(g) * dt;
    while (g.flowAcc >= 1) {
      if (g.onboard[g.target] > 0) {
        g.onboard[g.target] -= 1;
        g.money += 30;
        g.carried += 1;
      } else if (g.waiting > 0 && load(g) < capacity(g)) {
        g.waiting -= 1;
        boardOne(g);
      } else {
        g.flowAcc = 0;
        break;
      }
      g.flowAcc -= 1;
    }
  }

  if (isTerminal(g) && load(g) === 0 && g.doorAnim >= 1) {
    g.phase = 'clear';
    toast(g, '終点に到着！', 'good');
  }
}

function boardOne(g: Game): void {
  const n = g.line.stations.length;
  const from = g.target + 1;
  let total = 0;
  for (let k = from; k < n; k++) total += 1 / (k - g.target);
  let r = g.rand() * total;
  let dest = n - 1;
  for (let k = from; k < n; k++) {
    r -= 1 / (k - g.target);
    if (r <= 0) {
      dest = k;
      break;
    }
  }
  g.onboard[dest] += 1;
}

function spawnWaiting(g: Game, i: number): number {
  const st = g.line.stations[i];
  if (st.demand <= 0) return 0;
  const ramp = 1 + 0.22 * i;
  const jitter = 0.8 + g.rand() * 0.4;
  return Math.max(1, Math.round(st.demand * ramp * jitter));
}

function gameOver(g: Game, reason: string): void {
  g.phase = 'over';
  g.overReason = reason;
  g.offer = null;
}

function clampTrust(g: Game): void {
  g.trust = Math.max(0, Math.min(100, g.trust));
}

export function toast(g: Game, text: string, kind: Toast['kind']): void {
  g.toasts.push({ text, ttl: 3.2, kind });
  if (g.toasts.length > 4) g.toasts.shift();
}

export function trainLength(g: Game): number {
  return g.stats.cars * CAR_LEN;
}

function fmt1(n: number): string {
  return (Math.round(n * 10) / 10).toString();
}

function fmtSigned(n: number): string {
  return (n >= 0 ? '+' : '−') + fmt1(Math.abs(n));
}
