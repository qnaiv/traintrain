// 「障害突破ラン」のゲームの状態と進行。描画には触れない。

import { randomLook, type Look } from '../../game.ts';
import type { LineDef } from '../../data.ts';

// ---------- 路線（江ノ電を7駅に間引いたもの） ----------
export const LINE: LineDef = {
  id: 'enoden-run',
  name: '江ノ島電鉄',
  stations: [
    { name: '藤沢', platformCars: 2, demand: 0 },
    { name: '鵠沼', platformCars: 2, demand: 0 },
    { name: '江ノ島', platformCars: 2, demand: 0 },
    { name: '腰越', platformCars: 2, demand: 0 },
    { name: '鎌倉高校前', platformCars: 2, demand: 0 },
    { name: '長谷', platformCars: 2, demand: 0 },
    { name: '鎌倉', platformCars: 2, demand: 0 },
  ],
  sections: [380, 440, 380, 460, 420, 480],
  scenery: ['town', 'town', 'street', 'coast', 'coast', 'town'],
};
export const POS: number[] = [0];
for (const d of LINE.sections) POS.push(POS[POS.length - 1] + d);
export const N_ST = LINE.stations.length;
/** 停止できる範囲（先頭の位置。停止目標からの差） */
export const STOP_LO = -14;
export const STOP_HI = 4;
/** ここまで行き過ぎたら通過扱い（それまではバックで戻れる） */
export const OVERRUN_MAX = 60;
export const REVERSE_V = 3.5;
/** 予定の平均速度 [m/s]（これより速く走れば遅れを取り戻せる） */
export const PLAN_V = 10;
/** 1区間ごとに見込む加減速のぶん [秒] */
export const SECTION_EXTRA = 6;
export const sectionTime = (k: number) => LINE.sections[k] / PLAN_V + SECTION_EXTRA;

// ---------- 衝撃の式（バランス調整はここだけ） ----------
export const SHOCK = {
  /** 非常ブレーキ：速度 km/h × */
  brake: 0.5,
  /** 倒木：突き破っても止められても 速度 × */
  tree: 0.8,
  /** 急カーブ：基本 ＋ 超過 km/h × */
  curveBase: 20,
  curveOver: 2,
  /** 鹿・電柱にぶつかる：速度 × */
  hit: 0.7,
  /** 高速走行の揺れ：この速さを超えると、(速度 − base) × k */
  joltFrom: 60,
  joltBase: 50,
  joltK: 2,
  joltEvery: 3.2,
  /** ジャンプの着地：基本 ＋ 速度 × */
  jumpBase: 40,
  jumpK: 0.4,
  /** 大波：基本 ＋ 速度 × */
  waveBase: 30,
  waveK: 0.5,
};
export const TREE_V = 40; // km/h 以上で突き破る
export const CURVE_V = 20; // km/h 以下で通過

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
  kid: { name: '子ども', ch: '子', tol: 15, fare: 80, size: 1, note: '軽くてよく飛ぶ', color: '#E9B23E' },
  sal: { name: '会社員', ch: '会', tol: 30, fare: 130, size: 1, note: '遅れ30秒超で運賃半分', color: '#FFFDF6' },
  stu: { name: '学生', ch: '学', tol: 45, fare: 60, size: 1, note: '連打を手伝う（毎秒3回）', color: '#8299E0' },
  sumo: { name: '力士', ch: '力', tol: 90, fare: 280, size: 3, note: '席3つ。隣の客は耐衝撃+20', color: '#F0C9A0' },
  vip: { name: 'VIP', ch: 'V', tol: 5, fare: 0, size: 1, note: '無傷で届けると¥2000', color: '#B98ADB' },
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
  /** 何両目か（0 が先頭） */
  car: number;
  /** 0：1階、1：2階、2：屋根の上 */
  deck: number;
}
/** 1両ぶんの位置（1階）。車両基地の強化は全車両に効く */
function lowerSpots(m: Meta, car: number): Spot[] {
  const seats = [5.5, 6.7, 4.3, 7.9].slice(0, 2 + m.lv.bench);
  const straps = [9.3, 10.5, 2.2, 3.6].slice(0, 2 + m.lv.strap);
  const floors: [number, number][] = [[1.1, -0.25], [2.5, -0.5], [4.9, 0.45], [6.3, 0.45], [7.9, 0.45], [11.1, -0.3]];
  return [
    ...seats.map((x) => ({ x, y: -0.98, kind: 'seat' as const, car, deck: 0 })),
    ...straps.map((x) => ({ x, y: 0.42, kind: 'strap' as const, car, deck: 0 })),
    ...floors.map(([x, y]) => ({ x, y, kind: 'floor' as const, car, deck: 0 })),
  ];
}
/** 2階：座席が多い */
function upperSpots(car: number): Spot[] {
  return [
    ...[2.6, 3.8, 5.0, 6.2, 7.4, 8.6].map((x) => ({ x, y: -0.98, kind: 'seat' as const, car, deck: 1 })),
    ...[3.2, 6.0, 8.8].map((x) => ({ x, y: 0.4, kind: 'floor' as const, car, deck: 1 })),
  ];
}
/** 屋根の上 */
function roofSpots(car: number): Spot[] {
  return [3.0, 5.0, 7.0, 9.0].map((x) => ({ x, y: 0, kind: 'floor' as const, car, deck: 2 }));
}
/** 段ごとの耐衝撃の補正 */
export const DECK_TOL = [0, -10, -20];
export const DECK_NAME = ['1階', '2階', '屋根の上'];

