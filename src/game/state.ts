// 「障害突破ラン」のゲームの状態と進行。描画には触れない。

import { randomLook, type Look } from '../game.ts';
import type { LineDef } from '../data.ts';

// ---------- 路線 ----------
export interface RunLine extends LineDef {
  /** 路線選びの説明 */
  blurb: string;
  /** 遅れの上限 [秒] */
  delayLimit: number;
  /** 予定の平均速度 [m/s] */
  planV: number;
  /** 運賃の上乗せ（1人あたり） */
  fareBonus: number;
  /** 解放の条件（クリアが必要な路線） */
  needs: string | null;
  color: string;
  /** 見出しに出す短い名前と、車両の色 */
  short: string;
  cars: string[] | null;
  /** 路線ごとの運賃の上書き・持ち帰りの倍率・早着ボーナスの刻み[秒]・電柱の連打の追加 */
  fares: Partial<Record<Kind, number>>;
  carry: number;
  earlyPer: number;
  poleAdd: number;
  /** 乗客の出やすさ・観光客の行きたい駅 */
  weights: Record<Kind, number>;
  sights: number[];
}
const mkSt = (name: string) => ({ name, platformCars: 2, demand: 0 });
export const LINES: Record<string, RunLine> = {
  enoden: {
    id: 'enoden',
    name: '江ノ島電鉄',
    blurb: '海沿いの単線。倒木・鹿・急カーブ、終点前に江ノ島の大波',
    stations: ['藤沢', '鵠沼', '江ノ島', '腰越', '鎌倉高校前', '長谷', '鎌倉'].map(mkSt),
    sections: [380, 440, 380, 460, 420, 480],
    scenery: ['town', 'town', 'street', 'coast', 'coast', 'town'],
    delayLimit: 120,
    planV: 10,
    fareBonus: 0,
    needs: null,
    color: '#6FC3A0',
    short: '江ノ島電鉄',
    cars: null,
    fares: {},
    carry: 1,
    earlyPer: 10,
    poleAdd: 0,
    weights: { old: 1, kid: 1, sal: 2, stu: 1, sumo: 1, vip: 0, bride: 0.3, carp: 0.5, tour: 0.6 },
    sights: [2, 6],
  },
  ginza: {
    id: 'ginza',
    name: '東京メトロ銀座線',
    blurb: '日本最古の地下鉄。工事区間・坂・急カーブ、浅草の手前に浸水区間',
    stations: ['渋谷', '表参道', '赤坂見附', '銀座', '日本橋', '上野', '浅草'].map(mkSt),
    sections: [460, 520, 480, 420, 560, 500],
    scenery: ['street', 'tunnel', 'tunnel', 'tunnel', 'tunnel', 'tunnel'],
    delayLimit: 100,
    planV: 11,
    fareBonus: 0,
    needs: 'enoden',
    color: '#F39800',
    short: '銀座線',
    cars: ['#F3B81C', '#F39800', '#F3B81C', '#E9B23E'],
    fares: { sal: 3 },
    carry: 1.2,
    earlyPer: 8,
    poleAdd: 4,
    weights: { old: 1, kid: 0.5, sal: 3, stu: 1, sumo: 0.5, vip: 0, bride: 0.4, carp: 0.6, tour: 1.2 },
    sights: [3, 6],
  },
};
export let LINE: RunLine = LINES.enoden;
export let POS: number[] = [];
export let N_ST = 0;
/** 走る路線を切り替える（ランの最初に呼ぶ） */
export function setLine(id: string) {
  LINE = LINES[id] ?? LINES.enoden;
  POS = [0];
  for (const d of LINE.sections) POS.push(POS[POS.length - 1] + d);
  N_ST = LINE.stations.length;
  // 地下に倒木はない：見た目と名前だけガレキに
  const under = LINE.scenery.includes('tunnel');
  OBS_INFO.tree.name = under ? 'ガレキ' : '倒木';
  OBS_INFO.tree.ch = under ? '瓦' : '木';
}
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
export const sectionTime = (k: number) => LINE.sections[k] / LINE.planV + SECTION_EXTRA;

// ---------- 衝撃の式（バランス調整はここだけ） ----------
export const SHOCK = {
  /** 非常ブレーキ：速度 km/h × */
  brake: 0.5,
  /** 倒木：突き破っても止められても 速度 × */
  tree: 0.8,
  treeOver: 1.2,
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
  /** 大波：基本 ＋ 速度 × */
  waveBase: 30,
  waveK: 0.5,
};
export const TREE_V = 40; // km/h 以上で突き破る
export const CURVE_V = 20; // km/h 以下で通過

// ---------- 乗客 ----------
export type Kind = 'old' | 'kid' | 'sal' | 'stu' | 'sumo' | 'vip' | 'bride' | 'carp' | 'tour';
export interface KindDef {
  name: string;
  ch: string;
  tol: number;
  fare: number; // 1人あたり（コイン）
  size: number; // 席をいくつ使うか
  note: string;
  color: string;
  /** 長押しで出る、ちょっとした人となり */
  flavor: string[];
}
export const KINDS: Record<Kind, KindDef> = {
  old: {
    name: 'お年寄り', ch: '老', tol: 10, fare: 2, size: 1, note: '無事に届けると信頼+5', color: '#B9B0A2',
    flavor: ['「若い頃は車掌だった」と3駅ごとに言う。毎回違う路線名で。', '飛んでも着地してもまず「ありがとうねえ」。', '飴を3種類持っている。誰にあげるかは決めていない。'],
  },
  kid: {
    name: '子ども', ch: '子', tol: 15, fare: 1, size: 1, note: '軽くてよく飛ぶ', color: '#E9B23E',
    flavor: ['降りる駅より、電車そのものが目的。', '射出されたあと「もう1回！」と言う。', '運転席の真後ろは自分の席だと思っている。'],
  },
  sal: {
    name: '会社員', ch: '会', tol: 30, fare: 2, size: 1, note: '遅れ30秒超で運賃半分', color: '#FFFDF6',
    flavor: ['遅刻の言い訳を3つ用意してある。今日は全部使う予定。', '空中でもスマホでメールを返している。', '会議の資料は、たぶん前の駅のホームにある。'],
  },
  stu: {
    name: '学生', ch: '学', tol: 45, fare: 1, size: 1, note: '連打を手伝う（毎秒3回）', color: '#8299E0',
    flavor: ['定期の範囲はとうに過ぎた。帰りのことは考えていない。', '連打の速さだけは学年一位。', '単語帳を開いているが、ずっと同じページ。'],
  },
  sumo: {
    name: '力士', ch: '力', tol: 90, fare: 3, size: 3, note: '席3つ。隣の客は耐衝撃+20', color: '#F0C9A0',
    flavor: ['つり革を握ると、たまに取れる。', '急ブレーキは立ち合いだと思っている。', 'ちゃんこが冷める前に部屋へ帰りたい。'],
  },
  vip: {
    name: 'VIP', ch: 'V', tol: 5, fare: 5, size: 1, note: '無傷で届けると¢5', color: '#B98ADB',
    flavor: ['自分の到着を「お越し」と呼ぶよう秘書に言ってある。', '電車に乗るのは人生で2回目。1回目は買収の下見。', '着地の瞬間だけは、なぜかいつも笑顔。'],
  },
  bride: {
    name: '花嫁', ch: '嫁', tol: 20, fare: 3, size: 2, note: '乗っている間、早着ボーナス×2。遅れると運賃半分', color: '#FFFFFF',
    flavor: ['式場に早く着くほど機嫌がいい。ブーケはいつでも投げられる。', 'ドレスの裾で座席が2つ埋まる。本人は気にしていない。', '「人生最高の日」に電車から射出されるとは聞いていない。'],
  },
  carp: {
    name: '大工', ch: '工', tol: 50, fare: 2, size: 1, note: '倒木を10km/h遅くても突破できる。工事区間の安全速度+10', color: '#E9A23E',
    flavor: ['倒木を見ると「いい材だ」とつぶやく。', '車内の手すりのぐらつきを、勝手に直している。', '工事現場の人とはだいたい知り合い。'],
  },
  tour: {
    name: '観光客', ch: '観', tol: 25, fare: 2, size: 1, note: '屋根から届けると運賃+¢1', color: '#7EC8E3',
    flavor: ['屋根の上が一番の名所だとガイドブックに書いてあった（書いてない）。', '飛んでいる間もずっと自撮りしている。', '行き先は「いちばん有名なところ」。'],
  },
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
  return [4.0, 7.0, 2.5, 5.5, 8.5].map((x) => ({ x, y: 0, kind: 'floor' as const, car, deck: 2 }));
}
/** 段ごとの耐衝撃の補正 */
export const DECK_TOL = [0, -10, -10];
export const DECK_NAME = ['1階', '2階', '屋根の上'];

// ---------- 障害 ----------
export type ObsKind = 'tree' | 'curve' | 'deer' | 'pole' | 'wave' | 'work' | 'slope' | 'flood';
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
  /** 坂の向き（1：上り、−1：下り） */
  dir?: number;
}
export const OBS_INFO: Record<ObsKind, { name: string; ch: string }> = {
  tree: { name: '倒木', ch: '木' },
  curve: { name: '急カーブ', ch: '曲' },
  deer: { name: '鹿', ch: '鹿' },
  pole: { name: '倒れた電柱', ch: '柱' },
  wave: { name: '江ノ島の大波', ch: '波' },
  work: { name: '工事区間', ch: '工' },
  slope: { name: '坂', ch: '坂' },
  flood: { name: '浸水区間', ch: '水' },
};
setLine('enoden');
/** 工事区間：これ以下なら衝撃なし。浸水区間：これ以下なら衝撃なし */
export const WORK_V = 30;
export const FLOOD_V = 15;
/** 工事区間を連打できる距離と、作業員が退くまでの時間 */
export const WORK_REACH = 50;
export const WORK_EVAC = 1.0;
/** 大波：周期と、波が線路にかかっている時間 */
export const WAVE_PERIOD = 5;
export const WAVE_UP = 2.2;
export function waveUp(t: number): boolean {
  return t % WAVE_PERIOD < WAVE_UP;
}

