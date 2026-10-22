// 強化（魔改造）。どれも上限なしで重ねがけできる。

export interface Stats {
  cars: number;
  doorsPerCar: number;
  capPerCar: number;
  doorTimeMul: number;
  brakeMul: number;
  speedMul: number;
  /** 発車ごとに回復する信頼 */
  cooler: number;
  /** 詰め込み運用のレベル（毎駅信頼が減る） */
  pack: number;
  /** 定位置停止装置の補正幅 [m] */
  snap: number;
  levels: Record<string, number>;
}

export function defaultStats(): Stats {
  return {
    cars: 2,
    doorsPerCar: 2,
    capPerCar: 30,
    doorTimeMul: 1,
    brakeMul: 1,
    speedMul: 1,
    cooler: 0,
    pack: 0,
    snap: 0,
    levels: {},
  };
}

export type Rarity = 'common' | 'rare' | 'risk';

export interface UpgradeDef {
  id: string;
  name: (s: Stats) => string;
  desc: (s: Stats) => string;
  rarity: Rarity;
  weight: number;
  apply: (s: Stats) => void;
}

export const UPGRADES: UpgradeDef[] = [
  {
    id: 'couple',
    name: (s) => (s.cars >= 10 ? 'さらに連結' : '連結'),
    desc: (s) => `客車を1両つなぐ（いま${s.cars}両）。定員が増えるが、重く長くなる`,
    rarity: 'common',
    weight: 10,
    apply: (s) => {
      s.cars += 1;
    },
  },
  {
    id: 'door',
    name: (s) => (s.doorsPerCar >= 6 ? 'ドアをもっと増やす' : 'ドア増設'),
    desc: (s) => `1両あたりのドア +1（いま${s.doorsPerCar}枚）。乗降が速くなるが、座席が減る`,
    rarity: 'common',
    weight: 10,
    apply: (s) => {
      s.doorsPerCar += 1;
      s.capPerCar = Math.max(10, s.capPerCar - 2);
    },
  },
  {
    id: 'doorspeed',
    name: () => 'ドア開閉の高速化',
    desc: () => 'ドアの開け閉めにかかる時間 −30%',
    rarity: 'common',
    weight: 7,
    apply: (s) => {
      s.doorTimeMul *= 0.7;
    },
  },
  {
    id: 'brake',
    name: () => '新型ブレーキ',
    desc: () => 'ブレーキの効き +25%',
    rarity: 'common',
    weight: 7,
    apply: (s) => {
      s.brakeMul *= 1.25;
    },
  },
  {
    id: 'motor',
    name: () => '高出力モーター',
    desc: () => '最高速度と加速 +12%。遅れを取り戻しやすい',
    rarity: 'common',
    weight: 6,
    apply: (s) => {
      s.speedMul *= 1.12;
    },
  },
  {
    id: 'cooler',
    name: () => '冷房強化',
    desc: (s) => `発車するたびに信頼 +2（いま +${s.cooler}）`,
    rarity: 'common',
    weight: 5,
    apply: (s) => {
      s.cooler += 2;
    },
  },
  {
    id: 'capacity',
    name: () => '二階建て化',
    desc: (s) => `1両あたりの定員 +10（いま${s.capPerCar}人）`,
    rarity: 'common',
    weight: 6,
    apply: (s) => {
      s.capPerCar += 10;
    },
  },
  {
    id: 'snap',
    name: () => '定位置停止装置',
    desc: (s) => `止まった位置が停止位置から ±${s.snap + 3}m 以内なら自動で寄せる`,
    rarity: 'rare',
    weight: 2,
    apply: (s) => {
      s.snap += 3;
    },
  },
  {
    id: 'pack',
    name: () => '詰め込み運用',
    desc: () => '定員 ×1.5。そのかわり毎駅、信頼 −2',
    rarity: 'risk',
    weight: 3,
    apply: (s) => {
      s.capPerCar = Math.round(s.capPerCar * 1.5);
      s.pack += 2;
    },
  },
];

export function rollOffer(rand: () => number, n = 3): UpgradeDef[] {
  const pool = [...UPGRADES];
  const out: UpgradeDef[] = [];
  while (out.length < n && pool.length > 0) {
    const total = pool.reduce((a, u) => a + u.weight, 0);
    let r = rand() * total;
    let idx = 0;
    for (; idx < pool.length; idx++) {
      r -= pool[idx].weight;
      if (r <= 0) break;
    }
    idx = Math.min(idx, pool.length - 1);
    out.push(pool[idx]);
    pool.splice(idx, 1);
  }
  return out;
}
