// 試作 v0.7「障害突破ラン」のゲームの状態と進行。描画には触れない。

import { randomLook, type Look } from '../../game.ts';
import type { LineDef } from '../../data.ts';

// ---------- 路線 ----------
export const LINE: LineDef = {
  id: 'enoden-proto',
  name: '江ノ島電鉄',
  stations: [
    { name: '藤沢', platformCars: 2, demand: 0 },
    { name: '鵠沼', platformCars: 2, demand: 0 },
    { name: '江ノ島', platformCars: 2, demand: 0 },
    { name: '腰越', platformCars: 2, demand: 0 },
    { name: '鎌倉高校前', platformCars: 2, demand: 0 },
  ],
  sections: [380, 420, 360, 440],
  scenery: ['town', 'town', 'street', 'coast'],
};
export const POS: number[] = [0];
for (const d of LINE.sections) POS.push(POS[POS.length - 1] + d);
export const N_ST = LINE.stations.length;
/** 停止できる範囲（先頭の位置。停止目標からの差） */
export const STOP_LO = -14;
export const STOP_HI = 4;
export const DELAY_LIMIT = 120;
export const SEATS = 5;

// ---------- 乗客 ----------
export type Kind = 'old' | 'kid' | 'sal' | 'stu' | 'sumo' | 'vip';
export interface KindDef {
  name: string;
  ch: string;
  tol: number;
  fare: number; // 1駅あたり
  size: number; // 席をいくつ使うか
  note: string;
  color: string;
}
export const KINDS: Record<Kind, KindDef> = {
  old: { name: 'お年寄り', ch: '老', tol: 10, fare: 160, size: 1, note: '無事に届けると信頼+5', color: '#B9B0A2' },
  kid: { name: '子ども', ch: '子', tol: 15, fare: 70, size: 1, note: '軽い。よく飛ぶ', color: '#E9B23E' },
  sal: { name: '会社員', ch: '会', tol: 30, fare: 120, size: 1, note: '遅れ30秒超で運賃半分', color: '#FFFDF6' },
  stu: { name: '学生', ch: '学', tol: 45, fare: 60, size: 1, note: '連打を手伝う（毎秒3回）', color: '#8299E0' },
  sumo: { name: '力士', ch: '力', tol: 90, fare: 260, size: 3, note: '席を3つ使う。隣は耐衝撃+20', color: '#F0C9A0' },
  vip: { name: 'VIP', ch: 'V', tol: 5, fare: 0, size: 1, note: '依頼：無傷で届けると¥2000', color: '#B98ADB' },
};

export interface Pax {
  id: number;
  kind: Kind;
  look: Look;
  from: number;
  dest: number;
  spot: number; // 車内の位置。-1 はホーム
}

// ---------- 車内の位置 ----------
export type SpotKind = 'seat' | 'strap' | 'floor';
export interface Spot {
  x: number;
  y: number;
  kind: SpotKind;
}
export const SPOTS: Spot[] = [
  { x: 5.3, y: -0.98, kind: 'seat' },
  { x: 6.7, y: -0.98, kind: 'seat' },
  { x: 8.1, y: 0.4, kind: 'strap' },
  { x: 9.5, y: 0.4, kind: 'strap' },
  { x: 1.6, y: 0.1, kind: 'floor' },
  { x: 3.0, y: 0.55, kind: 'floor' },
  { x: 4.3, y: -0.1, kind: 'floor' },
  { x: 10.9, y: -0.2, kind: 'floor' },
];

// ---------- 障害 ----------
export type ObsKind = 'tree' | 'curve' | 'deer' | 'pole';
export interface Obstacle {
  kind: ObsKind;
  x: number; // 障害の位置（先頭がここに来たら判定）
  len: number; // カーブの長さ
  taps: number; // 残りタップ数（電柱）／鹿は 1
  need: number;
  state: 'wait' | 'cleared' | 'hit' | 'passed';
  t: number; // 状態が変わった時刻（演出用）
  shock?: number;
}
export const OBS_INFO: Record<ObsKind, { name: string; ch: string }> = {
  tree: { name: '倒木', ch: '木' },
  curve: { name: '急カーブ', ch: '曲' },
  deer: { name: '鹿', ch: '鹿' },
  pole: { name: '倒れた電柱', ch: '柱' },
};
export const TREE_V = 40; // km/h 以上で突き破る
export const CURVE_V = 20; // km/h 以下で通過

