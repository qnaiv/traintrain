// ボットに江ノ電を走らせてバランスを確かめる。
// node --experimental-strip-types scripts/sim.ts

import { ENODEN } from '../src/data.ts';
import {
  alightCount,
  canDepart,
  capacity,
  carsOnPlatform,
  isFree,
  movePassenger,
  chooseOffer,
  depart,
  isTerminal,
  load,
  newGame,
  setBrake,
  toggleDoors,
  update,
  weightFactor,
  type Game,
} from '../src/game.ts';

type Policy = 'skilled' | 'sloppy' | 'nobrake';

function brakeDistance(g: Game): number {
  // ブレーキを満たすまでの立ち上がりも含めたざっくりの制動距離
  const decel = (0.15 + 1.8) * g.stats.brakeMul / weightFactor(g);
  return (g.v * g.v) / (2 * decel) + g.v * 0.55;
}

/** 走行中の車内整理：次で降りる客をホームに収まる車両へ寄せる */
function organize(g: Game): void {
  const on = carsOnPlatform(g);
  for (const p of g.passengers) {
    if (p.dest !== g.target || p.car < on) continue;
    outer: for (let c = 0; c < on; c++) {
      for (let i = 0; i < g.layout.length; i++) {
        if (isFree(g, c, i)) {
          movePassenger(g, p.id, c, i);
          break outer;
        }
      }
    }
  }
}

function run(seed: number, policy: Policy, pick: (g: Game) => number, tidy = false) {
  const g = newGame(ENODEN, seed);
  const dt = 1 / 60;
  let steps = 0;
  while (g.phase !== 'clear' && g.phase !== 'over' && steps < 60 * 60 * 40) {
    steps++;
    if (g.phase === 'running') {
      if (g.offer) chooseOffer(g, pick(g));
      if (tidy) organize(g);
      const remain = g.pos[g.target] - g.x;
      const margin = policy === 'sloppy' ? (g.rand() - 0.5) * 30 : 0;
      setBrake(g, policy !== 'nobrake' && remain <= brakeDistance(g) + margin);
    } else if (g.phase === 'dwell') {
      const done = alightCount(g) === 0 && (g.waiting === 0 || load(g) >= capacity(g));
      const late = g.time >= g.dep[g.target];
      if (isTerminal(g)) {
        if (!g.doorsWant) toggleDoors(g);
      } else if (!g.doorsWant && g.doorAnim === 0) {
        // 発車時刻を過ぎたら、乗り切れていなくても発車する（積み残しを受け入れる）
        if (late && canDepart(g)) depart(g);
        else if (!done && !g.doorsWant) toggleDoors(g);
      } else if (g.doorsWant && (done || late)) {
        if (!isTerminal(g)) toggleDoors(g);
      }
    }
    update(g, dt);
  }
  return g;
}

const picks: Record<string, (g: Game) => number> = {
  first: () => 0,
  doors: (g) => Math.max(0, g.offer!.findIndex((u) => u.id === 'door' || u.id === 'capacity')),
  couple: (g) => Math.max(0, g.offer!.findIndex((u) => u.id === 'couple')),
};

for (const policy of ['skilled', 'sloppy'] as Policy[]) {
  for (const [pname, pick] of Object.entries(picks)) {
    const results: string[] = [];
    for (let seed = 1; seed <= 3; seed++) {
      for (const tidy of [false, true]) {
      const g = run(seed, policy, pick, tidy);
      results.push(
        (tidy ? '[整理] ' : '[放置] ') +
        `${g.phase === 'clear' ? 'CLEAR' : 'OVER '} 駅${g.target + 1} 信頼${Math.round(g.trust)} 遅れ${Math.round(g.delay)}s ` +
          `運んだ${g.carried} 積残${g.leftBehind} 乗過${g.missed} ぴったり${g.perfect} ${g.stats.cars}両/ドア${g.stats.doorsPerCar} ${g.overReason}`,
      );
      }
    }
    console.log(`== ${policy} / ${pname}`);
    for (const r of results) console.log('  ' + r);
  }
}
