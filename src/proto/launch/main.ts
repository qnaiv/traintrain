// 試作：射出配達。急ブレーキの慣性で屋根の客を飛ばし、ホームの着地マットに落とす。

import type { LineDef } from '../../data.ts';
import { DEST_COLORS } from '../../data.ts';
import { drawExterior } from '../../exterior.ts';
import { randomLook, type Game, type Look } from '../../game.ts';
import { INK, Iso } from '../../iso.ts';
import { drawPerson, type Facing } from '../../people.ts';
import { isMuted, setIntensity, setScene, sfx, toggleMute, unlock } from '../run/audio.ts';

// ---------- 路線 ----------
const LINE: LineDef = {
  id: 'launch',
  name: '江ノ島電鉄',
  stations: [
    { name: '藤沢', platformCars: 2, demand: 0 },
    { name: '鵠沼', platformCars: 2, demand: 0 },
    { name: '江ノ島', platformCars: 2, demand: 0 },
    { name: '腰越', platformCars: 2, demand: 0 },
    { name: '鎌倉高校前', platformCars: 2, demand: 0 },
    { name: '長谷', platformCars: 2, demand: 0 },
  ],
  sections: [320, 360, 300, 380, 340],
  scenery: ['town', 'town', 'street', 'coast', 'coast'],
};
const POS: number[] = [0];
for (const d of LINE.sections) POS.push(POS[POS.length - 1] + d);
const N = LINE.stations.length;
const PLAT_LO = -24.5; // ホーム（停止目標からの範囲）
const PLAT_HI = 4;
const STOP_LO = -14;
const STOP_HI = 4;
const ROOF_Z = 4.1;
const G = 9.8;
const PLAN_V = 11;

// ---------- 客 ----------
type Kind = 'old' | 'kid' | 'sal' | 'stu' | 'sumo';
const KINDS: Record<Kind, { name: string; ch: string; tol: number; w: number; color: string }> = {
  old: { name: 'お年寄り', ch: '老', tol: 10, w: 1.0, color: '#B9B0A2' },
  kid: { name: '子ども', ch: '子', tol: 15, w: 1.25, color: '#E9B23E' },
  sal: { name: '会社員', ch: '会', tol: 30, w: 1.0, color: '#FFFDF6' },
  stu: { name: '学生', ch: '学', tol: 45, w: 1.05, color: '#8299E0' },
  sumo: { name: '力士', ch: '力', tol: 90, w: 0.65, color: '#F0C9A0' },
};
interface Pax {
  id: number;
  kind: Kind;
  look: Look;
  dest: number;
  roof: boolean;
  slot: number; // 屋根・座席の何番目か
}
interface Flier {
  p: Pax;
  t0: number;
  x0: number;
  vx: number;
  vz: number;
  landX: number;
  tLand: number;
  judged: boolean;
  result: '' | 'perfect' | 'good' | 'miss' | 'lost';
}
interface Popup {
  text: string;
  x: number;
  t: number;
  color: string;
}

const ROOF_SLOTS = [2.6, 4.6, 6.6, 8.6];

// ---------- 状態 ----------
const NOTCH_A = [-3.4, -2.2, -1.4, -0.7, 0, 0.7, 1.1, 1.5];
const NOTCH_NAME = ['非常', 'B3', 'B2', 'B1', 'N', 'P1', 'P2', 'P3'];
const S = {
  time: 0,
  x: -4,
  v: 0,
  notch: 4,
  target: 1,
  phase: 'run' as 'run' | 'stop' | 'end',
  stopT: 0,
  pax: [] as Pax[],
  fliers: [] as Flier[],
  popups: [] as Popup[],
  mats: [] as { x: number; w: number }[],
  fare: 0,
  trust: 100,
  perfect: 0,
  good: 0,
  miss: 0,
  launches: 0,
  delay: 0,
  cool: 0,
  nextId: 1,
};

function rnd(a: number, b: number) {
  return a + Math.random() * (b - a);
}

