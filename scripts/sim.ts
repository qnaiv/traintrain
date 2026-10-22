// ボットに江ノ電を走らせてバランスを確かめる。
// node --experimental-strip-types scripts/sim.ts

import { ENODEN } from '../src/data.ts';
import {
  canDepart,
  capacity,
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

function run(seed: number, policy: Policy, pick: (g: Game) => number) {
  const g = newGame(ENODEN, seed);
  const dt = 1 / 60;
  let steps = 0;
  while (g.phase !== 'clear' && g.phase !== 'over' && steps < 60 * 60 * 40) {
    steps++;
    if (g.phase === 'running') {
      if (g.offer) chooseOffer(g, pick(g));
      const remain = g.pos[g.target] - g.x;
      const margin = policy === 'sloppy' ? (g.rand() - 0.5) * 30 : 0;
      setBrake(g, policy !== 'nobrake' && remain <= brakeDistance(g) + margin);
    } else if (g.phase === 'dwell') {
      const done = g.onboard[g.target] === 0 && (g.waiting === 0 || load(g) >= capacity(g));
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
};

for (const policy of ['skilled', 'sloppy', 'nobrake'] as Policy[]) {
  for (const [pname, pick] of Object.entries(picks)) {
    const results: string[] = [];
    for (let seed = 1; seed <= 5; seed++) {
      const g = run(seed, policy, pick);
      results.push(
        `${g.phase === 'clear' ? 'CLEAR' : 'OVER '} 駅${g.target + 1} 信頼${Math.round(g.trust)} 遅れ${Math.round(g.delay)}s ` +
          `運んだ${g.carried} 積残${g.leftBehind} ぴったり${g.perfect} ${g.stats.cars}両/ドア${g.stats.doorsPerCar} ${g.overReason}`,
      );
    }
    console.log(`== ${policy} / ${pname}`);
    for (const r of results) console.log('  ' + r);
  }
}
