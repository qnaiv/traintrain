// 路線データ。ホーム長・需要・駅間距離はゲーム用の仮の値。

/** 駅間の景色の種類 */
export type Scenery = 'town' | 'street' | 'coast' | 'tunnel';

export interface StationDef {
  name: string;
  /** ホームに収まる両数（これを超えた車両はドアカット） */
  platformCars: number;
  /** 待ち客の基本数 */
  demand: number;
}

export interface LineDef {
  id: string;
  name: string;
  stations: StationDef[];
  /** 駅間距離 [m]。stations.length - 1 個 */
  sections: number[];
  /** 駅間の景色。stations.length - 1 個 */
  scenery: Scenery[];
}

export const ENODEN: LineDef = {
  id: 'enoden',
  name: '江ノ島電鉄',
  // 実際は15駅。テンポ優先で7駅に間引いている
  stations: [
    { name: '藤沢', platformCars: 4, demand: 14 },
    { name: '鵠沼', platformCars: 4, demand: 10 },
    { name: '江ノ島', platformCars: 4, demand: 18 },
    { name: '腰越', platformCars: 2, demand: 10 },
    { name: '鎌倉高校前', platformCars: 4, demand: 16 },
    { name: '長谷', platformCars: 4, demand: 20 },
    { name: '鎌倉', platformCars: 4, demand: 0 },
  ],
  sections: [650, 600, 450, 550, 750, 600],
  scenery: ['town', 'town', 'street', 'coast', 'coast', 'town'],
};

/** 1両の長さ [m]（江ノ電サイズ） */
export const CAR_LEN = 12;
/** 車体の幅 [m] */
export const CAR_W = 2.6;

/** 降りる駅ごとの色（車内で見分けるため） */
export const DEST_COLORS = ['#B9B0A2', '#8299E0', '#5BB8C9', '#E9B23E', '#6FC3A0', '#B98ADB', '#F08E78'];