function reset() {
  S.time = 0;
  S.x = -4;
  S.v = 0;
  S.notch = 5;
  S.target = 1;
  S.phase = 'run';
  S.pax = [];
  S.fliers = [];
  S.popups = [];
  S.fare = S.perfect = S.good = S.miss = S.launches = 0;
  S.trust = 100;
  S.delay = 0;
  S.mats = POS.map((p, i) => (i === 0 ? { x: 0, w: 0 } : { x: p + rnd(PLAT_LO + 5, PLAT_HI - 3), w: 5 }));
  // 各駅で降りる客：2人ずつ（最初の2駅ぶんを屋根に）
  const kinds: Kind[] = ['old', 'kid', 'sal', 'stu', 'sumo'];
  for (let st = 1; st < N; st++) {
    for (let k = 0; k < 2; k++) {
      S.pax.push({ id: S.nextId++, kind: kinds[Math.floor(Math.random() * kinds.length)], look: randomLook(Math.random), dest: st, roof: false, slot: -1 });
    }
  }
  autoSeat();
  $('result').hidden = true;
  renderList(true);
}

/** 次の駅の客を屋根に、残りは座席に（最初の並べ方） */
function autoSeat() {
  let r = 0;
  let s = 0;
  for (const p of S.pax.sort((a, b) => a.dest - b.dest)) {
    if (p.dest === S.target && r < ROOF_SLOTS.length) {
      p.roof = true;
      p.slot = r++;
    } else {
      p.roof = false;
      p.slot = s++;
    }
  }
}

const kmh = (v: number) => v * 3.6;
const effTol = (p: Pax) => KINDS[p.kind].tol + (p.roof ? -20 : 20);
const shockOf = (v: number) => Math.round(kmh(v) * 0.5);

/** 飛び方（速度 v のとき） */
function flight(v: number, w: number) {
  const vz = 3 + v * 0.12;
  const t = (vz + Math.sqrt(vz * vz + 2 * G * ROOF_Z)) / G;
  return { vx: v * w, vz, t, dist: v * w * t };
}

function toggleRoof(id: number) {
  const p = S.pax.find((q) => q.id === id);
  if (!p) return;
  if (!p.roof) {
    const used = S.pax.filter((q) => q.roof).map((q) => q.slot);
    const free = ROOF_SLOTS.findIndex((_, i) => !used.includes(i));
    if (free < 0) {
      popup('屋根がいっぱい', S.x, '#B53E28');
      sfx.bad();
      return;
    }
    p.roof = true;
    p.slot = free;
  } else {
    const used = S.pax.filter((q) => !q.roof).map((q) => q.slot);
    let free = 0;
    while (used.includes(free)) free++;
    p.roof = false;
    p.slot = free;
  }
  sfx.drop();
  renderList(true);
}

function popup(text: string, x: number, color: string) {
  // 重ならないよう、同じころに出たものは少しずつ上へ
  const near = S.popups.filter((p) => S.time - p.t < 0.8).length;
  S.popups.push({ text, x, t: S.time - near * 0.25, color });
}

/** 急ブレーキ射出：その瞬間の衝撃で、耐えられない客が前へ飛ぶ */
function launch() {
  if (S.phase !== 'run' || S.v < 2 || S.cool > 0) return;
  S.cool = 0.6;
  const shock = shockOf(S.v);
  const flew: Pax[] = S.pax.filter((p) => shock > effTol(p));
  S.launches++;
  for (const p of flew) {
    const sx = S.x - 12 + (p.roof ? ROOF_SLOTS[p.slot] : 3 + p.slot * 2);
    const f = flight(S.v, KINDS[p.kind].w);
    S.fliers.push({ p, t0: S.time, x0: sx, vx: f.vx, vz: f.vz, landX: sx + f.dist, tLand: f.t, judged: false, result: '' });
  }
  S.pax = S.pax.filter((p) => !flew.includes(p));
  sfx.brake();
  sfx.shock(shock);
  if (flew.length) sfx.fly();
  $('shock').innerHTML = `<span class="num">衝撃 ${shock}</span><span class="sub">${flew.length ? `${flew.length}人 射出！` : 'だれも飛ばなかった'}</span>`;
  $('shock').classList.remove('show');
  void $('shock').offsetWidth;
  $('shock').classList.add('show');
  // 急ブレーキで速度が落ちる
  S.v *= 0.45;
  renderList(true);
}