// ---------- 障害 ----------
export type ObsKind = 'tree' | 'curve' | 'deer' | 'pole' | 'wave';
export interface Obstacle {
  kind: ObsKind;
  x: number; // 障害の位置（先頭がここに来たら判定）
  len: number; // カーブ・大波の長さ
  taps: number; // 残りタップ数（電柱）／鹿は 1
  need: number;
  state: 'wait' | 'cleared' | 'hit' | 'passed';
  t: number; // 状態が変わった時刻（演出用）
  shock?: number;
  acc?: number; // 学生の連打のたまり
}
export const OBS_INFO: Record<ObsKind, { name: string; ch: string }> = {
  tree: { name: '倒木', ch: '木' },
  curve: { name: '急カーブ', ch: '曲' },
  deer: { name: '鹿', ch: '鹿' },
  pole: { name: '倒れた電柱', ch: '柱' },
  wave: { name: '江ノ島の大波', ch: '波' },
};
/** 大波：周期と、波が線路にかかっている時間 */
export const WAVE_PERIOD = 5;
export const WAVE_UP = 2.2;
export function waveUp(t: number): boolean {
  return t % WAVE_PERIOD < WAVE_UP;
}

// ---------- 3択（ランの中だけ） ----------
export type ItemId = 'jump' | 'saw' | 'airbag';
export type ModId = 'belt' | 'ram' | 'susp' | 'car' | 'deck' | 'roof' | 'rocket';
export interface Offer {
  id: ItemId | ModId;
  name: string;
  desc: string;
  kind: 'item' | 'mod';
}
export const OFFERS: Offer[] = [
  { id: 'jump', name: 'ジャンプ台', desc: '次の障害を飛び越える（着地の衝撃 40＋速度×0.4）', kind: 'item' },
  { id: 'saw', name: 'チェーンソー', desc: '電柱か倒木を一瞬で片付ける', kind: 'item' },
  { id: 'airbag', name: 'エアバッグ', desc: '次の衝撃で誰も飛ばない', kind: 'item' },
  { id: 'belt', name: '全席シートベルト', desc: '座席の軽減 −20 → −50', kind: 'mod' },
  { id: 'ram', name: '衝角', desc: '倒木を突き破る速さ 40 → 20km/h', kind: 'mod' },
  { id: 'susp', name: 'エアサス', desc: 'すべての衝撃 −10', kind: 'mod' },
  { id: 'car', name: '増結', desc: '車両を1両つなぐ。定員+5（何両でも）。そのぶん加速が少し鈍る', kind: 'mod' },
  { id: 'deck', name: '二階建て', desc: '全車両を二階建てに。定員+両数×6。2階は耐衝撃−10', kind: 'mod' },
  { id: 'roof', name: '屋根の上の特等席', desc: '先頭車両の屋根に4人乗れる。耐衝撃−20、運賃×2', kind: 'mod' },
  { id: 'rocket', name: 'ロケットブースター', desc: '加速×1.8、最高速度がさらに伸びる', kind: 'mod' },
];
/** 何度でも取れる魔改造 */
const REPEAT_MODS: ModId[] = ['car'];