// ---------- 3択 ----------
export type ItemId = 'jump' | 'saw' | 'airbag';
export type ModId = 'belt' | 'ram' | 'susp';
export interface Offer {
  id: ItemId | ModId;
  name: string;
  desc: string;
  kind: 'item' | 'mod';
}
export const OFFERS: Offer[] = [
  { id: 'jump', name: 'ジャンプ台', desc: '次の障害を飛び越える。着地の衝撃は70', kind: 'item' },
  { id: 'saw', name: 'チェーンソー', desc: '電柱と倒木を一瞬で片付ける', kind: 'item' },
  { id: 'airbag', name: 'エアバッグ', desc: '次の衝撃で誰も飛ばない', kind: 'item' },
  { id: 'belt', name: '全席シートベルト', desc: '座席の軽減が −20 → −50', kind: 'mod' },
  { id: 'ram', name: '衝角', desc: '倒木を突き破る速さが 40 → 20km/h。衝撃も−10', kind: 'mod' },
  { id: 'susp', name: 'サスペンション', desc: 'すべての衝撃 −10', kind: 'mod' },
];

// ---------- 状態 ----------
export const NOTCH_A = [-3.6, -2.3, -1.5, -0.8, 0, 0.6, 1.0, 1.4];
export const NOTCH_NAME = ['非常', 'B3', 'B2', 'B1', 'N', 'P1', 'P2', 'P3'];
export const VMAX = 20; // m/s (72km/h)

export interface Flier {
  pax: Pax;
  t: number;
  x: number;
  side: number;
}
export interface ShockEvt {
  value: number;
  t: number;
  flew: string[];
  safe: number;
  label: string;
}

export interface Run {
  time: number;
  x: number; // 先頭の位置
  v: number;
  notch: number;
  phase: 'running' | 'dwell' | 'clear' | 'over';
  target: number; // 次に止まる駅（停車中はこの駅）
  doorAnim: number;
  pax: Pax[];
  candidates: Pax[];
  picked: Set<number>;
  obstacles: Obstacle[][]; // 区間ごと
  items: Record<ItemId, number>;
  mods: Set<ModId>;
  armed: ItemId | null; // 次の障害で使う
  airbag: boolean;
  money: number;
  trust: number;
  delay: number;
  schedule: number[]; // 各駅の到着予定時刻
  depart: number; // 発車予定時刻（停車中）
  fliers: Flier[];
  shocks: ShockEvt[];
  toasts: { text: string; kind: string; t: number }[];
  offer: Offer[] | null;
  stuck: number; // 障害で止められている残り時間
  overReason: string;
  stats: { carried: number; flew: number; shocks: number; maxShock: number };
  nextId: number;
}

const rnd = Math.random;
const pick = <T,>(a: T[]): T => a[Math.floor(rnd() * a.length)];

function genObstacles(sec: number): Obstacle[] {
  const len = LINE.sections[sec];
  const n = sec === 0 ? 2 : 3;
  const kinds: ObsKind[] = sec === 0 ? ['pole', 'tree'] : [];
  while (kinds.length < n) kinds.push(pick(['tree', 'curve', 'deer', 'pole'] as ObsKind[]));
  const out: Obstacle[] = [];
  const start = POS[sec] + 90;
  const span = len - 190;
  kinds.forEach((kind, i) => {
    const x = start + (span * (i + 0.3 + rnd() * 0.4)) / n;
    const need = kind === 'pole' ? 20 + Math.floor(rnd() * 3) * 4 : kind === 'deer' ? 1 : 0;
    out.push({ kind, x, len: kind === 'curve' ? 30 : 0, taps: need, need, state: 'wait', t: 0 });
  });
  return out;
}