function judge(f: Flier) {
  f.judged = true;
  const st = f.p.dest;
  const stop = POS[st];
  const onPlat = f.landX >= stop + PLAT_LO && f.landX <= stop + PLAT_HI;
  const mat = S.mats[st];
  // どの駅のホームに落ちたか
  const at = POS.findIndex((p, i) => i > 0 && f.landX >= p + PLAT_LO && f.landX <= p + PLAT_HI);
  if (st !== S.target && at !== st) {
    // この駅で降りる客ではないのに飛ばしてしまった
    f.result = 'lost';
    S.trust -= 10;
    S.miss++;
    popup(`${LINE.stations[st].name}行きの${KINDS[f.p.kind].name}まで飛ばしてしまった…`, f.landX, '#B53E28');
    sfx.bad();
    return;
  }
  if (at >= 0 && at !== st) {
    f.result = 'lost';
    S.trust -= 8;
    S.miss++;
    popup(`${LINE.stations[at].name}に着地…駅ちがい`, f.landX, '#B53E28');
    sfx.bad();
    return;
  }
  if (onPlat && Math.abs(f.landX - mat.x) <= mat.w / 2) {
    f.result = 'perfect';
    S.fare += 400;
    S.perfect++;
    popup('PERFECT 着地配達！ ¥400', f.landX, '#2E6B53');
    sfx.cleared();
    sfx.coin();
  } else if (onPlat) {
    f.result = 'good';
    S.fare += 200;
    S.good++;
    popup('GOOD ¥200', f.landX, '#2E6B53');
    sfx.coin();
  } else {
    f.result = 'miss';
    S.trust -= 12;
    S.miss++;
    const d = f.landX - stop;
    popup(d < PLAT_LO ? `手前に落下（${Math.round(stop + PLAT_LO - f.landX)}m 足りない）` : `飛びすぎ（${Math.round(f.landX - stop - PLAT_HI)}m オーバー）`, f.landX, '#B53E28');
    sfx.bad();
  }
}

function setNotch(n: number) {
  S.notch = Math.max(0, Math.min(7, n));
  sfx.notch(S.notch < 4);
}

function update(dt: number) {
  if (S.phase === 'end') return;
  S.time += dt;
  S.cool = Math.max(0, S.cool - dt);
  S.popups = S.popups.filter((p) => S.time - p.t < 2.4);
  // 着地
  for (const f of S.fliers) if (!f.judged && S.time - f.t0 >= f.tLand) judge(f);
  S.fliers = S.fliers.filter((f) => S.time - f.t0 < f.tLand + 1.5);

  if (S.phase === 'stop') {
    S.stopT -= dt;
    if (S.stopT <= 0) {
      S.phase = 'run';
      S.target++;
      S.notch = 5;
      if (S.target >= N) return finish();
      autoSeat();
      renderList(true);
    }
    return;
  }
  let a = NOTCH_A[S.notch];
  if (a > 0) a *= Math.max(0.08, 1 - S.v / 30);
  a -= 0.05;
  S.v = Math.max(0, S.v + a * dt);
  S.x += S.v * dt;
  const st = S.target;
  const stop = POS[st];
  // 予定との差
  const plan = (S.x / PLAN_V) + st * 6;
  S.delay = S.time - plan;
  // 停車（安全に降ろす）
  if (S.v < 0.05 && S.notch <= 4 && S.x >= stop + STOP_LO && S.x <= stop + STOP_HI) {
    const here = S.pax.filter((p) => p.dest === st);
    S.pax = S.pax.filter((p) => p.dest !== st);
    S.fare += here.length * 200;
    S.good += here.length;
    if (here.length) popup(`停車して ${here.length}人 降車 ¥${here.length * 200}`, S.x, '#2E6B53');
    sfx.arrive();
    S.phase = 'stop';
    S.stopT = 4 + here.length * 1.5;
    renderList(true);
    return;
  }
  // 駅を通り過ぎた
  if (S.x > stop + 40) {
    const left = S.pax.filter((p) => p.dest === st);
    if (left.length) {
      S.trust -= 6 * left.length;
      popup(`${left.length}人 乗り過ごし`, S.x, '#B53E28');
      for (const p of left) p.dest = Math.min(N - 1, st + 1);
      sfx.bad();
    }
    S.target++;
    if (S.target >= N) return finish();
    autoSeat();
    renderList(true);
  }
  if (S.trust <= 0) finish();
}