// ---------- 3択（ランの中だけ） ----------
export type ItemId = 'jump' | 'saw' | 'airbag' | 'nitro' | 'net' | 'dia';
export type ModId =
  | 'belt' | 'belt2' | 'ram' | 'ram2' | 'plow' | 'susp' | 'susp2' | 'susp3' | 'car' | 'deck' | 'roof' | 'roof2' | 'view'
  | 'rocket' | 'motor' | 'mat' | 'mat2' | 'kidlove' | 'chute' | 'chute2' | 'rubber' | 'hbrake' | 'hbrake2' | 'sand' | 'sand2' | 'tilt' | 'magnet';
export interface Offer {
  id: ItemId | ModId;
  name: string;
  desc: string;
  kind: 'item' | 'mod';
  /** お店での値段（コイン） */
  price: number;
  /** 改造ツリー：系統・段・前提 */
  branch?: Tag;
  tier?: Tier;
  req?: ModId;
}
export type Tier = 'Ⅰ' | 'Ⅱ' | 'Ⅲ' | '分岐';
/** お店の1枚 */
export interface ShopCard extends Offer {
  sold: boolean;
  /** セール前の値段 */
  full: number;
}
/** ランの最初の所持金・引き直しの値段 */
export const START_MONEY = 3;
type M = [ModId, string, Tag, Tier, ModId | undefined, number, string];
/** 改造ツリー（Ⅰは最初から、Ⅱ・Ⅲと分岐は前の改造を持っていると出る） */
const TREE: M[] = [
  ['hbrake', '強力ブレーキ', '射出', 'Ⅰ', undefined, 3, '非常ブレーキの射出 ×1.15。車内の客も少し飛びやすい'],
  ['hbrake2', '強力ブレーキⅡ', '射出', 'Ⅱ', 'hbrake', 6, '非常ブレーキの射出 ×1.3'],
  ['mat', '着地マット', '射出', 'Ⅰ', undefined, 3, '各駅の×2マットの幅 5 → 7m'],
  ['mat2', '着地マットⅡ', '射出', 'Ⅱ', 'mat', 6, '×2マットの幅 → 9m'],
  ['magnet', '磁石マット', '射出', '分岐', 'mat', 6, '×2マットに吸い寄せる。PERFECTの判定 両側+2m'],
  ['kidlove', '子ども好き', '射出', '分岐', 'mat', 4, '子どもがPERFECT着地すると運賃がさらに×2'],
  ['chute', 'パラシュート傘', '射出', 'Ⅰ', undefined, 3, 'ホームから2mまでのはみ出しなら届く'],
  ['chute2', 'パラシュート傘Ⅱ', '射出', 'Ⅱ', 'chute', 5, '4mまでのはみ出しなら届く'],
  ['susp', 'エアサス', '守り', 'Ⅰ', undefined, 3, 'すべての衝撃 −5（射出も少し弱まる）'],
  ['susp2', 'エアサスⅡ', '守り', 'Ⅱ', 'susp', 6, 'すべての衝撃 −10'],
  ['susp3', 'エアサスⅢ', '守り', 'Ⅲ', 'susp2', 10, 'すべての衝撃 −15'],
  ['belt', 'シートベルト', '守り', 'Ⅰ', undefined, 3, '座席の耐衝撃 +20 → +30'],
  ['belt2', '全席シートベルト', '守り', 'Ⅱ', 'belt', 6, '座席の耐衝撃 → +50'],
  ['rubber', 'ゴムの手すり', '守り', '分岐', 'belt', 5, '射出以外の衝撃では、屋根の客の耐衝撃 +30'],
  ['ram', '衝角', '突破', 'Ⅰ', undefined, 3, '倒木を突き破る速さ 40 → 32km/h'],
  ['ram2', '衝角Ⅱ', '突破', 'Ⅱ', 'ram', 6, '倒木を突き破る速さ → 20km/h'],
  ['plow', '排障器', '突破', '分岐', 'ram', 6, '倒木・鹿・工事区間の衝撃が半分'],
  ['sand', '砂まき装置', '突破', 'Ⅰ', undefined, 3, '急カーブの安全な速さ 20 → 25km/h'],
  ['sand2', '砂まき装置Ⅱ', '突破', 'Ⅱ', 'sand', 6, '急カーブの安全な速さ → 30km/h'],
  ['tilt', '振り子台車', '突破', '分岐', 'sand', 7, '急カーブで脱輪しない（衝撃は受ける）'],
  ['motor', 'モーター', '突破', 'Ⅰ', undefined, 3, '加速 +15%'],
  ['rocket', 'ロケットブースター', '突破', '分岐', 'motor', 8, '加速×1.8、最高速度も伸び、射出も×1.5'],
  ['roof', '屋根席', '満員', 'Ⅰ', undefined, 4, '屋根に乗れる人数 +1（全車両）。屋根は射出台'],
  ['roof2', '屋根席Ⅱ', '満員', 'Ⅱ', 'roof', 7, '屋根に乗れる人数 さらに+2（全車両）'],
  ['view', '展望デッキ', '満員', '分岐', 'roof', 6, '屋根から届けた客の運賃 +1'],
  ['car', '増結', '満員', 'Ⅰ', undefined, 5, '車両を1両つなぐ。定員+5（何両でも、買うたび高くなる）。そのぶん加速が少し鈍る'],
  ['deck', '二階建て', '満員', '分岐', 'car', 8, '全車両を二階建てに。定員+両数×6。2階は耐衝撃−10'],
];
export const OFFERS: Offer[] = [
  { id: 'jump', name: 'ジャンプ台', desc: '次の障害の手前で電車ごと跳ぶ。速いほど高く遠くへ、空中でも少し加減速できる。着地の衝撃なし。空中で非常ブレーキを引くと、空から客を射出できる', kind: 'item', price: 2 },
  { id: 'saw', name: 'チェーンソー', desc: '電柱か倒木を一瞬で片付ける', kind: 'item', price: 2 },
  { id: 'airbag', name: 'エアバッグ', desc: '次の衝撃で誰も飛ばない', kind: 'item', price: 3 },
  { id: 'nitro', name: 'ニトロ', desc: 'その場で +20km/h。空中では使えない', kind: 'item', price: 2 },
  { id: 'net', name: '着地ネット', desc: '次の射出だけ、ホームから4mはみ出してもGOOD', kind: 'item', price: 2 },
  { id: 'dia', name: '臨時ダイヤ', desc: '遅れを20秒なかったことに（予定より早くはならない）', kind: 'item', price: 3 },
  ...TREE.map(([id, name, branch, tier, req, price, desc]): Offer => ({ id, name, desc, kind: 'mod', price, branch, tier, req })),
];
/** 改造ツリーの1つ */
export const treeNode = (id: string): Offer | undefined => OFFERS.find((o) => o.id === id && o.kind === 'mod');
/** ツリーの根（Ⅰ）までさかのぼる */
export function treeRoot(id: string): string {
  let o = treeNode(id);
  while (o?.req) o = treeNode(o.req);
  return o?.id ?? id;
}
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
  { id: 'cap', name: '定員アップ', desc: (l) => `乗せられる人数 ${5 + l} → ${6 + l}`, cost: [5, 11, 22] },
  { id: 'bench', name: '座席の増設', desc: (l) => `座席 ${2 + l} → ${3 + l}`, cost: [6, 15] },
  { id: 'strap', name: 'つり革の増設', desc: (l) => `つり革 ${2 + l} → ${3 + l}`, cost: [4, 9] },
  { id: 'cushion', name: '座席クッション', desc: (l) => `座席の軽減 −${20 + l * 5} → −${25 + l * 5}`, cost: [4, 9, 19] },
  { id: 'susp', name: '台車のばね', desc: (l) => `すべての衝撃 −${l * 3} → −${l * 3 + 3}`, cost: [6, 14, 28] },
  { id: 'motor', name: 'モーター', desc: (l) => `加速 +${l * 15}% → +${l * 15 + 15}%`, cost: [4, 9, 19] },
  { id: 'kit', name: '初期装備', desc: (l) => (l === 0 ? 'チェーンソー1つを持って出発' : 'エアバッグも1つ持って出発'), cost: [5, 11] },
  { id: 'grace', name: 'ダイヤの余裕', desc: (l) => `遅れの上限 ${120 + l * 20} → ${140 + l * 20}秒`, cost: [4, 9, 19] },
];
// ---------- 持ち込み改造（出発前に1つだけ） ----------
export interface Loadout {
  id: string;
  name: string;
  up: string;
  down: string;
  /** 車両基地での解放コスト（0 は最初から） */
  cost: number;
}
export const LOADOUTS: Loadout[] = [
  { id: 'normal', name: 'ノーマル', up: '特になし', down: '特になし', cost: 0 },
  { id: 'rails', name: '手すり撤去', up: '屋根の客がよく飛ぶ（耐衝撃 −25）。屋根からの射出は飛距離+15%', down: '倒木やカーブでも屋根の客が飛びやすい', cost: 0 },
  { id: 'deadhead', name: '回送明け', up: '所持金 +5 で出発', down: '遅れの上限 −20秒', cost: 0 },
  { id: 'trip', name: '遠足の引率', up: '毎駅 子どもが2人多い。子どもの運賃 +1', down: '車内の客の耐衝撃 −5（騒がしい）', cost: 6 },
  { id: 'bigmat', name: '巨大マット', up: '×2マットの幅 ×1.8', down: '連続着地のボーナスなし', cost: 6 },
  { id: 'sumo', name: '力士部屋', up: '毎駅 力士が1人いる。力士の隣は耐衝撃 +30', down: '定員 −1', cost: 8 },
  { id: 'debt', name: '借金スタート', up: '所持金 10 で出発', down: '終点で12返済。返せなければ持ち帰り0', cost: 8 },
  { id: 'cargo', name: '二両目は貨物室', up: '2両で出発。2両目の客は何があっても飛ばない', down: '2両目の客は運賃半分。2両目に屋根席なし', cost: 10 },
  { id: 'packed', name: 'ぎゅうぎゅう詰め', up: '定員 +3', down: 'つり革なし。全員の耐衝撃 −10', cost: 10 },
  { id: 'bullet', name: '弾丸特急', up: '駅を通過するたびに ¢2', down: '停車した駅の客が4人だけ', cost: 12 },
  { id: 'rocketd', name: 'ロケット直結', up: 'ロケットブースターを積んで出発', down: 'ブレーキ（B1〜B3）の効きが −30%', cost: 12 },
  { id: 'vipcar', name: 'VIP専用車', up: '毎駅 VIPがいる。VIPのPERFECTは ¢6', down: 'VIPを着地ミスさせると信頼 −50', cost: 15 },
];
// ---------- キーワードとコンボ ----------
export type Tag = '射出' | '守り' | '突破' | '満員';
export const OFFER_TAGS: Record<string, Tag[]> = {
  ...Object.fromEntries(TREE.map(([id, , branch]) => [id, [branch]])),
  jump: ['射出'],
  airbag: ['守り'],
  saw: ['突破'],
  nitro: ['突破'],
  net: ['射出'],
  dia: ['突破'],
};
export type ComboId = 'cannon' | 'retro' | 'bumper' | 'wall' | 'upper' | 'salvo' | 'sling' | 'tour';
export interface ComboDef {
  id: ComboId;
  name: string;
  /** 組み合わせる2つ（お店の◎と図鑑のヒントに使う） */
  parts: [string, string];
  cond: string;
  eff: string;
  tags: Tag[];
}
export const PART_NAME: Record<string, string> = {
  roof: '屋根席の拡張',
  jump: 'ジャンプ台',
  rocket: 'ロケット',
  brake: '急ブレーキ射出',
  ram: '衝角',
  sumo: '力士',
  belt: 'シートベルト',
  susp: 'エアサス',
  deck: '二階建て',
  many: '1回の射出で、何人も…',
  rubber: 'ゴムの手すり',
  hbrake: '強力ブレーキ',
  tour: '観光客',
};
export const COMBOS: ComboDef[] = [
  { id: 'cannon', name: '人間大砲', parts: ['roof', 'jump'], cond: '屋根席の拡張 ＋ ジャンプ台（駅の手前120m以内でジャンプ）', eff: '屋根の客が空中から射出される・飛距離×1.5', tags: ['射出'] },
  { id: 'retro', name: '逆噴射射出', parts: ['rocket', 'brake'], cond: 'ロケット ＋ 急ブレーキ射出', eff: '飛距離×1.5', tags: ['射出', '突破'] },
  { id: 'bumper', name: '力士バンパー', parts: ['ram', 'sumo'], cond: '衝角 ＋ 力士が乗っている状態で倒木を突き破る', eff: '倒木の衝撃0・突破ボーナス2倍', tags: ['突破', '守り'] },
  { id: 'wall', name: '鉄壁の選択射出', parts: ['belt', 'susp'], cond: '50km/h以上の射出で、屋根の客だけが2人以上飛ぶ', eff: '飛んだ客1人につき +¢1', tags: ['守り', '射出'] },
  { id: 'upper', name: '二階席射出', parts: ['deck', 'roof'], cond: '二階建て ＋ 屋根席。2階と屋根の客が同じ射出で着地成功', eff: '+¢2', tags: ['満員', '射出'] },
  { id: 'salvo', name: '一斉着地', parts: ['many', 'many'], cond: '1回の射出で3人以上がPERFECT', eff: '+¢3', tags: ['射出'] },
  { id: 'sling', name: 'ゴム鉄砲', parts: ['rubber', 'hbrake'], cond: 'ゴムの手すり ＋ 強力ブレーキで、屋根の客を射出', eff: '屋根の客の飛距離×1.3', tags: ['射出'] },
  { id: 'tour', name: '観光ツアー', parts: ['tour', 'many'], cond: '1回の射出で観光客3人がPERFECT', eff: '+¢5（一斉着地のかわり）', tags: ['射出'] },
];
export function comboDef(id: ComboId): ComboDef {
  return COMBOS.find((c) => c.id === id)!;
}
/** そのパーツを今持っているか */
function hasPart(r: Run, part: string): boolean {
  if (part === 'brake') return true;
  if (part === 'jump') return r.items.jump > 0 || r.armed === 'jump';
  if (part === 'sumo') return r.pax.some((p) => p.kind === 'sumo') || r.lo === 'sumo';
  if (part === 'tour') return r.pax.some((p) => p.kind === 'tour');
  if (part === 'belt' || part === 'susp') return r.mods.has(part as ModId);
  return r.mods.has(part as ModId);
}
/** お店の◎：このカードと組むとコンボになる相手を今持っていれば、そのコンボ */
export function comboHint(r: Run, offerId: string): { combo: ComboDef; partner: string } | null {
  for (const c of COMBOS) {
    const i = c.parts.indexOf(offerId);
    if (i < 0) continue;
    const other = c.parts[1 - i];
    if (other !== 'many' && hasPart(r, other)) return { combo: c, partner: PART_NAME[other] };
  }
  return null;
}
/** 人間大砲の準備ができているなら、ジャンプの頂点（そこで屋根の客が飛ぶ） */
export function cannonReady(r: Run): { apexX: number; apexZ: number } | null {
  if (r.phase !== 'running' || !r.mods.has('roof')) return null;
  if (r.air && (!r.cannonArm || r.vz <= 0)) return null;
  const plan = jumpPlan(r);
  if (!plan) return null;
  const st = Math.min(r.target, LINE.stations.length - 1);
  const d = POS[st] - plan.apexX;
  if (d <= 0 || d >= 160) return null;
  return r.pax.some((p) => r.spots[p.spot]?.deck === 2 && p.dest === st) ? { apexX: plan.apexX, apexZ: plan.apexZ } : null;
}
/** コンボ発動（演出キューに積み、初めてなら図鑑に記録） */
function triggerCombo(r: Run, id: ComboId, extra = '') {
  // トップ画面の映像では記録しない
  if (r.demo) {
    r.cutins.push({ id, t: r.time, first: false, extra });
    return;
  }
  r.meta.combos = r.meta.combos ?? {};
  const first = !r.meta.combos[id];
  if (first) {
    const d = new Date();
    r.meta.combos[id] = `${d.getMonth() + 1}/${d.getDate()}`;
    saveMeta(r.meta);
  }
  r.cutins.push({ id, t: r.time, first, extra });
  r.stats.combos++;
}