// ---------- 車両基地（ランをまたいで残る強化） ----------
export type UpId = 'cap' | 'bench' | 'strap' | 'cushion' | 'susp' | 'motor' | 'kit' | 'grace';
export interface UpDef {
  id: UpId;
  name: string;
  desc: (lv: number) => string;
  cost: number[];
}
export const UPGRADES: UpDef[] = [
  { id: 'cap', name: '定員アップ', desc: (l) => `乗せられる人数 ${5 + l} → ${6 + l}`, cost: [400, 900, 1800] },
  { id: 'bench', name: '座席の増設', desc: (l) => `座席 ${2 + l} → ${3 + l}`, cost: [500, 1200] },
  { id: 'strap', name: 'つり革の増設', desc: (l) => `つり革 ${2 + l} → ${3 + l}`, cost: [300, 700] },
  { id: 'cushion', name: '座席クッション', desc: (l) => `座席の軽減 −${20 + l * 5} → −${25 + l * 5}`, cost: [300, 700, 1500] },
  { id: 'susp', name: '台車のばね', desc: (l) => `すべての衝撃 −${l * 3} → −${l * 3 + 3}`, cost: [500, 1100, 2200] },
  { id: 'motor', name: 'モーター', desc: (l) => `加速 +${l * 15}% → +${l * 15 + 15}%`, cost: [300, 700, 1500] },
  { id: 'kit', name: '初期装備', desc: (l) => (l === 0 ? 'チェーンソー1つを持って出発' : 'エアバッグも1つ持って出発'), cost: [400, 900] },
  { id: 'grace', name: 'ダイヤの余裕', desc: (l) => `遅れの上限 ${120 + l * 20} → ${140 + l * 20}秒`, cost: [300, 700, 1500] },
];
export interface Meta {
  bank: number;
  lv: Record<UpId, number>;
  runs: number;
  best: number;
}
const META_KEY = 'hakobi.run.meta.v1';
export function loadMeta(): Meta {
  const base: Meta = { bank: 0, lv: { cap: 0, bench: 0, strap: 0, cushion: 0, susp: 0, motor: 0, kit: 0, grace: 0 }, runs: 0, best: 0 };
  try {
    const raw = localStorage.getItem(META_KEY);
    if (raw) {
      const m = JSON.parse(raw) as Partial<Meta>;
      return { ...base, ...m, lv: { ...base.lv, ...(m.lv ?? {}) } };
    }
  } catch {
    // 保存できない環境では毎回まっさらから
  }
  return base;
}
export function saveMeta(m: Meta) {
  try {
    localStorage.setItem(META_KEY, JSON.stringify(m));
  } catch {
    // 無視
  }
}
export function buyUpgrade(m: Meta, id: UpId): boolean {
  const def = UPGRADES.find((u) => u.id === id)!;
  const lv = m.lv[id];
  const cost = def.cost[lv];
  if (cost == null || m.bank < cost) return false;
  m.bank -= cost;
  m.lv[id] = lv + 1;
  saveMeta(m);
  return true;
}

// ---------- 状態 ----------
export const NOTCH_A = [-3.6, -2.3, -1.5, -0.8, 0, 0.6, 1.0, 1.4];
export const NOTCH_NAME = ['非常', 'B3', 'B2', 'B1', 'N', 'P1', 'P2', 'P3'];
/** 加速が鈍っていく目安の速さ [m/s]（上限ではない） */
export function vmaxOf(r: Run): number {
  return 30 + (r.mods.has('rocket') ? 18 : 0) + r.meta.lv.motor * 3;
}

export interface Flier {
  pax: Pax;
  t: number;
  x: number;
}
export interface ShockEvt {
  value: number;
  t: number;
  flew: string[];
  safe: number;
  label: string;
}

export interface Run {
  meta: Meta;
  spots: Spot[];
  cap: number;
  cars: number;
  decks: number;
  roof: boolean;
  sawArmed: boolean;
  delayLimit: number;
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
  earlyBonus: number;
  trust: number;
  delay: number;
  /** 予定に対する差（負なら早い） */
  ahead: number;
  /** ダイヤの時計（走っている間だけ進む） */
  clock: number;
  schedule: number[]; // 各駅の到着予定（ダイヤの時計で）
  arrivals: (number | null)[]; // 実際の到着
  paused: boolean;
  rank: { name: string; mult: number } | null;
  jolt: number; // 高速走行の揺れまでの残り
  fliers: Flier[];
  shocks: ShockEvt[];
  toasts: { text: string; kind: string; t: number }[];
  offer: Offer[] | null;
  stuck: number; // 障害で止められている残り時間
  reverse: boolean; // バック中（ボタンを押している間）
  overReason: string;
  stats: { carried: number; flew: number; shocks: number; maxShock: number; early: number };
  nextId: number;
}

const rnd = Math.random;
const pick = <T,>(a: T[]): T => a[Math.floor(rnd() * a.length)];