function finish() {
  S.phase = 'end';
  const rows: [string, string][] = [
    ['運賃', `¥${S.fare.toLocaleString()}`],
    ['PERFECT（マットに着地）', `${S.perfect}人`],
    ['GOOD（ホームに着地・停車）', `${S.good}人`],
    ['失敗', `${S.miss}人`],
    ['信頼', `${Math.max(0, Math.round(S.trust))}`],
    ['かかった時間', `${Math.round(S.time)}秒（予定との差 ${S.delay > 0 ? '+' : ''}${Math.round(S.delay)}秒）`],
  ];
  $('result-stats').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
  $('result').hidden = false;
  sfx.clear();
}

// ---------- 描画 ----------
const $ = (id: string) => document.getElementById(id) as HTMLElement;
const canvas = $('view') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;

function fit() {
  const dpr = window.devicePixelRatio || 1;
  const r = canvas.getBoundingClientRect();
  const cw = Math.round(r.width * dpr);
  const ch = Math.round(r.height * dpr);
  if (canvas.width !== cw || canvas.height !== ch) {
    canvas.width = cw;
    canvas.height = ch;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { w: r.width, h: r.height };
}

function lookOf(p: Pax): Look {
  const l = p.look;
  if (p.kind === 'sumo') return { ...l, shirt: '#F0C9A0', pants: '#3A3631', skin: '#F0C9A0', hairStyle: 2, hat: 0, bag: 0, hair: '#24211D' };
  if (p.kind === 'stu') return { ...l, shirt: '#2D3550', pants: '#2D3550', hat: 0 };
  if (p.kind === 'old') return { ...l, shirt: '#B9B0A2', pants: '#6B655C', hair: '#E6E1D8', hairStyle: 2, hat: 0 };
  if (p.kind === 'kid') return { ...l, shirt: '#E9B23E', hat: 1 };
  return { ...l, shirt: '#FFFDF6', pants: '#4A4540', bag: 1 };
}
const scaleOf = (p: Pax) => (p.kind === 'sumo' ? 1.35 : p.kind === 'kid' ? 0.72 : 1);

function person(iso: Iso, x: number, y: number, z: number, p: Pax, facing: Facing, k = 1) {
  const sub = new Iso(iso.ctx, iso.s * scaleOf(p) * k, 0, 0);
  const [px, py] = iso.P(x, y, z);
  const [qx, qy] = sub.P(0, 0, 0);
  sub.ox = px - qx;
  sub.oy = py - qy;
  sub.lw = iso.lw;
  return drawPerson(sub, 0, 0, 0, lookOf(p), { pose: 'stand', facing });
}

function fakeGame(): Game {
  return {
    line: LINE,
    pos: POS,
    phase: S.phase === 'stop' ? 'dwell' : 'running',
    target: Math.min(S.target, N - 1),
    time: S.time,
    v: S.v,
    x: S.x,
    stats: { cars: 1, doorsPerCar: 2, levels: {} },
    waiting: 0,
    doorAnim: S.phase === 'stop' ? 1 : 0,
    layout: new Array(8),
    passengers: S.pax.filter((p) => !p.roof).map(() => ({ car: 0 })),
  } as unknown as Game;
}

function draw() {
  const { w, h } = fit();
  ctx.fillStyle = '#F5EFE3';
  ctx.fillRect(0, 0, w, h);
  const st = Math.min(S.target, N - 1);
  const stop = POS[st];
  // 予測（今急ブレーキしたら）
  const shock = shockOf(S.v);
  const willFly = S.pax.filter((p) => shock > effTol(p));
  drawExterior(ctx, fakeGame(), w, 70, h - 4, {
    ahead: 46,
    extra: (iso, put) => {
      // 着地マット
      for (let i = 1; i < N; i++) {
        const m = S.mats[i];
        if (!iso.inX(m.x - 4, m.x + 4)) continue;
        put(m.x, 3.6, () => {
          iso.box(m.x - m.w / 2, m.x + m.w / 2, 2.6, 4.9, 1.05, 1.3, i === st ? '#E4553A' : '#F08E78', { top: i === st ? '#F2C94C' : '#F3D27F' });
          iso.label(m.x, 3.7, 1.35, '×2', 14, INK);
        });
      }
    },
    after: (iso) => {
      // 屋根の客
      const x1 = S.x - 0.3;
      iso.box(x1 - 10.6, x1 - 1.4, -1.05, -0.95, ROOF_Z, ROOF_Z + 0.45, '#9A9184', { lw: iso.lw * 0.6 });
      for (const p of S.pax) {
        if (!p.roof) continue;
        const wx = S.x - 12 + ROOF_SLOTS[p.slot];
        const h2 = person(iso, wx, 0, ROOF_Z, p, 0);
        const fly = willFly.includes(p);
        const c = DEST_COLORS[p.dest];
        ctx.beginPath();
        ctx.arc(h2.hx, h2.hy - h2.hr * 2.2, 8, 0, Math.PI * 2);
        ctx.fillStyle = c;
        ctx.fill();
        ctx.strokeStyle = fly ? '#E4553A' : INK;
        ctx.lineWidth = fly ? 3 : 1.5;
        ctx.stroke();
        ctx.fillStyle = INK;
        ctx.font = '900 10px "Zen Maru Gothic", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(p.dest === st ? '降' : String(p.dest - st + 1), h2.hx, h2.hy - h2.hr * 2.2 + 0.5);
      }
      iso.box(x1 - 10.6, x1 - 1.4, 0.95, 1.05, ROOF_Z, ROOF_Z + 0.45, '#9A9184', { lw: iso.lw * 0.6 });
      // 予測の放物線（飛ぶ客がいて、駅が近いとき）
      if (S.phase === 'run' && S.v > 2 && willFly.length && stop - S.x < 120) {
        const kinds = [...new Set(willFly.map((p) => KINDS[p.kind].w))];
        for (const wgt of kinds) {
          const sample = willFly.find((p) => KINDS[p.kind].w === wgt)!;
          const sx = S.x - 12 + (sample.roof ? ROOF_SLOTS[sample.slot] : 6);
          const f = flight(S.v, wgt);
          ctx.fillStyle = INK;
          for (let k = 1; k < 14; k++) {
            const t = (f.t * k) / 14;
            const [px, py] = iso.P(sx + f.vx * t, 0, ROOF_Z + f.vz * t - (G * t * t) / 2);
            ctx.beginPath();
            ctx.arc(px, py, 2.2, 0, Math.PI * 2);
            ctx.fill();
          }
          const lx = sx + f.dist;
          const onMat = Math.abs(lx - S.mats[st].x) <= S.mats[st].w / 2;
          const onPlat = lx >= stop + PLAT_LO && lx <= stop + PLAT_HI;
          const [cx, cy] = iso.P(lx, 0, onPlat ? 1.06 : 0);
          ctx.setLineDash([5, 4]);
          iso.ell(cx, cy, 1.4 * iso.s * 1.22, 1.4 * iso.s * 0.7, onMat ? 'rgba(111,195,160,0.6)' : onPlat ? 'rgba(233,178,62,0.45)' : 'rgba(228,85,58,0.35)', 2.4, onMat ? '#2E6B53' : onPlat ? '#8A5D00' : '#B53E28');
          ctx.setLineDash([]);
          if (kinds.length > 1) iso.label(lx, 0, 1.6, KINDS[sample.kind].ch, 11, INK);
        }
      }
      // 飛んでいる客
      for (const f of S.fliers) {
        const t = Math.min(S.time - f.t0, f.tLand);
        const x = f.x0 + f.vx * t;
        const z = Math.max(0, ROOF_Z + f.vz * t - (G * t * t) / 2);
        const landed = S.time - f.t0 >= f.tLand;
        const onPlat = POS.some((p, i) => i > 0 && f.landX >= p + PLAT_LO && f.landX <= p + PLAT_HI);
        const zz = landed && onPlat ? 1.05 : z;
        if (landed && f.result === 'miss' && !onPlat) {
          const k = (S.time - f.t0 - f.tLand) / 1.2;
          const [sx, sy] = iso.P(f.landX, 0.5, 0);
          ctx.globalAlpha = Math.max(0, 1 - k);
          iso.ell(sx, sy, 8 + k * 30, 3 + k * 12, 'rgba(255,253,246,0.85)', 1.4);
          ctx.globalAlpha = 1;
          continue;
        }
        const h2 = person(iso, x, 0, zz, f.p, landed ? 3 : ((Math.floor(t * 12) % 4) as Facing), 1.3);
        if (!landed) {
          ctx.fillStyle = '#FFFDF6';
          ctx.strokeStyle = INK;
          ctx.lineWidth = 1.5;
          ctx.font = '900 11px "Zen Maru Gothic", sans-serif';
          ctx.textAlign = 'center';
          ctx.strokeText('わ〜っ', h2.hx + 18, h2.hy - 16);
          ctx.fillStyle = INK;
          ctx.fillText('わ〜っ', h2.hx + 18, h2.hy - 16);
        }
      }
      // ポップ
      for (const p of S.popups) {
        const k = (S.time - p.t) / 2.4;
        ctx.globalAlpha = 1 - k * k;
        iso.label(p.x, 0, 6 + k * 3, p.text, 14, p.color);
        ctx.globalAlpha = 1;
      }
    },
  });
  // 上のバー
  drawTop(w);
}

function drawTop(w: number) {
  const st = Math.min(S.target, N - 1);
  const stop = POS[st];
  ctx.fillStyle = INK;
  ctx.font = '900 13px "Zen Maru Gothic", sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  const d = stop + PLAT_LO - S.x;
  ctx.fillText(S.phase === 'stop' ? `${LINE.stations[st].name} 停車中` : d > 0 ? `次は ${LINE.stations[st].name}　ホームまで ${Math.round(d)}m` : `${LINE.stations[st].name} 通過中`, 14, 22);
  // 駅の点
  const x0 = 14;
  const x1 = w - 14;
  const total = POS[N - 1];
  const map = (x: number) => x0 + (Math.max(0, Math.min(total, x)) / total) * (x1 - x0);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x0, 40);
  ctx.lineTo(x1, 40);
  ctx.stroke();
  for (let i = 0; i < N; i++) {
    ctx.beginPath();
    ctx.arc(map(POS[i]), 40, i === st ? 6 : 4.5, 0, Math.PI * 2);
    ctx.fillStyle = i === 0 ? '#9A9184' : DEST_COLORS[i];
    ctx.fill();
    ctx.lineWidth = 1.8;
    ctx.stroke();
  }
  ctx.fillStyle = '#6FC3A0';
  ctx.beginPath();
  ctx.roundRect(map(S.x) - 8, 34, 16, 12, 3);
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.stroke();
}