function genCandidates(r: Run, st: number): Pax[] {
  const out: Pax[] = [];
  const n = 7;
  const kinds: Kind[] = ['old', 'kid', 'sal', 'stu', 'sumo'];
  for (let i = 0; i < n; i++) {
    const kind = i === 0 && rnd() < 0.6 ? 'vip' : pick(kinds);
    const dest = st + 1 + Math.floor(rnd() * Math.min(3, N_ST - 1 - st));
    out.push({ id: r.nextId++, kind, look: randomLook(rnd), from: st, dest, spot: -1 });
  }
  return out;
}

export function newRun(): Run {
  const r: Run = {
    time: 0,
    x: POS[0] - 4,
    v: 0,
    notch: 4,
    phase: 'dwell',
    target: 0,
    doorAnim: 1,
    pax: [],
    candidates: [],
    picked: new Set(),
    obstacles: LINE.sections.map((_, i) => genObstacles(i)),
    items: { jump: 1, saw: 0, airbag: 0 },
    mods: new Set(),
    armed: null,
    airbag: false,
    money: 0,
    trust: 100,
    delay: 0,
    schedule: [],
    depart: 25,
    fliers: [],
    shocks: [],
    toasts: [],
    offer: null,
    stuck: 0,
    overReason: '',
    stats: { carried: 0, flew: 0, shocks: 0, maxShock: 0 },
    nextId: 1,
  };
  // 予定：1区間あたり 走行（平均 36km/h）＋停車20秒
  let t = 25;
  r.schedule.push(0);
  for (const d of LINE.sections) {
    t += d / 10;
    r.schedule.push(t);
    t += 20;
  }
  r.candidates = genCandidates(r, 0);
  return r;
}

export function toast(r: Run, text: string, kind = '') {
  r.toasts.push({ text, kind, t: r.time });
  if (r.toasts.length > 3) r.toasts.shift();
}

export const kmh = (v: number) => v * 3.6;
export const seatsUsed = (r: Run) => r.pax.reduce((n, p) => n + KINDS[p.kind].size, 0);
export const pickedSeats = (r: Run) => r.candidates.filter((c) => r.picked.has(c.id)).reduce((n, p) => n + KINDS[p.kind].size, 0);

/** 客の今の耐衝撃（席と力士の隣を足したもの） */
export function effTol(r: Run, p: Pax): number {
  let t = KINDS[p.kind].tol;
  const s = SPOTS[p.spot];
  if (!s) return t;
  if (s.kind === 'seat') t += r.mods.has('belt') ? 50 : 20;
  else if (s.kind === 'strap') t += 10;
  if (p.kind !== 'sumo') {
    for (const q of r.pax) {
      if (q.kind !== 'sumo' || q === p) continue;
      const o = SPOTS[q.spot];
      if (o && Math.hypot(o.x - s.x, o.y - s.y) < 1.8) t += 20;
    }
  }
  return t;
}

/** 次の障害（まだ片付いていないもの） */
export function nextObstacle(r: Run): Obstacle | null {
  if (r.phase !== 'running') return r.obstacles[r.target]?.find((o) => o.state === 'wait') ?? null;
  const sec = r.target - 1;
  return r.obstacles[sec]?.find((o) => o.state === 'wait' && o.x + o.len > r.x - 1) ?? null;
}

/** 障害の衝撃の見込み（今の速さのまま行ったら） */
export function predictShock(r: Run, o: Obstacle, v = r.v): number {
  const susp = r.mods.has('susp') ? 10 : 0;
  if (r.armed === 'jump') return Math.max(0, 70 - susp);
  const k = kmh(v);
  switch (o.kind) {
    case 'tree': {
      const need = r.mods.has('ram') ? 20 : TREE_V;
      if (k < need) return Math.max(0, 25 - susp);
      return Math.max(0, Math.round(k * 0.78) - (r.mods.has('ram') ? 10 : 0) - susp);
    }
    case 'curve':
      return k > CURVE_V ? Math.max(0, 50 - susp) : 0;
    case 'deer':
      return o.taps > 0 ? Math.max(0, 40 - susp) : 0;
    case 'pole':
      return 0;
  }
}