/** 改造ごとの「推し」商品（お店で出やすい） */
const LO_SYNERGY: Record<string, string[]> = {
  rails: ['susp'],
  deadhead: ['rocket', 'roof'],
  trip: ['kidlove'],
  bigmat: ['chute', 'rocket'],
  sumo: ['roof', 'deck'],
  debt: ['deck', 'belt'],
  cargo: ['roof'],
  packed: ['belt'],
  bullet: ['mat', 'chute'],
  rocketd: ['chute', 'mat'],
  vipcar: ['airbag', 'belt', 'chute', 'net'],
};
export function loadoutOf(id: string): Loadout {
  return LOADOUTS.find((l) => l.id === id) ?? LOADOUTS[0];
}
export function unlockLoadout(m: Meta, id: string): boolean {
  const l = LOADOUTS.find((q) => q.id === id);
  if (!l || m.unlocked.includes(id) || m.bank < l.cost) return false;
  m.bank -= l.cost;
  m.unlocked.push(id);
  m.loadout = id;
  saveMeta(m);
  return true;
}

export interface Meta {
  bank: number;
  /** 解放済みの持ち込み改造と、次に持っていくもの */
  unlocked: string[];
  loadout: string;
  /** 選んでいる路線と、クリアした路線 */
  line: string;
  cleared: string[];
  /** 研修運転を終えたか・見た初回ヒント */
  tutorialDone: boolean;
  tips: string[];
  /** コンボ図鑑：見つけた日 */
  combos: Partial<Record<ComboId, string>>;
  /** 旧・恒久強化（もう使わない。常に0） */
  lv: Record<UpId, number>;
  runs: number;
  best: number;
}
const META_KEY = 'hakobi.run.meta.v2';
const OLD_META_KEY = 'hakobi.run.meta.v1';
export function loadMeta(): Meta {
  const base: Meta = { bank: 0, unlocked: [], loadout: 'normal', line: 'enoden', cleared: [], combos: {}, tutorialDone: false, tips: [], lv: { cap: 0, bench: 0, strap: 0, cushion: 0, susp: 0, motor: 0, kit: 0, grace: 0 }, runs: 0, best: 0 };
  try {
    const raw = localStorage.getItem(META_KEY);
    const old = raw ? null : localStorage.getItem(OLD_META_KEY);
    if (old) {
      // 円 → コインへの切り替え：貯金を 1/80 に
      const m = JSON.parse(old) as Partial<Meta>;
      return withFree({ ...base, ...m, tutorialDone: m.tutorialDone ?? (m.runs ?? 0) > 0, bank: Math.floor((m.bank ?? 0) / 80), best: Math.floor((m.best ?? 0) / 80), lv: { ...base.lv } });
    }
    if (raw) {
      const m = JSON.parse(raw) as Partial<Meta>;
      // 旧・恒久強化に使ったコインは返す（持ち込み改造に切り替えたため）
      let refund = 0;
      if (!m.unlocked && m.lv) for (const u of UPGRADES) for (let i = 0; i < (m.lv[u.id] ?? 0); i++) refund += u.cost[i] ?? 0;
      return withFree({ ...base, ...m, tutorialDone: m.tutorialDone ?? (m.runs ?? 0) > 0, bank: (m.bank ?? 0) + refund, lv: { ...base.lv } });
    }
  } catch {
    // 保存できない環境では毎回まっさらから
  }
  return withFree(base);
}
/** 最初から使える改造は常に解放済みに */
function withFree(m: Meta): Meta {
  const u = new Set(m.unlocked ?? []);
  for (const l of LOADOUTS) if (l.cost === 0) u.add(l.id);
  m.unlocked = [...u];
  m.combos = m.combos ?? {};
  m.tips = m.tips ?? [];
  m.cleared = m.cleared ?? [];
  if (!LINES[m.line] || !lineOpen(m, m.line)) m.line = 'enoden';
  if (!m.unlocked.includes(m.loadout)) m.loadout = 'normal';
  return m;
}
/** セーブデータを消して最初からに（音とズームの設定は残す） */
export function resetMeta(): Meta {
  try {
    localStorage.removeItem(META_KEY);
    localStorage.removeItem(OLD_META_KEY);
  } catch {
    // 無視
  }
  return loadMeta();
}
/** 路線が選べるか */
export function lineOpen(m: Meta, id: string): boolean {
  const l = LINES[id];
  return !!l && (!l.needs || (m.cleared ?? []).includes(l.needs));
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
  return 30 + (r.mods.has('rocket') ? 18 : 0);
}