// ---------- 一覧（屋根／座席の切り替え） ----------
let listKey = '';
function renderList(force = false) {
  const st = Math.min(S.target, N - 1);
  const shock = shockOf(S.v);
  const key = S.pax.map((p) => `${p.id}${p.roof ? 'r' : 's'}${p.dest}`).join(',') + '|' + st + '|' + Math.floor(shock / 5);
  if (!force && key === listKey) return;
  listKey = key;
  const box = $('list');
  const sorted = [...S.pax].sort((a, b) => a.dest - b.dest);
  box.innerHTML = sorted
    .map((p) => {
      const t = effTol(p);
      const fly = shock > t;
      const left = p.dest - st + 1;
      return `<button type="button" class="pc ${p.roof ? 'roof' : ''} ${fly ? 'fly' : ''}" data-id="${p.id}"><i style="background:${DEST_COLORS[p.dest]}">${left <= 1 ? '降' : left}</i><span>${KINDS[p.kind].name}</span><b>${p.roof ? '屋根' : '座席'} ${t}</b></button>`;
    })
    .join('');
  box.querySelectorAll<HTMLButtonElement>('.pc').forEach((b) => b.addEventListener('click', () => toggleRoof(Number(b.dataset.id))));
}

function renderHud() {
  const k = kmh(S.v);
  $('speed').textContent = String(Math.round(k));
  const shock = shockOf(S.v);
  const fly = S.pax.filter((p) => shock > effTol(p));
  $('pred').innerHTML = `今 急ブレーキすると <b>衝撃 ${shock}</b> → ${fly.length ? `<span class="warn">${fly.map((p) => KINDS[p.kind].name).join('・')} が飛ぶ</span>` : 'だれも飛ばない'}`;
  $('fare').textContent = `¥${S.fare.toLocaleString()}`;
  $('trust').textContent = `信頼 ${Math.max(0, Math.round(S.trust))}`;
  $('delay').textContent = S.delay > 0 ? `予定より +${Math.round(S.delay)}秒` : `予定より ${Math.round(-S.delay)}秒 早い`;
  $('delay').className = S.delay > 0 ? 'late' : 'early';
  document.querySelectorAll<HTMLElement>('.notch').forEach((n) => n.classList.toggle('on', Number(n.dataset.n) === S.notch));
  ($('btn-launch') as HTMLButtonElement).disabled = S.phase !== 'run' || S.v < 2;
  renderList();
}