export function treeNeed(r: Run): number {
  return r.mods.has('ram') ? 20 : TREE_V;
}

function applyShock(r: Run, value: number, label: string) {
  if (value <= 0) return;
  r.stats.shocks++;
  r.stats.maxShock = Math.max(r.stats.maxShock, value);
  const flew: string[] = [];
  let safe = 0;
  if (r.airbag) {
    r.airbag = false;
    safe = r.pax.length;
    r.shocks.push({ value, t: r.time, flew, safe, label: label + '（エアバッグで全員無事）' });
    return;
  }
  for (const p of [...r.pax]) {
    if (value > effTol(r, p)) {
      flew.push(KINDS[p.kind].name);
      r.pax = r.pax.filter((q) => q !== p);
      r.fliers.push({ pax: p, t: r.time, x: r.x - 6 + (SPOTS[p.spot]?.x ?? 6) - 6, side: -1 });
      const big = p.kind === 'old' || p.kind === 'kid' || p.kind === 'vip';
      r.trust -= big ? 15 : 8;
      r.stats.flew++;
    } else safe++;
  }
  r.shocks.push({ value, t: r.time, flew, safe, label });
}

export function setNotch(r: Run, n: number) {
  const prev = r.notch;
  r.notch = Math.max(0, Math.min(7, n));
  if (r.notch === 0 && prev !== 0 && r.v > 4 && r.phase === 'running') applyShock(r, r.mods.has('susp') ? 10 : 20, '非常ブレーキ');
}

export function tapObstacle(r: Run, o: Obstacle) {
  if (o.state !== 'wait') return;
  if (o.kind === 'deer') {
    o.taps = 0;
    o.state = 'cleared';
    o.t = r.time;
  } else if (o.kind === 'pole') {
    o.taps = Math.max(0, o.taps - 1);
    if (o.taps === 0) {
      o.state = 'cleared';
      o.t = r.time;
      toast(r, '電柱を片付けた！', 'good');
    }
  }
}

export function useItem(r: Run, id: ItemId) {
  if (r.items[id] <= 0) return;
  if (id === 'airbag') {
    r.items.airbag--;
    r.airbag = true;
    toast(r, 'エアバッグ準備OK', 'good');
    return;
  }
  if (id === 'saw') {
    const o = nextObstacle(r);
    if (!o || (o.kind !== 'pole' && o.kind !== 'tree')) {
      toast(r, '次の障害には使えない', 'bad');
      return;
    }
    r.items.saw--;
    o.state = 'cleared';
    o.taps = 0;
    o.t = r.time;
    r.stuck = 0;
    toast(r, `${OBS_INFO[o.kind].name}をチェーンソーで一刀両断！`, 'good');
    return;
  }
  if (id === 'jump') {
    if (r.armed === 'jump') return;
    r.items.jump--;
    r.armed = 'jump';
    toast(r, '次の障害でジャンプ！', 'good');
  }
}

export function togglePick(r: Run, id: number) {
  if (r.picked.has(id)) r.picked.delete(id);
  else {
    const c = r.candidates.find((q) => q.id === id);
    if (!c) return;
    if (seatsUsed(r) + pickedSeats(r) + KINDS[c.kind].size > SEATS) {
      toast(r, '席が足りない', 'bad');
      return;
    }
    r.picked.add(id);
  }
}

function freeSpot(r: Run, prefer: SpotKind[]): number {
  for (const k of prefer) {
    const i = SPOTS.findIndex((s, j) => s.kind === k && !r.pax.some((p) => p.spot === j));
    if (i >= 0) return i;
  }
  return SPOTS.findIndex((_, j) => !r.pax.some((p) => p.spot === j));
}

export function moveToSpot(r: Run, id: number, spot: number) {
  const p = r.pax.find((q) => q.id === id);
  if (!p || spot < 0 || spot >= SPOTS.length) return;
  const other = r.pax.find((q) => q.spot === spot);
  if (other) other.spot = p.spot;
  p.spot = spot;
}