function genObstacles(sec: number): Obstacle[] {
  const len = LINE.sections[sec];
  const last = sec === LINE.sections.length - 1;
  const n = sec === 0 ? 2 : sec <= 2 ? 3 : 4;
  const kinds: ObsKind[] = sec === 0 ? ['pole', 'tree'] : sec === 1 ? ['curve'] : [];
  const pool: ObsKind[] = LINE.scenery[sec] === 'coast' ? ['tree', 'curve', 'deer', 'pole', 'deer'] : ['tree', 'curve', 'deer', 'pole'];
  while (kinds.length < (last ? n - 1 : n)) kinds.push(pick(pool));
  // 並びをばらす（最初の区間は教える順のまま）
  if (sec > 1) kinds.sort(() => rnd() - 0.5);
  const out: Obstacle[] = [];
  const start = POS[sec] + 80;
  const span = len - (last ? 260 : 170);
  kinds.forEach((kind, i) => {
    const x = start + (span * (i + 0.25 + rnd() * 0.5)) / kinds.length;
    const need = kind === 'pole' ? 16 + Math.min(16, sec * 3) + Math.floor(rnd() * 3) * 2 : kind === 'deer' ? 1 : 0;
    out.push({ kind, x, len: kind === 'curve' ? 30 : 0, taps: need, need, state: 'wait', t: 0 });
  });
  if (last) out.push({ kind: 'wave', x: POS[sec + 1] - 120, len: 16, taps: 0, need: 0, state: 'wait', t: 0 });
  return out;
}

function genCandidates(r: Run, st: number): Pax[] {
  const out: Pax[] = [];
  const n = 7;
  const kinds: Kind[] = ['old', 'kid', 'sal', 'sal', 'stu', 'sumo'];
  for (let i = 0; i < n; i++) {
    const kind = i === 0 && rnd() < 0.55 ? 'vip' : pick(kinds);
    const dest = st + 1 + Math.floor(rnd() * Math.min(3, N_ST - 1 - st));
    out.push({ id: r.nextId++, kind, look: randomLook(rnd), from: st, dest, spot: -1 });
  }
  return out;
}

export function newRun(meta: Meta): Run {
  const r: Run = {
    meta,
    spots: lowerSpots(meta, 0),
    cap: 5 + meta.lv.cap,
    cars: 1,
    decks: 1,
    roof: false,
    sawArmed: false,
    delayLimit: 120 + meta.lv.grace * 20,
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
    items: { jump: 1, saw: meta.lv.kit >= 1 ? 1 : 0, airbag: meta.lv.kit >= 2 ? 1 : 0 },
    mods: new Set(),
    armed: null,
    airbag: false,
    money: 0,
    earlyBonus: 0,
    trust: 100,
    delay: 0,
    ahead: 0,
    clock: 0,
    schedule: [],
    arrivals: LINE.stations.map((_, i) => (i === 0 ? 0 : null)),
    paused: false,
    rank: null,
    jolt: SHOCK.joltEvery,
    fliers: [],
    shocks: [],
    toasts: [],
    offer: null,
    stuck: 0,
    reverse: false,
    overReason: '',
    stats: { carried: 0, flew: 0, shocks: 0, maxShock: 0, early: 0 },
    nextId: 1,
  };
  let t = 0;
  r.schedule.push(0);
  LINE.sections.forEach((_, k) => {
    t += sectionTime(k);
    r.schedule.push(t);
  });
  r.candidates = genCandidates(r, 0);
  return r;
}

export function toast(r: Run, text: string, kind = '') {
  r.toasts.push({ text, kind, t: r.time });
  if (r.toasts.length > 3) r.toasts.shift();
}

export const kmh = (v: number) => v * 3.6;
export const seatsUsed = (r: Run) => r.pax.reduce((n, p) => n + KINDS[p.kind].size, 0);
export const pickedSeats = (_r: Run) => 0;
const minus = (r: Run) => (r.mods.has('susp') ? 10 : 0) + r.meta.lv.susp * 3;
const soften = (r: Run, v: number) => Math.max(0, Math.round(v - minus(r)));

/** 客の今の耐衝撃（席と力士の隣を足したもの） */
export function effTol(r: Run, p: Pax): number {
  let t = KINDS[p.kind].tol;
  const s = r.spots[p.spot];
  if (!s) return t;
  if (s.kind === 'seat') t += (r.mods.has('belt') ? 50 : 20) + r.meta.lv.cushion * 5;
  else if (s.kind === 'strap') t += 10;
  t += DECK_TOL[s.deck] ?? 0;
  if (p.kind !== 'sumo') {
    for (const q of r.pax) {
      if (q.kind !== 'sumo' || q === p) continue;
      const o = r.spots[q.spot];
      if (o && o.car === s.car && o.deck === s.deck && Math.hypot(o.x - s.x, o.y - s.y) < 1.8) t += 20;
    }
  }
  return t;
}
/** この衝撃で飛ぶ客 */
export function wouldFly(r: Run, shock: number): Pax[] {
  if (r.airbag) return [];
  return r.pax.filter((p) => shock > effTol(r, p));
}

