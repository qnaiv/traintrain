// ゲームの状態と更新。DOM には触らない（シミュレーションからも動かせるように）。

import { CAR_LEN, type LineDef } from './data.ts';
import { buildLayout, layoutKey, type SlotDef } from './seats.ts';
import { defaultStats, rollOffer, type Stats, type UpgradeDef } from './upgrades.ts';

export type Phase = 'running' | 'adjust' | 'dwell' | 'clear' | 'over';

export const DWELL_NOMINAL = 18; // 時刻表上の停車時間 [s]
export const DELAY_LIMIT = 300; // 遅れの上限 [s]
const STOP_WINDOW_BEFORE = 60; // 停止位置の手前これ以内で止まったら停車扱い [m]
const PASS_DISTANCE = 150; // 停止位置をこれ以上過ぎたら通過扱い [m]
const BOARD_RATE_PER_DOOR = 0.8; // 1枚のドアから1秒に乗り降りできる人数
const THROUGH_RATE = 0.25; // ドアカット車両の通り抜け乗降の効率
const MISSED_PENALTY = 2; // 降りそびれた客1人あたりの信頼の減り
const BASE_VMAX = 20; // [m/s]
const BASE_ACCEL = 1.1; // [m/s^2]

export interface Toast {
  text: string;
  ttl: number;
  kind: 'good' | 'bad' | 'info';
}

export interface Look {
  shirt: string;
  pants: string;
  hair: string;
  skin: string;
  hairStyle: number;
  bag: number;
  hat: number;
  /** 帽子・ヘルメットの色 */
  hatColor?: string;
  /** 花嫁：ドレスとベール */
  dress?: boolean;
  /** 観光客：首から下げたカメラ */
  camera?: boolean;
}

export interface Passenger {
  id: number;
  dest: number;
  car: number;
  slot: number;
  look: Look;
  /** 乗った時刻（登場アニメ用） */
  t: number;
  /** 立っているときの向き（0: 進行方向, 1: 逆） */
  face: number;
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
  passengers: Passenger[];
  layout: SlotDef[];
  layoutKey: string;
  nextId: number;
  waiting: number;
  doorAnim: number;
  doorsWant: boolean;
  departQueued: boolean;
  adjustTimer: number;
  accMain: number;
  accCut: number;
  offer: UpgradeDef[] | null;
  toasts: Toast[];
  carried: number;
  leftBehind: number;
  missed: number;
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
  const stats = defaultStats();
  const g: Game = {
    line,
    stats,
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
    passengers: [],
    layout: buildLayout(stats),
    layoutKey: layoutKey(stats),
    nextId: 1,
    waiting: 0,
    doorAnim: 0,
    doorsWant: true,
    departQueued: false,
    adjustTimer: 0,
    accMain: 0,
    accCut: 0,
    offer: null,
    toasts: [],
    carried: 0,
    leftBehind: 0,
    missed: 0,
    perfect: 0,
    overReason: '',
  };
  g.waiting = spawnWaiting(g, 0);
  toast(g, `${line.stations[0].name}駅。乗せ終わったら発車！`, 'info');
  return g;
}

// ---- 派生値 ----

export function slotsPerCar(g: Game): number {
  return g.layout.length;
}

export function capacity(g: Game): number {
  return g.stats.cars * slotsPerCar(g);
}

export function load(g: Game): number {
  return g.passengers.length;
}