export function depart(r: Run) {
  if (r.phase !== 'dwell' || r.offer) return;
  if (r.target >= N_ST - 1) return;
  for (const c of r.candidates) {
    if (!r.picked.has(c.id)) continue;
    c.spot = freeSpot(r, c.kind === 'old' || c.kind === 'vip' || c.kind === 'kid' ? ['seat', 'strap', 'floor'] : ['floor', 'strap', 'seat']);
    r.pax.push(c);
  }
  r.candidates = [];
  r.picked.clear();
  r.phase = 'running';
  r.target++;
  r.notch = 5;
  if (r.time > r.depart + 1) toast(r, `発車が ${Math.round(r.time - r.depart)}秒 遅れた`, 'bad');
}

export function chooseOffer(r: Run, i: number) {
  const o = r.offer?.[i];
  if (!o) return;
  if (o.kind === 'item') r.items[o.id as ItemId]++;
  else r.mods.add(o.id as ModId);
  r.offer = null;
  toast(r, `${o.name} を手に入れた`, 'good');
}

function arrive(r: Run) {
  const st = r.target;
  r.phase = 'dwell';
  r.notch = 4;
  r.v = 0;
  r.doorAnim = 0;
  r.stuck = 0;
  const late = r.time - r.schedule[st];
  r.delay = Math.max(0, late);
  r.depart = Math.max(r.time + 12, r.schedule[st] + 20);
  // 降車
  let earned = 0;
  for (const p of [...r.pax]) {
    if (p.dest !== st) continue;
    const k = KINDS[p.kind];
    let fare = k.fare * (st - p.from);
    if (p.kind === 'vip') fare = 2000;
    if (p.kind === 'sal' && r.delay > 30) fare = Math.round(fare / 2);
    if (p.kind === 'old') r.trust = Math.min(100, r.trust + 5);
    earned += fare;
    r.stats.carried++;
    r.pax = r.pax.filter((q) => q !== p);
  }
  r.money += earned;
  if (earned) toast(r, `運賃 +¥${earned.toLocaleString()}`, 'good');
  if (st >= N_ST - 1) {
    r.phase = 'clear';
    return;
  }
  r.candidates = genCandidates(r, st);
  // 3択（始発以外）
  const pool = OFFERS.filter((o) => o.kind === 'item' || !r.mods.has(o.id as ModId));
  const opts: Offer[] = [];
  while (opts.length < 3 && pool.length) opts.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);
  r.offer = opts;
}

export function update(r: Run, dt: number) {
  if (r.phase === 'clear' || r.phase === 'over') return;
  r.time += dt;
  r.toasts = r.toasts.filter((t) => r.time - t.t < 2.6);
  r.fliers = r.fliers.filter((f) => r.time - f.t < 2.2);
  r.shocks = r.shocks.filter((s) => r.time - s.t < 2.4);

  if (r.phase === 'dwell') {
    r.doorAnim = Math.min(1, r.doorAnim + dt * 3);
    r.delay = Math.max(0, r.time - r.depart);
  } else {
    r.doorAnim = Math.max(0, r.doorAnim - dt * 3);
    driving(r, dt);
    const st = r.target;
    // 予定との差
    const expected = r.schedule[st - 1] + 20 + (r.x - POS[st - 1]) / 10;
    r.delay = Math.max(0, r.time - expected);
  }
  // 学生の連打
  const stu = r.pax.filter((p) => p.kind === 'stu').length;
  if (stu && r.phase === 'running') {
    const o = nextObstacle(r);
    if (o && o.kind === 'pole' && o.x - r.x < 60) {
      (o as Obstacle & { acc?: number }).acc = ((o as Obstacle & { acc?: number }).acc ?? 0) + dt * 3 * stu;
      const a = o as Obstacle & { acc: number };
      while (a.acc >= 1 && o.state === 'wait') {
        a.acc -= 1;
        tapObstacle(r, o);
      }
    }
  }
  if (r.delay > DELAY_LIMIT) {
    r.phase = 'over';
    r.overReason = `遅れが${DELAY_LIMIT}秒を超えた`;
  }
  if (r.trust <= 0) {
    r.trust = 0;
    r.phase = 'over';
    r.overReason = '信頼が尽きた';
  }
}