/** 次の障害（まだ片付いていないもの） */
export function nextObstacle(r: Run): Obstacle | null {
  if (r.phase !== 'running') return r.obstacles[r.target]?.find((o) => o.state === 'wait') ?? null;
  const sec = r.target - 1;
  return r.obstacles[sec]?.find((o) => o.state === 'wait' && o.x + o.len > r.x - 1) ?? null;
}

export function treeNeed(r: Run): number {
  return r.mods.has('ram') ? 20 : TREE_V;
}

/** 障害の衝撃の見込み（この速さで入ったら） */
export function predictShock(r: Run, o: Obstacle, v = r.v): number {
  const k = kmh(v);
  if (r.armed === 'jump' && o.kind !== 'curve') return soften(r, SHOCK.jumpBase + k * SHOCK.jumpK);
  switch (o.kind) {
    case 'tree':
      return soften(r, k * SHOCK.tree);
    case 'curve':
      return k > CURVE_V ? soften(r, SHOCK.curveBase + (k - CURVE_V) * SHOCK.curveOver) : 0;
    case 'deer':
      return o.taps > 0 ? soften(r, k * SHOCK.hit) : 0;
    case 'pole':
      return 0;
    case 'wave':
      return soften(r, SHOCK.waveBase + k * SHOCK.waveK);
  }
}

function applyShock(r: Run, value: number, label: string) {
  if (value <= 0) return;
  r.stats.shocks++;
  r.stats.maxShock = Math.max(r.stats.maxShock, value);
  const flew: string[] = [];
  let safe = 0;
  if (r.airbag) {
    r.airbag = false;
    r.shocks.push({ value, t: r.time, flew, safe: r.pax.length, label: label + '（エアバッグで全員無事）' });
    return;
  }
  for (const p of [...r.pax]) {
    if (value > effTol(r, p)) {
      flew.push(KINDS[p.kind].name);
      r.pax = r.pax.filter((q) => q !== p);
      r.fliers.push({ pax: p, t: r.time, x: spotWorldX(r, p.spot) });
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
  if (r.notch === 0 && prev !== 0 && r.v > 2 && r.phase === 'running') applyShock(r, soften(r, kmh(r.v) * SHOCK.brake), `非常ブレーキ（${Math.round(kmh(r.v))}km/hから）`);
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
      r.stuck = 0;
      toast(r, '電柱を片付けた！', 'good');
    }
  }
}

/** アイテムは「構える」→ 次の該当する場面で自動で使われる。もう一度押すと取り消し */
export function isArmed(r: Run, id: ItemId): boolean {
  return id === 'jump' ? r.armed === 'jump' : id === 'saw' ? r.sawArmed : r.airbag;
}
export function useItem(r: Run, id: ItemId) {
  if (r.phase !== 'running' && r.phase !== 'dwell') return;
  if (isArmed(r, id)) {
    r.items[id]++;
    if (id === 'jump') r.armed = null;
    else if (id === 'saw') r.sawArmed = false;
    else r.airbag = false;
    toast(r, `${ITEM_NAME[id]}を取り消した`, '');
    return;
  }
  if (r.items[id] <= 0) return;
  r.items[id]--;
  if (id === 'jump') {
    r.armed = 'jump';
    toast(r, '次の障害でジャンプ！（もう一度押すと取り消し）', 'good');
  } else if (id === 'saw') {
    r.sawArmed = true;
    toast(r, '次の電柱か倒木をチェーンソーで切る（もう一度押すと取り消し）', 'good');
  } else {
    r.airbag = true;
    toast(r, '次の衝撃でエアバッグ（もう一度押すと取り消し）', 'good');
  }
}
export const ITEM_NAME: Record<ItemId, string> = { jump: 'ジャンプ台', saw: 'チェーンソー', airbag: 'エアバッグ' };

/** 選んだ客はその場で乗り込む（停車中に席を決められる）。もう一度押すとホームに戻る */
export function togglePick(r: Run, id: number) {
  const c = r.candidates.find((q) => q.id === id);
  if (!c) return;
  if (r.picked.has(id)) {
    r.picked.delete(id);
    r.pax = r.pax.filter((q) => q !== c);
    c.spot = -1;
    return;
  }
  if (seatsUsed(r) + KINDS[c.kind].size > r.cap) {
    toast(r, '定員オーバー', 'bad');
    return;
  }
  const sp = freeSpot(r, c.kind === 'old' || c.kind === 'vip' || c.kind === 'kid' ? ['seat', 'strap', 'floor'] : ['floor', 'strap', 'seat']);
  if (sp < 0) {
    toast(r, '立つ場所がない', 'bad');
    return;
  }
  c.spot = sp;
  r.pax.push(c);
  r.picked.add(id);
}