export interface Flier {
  pax: Pax;
  t: number;
  x: number; // 飛び出した位置
  z: number;
  vx: number;
  vz: number;
  tLand: number;
  landX: number;
  judged: boolean;
  result: '' | 'perfect' | 'good' | 'miss' | 'lost';
  /** どの射出で飛んだか（0 は射出以外） */
  launch: number;
  deck: number;
  /** 着地ネットつき */
  net?: boolean;
}
/** ホームの範囲（停止目標からの差） */
export const PLAT_LO = -24.5;
export const PLAT_HI = 4;
const G = 9.8;
const KIND_W: Record<Kind, number> = { old: 1.0, kid: 1.25, sal: 1.0, stu: 1.05, sumo: 0.65, vip: 1.1, bride: 0.9, carp: 0.95, tour: 1.05 };
/** 速度 v で飛び出したときの飛び方 */
export function flight(v: number, z: number, kind: Kind, boost = 1) {
  const vz = 3 + v * 0.12;
  const t = (vz + Math.sqrt(vz * vz + 2 * G * Math.max(0.5, z))) / G;
  const vx = v * KIND_W[kind] * boost;
  return { vx, vz, t, dist: vx * t };
}
/** 段ごとの高さ（飛び出す高さ） */
export function spotZ(r: Run, spot: number): number {
  const sp = r.spots[spot];
  const lift = r.z;
  if (!sp) return 1.5 + lift;
  if (sp.deck === 2) return 0.95 + 2.9 * r.decks + 0.3 + lift;
  if (sp.deck === 1) return 4.6 + lift;
  return 1.6 + lift;
}
// ---------- ジャンプ ----------
/** 踏み切りの上向きの速さ：速いほど高く遠くへ */
export function jumpVz(v: number): number {
  return 3 + v * 0.33;
}
/** 構えたジャンプ台の位置（次の障害の8m手前） */
export function rampX(r: Run): number | null {
  if (r.armed !== 'jump' || r.air || r.phase !== 'running') return null;
  const o = nextObstacle(r);
  if (!o) return null;
  return o.x - 8;
}
/** 着地の予測：今の速さのまま跳んだら（跳んでいたら）どこに降りるか */
export function jumpPlan(r: Run): { from: number; land: number; apexX: number; apexZ: number } | null {
  if (r.air) {
    const t = (r.vz + Math.sqrt(r.vz * r.vz + 2 * 9.8 * Math.max(0, r.z))) / 9.8;
    const ta = Math.max(0, r.vz / 9.8);
    return { from: r.x, land: r.x + r.v * t, apexX: r.x + r.v * ta, apexZ: r.z + (r.vz > 0 ? (r.vz * r.vz) / 19.6 : 0) };
  }
  const rx = rampX(r);
  if (rx == null) return null;
  const from = Math.max(rx, r.x);
  const vz = jumpVz(r.v);
  return { from, land: from + (r.v * 2 * vz) / 9.8, apexX: from + (r.v * vz) / 9.8, apexZ: (vz * vz) / 19.6 };
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
  launchCool: number;
  mats: { x: number }[];
  streak: number;
  perfectHere: number;
  missHere: number;
  pops: { text: string; x: number; t: number; good: boolean }[];
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
  offer: ShopCard[] | null;
  /** お店で使ったコインの合計 */
  spent: number;
  startMoney: number;
  /** この駅で並べ替えた回数（値段が上がる） */
  rerolls: number;
  /** 持ち込み改造 */
  lo: string;
  startCars: number;
  /** 研修運転 */
  tutorial: boolean;
  /** トップ画面の映像（記録しない） */
  demo?: boolean;
  /** 時間の流れ（研修のスロー） */
  slow: number;
  /** ジャンプ中（電車が宙に浮いている） */
  air: boolean;
  z: number;
  vz: number;
  /** 人間大砲の待機（頂点で屋根の客を飛ばす） */
  cannonArm: boolean;
  /** コンボの演出待ち */
  cutins: { id: ComboId; t: number; first: boolean; extra: string }[];
  /** 射出ごとの着地の記録（コンボ判定用） */
  launchSeq: number;
  launchLog: Record<number, { perfect: number; tours: number; decks: Set<number>; done: Set<string> }>;
  /** 着地ネットを構えている */
  net: boolean;
  stuck: number; // 障害で止められている残り時間
  reverse: boolean; // バック中（ボタンを押している間）
  overReason: string;
  stats: { carried: number; flew: number; shocks: number; maxShock: number; early: number; perfect: number; good: number; launches: number; bestStreak: number; combos: number };
  nextId: number;
}

const rnd = Math.random;
const pick = <T,>(a: T[]): T => a[Math.floor(rnd() * a.length)];

function genObstacles(sec: number): Obstacle[] {
  const len = LINE.sections[sec];
  const last = sec === LINE.sections.length - 1;
  const under = LINE.id === 'ginza';
  const n = sec === 0 ? 2 : sec <= 2 ? 3 : 4;
  const kinds: ObsKind[] = under ? (sec === 0 ? ['work', 'slope'] : sec === 1 ? ['curve', 'slope'] : []) : sec === 0 ? ['pole', 'tree'] : sec === 1 ? ['curve'] : [];
  const pool: ObsKind[] = under ? ['work', 'work', 'curve', 'pole', 'slope', 'tree'] : LINE.scenery[sec] === 'coast' ? ['tree', 'curve', 'deer', 'pole', 'deer'] : ['tree', 'curve', 'deer', 'pole'];
  const want = under ? [2, 3, 3, 4, 4, 3][sec] ?? 3 : n;
  while (kinds.length < (last && !under ? want - 1 : want)) kinds.splice(kinds.length && sec === 1 && under ? 1 : kinds.length, 0, pick(pool));
  // 並びをばらす（最初の区間は教える順のまま）
  if (sec > 1) kinds.sort(() => rnd() - 0.5);
  // 序盤の坂は区間の最後に（坂の直後に工事やカーブを置かない）
  if (under && sec <= 2) kinds.sort((a, b) => (a === 'slope' ? 1 : 0) - (b === 'slope' ? 1 : 0));
  const out: Obstacle[] = [];
  const start = POS[sec] + 80;
  const span = len - (last ? 260 : 170);
  kinds.forEach((kind, i) => {
    const x = start + (span * (i + 0.25 + rnd() * 0.5)) / kinds.length;
    const need = kind === 'pole' ? 16 + Math.min(16, sec * 3) + Math.floor(rnd() * 3) * 2 + LINE.poleAdd : kind === 'deer' ? 1 : kind === 'work' ? (sec <= 2 ? 1 : 2) : 0;
    const slen = kind === 'curve' ? 30 : kind === 'slope' ? 40 + Math.floor(rnd() * 21) : 0;
    const o: Obstacle = { kind, x, len: slen, taps: need, need, state: 'wait', t: 0 };
    if (kind === 'slope') o.dir = under && sec === 0 ? -1 : under && sec === 1 ? 1 : rnd() < 0.5 ? 1 : -1;
    out.push(o);
  });
  if (last && under) out.push({ kind: 'flood', x: POS[sec + 1] - 140, len: 40, taps: 0, need: 0, state: 'wait', t: 0 });
  else if (last) out.push({ kind: 'wave', x: POS[sec + 1] - 120, len: 16, taps: 0, need: 0, state: 'wait', t: 0 });
  return out;
}

function genCandidates(r: Run, st: number): Pax[] {
  const out: Pax[] = [];
  const n = r.lo === 'bullet' ? 4 : r.lo === 'trip' ? 9 : 7;
  const w = LINE.weights;
  let bride = false;
  const draw = (): Kind => {
    const ks = (Object.keys(w) as Kind[]).filter((k) => w[k] > 0 && !(k === 'bride' && bride));
    let t = rnd() * ks.reduce((a, k) => a + w[k], 0);
    for (const k of ks) if ((t -= w[k]) < 0) return k;
    return 'sal';
  };
  for (let i = 0; i < n; i++) {
    let kind: Kind = i === 0 && (r.lo === 'vipcar' || rnd() < 0.55) ? 'vip' : draw();
    if (r.lo === 'sumo' && i === 1) kind = 'sumo';
    if (r.lo === 'trip' && i >= n - 2) kind = 'kid';
    if (kind === 'bride') bride = true;
    const reach = Math.min(3, N_ST - 1 - st);
    let dest = st + 1 + Math.floor(rnd() * reach);
    // 観光客は名所の駅に行きたがる（重み×2）
    if (kind === 'tour') {
      const opts: number[] = [];
      for (let d = st + 1; d <= st + reach; d++) opts.push(d, ...(LINE.sights.includes(d) ? [d] : []));
      dest = pick(opts);
    }
    out.push({ id: r.nextId++, kind, look: randomLook(rnd), from: st, dest, spot: -1 });
  }
  return out;
}