// ---------- 入力 ----------
const lever = $('lever');
NOTCH_NAME.forEach((name, i) => {
  if (i === 0) return; // 非常は射出ボタンで
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'notch' + (i < 4 ? ' brake' : i > 4 ? ' power' : '');
  b.dataset.n = String(i);
  b.textContent = name;
  b.addEventListener('pointerdown', () => setNotch(i));
  lever.appendChild(b);
});
$('btn-launch').addEventListener('pointerdown', (e) => {
  e.preventDefault();
  launch();
});
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') {
    e.preventDefault();
    launch();
  } else if (e.code === 'ArrowUp') setNotch(S.notch + 1);
  else if (e.code === 'ArrowDown') setNotch(Math.max(1, S.notch - 1));
});
window.addEventListener('pointerdown', unlock, { capture: true });
window.addEventListener('keydown', unlock, { capture: true });
$('retry').addEventListener('click', reset);
const snd = $('btn-sound');
snd.textContent = isMuted() ? '×' : '♪';
snd.addEventListener('click', () => {
  toggleMute();
  snd.textContent = isMuted() ? '×' : '♪';
});

// ---------- ループ ----------
const params = new URLSearchParams(location.search);
const SPEED = Math.max(1, Number(params.get('speed')) || 1);
if (params.has('debug')) Object.assign(window, { __S: S, __launch: launch });
reset();
setScene('run');
let last = performance.now();
function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000) * SPEED;
  last = now;
  const steps = Math.ceil(dt / 0.02);
  for (let i = 0; i < steps; i++) update(dt / steps);
  setIntensity(kmh(S.v) / 80);
  setScene(S.phase === 'stop' ? 'dwell' : S.phase === 'end' ? 'none' : 'run');
  draw();
  renderHud();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