function freeSpot(r: Run, prefer: SpotKind[]): number {
  for (const k of prefer) {
    const i = r.spots.findIndex((s, j) => s.kind === k && !r.pax.some((p) => p.spot === j));
    if (i >= 0) return i;
  }
  return r.spots.findIndex((_, j) => !r.pax.some((p) => p.spot === j));
}

export function moveToSpot(r: Run, id: number, spot: number) {
  const p = r.pax.find((q) => q.id === id);
  if (!p || spot < 0 || spot >= r.spots.length) return;
  const other = r.pax.find((q) => q.spot === spot);
  if (other) other.spot = p.spot;
  p.spot = spot;
}

export function depart(r: Run) {
  if (r.phase !== 'dwell' || r.offer) return;
  if (r.target >= N_ST - 1) return;
  r.candidates = [];
  r.picked.clear();
  r.phase = 'running';
  r.target++;
  r.notch = 5;
}

export function chooseOffer(r: Run, i: number) {
  const o = r.offer?.[i];
  if (!o) return;
  if (o.kind === 'item') r.items[o.id as ItemId]++;
  else applyMod(r, o.id as ModId);
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
  const diff = r.clock - r.schedule[st];
  r.delay = Math.max(0, diff);
  r.ahead = diff;
  r.arrivals[st] = r.clock;
  // 早着ボーナス
  if (diff < 0) {
    const bonus = Math.round(-diff * 12);
    r.money += bonus;
    r.earlyBonus += bonus;
    r.stats.early++;
    toast(r, `早着 ${Math.round(-diff)}秒！ ボーナス +¥${bonus}`, 'good');
  }
  // 降車
  let earned = 0;
  for (const p of [...r.pax]) {
    if (p.dest !== st) continue;
    const k = KINDS[p.kind];
    let fare = k.fare * (st - p.from) * (r.spots[p.spot]?.deck === 2 ? 2 : 1);
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
    r.rank = diff <= 0 ? { name: '定時運行', mult: 1.5 } : diff <= 20 ? { name: 'ほぼ定時', mult: 1.2 } : diff <= 60 ? { name: '遅れあり', mult: 1.0 } : { name: '大遅延', mult: 0.8 };
    return;
  }
  r.candidates = genCandidates(r, st);
  const pool = OFFERS.filter((o) => o.kind === 'item' || REPEAT_MODS.includes(o.id as ModId) || !r.mods.has(o.id as ModId));
  const opts: Offer[] = [];
  while (opts.length < 3 && pool.length) opts.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);
  r.offer = opts;
}

/** ダイヤどおりなら、この位置にいる時刻 */
export function planTimeAt(x: number): number {
  for (let k = 0; k < LINE.sections.length; k++) {
    if (x <= POS[k + 1] || k === LINE.sections.length - 1) {
      const u = Math.max(0, Math.min(1, (x - POS[k]) / LINE.sections[k]));
      return r0(k) + u * sectionTime(k);
    }
  }
  return 0;
}
const r0 = (k: number) => {
  let t = 0;
  for (let i = 0; i < k; i++) t += sectionTime(i);
  return t;
};
/** ゴースト列車（ダイヤどおりに走る列車）の位置 */
export function ghostX(clock: number): number {
  let t = clock;
  for (let k = 0; k < LINE.sections.length; k++) {
    const st = sectionTime(k);
    if (t <= st) return POS[k] + (t / st) * LINE.sections[k];
    t -= st;
  }
  return POS[POS.length - 1];
}
function scheduleDiff(r: Run): number {
  return r.clock - planTimeAt(r.x);
}