export function newRun(meta: Meta, tutorial = false): Run {
  setLine(tutorial ? 'enoden' : meta.line);
  const r: Run = {
    meta,
    spots: [...lowerSpots(meta, 0), ...roofSpots(0).slice(0, 2)],
    cap: 5 + meta.lv.cap,
    cars: 1,
    decks: 1,
    roof: true,
    sawArmed: false,
    launchCool: 0,
    mats: POS.map((p, i) => ({ x: i === 0 ? 0 : p + PLAT_LO + 5 + Math.random() * (PLAT_HI - PLAT_LO - 9) })),
    streak: 0,
    perfectHere: 0,
    missHere: 0,
    pops: [],
    delayLimit: LINE.delayLimit,
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
    items: { jump: 1, saw: meta.lv.kit >= 1 ? 1 : 0, airbag: meta.lv.kit >= 2 ? 1 : 0, nitro: 0, net: 0, dia: 0 },
    mods: new Set(),
    armed: null,
    airbag: false,
    money: START_MONEY,
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
    spent: 0,
    startMoney: START_MONEY,
    rerolls: 0,
    lo: tutorial ? 'normal' : meta.loadout,
    startCars: 1,
    tutorial,
    slow: 1,
    air: false,
    z: 0,
    vz: 0,
    cannonArm: false,
    net: false,
    cutins: [],
    launchSeq: 0,
    launchLog: {},
    stuck: 0,
    reverse: false,
    overReason: '',
    stats: { carried: 0, flew: 0, shocks: 0, maxShock: 0, early: 0, perfect: 0, good: 0, launches: 0, bestStreak: 0, combos: 0 },
    nextId: 1,
  };
  let t = 0;
  r.schedule.push(0);
  LINE.sections.forEach((_, k) => {
    t += sectionTime(k);
    r.schedule.push(t);
  });
  applyLoadout(r);
  r.candidates = genCandidates(r, 0);
  r.rerolls = 0;
  r.offer = rollShop(r);
  if (tutorial) setupTutorial(r);
  return r;
}
/** 研修運転：最初の区間は倒木1本だけ、鵠沼行きの子どもが待っている */
function setupTutorial(r: Run) {
  r.offer = null;
  const mk = (kind: Kind, dest: number): Pax => ({ id: r.nextId++, kind, look: randomLook(rnd), from: 0, dest, spot: -1 });
  r.candidates = [mk('kid', 1), mk('sal', 2), mk('stu', 3), mk('old', 2)];
  r.obstacles[0] = [{ kind: 'tree', x: POS[0] + 190, len: 0, taps: 0, need: 0, state: 'wait', t: 0 }];
}
function applyLoadout(r: Run) {
  const lo = r.lo;
  if (lo === 'deadhead') {
    r.money += 5;
    r.delayLimit -= 20;
  } else if (lo === 'debt') r.money = 10;
  else if (lo === 'sumo') r.cap -= 1;
  else if (lo === 'packed') {
    r.cap += 3;
    r.spots = r.spots.filter((sp) => sp.kind !== 'strap');
  } else if (lo === 'cargo') applyMod(r, 'car');
  else if (lo === 'rocketd') {
    applyMod(r, 'motor');
    applyMod(r, 'rocket');
  }
  r.mods.delete('car');
  r.startMoney = r.money;
  r.startCars = r.cars;
}
/** 運賃（持ち込み改造の補正つき） */
export function fareOf(r: Run, p: Pax | { kind: Kind }, car = 0): number {
  let f = LINE.fares[p.kind] ?? KINDS[p.kind].fare;
  if (p.kind === 'kid' && r.lo === 'trip') f += 1;
  if (r.lo === 'cargo' && car === 1) f = Math.max(1, Math.floor(f / 2));
  return f;
}
/** 射出の飛距離の倍率 */
export function launchBoost(r: Run, p: Pax, base: number): number {
  const sp = r.spots[p.spot];
  let b = base * (r.lo === 'rails' && sp?.deck === 2 ? 1.15 : 1);
  if (sp?.deck === 2 && slingReady(r)) b = Math.min(2, b * 1.3);
  return b;
}
/** ゴム鉄砲：ゴムの手すり＋強力ブレーキ */
export function slingReady(r: Run): boolean {
  return r.mods.has('rubber') && r.mods.has('hbrake');
}

export function toast(r: Run, text: string, kind = '') {
  r.toasts.push({ text, kind, t: r.time });
  if (r.toasts.length > 3) r.toasts.shift();
}

export const kmh = (v: number) => v * 3.6;
export const seatsUsed = (r: Run) => r.pax.reduce((n, p) => n + KINDS[p.kind].size, 0);
export const pickedSeats = (_r: Run) => 0;
const minus = (r: Run) => (r.mods.has('susp3') ? 15 : r.mods.has('susp2') ? 10 : r.mods.has('susp') ? 5 : 0);
/** 座席の耐衝撃の上乗せ */
export const seatBonus = (r: Run) => (r.mods.has('belt2') ? 50 : r.mods.has('belt') ? 30 : 20);
/** パラシュート傘：ホームからはみ出しても届く距離 */
export const chuteSlack = (r: Run) => (r.mods.has('chute2') ? 4 : r.mods.has('chute') ? 2 : 0);
const soften = (r: Run, v: number) => Math.max(0, Math.round(v - minus(r)));

/** 客の今の耐衝撃（席と力士の隣を足したもの） */
export function effTol(r: Run, p: Pax, launch = false): number {
  let t = KINDS[p.kind].tol;
  const s = r.spots[p.spot];
  if (!s) return t;
  // ゴムの手すり：射出以外では屋根の客がしがみつける
  if (s.deck === 2 && !launch && r.mods.has('rubber')) t += 30;
  if (s.kind === 'seat') t += seatBonus(r);
  else if (s.kind === 'strap') t += 10;
  t += DECK_TOL[s.deck] ?? 0;
  if (s.deck === 2 && r.lo === 'rails') t -= 15;
  if (s.deck < 2 && r.lo === 'trip') t -= 5;
  if (r.lo === 'packed') t -= 10;
  // 貨物室の客は箱入り
  if (r.lo === 'cargo' && s.car === 1) return 9999;
  if (p.kind !== 'sumo') {
    for (const q of r.pax) {
      if (q.kind !== 'sumo' || q === p) continue;
      const o = r.spots[q.spot];
      if (o && o.car === s.car && o.deck === s.deck && Math.hypot(o.x - s.x, o.y - s.y) < 1.8) t += r.lo === 'sumo' ? 30 : 20;
    }
  }
  return t;
}
/** この衝撃で飛ぶ客 */
export function wouldFly(r: Run, shock: number, launch = false): Pax[] {
  if (r.airbag && !launch) return [];
  return r.pax.filter((p) => shock > effTol(r, p, launch));
}

/** 次の障害（まだ片付いていないもの） */
export function nextObstacle(r: Run): Obstacle | null {
  if (r.phase !== 'running') return r.obstacles[r.target]?.find((o) => o.state === 'wait') ?? null;
  const sec = r.target - 1;
  return r.obstacles[sec]?.find((o) => o.state === 'wait' && o.x + o.len > r.x - 1) ?? null;
}

export function treeNeed(r: Run): number {
  const base = r.mods.has('ram2') ? 20 : r.mods.has('ram') ? 32 : TREE_V;
  return hasCarp(r) ? Math.max(15, base - 10) : base;
}
const hasCarp = (r: Run) => r.pax.some((p) => p.kind === 'carp');
/** 急カーブを衝撃なしで曲がれる速さ */
export function curveV(r: Run): number {
  return r.mods.has('sand2') ? 30 : r.mods.has('sand') ? 25 : CURVE_V;
}
/** 工事区間を衝撃なしで通れる速さ */
export function workV(r: Run): number {
  return WORK_V + (hasCarp(r) ? 10 : 0);
}


/** 障害バーの短い条件（「40↑」「20↓」など） */
export function obsTag(r: Run, q: Obstacle): string {
  switch (q.kind) {
    case 'tree':
      return `${treeNeed(r)}↑`;
    case 'curve':
      return `${curveV(r)}↓`;
    case 'pole':
      return `連打${q.need}`;
    case 'wave':
      return 'すきに';
    case 'work':
      return `${workV(r)}↓`;
    case 'slope':
      return (q.dir ?? 1) > 0 ? '上り' : '下り';
    case 'flood':
      return `${FLOOD_V}↓`;
    default:
      return 'タップ';
  }
}
/** 障害の衝撃の見込み（この速さで入ったら） */
export function predictShock(r: Run, o: Obstacle, v = r.v): number {
  const s0 = predictShock0(r, o, v);
  // 排障器：倒木・鹿・工事区間の衝撃が半分
  return r.mods.has('plow') && (o.kind === 'tree' || o.kind === 'deer' || o.kind === 'work') ? Math.round(s0 / 2) : s0;
}
function predictShock0(r: Run, o: Obstacle, v = r.v): number {
  const k = kmh(v);
  // ジャンプで越える障害は衝撃なし（着地も衝撃なし）
  if (r.armed === 'jump' && o.kind !== 'curve' && o.kind !== 'slope') return 0;
  switch (o.kind) {
    case 'tree':
      // 突破できる速さなら「超過分」だけ響く。届かなければ正面衝突
      return k >= treeNeed(r) ? soften(r, (k - treeNeed(r)) * SHOCK.treeOver) : soften(r, k * SHOCK.tree);
    case 'curve': {
      const cv = curveV(r);
      return k > cv ? soften(r, (k - cv) * SHOCK.curveOver + (k > cv + 15 && !r.mods.has('tilt') ? SHOCK.curveBase : 0)) : 0;
    }
    case 'work': {
      if (k <= workV(r)) return 0;
      const full = soften(r, 15 + (k - workV(r)) * 1.2);
      return o.taps === 0 ? Math.round(full / 2) : full;
    }
    case 'slope':
      return 0;
    case 'flood':
      return k > FLOOD_V ? soften(r, 25 + (k - FLOOD_V) * 1.0) : 0;
    case 'deer':
      return o.taps > 0 ? soften(r, k * SHOCK.hit) : 0;
    case 'pole':
      return 0;
    case 'wave':
      return soften(r, SHOCK.waveBase + k * SHOCK.waveK);
  }
}

