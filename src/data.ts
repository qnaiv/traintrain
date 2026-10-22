// 路線データ。ホーム長・需要・駅間距離はゲーム用の仮の値。

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
};

export const CAR_LEN = 20; // 1両の長さ [m]