export function update(r: Run, dt: number) {
  if (r.phase === 'clear' || r.phase === 'over' || r.paused) return;
  r.time += dt;
  if (r.phase === 'running') r.clock += dt;
  r.toasts = r.toasts.filter((t) => r.time - t.t < 2.6);
  r.fliers = r.fliers.filter((f) => r.time - f.t < 2.2);
  r.shocks = r.shocks.filter((s) => r.time - s.t < 2.4);

  if (r.phase === 'dwell') {
    r.doorAnim = Math.min(1, r.doorAnim + dt * 3);
  } else {
    r.doorAnim = Math.max(0, r.doorAnim - dt * 3);
    driving(r, dt);
    if (r.phase === 'running') {
      r.ahead = scheduleDiff(r);
      r.delay = Math.max(0, r.ahead);
    }
  }
  // 学生の連打
  const stu = r.pax.filter((p) => p.kind === 'stu').length;
  if (stu && r.phase === 'running') {
    const o = nextObstacle(r);
    if (o && o.kind === 'pole' && o.x - r.x < 60) {
      o.acc = (o.acc ?? 0) + dt * 3 * stu;
      while ((o.acc ?? 0) >= 1 && o.state === 'wait') {
        o.acc = (o.acc ?? 0) - 1;
        tapObstacle(r, o);
      }
    }
  }
  if (r.delay > r.delayLimit) {
    r.phase = 'over';
    r.overReason = `遅れが${r.delayLimit}秒を超えた`;
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
  if (a > 0) a *= (1 + r.meta.lv.motor * 0.15) * (r.mods.has('rocket') ? 1.8 : 1) * Math.pow(0.92, r.cars - 1) * Math.max(0.08, 1 - r.v / vmaxOf(r));
  a -= 0.05;
  const obs = r.obstacles[sec] ?? [];
  // 電柱に止められる
  for (const o of obs) {
    if (o.state !== 'wait' || o.kind !== 'pole' || r.armed === 'jump') continue;
    if (r.x >= o.x - 6 && r.x < o.x + 2) {
      if (r.v > 0) {
        if (r.v > 1) applyShock(r, soften(r, kmh(r.v) * SHOCK.hit), `電柱にぶつかって停止（${Math.round(kmh(r.v))}km/h）`);
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
  r.v = Math.max(0, r.v + a * dt);
  const x0 = r.x;
  r.x += r.v * dt;
  // バック（止まっているときだけ。停止位置より手前までは戻らない）
  if (r.reverse && r.v < 0.05 && r.notch <= 4) {
    r.x = Math.max(POS[st] + STOP_LO - 2, r.x - REVERSE_V * dt);
  }
  // 構えたチェーンソー
  if (r.sawArmed) {
    const o = obs.find((q) => q.state === 'wait' && (q.kind === 'pole' || q.kind === 'tree') && q.x - r.x < 30 && q.x - r.x > -2);
    if (o) {
      r.sawArmed = false;
      o.state = 'cleared';
      o.taps = 0;
      o.t = r.time;
      r.stuck = 0;
      toast(r, `${OBS_INFO[o.kind].name}をチェーンソーで一刀両断！`, 'good');
    }
  }
  // 障害の判定
  for (const o of obs) {
    if (o.state !== 'wait') continue;
    if (o.kind === 'curve') {
      if (r.x >= o.x && x0 < o.x + o.len && kmh(r.v) > CURVE_V + 0.5) {
        if (r.armed === 'jump') continue;
        o.state = 'hit';
        o.t = r.time;
        o.shock = predictShock(r, o);
        applyShock(r, o.shock, `急カーブを${Math.round(kmh(r.v))}km/hで曲がって脱輪`);
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
    if (o.kind === 'wave') {
      if (r.x >= o.x && x0 < o.x + o.len && waveUp(r.time)) {
        if (r.armed === 'jump') continue;
        o.state = 'hit';
        o.t = r.time;
        o.shock = predictShock(r, o);
        applyShock(r, o.shock, '大波をかぶった！');
        r.v *= 0.4;
      } else if (x0 < o.x + o.len && r.x >= o.x + o.len) {
        o.state = 'passed';
        o.t = r.time;
        toast(r, '大波のすきをすり抜けた！', 'good');
      }
      if (r.armed === 'jump' && x0 < o.x && r.x >= o.x) {
        r.armed = null;
        o.state = 'passed';
        o.t = r.time;
        applyShock(r, soften(r, SHOCK.jumpBase + kmh(r.v) * SHOCK.jumpK), '大波をジャンプで飛び越えた');
      }
      continue;
    }
    if (x0 < o.x && r.x >= o.x) {
      if (r.armed === 'jump') {
        r.armed = null;
        o.state = 'passed';
        o.t = r.time;
        o.shock = soften(r, SHOCK.jumpBase + kmh(r.v) * SHOCK.jumpK);
        applyShock(r, o.shock, `${OBS_INFO[o.kind].name}をジャンプで飛び越えた`);
        continue;
      }
      if (o.kind === 'tree') {
        o.shock = predictShock(r, o);
        o.state = 'hit';
        o.t = r.time;
        if (kmh(r.v) >= treeNeed(r)) {
          applyShock(r, o.shock, `倒木を${Math.round(kmh(r.v))}km/hで突破！`);
          r.v *= 0.82;
        } else {
          applyShock(r, o.shock, '倒木に止められた');
          r.v = 0;
          r.stuck = 6;
          toast(r, `${treeNeed(r)}km/h に届かず止められた。撤去に6秒`, 'bad');
        }
      } else if (o.kind === 'deer') {
        o.state = 'hit';
        o.t = r.time;
        o.shock = predictShock(r, o);
        applyShock(r, o.shock, `鹿と衝突（${Math.round(kmh(r.v))}km/h）`);
        r.v *= 0.5;
      }
    }
  }
  // 駅
  const stop = POS[st];
  if (!r.reverse && r.v < 0.05 && r.notch <= 4 && r.x >= stop + STOP_LO && r.x <= stop + STOP_HI) arrive(r);
  else if (r.x > stop + OVERRUN_MAX) {
    const missed = r.pax.filter((p) => p.dest === st);
    for (const p of missed) p.dest = Math.min(N_ST - 1, st + 1);
    if (missed.length) {
      r.trust -= 5 * missed.length;
      toast(r, `${LINE.stations[st].name}を通過。${missed.length}人が乗り過ごし`, 'bad');
    } else toast(r, `${LINE.stations[st].name}を通過`, '');
    if (st >= N_ST - 1) {
      r.phase = 'over';
      r.overReason = '終点を通り過ぎた';
    } else {
      r.target++;
    }
  }
}

/** バックできる状態か（行き過ぎて止まっている） */
export function canReverse(r: Run): boolean {
  if (r.phase !== 'running') return false;
  const stop = POS[r.target];
  return r.x > stop + STOP_HI && r.x <= stop + OVERRUN_MAX && r.v < 0.05;
}

/** 客を降ろす（いつでも）。走行中なら窓から放り出す */
export function eject(r: Run, id: number) {
  const p = r.pax.find((q) => q.id === id);
  if (!p) return;
  const big = p.kind === 'old' || p.kind === 'kid' || p.kind === 'vip';
  const loss = r.phase === 'running' ? (big ? 15 : 8) : big ? 8 : 4;
  r.trust -= loss;
  if (r.picked.has(id)) {
    // 停車中に乗せたばかりの客ならホームに戻すだけ
    r.picked.delete(id);
    r.trust += loss;
    r.pax = r.pax.filter((q) => q !== p);
    p.spot = -1;
    return;
  }
  r.pax = r.pax.filter((q) => q !== p);
  if (r.phase === 'running') {
    r.fliers.push({ pax: p, t: r.time, x: spotWorldX(r, p.spot) });
    toast(r, `${KINDS[p.kind].name}を窓から降ろした（信頼−${loss}）`, 'bad');
  } else toast(r, `${KINDS[p.kind].name}に途中で降りてもらった（信頼−${loss}）`, 'bad');
}

/** 今の速さでの揺れの衝撃（60km/h以下なら0） */
export function joltShock(_r: Run): number {
  return 0;
}
/** 次に来る脅威の衝撃（次の障害の予測と揺れの大きいほう） */
export function threat(r: Run): number {
  const o = nextObstacle(r);
  let sh = 0;
  if (o) sh = o.kind === 'tree' && r.phase === 'running' ? predictShock(r, o, Math.max(r.v, (treeNeed(r) + 2) / 3.6)) : predictShock(r, o);
  return Math.max(sh, joltShock(r));
}

/** 位置の、線路の上での x（先頭車両の前端が r.x） */
export function spotWorldX(r: Run, spot: number): number {
  const sp = r.spots[spot];
  if (!sp) return r.x - 6;
  return r.x - (sp.car + 1) * 12 + sp.x;
}

function applyMod(r: Run, id: ModId) {
  r.mods.add(id);
  if (id === 'car') {
    const c = r.cars;
    r.cars++;
    r.spots.push(...lowerSpots(r.meta, c));
    if (r.decks > 1) r.spots.push(...upperSpots(c));
    r.cap += 5;
  } else if (id === 'deck') {
    r.decks = 2;
    for (let c = 0; c < r.cars; c++) r.spots.push(...upperSpots(c));
    r.cap += r.cars * 6;
  } else if (id === 'roof') {
    r.roof = true;
    r.spots.push(...roofSpots(0));
    r.cap += 4;
  }
}

/** 客をほかの車両へ（空いている位置へ） */
export function moveToCar(r: Run, id: number, car: number): boolean {
  const p = r.pax.find((q) => q.id === id);
  if (!p) return false;
  const free = r.spots.findIndex((sp, j) => sp.car === car && !r.pax.some((q) => q.spot === j) && sp.deck === 0);
  const any = free >= 0 ? free : r.spots.findIndex((sp, j) => sp.car === car && !r.pax.some((q) => q.spot === j));
  if (any < 0) return false;
  p.spot = any;
  return true;
}

/** 客を別の段（1階・2階・屋根）へ */
export function moveToLevel(r: Run, id: number, car: number, deck: number): boolean {
  const p = r.pax.find((q) => q.id === id);
  if (!p) return false;
  const free = r.spots.findIndex((sp, j) => sp.car === car && sp.deck === deck && !r.pax.some((q) => q.spot === j));
  if (free < 0) return false;
  p.spot = free;
  return true;
}