function applyShock(r: Run, value: number, label: string, boost = 1, launch = false) {
  if (value <= 0) return;
  r.stats.shocks++;
  r.stats.maxShock = Math.max(r.stats.maxShock, value);
  const flew: string[] = [];
  let safe = 0;
  // エアバッグは射出の急ブレーキでは開かない
  if (r.airbag && !launch) {
    r.airbag = false;
    r.shocks.push({ value, t: r.time, flew, safe: r.pax.length, label: label + '（エアバッグで全員無事）' });
    return;
  }
  const id = launch ? ++r.launchSeq : 0;
  if (id) r.launchLog[id] = { perfect: 0, tours: 0, decks: new Set(), done: new Set() };
  const decks: number[] = [];
  const net = launch && r.net;
  for (const p of [...r.pax]) {
    if (value > effTol(r, p, launch)) {
      flew.push(KINDS[p.kind].name);
      decks.push(r.spots[p.spot]?.deck ?? 0);
      r.pax = r.pax.filter((q) => q !== p);
      launchPax(r, p, boost, id);
      if (net) r.fliers[r.fliers.length - 1].net = true;
      r.stats.flew++;
    } else safe++;
  }
  r.shocks.push({ value, t: r.time, flew, safe, label });
  if (net && flew.length) {
    r.net = false;
    toast(r, '着地ネットを広げた！', 'good');
  }
  if (launch && flew.length) {
    if (decks.includes(2) && slingReady(r)) triggerCombo(r, 'sling');
    if (r.mods.has('rocket')) triggerCombo(r, 'retro');
    // 鉄壁：速い射出で屋根の客だけが2人以上飛び、車内の客は全員無事
    if (kmh(r.v) >= 50 && decks.length >= 2 && decks.every((d) => d === 2) && safe > 0) {
      r.money += decks.length;
      triggerCombo(r, 'wall', `+¢${decks.length}`);
    }
  }
}

export function setNotch(r: Run, n: number) {
  const prev = r.notch;
  r.notch = Math.max(0, Math.min(7, n));
  if (r.notch === 0 && prev !== 0 && r.v > 2 && r.phase === 'running') brakeLaunch(r, false);
}
/** 急ブレーキの衝撃（射出の強さ） */
export function brakeShock(r: Run, v = r.v): number {
  const k = kmh(v);
  const rocket = r.mods.has('rocket') ? 1.5 : 1;
  const hb = r.mods.has('hbrake2') ? 1.3 : r.mods.has('hbrake') ? 1.15 : 1;
  return soften(r, k * SHOCK.brake * rocket * hb);
}
/** 急ブレーキ射出：衝撃に耐えられない客が前へ飛ぶ。ボタンなら速度を落として走り続ける */
export function brakeLaunch(r: Run, button = true) {
  if (r.phase !== 'running' || r.v < 2 || r.launchCool > 0) return;
  r.launchCool = 0.6;
  const k = kmh(r.v);
  const rocket = r.mods.has('rocket');
  applyShock(r, brakeShock(r), `急ブレーキ射出（${Math.round(k)}km/h${rocket ? '・逆噴射' : ''}）`, rocket ? 1.5 : 1, true);
  r.stats.launches++;
  if (button) {
    r.v *= 0.45;
    r.notch = 4;
  }
}
function launchPax(r: Run, p: Pax, boost = 1, launch = 0, zAdd = 0) {
  const z = spotZ(r, p.spot) + zAdd;
  const car = r.spots[p.spot]?.car ?? 0;
  const deck = r.spots[p.spot]?.deck ?? 0;
  const f = flight(r.v, z, p.kind, launchBoost(r, p, boost));
  const x = spotWorldX(r, p.spot);
  (p as Pax & { car?: number }).car = car;
  r.fliers.push({ pax: p, t: r.time, x, z, vx: f.vx, vz: f.vz, tLand: f.t, landX: x + f.dist, judged: false, result: '', launch, deck });
}
/** 着地の判定 */
function judgeLanding(r: Run, f: Flier) {
  f.judged = true;
  const p = f.pax;
  const slack = chuteSlack(r) + (f.net ? 4 : 0);
  const at = POS.findIndex((pos, i) => i > 0 && f.landX >= pos + PLAT_LO - slack && f.landX <= pos + PLAT_HI + slack);
  const big = p.kind === 'old' || p.kind === 'kid' || p.kind === 'vip';
  const k = KINDS[p.kind];
  if (at >= 0 && at === p.dest) {
    const mat = r.mats[at];
    const perfect = Math.abs(f.landX - mat.x) <= perfectHalf(r);
    const car = (p as Pax & { car?: number }).car ?? 0;
    let fare = p.kind === 'vip' ? (perfect ? (r.lo === 'vipcar' ? 6 : 5) : 3) : fareOf(r, p, car);
    if (perfect) {
      f.result = 'perfect';
      r.perfectHere++;
      if (p.kind !== 'vip') fare *= 2;
      if (r.lo !== 'bigmat') fare += r.streak;
      if (p.kind === 'kid' && r.mods.has('kidlove')) fare *= 2;
      if (p.kind === 'tour' && f.deck === 2) fare += 1;
      if (f.deck === 2 && r.mods.has('view')) fare += 1;
      r.stats.perfect++;
      r.pops.push({ text: `PERFECT ¢${fare}${r.streak && r.lo !== 'bigmat' ? `（連続+${r.streak}）` : ''}`, x: f.landX, t: r.time, good: true });
    } else {
      f.result = 'good';
      if (p.kind === 'bride' && r.ahead > 0) fare = Math.ceil(fare / 2);
      if (p.kind === 'tour' && f.deck === 2) fare += 1;
      if (r.mods.has('view') && f.deck === 2) fare += 1;
      r.stats.good++;
      r.pops.push({ text: `GOOD ¢${fare}`, x: f.landX, t: r.time, good: true });
    }
    r.money += fare;
    r.stats.carried++;
    const log = f.launch ? r.launchLog[f.launch] : null;
    if (log) {
      if (perfect) log.perfect++;
      if (perfect && p.kind === 'tour') log.tours++;
      log.decks.add(f.deck);
      // 観光ツアー：一斉着地のかわりに +¢5（先に一斉着地が出ていれば差額）
      if (log.tours >= 3 && !log.done.has('tour')) {
        log.done.add('tour');
        const add = log.done.has('salvo') ? 2 : 5;
        log.done.add('salvo');
        r.money += add;
        triggerCombo(r, 'tour', `+¢${add}`);
      }
      if (log.perfect >= 3 && !log.done.has('salvo')) {
        log.done.add('salvo');
        r.money += 3;
        triggerCombo(r, 'salvo', '+¢3');
      }
      if (log.decks.has(1) && log.decks.has(2) && !log.done.has('upper')) {
        log.done.add('upper');
        r.money += 2;
        triggerCombo(r, 'upper', '+¢2');
      }
    }
    return;
  }
  if (at >= 0 && at !== p.dest) {
    f.result = 'lost';
    r.trust -= p.kind === 'vip' && r.lo === 'vipcar' ? 50 : 10;
    r.missHere++;
    r.pops.push({ text: `${LINE.stations[at].name}に着地…${LINE.stations[p.dest].name}行きなのに`, x: f.landX, t: r.time, good: false });
    return;
  }
  f.result = 'miss';
  r.trust -= p.kind === 'vip' && r.lo === 'vipcar' ? 50 : big ? 18 : 12;
  r.missHere++;
  r.pops.push({ text: `${k.name}が${LINE.scenery[Math.max(0, Math.min(LINE.sections.length - 1, POS.findIndex((pos) => pos > f.landX) - 1))] === 'coast' ? '海' : LINE.scenery.includes('tunnel') ? '線路わき' : '田んぼ'}にポチャン`, x: f.landX, t: r.time, good: false });
}
export function matWidth(r: Run): number {
  const w = r.mods.has('mat2') ? 9 : r.mods.has('mat') ? 7 : 5;
  return r.lo === 'bigmat' ? Math.min(16, w * 1.8) : w;
}
/** PERFECTになる、マットの中心からの距離（磁石で広がる。最大8m） */
export function perfectHalf(r: Run): number {
  return r.mods.has('magnet') ? Math.min(8, matWidth(r) / 2 + 2) : matWidth(r) / 2;
}

export function tapObstacle(r: Run, o: Obstacle) {
  if (o.state !== 'wait') return;
  if (o.kind === 'deer') {
    o.taps = 0;
    o.state = 'cleared';
    o.t = r.time;
  } else if (o.kind === 'work') {
    if (o.taps <= 0 || (r.phase === 'running' && o.x - r.x > WORK_REACH)) return;
    o.taps--;
    o.t = r.time;
    if (o.taps === 0) toast(r, '警笛！ 作業員が退避中…', 'good');
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
  if (id === 'nitro' || id === 'dia') return false;
  return id === 'jump' ? r.armed === 'jump' : id === 'saw' ? r.sawArmed : id === 'net' ? r.net : r.airbag;
}
/** その場で効くアイテム（構えない） */
export const INSTANT: ItemId[] = ['nitro', 'dia'];
/** 今使えるか（使えないならその理由） */
export function itemBlock(r: Run, id: ItemId): string {
  if (id === 'nitro') return r.phase !== 'running' ? '走っているときに使う' : r.air ? '空中では使えない' : '';
  if (id === 'dia') return diaGain(r) <= 0 ? '遅れていないときは使えない' : '';
  return '';
}
/** 臨時ダイヤで取り戻せる秒数（予定より早くはならない） */
export function diaGain(r: Run): number {
  const late = r.phase === 'running' ? r.ahead : r.clock - r.schedule[r.target];
  return Math.min(20, Math.max(0, late));
}
export function useItem(r: Run, id: ItemId) {
  if (r.phase !== 'running' && r.phase !== 'dwell') return;
  if (INSTANT.includes(id)) {
    if (r.items[id] <= 0) return;
    const why = itemBlock(r, id);
    if (why) {
      toast(r, why, 'bad');
      return;
    }
    r.items[id]--;
    if (id === 'nitro') {
      r.v += 20 / 3.6;
      toast(r, 'ニトロ点火！ +20km/h', 'good');
    } else {
      const g = diaGain(r);
      r.clock -= g;
      if (r.phase === 'running') r.ahead = scheduleDiff(r);
      else r.ahead -= g;
      r.delay = Math.max(0, r.ahead);
      toast(r, `臨時ダイヤ：遅れを${Math.round(g)}秒取り戻した`, 'good');
    }
    return;
  }
  if (isArmed(r, id)) {
    r.items[id]++;
    if (id === 'jump') r.armed = null;
    else if (id === 'saw') r.sawArmed = false;
    else if (id === 'net') r.net = false;
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
  } else if (id === 'net') {
    r.net = true;
    toast(r, '次の射出で着地ネットを広げる（もう一度押すと取り消し）', 'good');
  } else {
    r.airbag = true;
    toast(r, '次の衝撃でエアバッグ（もう一度押すと取り消し）', 'good');
  }
}
export const ITEM_NAME: Record<ItemId, string> = { jump: 'ジャンプ台', saw: 'チェーンソー', airbag: 'エアバッグ', nitro: 'ニトロ', net: '着地ネット', dia: '臨時ダイヤ' };

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
  // 乗った順に端から詰めて座る（屋根は最後）。席を決めるのはプレイヤー
  const sp = fillSpot(r);
  if (sp < 0) {
    toast(r, '立つ場所がない', 'bad');
    return;
  }
  c.spot = sp;
  r.pax.push(c);
  r.picked.add(id);
}