function driving(r: Run, dt: number) {
  const st = r.target;
  const sec = st - 1;
  let a = NOTCH_A[r.notch];
  if (a > 0) a *= Math.max(0.15, 1 - r.v / VMAX);
  a -= 0.05;
  // 電柱に止められている
  const obs = r.obstacles[sec] ?? [];
  for (const o of obs) {
    if (o.state !== 'wait' || o.kind !== 'pole') continue;
    if (r.armed === 'jump') continue;
    if (r.x >= o.x - 6 && r.x < o.x + 2) {
      // 手前で強制停止
      if (r.v > 0) {
        if (r.v > 3) applyShock(r, Math.max(0, Math.round(kmh(r.v) * 0.6) - (r.mods.has('susp') ? 10 : 0)), '電柱の手前で急停止');
        r.v = 0;
        r.x = o.x - 6;
        toast(r, '電柱で止められた！ 連打で片付けよう', 'bad');
      }
      a = Math.min(a, 0);
    }
  }
  if (r.stuck > 0) {
    r.stuck -= dt;
    a = 0;
    r.v = 0;
  }
  r.v = Math.max(0, Math.min(VMAX, r.v + a * dt));
  const x0 = r.x;
  r.x += r.v * dt;
  // 障害の判定
  for (const o of obs) {
    if (o.state !== 'wait') continue;
    if (o.kind === 'curve') {
      if (r.x >= o.x && x0 < o.x + o.len && kmh(r.v) > CURVE_V + 0.5) {
        if (r.armed === 'jump') continue;
        o.state = 'hit';
        o.t = r.time;
        o.shock = predictShock(r, o);
        applyShock(r, o.shock, '急カーブで脱輪');
        r.v = 0;
        r.stuck = 5;
        toast(r, '脱輪！ 復旧に5秒', 'bad');
      } else if (x0 < o.x + o.len && r.x >= o.x + o.len) {
        o.state = 'passed';
        o.t = r.time;
        toast(r, '急カーブを安全に通過', 'good');
      }
      continue;
    }
    if (x0 < o.x && r.x >= o.x) {
      if (r.armed === 'jump') {
        r.armed = null;
        o.state = 'passed';
        o.t = r.time;
        o.shock = 70 - (r.mods.has('susp') ? 10 : 0);
        applyShock(r, o.shock, `${OBS_INFO[o.kind].name}をジャンプで飛び越えた`);
        continue;
      }
      if (o.kind === 'tree') {
        o.shock = predictShock(r, o);
        if (kmh(r.v) >= treeNeed(r)) {
          o.state = 'hit';
          o.t = r.time;
          applyShock(r, o.shock, '倒木を突破！');
          r.v *= 0.82;
        } else {
          o.state = 'hit';
          o.t = r.time;
          applyShock(r, o.shock, '倒木に止められた');
          r.v = 0;
          r.stuck = 6;
          toast(r, `${treeNeed(r)}km/h に届かず止められた。撤去に6秒`, 'bad');
        }
      } else if (o.kind === 'deer') {
        o.state = 'hit';
        o.t = r.time;
        o.shock = predictShock(r, o);
        applyShock(r, o.shock, '鹿と衝突');
        r.v *= 0.5;
      }
    }
  }
  // 駅
  const stop = POS[st];
  if (r.v < 0.05 && r.notch <= 4 && r.x >= stop + STOP_LO && r.x <= stop + STOP_HI) arrive(r);
  else if (r.x > stop + STOP_HI + 8) {
    // 通過してしまった
    const missed = r.pax.filter((p) => p.dest === st);
    for (const p of missed) p.dest = Math.min(N_ST - 1, st + 1);
    if (missed.length) {
      r.trust -= 5 * missed.length;
      toast(r, `${LINE.stations[st].name}を通過。${missed.length}人が乗り過ごし`, 'bad');
    }
    if (st >= N_ST - 1) {
      r.phase = 'over';
      r.overReason = '終点を通り過ぎた';
    } else {
      r.target++;
    }
  }
}
