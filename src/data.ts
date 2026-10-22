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
  stations: [
    { name: '藤沢', platformCars: 4, demand: 14 },
    { name: '石上', platformCars: 4, demand: 6 },
    { name: '柳小路', platformCars: 4, demand: 6 },
    { name: '鵠沼', platformCars: 4, demand: 8 },
    { name: '湘南海岸公園', platformCars: 4, demand: 8 },
    { name: '江ノ島', platformCars: 4, demand: 18 },
    { name: '腰越', platformCars: 2, demand: 8 },
    { name: '鎌倉高校前', platformCars: 4, demand: 14 },
    { name: '七里ヶ浜', platformCars: 4, demand: 10 },
    { name: '稲村ヶ崎', platformCars: 4, demand: 10 },
    { name: '極楽寺', platformCars: 4, demand: 8 },
    { name: '長谷', platformCars: 4, demand: 18 },
    { name: '由比ヶ浜', platformCars: 4, demand: 8 },
    { name: '和田塚', platformCars: 4, demand: 6 },
    { name: '鎌倉', platformCars: 4, demand: 0 },
  ],
  sections: [600, 450, 400, 500, 550, 650, 500, 450, 600, 700, 450, 400, 350, 450],
};

export const CAR_LEN = 20; // 1両の長さ [m]