/** 端から詰める順：1階（車両ごとに前から）→ 2階 → 屋根 */
function fillSpot(r: Run): number {
  const order = r.spots
    .map((sp, j) => ({ sp, j }))
    .filter(({ j }) => !r.pax.some((p) => p.spot === j))
    .sort((a, b) => a.sp.deck - b.sp.deck || a.sp.car - b.sp.car || b.sp.x - a.sp.x);
  return order.length ? order[0].j : -1;
}
export function freeSpot(r: Run, prefer: SpotKind[]): number {
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
  if (r.phase !== 'dwell') return;
  if (r.target >= N_ST - 1) return;
  r.offer = null;
  r.candidates = [];
  r.picked.clear();
  r.phase = 'running';
  r.target++;
  r.notch = 5;
}

/** お店で買う。何枚でも（お金が続くかぎり） */
export function buyCard(r: Run, i: number): boolean {
  const o = r.offer?.[i];
  if (!o || o.sold || r.money < o.price) return false;
  r.money -= o.price;
  r.spent += o.price;
  o.sold = true;
  if (o.kind === 'item') r.items[o.id as ItemId]++;
  else applyMod(r, o.id as ModId);
  toast(r, `${o.name} を買った（−¢${o.price}）`, 'good');
  return true;
}
/** 並べ替えの値段：駅ごとに 1→2→3… */
export function rerollCost(r: Run): number {
  return 1 + r.rerolls;
}
/** 並べ替え（3枚とも引き直す） */
export function rerollShop(r: Run): boolean {
  const c = rerollCost(r);
  if (!r.offer || r.money < c) return false;
  r.money -= c;
  r.spent += c;
  r.rerolls++;
  r.offer = rollShop(r);
  return true;
}
/** 今お店に出られるか（前の改造を持っていて、まだ持っていない） */
export function modEligible(r: Run, o: Offer): boolean {
  if (o.kind !== 'mod') return true;
  const id = o.id as ModId;
  if (!REPEAT_MODS.includes(id) && r.mods.has(id)) return false;
  if (id === 'deck') return r.cars >= 2;
  if (o.req && !r.mods.has(o.req)) return false;
  // 効き目がないものは出さない
  if (id === 'rubber' && r.lo === 'rails') return false;
  if (id === 'magnet' && r.lo === 'bigmat' && r.mods.has('mat2')) return false;
  return true;
}
/** アイテムの値段：駅が進むほど高い（元の値段の2倍まで） */
export function itemPrice(r: Run, base: number): number {
  return Math.min(base * 2, base + Math.max(0, r.target - 1));
}
/** お店の3枚：アイテムと、今出られる改造から完全にランダム */
function rollShop(r: Run): ShopCard[] {
  const avail = OFFERS.filter((o) => modEligible(r, o));
  // 持ち込み改造の推し（まだ出られないものは、その系統のⅠを推す）
  const syn = new Set((LO_SYNERGY[r.lo] ?? []).map((id) => (treeNode(id) && !modEligible(r, treeNode(id)!) ? treeRoot(id) : id)));
  const weight = (o: Offer) => (o.kind === 'item' ? 1 : o.tier === 'Ⅰ' ? 1 : o.tier === '分岐' ? 1.2 : 1.5) * (syn.has(o.id) ? 2 : 1);
  const opts: Offer[] = [];
  for (let n = 0; n < 3; n++) {
    const left = avail.filter((o) => !opts.includes(o));
    if (!left.length) break;
    const wts = left.map(weight);
    let k = rnd() * wts.reduce((a, b) => a + b, 0);
    let pick = left[left.length - 1];
    for (let i = 0; i < left.length; i++) if ((k -= wts[i]) < 0) {
      pick = left[i];
      break;
    }
    opts.push(pick);
  }
  const cards = opts.map((o) => {
    // 増結は買うたびに高くなる。アイテムは駅が進むほど高い
    const price = o.id === 'car' ? o.price + 3 * (r.cars - r.startCars) : o.kind === 'item' ? itemPrice(r, o.price) : o.price;
    return { ...o, price, full: price, sold: false };
  });
  // セール：たまに1枚だけ −1
  if (rnd() < 0.3 && cards.length) {
    const c = cards[Math.floor(rnd() * cards.length)];
    c.price = Math.max(1, c.price - 1);
  }
  return cards;
}
/** 持ち帰れるコイン：クリアなら（稼いだ額÷8＋残金÷3）×ダイヤ評価×路線、打ち切りなら稼いだ額÷12 */
export function carryHome(r: Run): number {
  const earned = earnedOf(r);
  if (r.phase !== 'clear') return Math.floor(earned / 12);
  let left = r.money;
  if (r.lo === 'debt') {
    if (left < 12) return 0;
    left -= 12;
  }
  return Math.max(0, Math.floor((r.rank?.mult ?? 1) * LINE.carry * (earned / 8 + left / 3)));
}
/** このランで稼いだコイン（使った分も含む） */
export function earnedOf(r: Run): number {
  return Math.max(0, r.money + r.spent - r.startMoney);
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
  stationDone(r, diff);

  // 降車
  let earned = 0;
  for (const p of [...r.pax]) {
    if (p.dest !== st) continue;
    let fare = fareOf(r, p, r.spots[p.spot]?.car ?? 0);
    if (p.kind === 'sal' && r.delay > 30) fare = Math.ceil(fare / 2);
    if (p.kind === 'bride' && diff > 0) fare = Math.ceil(fare / 2);
    if (p.kind === 'tour' && r.spots[p.spot]?.deck === 2) fare += 1;
    if (r.mods.has('view') && r.spots[p.spot]?.deck === 2) fare += 1;
    if (p.kind === 'old') r.trust = Math.min(100, r.trust + 5);
    earned += fare;
    r.stats.carried++;
    r.pax = r.pax.filter((q) => q !== p);
  }
  r.money += earned;
  if (earned) toast(r, `運賃 +¢${earned}`, 'good');
  if (st >= N_ST - 1) {
    r.phase = 'clear';
    r.rank = rankOf(diff);
    markCleared(r);
    return;
  }
  r.candidates = genCandidates(r, st);
  r.rerolls = 0;
  r.offer = rollShop(r);
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
  r.launchCool = Math.max(0, r.launchCool - dt);
  for (const f of r.fliers) if (!f.judged && r.time - f.t >= f.tLand) judgeLanding(r, f);
  r.fliers = r.fliers.filter((f) => r.time - f.t < f.tLand + 1.4);
  r.pops = r.pops.filter((p) => r.time - p.t < 2.6);
  r.cutins = r.cutins.filter((c) => r.time - c.t < 2);
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
  // 工事区間：最後の警笛から少しで作業員が退く
  for (const o of r.obstacles[r.target - 1] ?? []) {
    if (o.kind === 'work' && o.state === 'wait' && o.taps === 0 && r.time - o.t >= WORK_EVAC) {
      o.state = 'cleared';
      o.t = r.time;
      toast(r, '作業員が退避した！', 'good');
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
  if (r.lo === 'rocketd' && r.notch >= 1 && r.notch <= 3) a *= 0.7;
  if (a > 0) a *= (r.mods.has('motor') ? 1.15 : 1) * (r.mods.has('rocket') ? 1.8 : 1) * Math.pow(0.92, r.cars - 1) * Math.max(0.08, 1 - r.v / vmaxOf(r));
  a -= 0.05;
  // 空中ではモーターもブレーキも半分だけ効く（着地点の微調整）
  if (r.air) a *= 0.5;
  const obs = r.obstacles[sec] ?? [];
  // 坂：上りは鈍り、下りは勝手に速くなる
  if (!r.air) for (const o of obs) if (o.kind === 'slope' && r.x >= o.x && r.x < o.x + o.len) a += (o.dir ?? 1) > 0 ? -1.0 : 0.8;
  // 電柱に止められる
  for (const o of obs) {
    if (o.state !== 'wait' || o.kind !== 'pole' || r.air) continue;
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
  const ramp = rampX(r);
  r.x += r.v * dt;
  // 踏み切り
  if (ramp != null && r.x >= ramp && r.v > 1) {
    r.armed = null;
    r.air = true;
    r.z = 0.01;
    r.vz = jumpVz(r.v);
    r.cannonArm = r.mods.has('roof');
    toast(r, `ジャンプ！（${Math.round(kmh(r.v))}km/h）`, 'good');
  }
  // 空中
  if (r.air) {
    const vz0 = r.vz;
    r.vz -= 9.8 * dt;
    r.z += r.vz * dt;
    // 頂点：人間大砲
    if (vz0 > 0 && r.vz <= 0 && r.cannonArm) {
      r.cannonArm = false;
      const toSt = POS[st] - r.x;
      const roofers = r.pax.filter((p) => r.spots[p.spot]?.deck === 2 && p.dest === st);
      if (toSt > 0 && toSt < 160 && roofers.length) {
        const id = ++r.launchSeq;
        r.launchLog[id] = { perfect: 0, tours: 0, decks: new Set(), done: new Set() };
        for (const p of roofers) {
          r.pax = r.pax.filter((q) => q !== p);
          launchPax(r, p, 1.2, id);
        }
        triggerCombo(r, 'cannon');
      }
    }
    if (r.z <= 0) {
      r.z = 0;
      r.vz = 0;
      r.air = false;
      r.cannonArm = false;
      toast(r, '着地！', 'good');
    }
  }
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
    // 空中なら下をくぐり抜ける
    if (r.air) {
      if (x0 < o.x + o.len && r.x >= o.x) {
        o.state = 'passed';
        o.t = r.time;
        toast(r, `${OBS_INFO[o.kind].name}を飛び越えた！`, 'good');
      }
      continue;
    }
    if (o.kind === 'slope') {
      if (x0 < o.x + o.len && r.x >= o.x + o.len) {
        o.state = 'passed';
        o.t = r.time;
      }
      continue;
    }
    if (o.kind === 'flood') {
      if (r.x >= o.x && x0 < o.x + o.len && kmh(r.v) > FLOOD_V + 0.5) {
        const k = kmh(r.v);
        o.state = 'hit';
        o.t = r.time;
        o.shock = predictShock(r, o);
        applyShock(r, o.shock, `浸水区間に${Math.round(k)}km/hで突っ込んだ！`);
        r.v *= 0.35;
        if (k > 45) {
          r.v = 0;
          r.stuck = 4;
          toast(r, 'モーターが水をかぶった！ 4秒停止', 'bad');
        }
      } else if (x0 < o.x + o.len && r.x >= o.x + o.len) {
        o.state = 'passed';
        o.t = r.time;
        toast(r, '浸水区間をそろそろと通過', 'good');
      }
      continue;
    }
    if (o.kind === 'work') {
      if (x0 < o.x && r.x >= o.x) {
        const k = kmh(r.v);
        o.shock = predictShock(r, o);
        o.state = o.shock > 0 ? 'hit' : 'passed';
        o.t = r.time;
        if (o.shock > 0) {
          applyShock(r, o.shock, `工事区間を${Math.round(k)}km/hで通過`);
          r.v *= 0.5;
          r.trust -= 8;
          toast(r, '作業員に怒られた（信頼−8）', 'bad');
        } else toast(r, '工事区間を徐行で通過', 'good');
      }
      continue;
    }
    if (o.kind === 'curve') {
      const cv = curveV(r);
      if (x0 < o.x && r.x >= o.x && kmh(r.v) > cv + 0.5 && r.armed !== 'jump') {
        const k = kmh(r.v);
        o.shock = predictShock(r, o);
        if (k > cv + 15 && r.mods.has('tilt')) {
          // 振り子台車：車体を傾けて脱輪しない
          applyShock(r, o.shock, `振り子台車で急カーブを${Math.round(k)}km/hで曲がり切った`);
          r.v *= 0.85;
        } else if (k > cv + 15) {
          o.state = 'hit';
          o.t = r.time;
          applyShock(r, o.shock, `急カーブを${Math.round(k)}km/hで曲がって脱輪`);
          r.v = 0;
          r.stuck = 5;
          toast(r, '脱輪！ 復旧に5秒', 'bad');
        } else {
          applyShock(r, o.shock, `急カーブを${Math.round(k)}km/hで攻めた`);
        }
      } else if (x0 < o.x + o.len && r.x >= o.x + o.len) {
        o.state = 'passed';
        o.t = r.time;
        toast(r, '急カーブを安全に通過', 'good');
      }
      continue;
    }
    if (o.kind === 'wave') {
      if (r.x >= o.x && x0 < o.x + o.len && waveUp(r.time)) {
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
      continue;
    }
    if (x0 < o.x && r.x >= o.x) {
      if (o.kind === 'tree') {
        o.shock = predictShock(r, o);
        o.state = 'hit';
        o.t = r.time;
        if (kmh(r.v) >= treeNeed(r)) {
          const k = kmh(r.v);
          const bumper = r.mods.has('ram') && r.pax.some((p) => p.kind === 'sumo');
          // ボーナスは40km/hを基準に（衝角で突破の速さが下がっても膨らまない）
          const bonus = Math.floor(Math.max(0, k - Math.max(40, treeNeed(r))) / 10) * (bumper ? 2 : 1);
          const tn = OBS_INFO.tree.name;
          if (bumper) {
            o.shock = 0;
            triggerCombo(r, 'bumper', bonus > 0 ? `+¢${bonus}` : '');
          }
          applyShock(r, o.shock, `${tn}を${Math.round(k)}km/hで粉砕！${bonus > 0 ? ` +¢${bonus}` : ''}`);
          r.money += bonus;
          r.v *= k >= 60 ? 0.95 : 0.82;
        } else {
          applyShock(r, o.shock, `${OBS_INFO.tree.name}に止められた`);
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
    } else toast(r, `${LINE.stations[st].name}を射出で通過！`, 'good');
    if (r.lo === 'bullet' && st < N_ST - 1) {
      r.money += 2;
      toast(r, '弾丸特急ボーナス +¢2', 'good');
    }
    const diff = r.clock - r.schedule[st];
    r.arrivals[st] = r.clock;
    stationDone(r, diff);
    if (st >= N_ST - 1) {
      if (r.pax.length === 0) {
        r.phase = 'clear';
        r.ahead = diff;
        r.delay = Math.max(0, diff);
        r.rank = rankOf(diff);
        markCleared(r);
      } else {
        r.phase = 'over';
        r.overReason = '終点を通り過ぎた（客が残っている）';
      }
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
    launchPax(r, p);
    r.fliers[r.fliers.length - 1].judged = true; // 降ろしただけ（判定しない）
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

/** 屋根席の追加分（車両ごと） */
const roofExtra = (r: Run) => (r.mods.has('roof2') ? 3 : r.mods.has('roof') ? 1 : 0);
/** 車両 c の屋根の席を n 個目まで（足りない分だけ足す） */
function fillRoof(r: Run, c: number, n: number) {
  if (r.lo === 'cargo' && c === 1) return;
  const have = r.spots.filter((sp) => sp.car === c && sp.deck === 2).length;
  r.spots.push(...roofSpots(c).slice(have, n));
}
function applyMod(r: Run, id: ModId) {
  r.mods.add(id);
  if (id === 'car') {
    const c = r.cars;
    r.cars++;
    r.spots.push(...lowerSpots(r.meta, c));
    if (r.decks > 1 && !(r.lo === 'cargo' && c === 1)) r.spots.push(...upperSpots(c));
    // 屋根席を取ったあとにつないだ車両にも屋根席を
    fillRoof(r, c, roofExtra(r));
    r.cap += 5;
  } else if (id === 'deck') {
    r.decks = 2;
    for (let c = 0; c < r.cars; c++) if (!(r.lo === 'cargo' && c === 1)) r.spots.push(...upperSpots(c));
    r.cap += r.cars * 6;
  } else if (id === 'roof' || id === 'roof2') {
    r.roof = true;
    const before = r.spots.filter((sp) => sp.deck === 2).length;
    fillRoof(r, 0, 2 + roofExtra(r));
    for (let c = 1; c < r.cars; c++) fillRoof(r, c, roofExtra(r));
    r.cap += Math.max(0, r.spots.filter((sp) => sp.deck === 2).length - before) > 0 ? (id === 'roof' ? 1 : 2) : 0;
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

/** 路線をクリアした記録（次の路線の解放に使う） */
function markCleared(r: Run) {
  if (r.tutorial || r.demo) return;
  r.meta.cleared = r.meta.cleared ?? [];
  if (!r.meta.cleared.includes(LINE.id)) r.meta.cleared.push(LINE.id);
}
function rankOf(diff: number) {
  return diff <= 0 ? { name: '定時運行', mult: 1.2 } : diff <= 20 ? { name: 'ほぼ定時', mult: 1.1 } : diff <= 60 ? { name: '遅れあり', mult: 1.0 } : { name: '大遅延', mult: 0.8 };
}
/** 駅を1つ終えたとき：連続着地と早着の精算 */
function stationDone(r: Run, diff: number) {
  if (r.perfectHere > 0 && r.missHere === 0) {
    r.streak++;
    r.stats.bestStreak = Math.max(r.stats.bestStreak, r.streak);
    if (r.streak >= 2) toast(r, r.lo === 'bigmat' ? `連続着地 ${r.streak}駅！` : `連続着地 ${r.streak}駅！ 次のPERFECTは +¢${r.streak}`, 'good');
  } else if (r.missHere > 0) {
    if (r.streak > 0) toast(r, '連続着地が途切れた', 'bad');
    r.streak = 0;
  }
  r.perfectHere = 0;
  r.missHere = 0;
  if (diff < 0) {
    let bonus = Math.floor(-diff / LINE.earlyPer);
    // 花嫁が乗っていると早着ボーナス×2（上乗せは1駅¢3まで）
    if (bonus > 0 && r.pax.some((p) => p.kind === 'bride')) bonus += Math.min(3, bonus);
    r.money += bonus;
    r.earlyBonus += bonus;
    r.stats.early++;
    if (bonus > 0) toast(r, `早着 ${Math.round(-diff)}秒 +¢${bonus}`, 'good');
  }
}

/** おまかせ配置：次で降りる客は屋根へ、それ以外は耐衝撃の低い順に座席・つり革へ */
export function autoArrange(r: Run) {
  const next = r.phase === 'dwell' ? r.target + 1 : r.target;
  const free = new Set(r.spots.map((_, i) => i));
  const order = [...r.pax].sort((a, b) => (a.dest === next ? 0 : 1) - (b.dest === next ? 0 : 1) || KINDS[a.kind].tol - KINDS[b.kind].tol);
  for (const p of r.pax) p.spot = -1;
  const take = (pred: (sp: Spot) => boolean) => {
    const i = [...free].find((j) => pred(r.spots[j]));
    if (i == null) return -1;
    free.delete(i);
    return i;
  };
  for (const p of order) {
    let i = -1;
    if (p.dest === next && p.kind !== 'sumo') i = take((sp) => sp.deck === 2);
    if (i < 0) i = take((sp) => sp.kind === 'seat' && sp.deck === 0);
    if (i < 0) i = take((sp) => sp.kind === 'strap');
    if (i < 0) i = take((sp) => sp.deck !== 2);
    if (i < 0) i = take(() => true);
    p.spot = i;
  }
}