export function loadOfCar(g: Game, car: number): number {
  let n = 0;
  for (const p of g.passengers) if (p.car === car) n++;
  return n;
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

/** 停車中（走行中は次の駅）のホームに収まる両数。前から数える */
export function carsOnPlatform(g: Game): number {
  return Math.min(g.stats.cars, g.line.stations[g.target].platformCars);
}

export function doorCutCars(g: Game): number {
  return g.stats.cars - carsOnPlatform(g);
}

/** 次（停車中はこの駅）で降りる客の数 */
export function alightCount(g: Game): number {
  let n = 0;
  for (const p of g.passengers) if (p.dest === g.target) n++;
  return n;
}

/** 次で降りる客のうち、ドアの開かない車両にいる数 */
export function stuckCount(g: Game): number {
  const on = carsOnPlatform(g);
  let n = 0;
  for (const p of g.passengers) if (p.dest === g.target && p.car >= on) n++;
  return n;
}

/** 停車駅の発車まで（running 中は到着予定まで）の残り秒。負なら遅れ */
export function countdown(g: Game): number {
  if (g.phase === 'running') return g.arr[g.target] - g.time;
  return g.dep[g.target] - g.time;
}

function occupancy(g: Game): Set<number> {
  const s = new Set<number>();
  for (const p of g.passengers) s.add(p.car * 1000 + p.slot);
  return s;
}

export function isFree(g: Game, car: number, slot: number): boolean {
  if (car < 0 || car >= g.stats.cars || slot < 0 || slot >= g.layout.length) return false;
  return !g.passengers.some((p) => p.car === car && p.slot === slot);
}

function pickFreeSlot(g: Game, carFrom: number, carTo: number): { car: number; slot: number } | null {
  const occ = occupancy(g);
  let best: { car: number; slot: number } | null = null;
  let bestScore = Infinity;
  for (let c = carFrom; c < carTo; c++) {
    for (let i = 0; i < g.layout.length; i++) {
      if (occ.has(c * 1000 + i)) continue;
      // 座席を優先し、同じくらいなら散らばるように少しランダム
      const score = (g.layout[i].seat ? 0 : 10) + i * 0.05 + g.rand() * 3;
      if (score < bestScore) {
        bestScore = score;
        best = { car: c, slot: i };
      }
    }
  }
  return best;
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
  const missed = g.passengers.filter((p) => p.dest === g.target);
  if (missed.length > 0) {
    for (const p of missed) p.dest = g.target + 1;
    g.trust -= missed.length * MISSED_PENALTY;
    g.missed += missed.length;
    toast(g, `${missed.length}人が降りられなかった（信頼 −${missed.length * MISSED_PENALTY}）`, 'bad');
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
  relayout(g);
}

export function dismissOffer(g: Game): void {
  g.offer = null;
}

/** 乗客を別の席へ動かす（車内整理）。動かせたら true */
export function movePassenger(g: Game, id: number, car: number, slot: number): boolean {
  const p = g.passengers.find((q) => q.id === id);
  if (!p || !isFree(g, car, slot)) return false;
  p.car = car;
  p.slot = slot;
  return true;
}

/** 乗客を別の車両へ移す（空いた席に入る）。満員なら false */
export function movePassengerToCar(g: Game, id: number, car: number): boolean {
  const p = g.passengers.find((q) => q.id === id);
  if (!p || car < 0 || car >= g.stats.cars || p.car === car) return false;
  const spot = pickFreeSlot(g, car, car + 1);
  if (!spot) return false;
  p.car = spot.car;
  p.slot = spot.slot;
  p.t = g.time;
  return true;
}

export function isCarFull(g: Game, car: number): boolean {
  return loadOfCar(g, car) >= slotsPerCar(g);
}

/** 強化で席の並びが変わったら、乗客をいちばん近い席へ座り直させる */
export function relayout(g: Game): void {
  const key = layoutKey(g.stats);
  if (key === g.layoutKey) return;
  const old = g.layout;
  const next = buildLayout(g.stats);
  g.layout = next;
  g.layoutKey = key;
  const taken = new Set<number>();
  const homeless: Passenger[] = [];
  for (let c = 0; c < g.stats.cars; c++) {
    const inCar = g.passengers.filter((p) => p.car === c);
    for (const p of inCar) {
      const was = old[p.slot] ?? old[0];
      let best = -1;
      let bestD = Infinity;
      for (let i = 0; i < next.length; i++) {
        if (taken.has(c * 1000 + i)) continue;
        const s = next[i];
        const d = Math.hypot(s.x - was.x, s.y - was.y) + Math.abs(s.deck - Math.min(was.deck, 9)) * 4;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      if (best >= 0) {
        p.slot = best;
        taken.add(c * 1000 + best);
      } else homeless.push(p);
    }
  }
  for (const p of homeless) {
    const spot = pickFreeSlotExcluding(g, taken);
    if (spot) {
      p.car = spot.car;
      p.slot = spot.slot;
      taken.add(spot.car * 1000 + spot.slot);
    } else {
      g.passengers = g.passengers.filter((q) => q !== p);
      g.money += 30;
    }
  }
}

function pickFreeSlotExcluding(g: Game, taken: Set<number>): { car: number; slot: number } | null {
  for (let c = 0; c < g.stats.cars; c++) for (let i = 0; i < g.layout.length; i++) if (!taken.has(c * 1000 + i)) return { car: c, slot: i };
  return null;
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
      g.doorsWant = true;
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
  // 駅が近づいたら、選ばれなかった強化は見送り（停止メーターを隠さないため）
  if (g.offer && P - g.x < 130) {
    g.offer = null;
    toast(g, '魔改造は見送り（駅が近い）', 'info');
  }
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
  g.accMain = 0;
  g.accCut = 0;
  g.waiting = spawnWaiting(g, g.target);
  if (e > 2) {
    g.phase = 'adjust';
    g.adjustTimer = e > 10 ? 12 : 4;
  } else {
    g.x = P;
    g.phase = 'dwell';
    g.doorsWant = true; // ドアは自動で開く
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
  const stranded = g.passengers.filter((p) => p.dest === g.target);
  for (const p of stranded) p.dest = g.target + 1;
  const penalty = 15 + stranded.length * 0.5;
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
    const on = carsOnPlatform(g);
    const cut = g.stats.cars - on;
    const doors = g.stats.doorsPerCar;
    // ホームにいる車両は直接、はみ出した車両は隣の車両を通り抜けて乗り降りする
    g.accMain += on * doors * BOARD_RATE_PER_DOOR * dt;
    g.accCut += cut > 0 ? Math.max(0.5, cut * doors * BOARD_RATE_PER_DOOR * THROUGH_RATE) * dt : 0;
    while (g.accMain >= 1) {
      if (!flowOne(g, 0, on, true)) {
        g.accMain = Math.min(g.accMain, 1);
        break;
      }
      g.accMain -= 1;
    }
    while (g.accCut >= 1) {
      if (!flowOne(g, on, g.stats.cars, false)) {
        g.accCut = Math.min(g.accCut, 1);
        break;
      }
      g.accCut -= 1;
    }
  }

  if (isTerminal(g) && load(g) === 0 && g.doorAnim >= 1) {
    g.phase = 'clear';
    toast(g, '終点に到着！', 'good');
  }
}

/** 車両 [from, to) で1人分の乗り降りを進める。何もできなければ false */
function flowOne(g: Game, from: number, to: number, front: boolean): boolean {
  const idx = g.passengers.findIndex((p) => p.dest === g.target && p.car >= from && p.car < to);
  if (idx >= 0) {
    g.passengers.splice(idx, 1);
    g.money += 30;
    g.carried += 1;
    return true;
  }
  if (g.waiting <= 0) return false;
  // はみ出した車両に乗せるのは、前の車両が満員のときだけ
  if (!front && pickFreeSlot(g, 0, carsOnPlatform(g))) return false;
  const spot = pickFreeSlot(g, from, to);
  if (!spot) return false;
  g.waiting -= 1;
  boardOne(g, spot.car, spot.slot);
  return true;
}

const SHIRTS = ['#E4553A', '#3F62CF', '#6FC3A0', '#E9B23E', '#F0A79C', '#FFFDF6', '#8299E0', '#3A3631', '#B98ADB', '#5BB8C9'];
const PANTS = ['#3A3631', '#2C47A0', '#6B655C', '#8E6640', '#24211D', '#CFC6B8'];
const HAIRS = ['#24211D', '#3A3631', '#6B4A2E', '#8E6640', '#C9B79C', '#E9B23E', '#B9B0A2'];
const SKINS = ['#F3D9B8', '#E8C39E', '#D6A77A', '#F6E2CB'];

export function randomLook(r: () => number): Look {
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  return {
    shirt: pick(SHIRTS),
    pants: pick(PANTS),
    hair: pick(HAIRS),
    skin: pick(SKINS),
    hairStyle: Math.floor(r() * 4),
    bag: r() < 0.35 ? 1 + Math.floor(r() * 2) : 0,
    hat: r() < 0.12 ? 1 : 0,
  };
}

function boardOne(g: Game, car: number, slot: number): void {
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
  g.passengers.push({ id: g.nextId++, dest, car, slot, look: randomLook(g.rand), t: g.time, face: g.rand() < 0.5 ? 0 : 1 });
}

function spawnWaiting(g: Game, i: number): number {
  const st = g.line.stations[i];
  if (st.demand <= 0) return 0;
  const ramp = 1 + 0.4 * i;
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
