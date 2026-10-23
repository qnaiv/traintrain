// 試作：満員電車シェイク。客には触れず、加速とブレーキの慣性だけで車内の客を動かす。

import { DEST_COLORS } from '../data.ts';
import { randomLook, type Look } from '../game.ts';
import { C30, INK, Iso, shade } from '../iso.ts';
import { drawPerson, type Facing } from '../people.ts';

// ---------- 定数 ----------
const L = 12; // 車両の長さ
const WALL = 1.2; // 内壁（中心から）
const BENCH_IN = 0.74; // 座席の前端
const DOORS = [3, 9];
const DOOR_HALF = 0.62;
const SEGS: [number, number][] = [
  [0.3, DOORS[0] - DOOR_HALF - 0.08],
  [DOORS[0] + DOOR_HALF + 0.08, DOORS[1] - DOOR_HALF - 0.08],
  [DOORS[1] + DOOR_HALF + 0.08, L - 0.3],
];
const CAPACITY = 60; // 乗車率100%の人数
const PLAT_LEN = 16;
const MARKS = [-14, -9, -4]; // ホームの乗車位置（ホーム先端からの距離）
const STATIONS = ['藤沢', '鵠沼', '江ノ島', '腰越', '長谷', '鎌倉'];
const GAPS = [300, 260, 240, 280, 300];
const VMAX = 17;
const NOTCH = [-4.2, -2.6, -1.7, -0.9, 0, 0.8, 1.3, 1.8]; // 非常 B3 B2 B1 N P1 P2 P3
const NOTCH_NAME = ['非常', 'B3', 'B2', 'B1', 'N', 'P1', 'P2', 'P3'];
const SEG_TIME = 30; // 1駅間の予定（走行＋停車）

type Kind = 'normal' | 'student' | 'kid' | 'sumo';
const KIND: Record<Kind, { r: number; m: number; grip: number; label: string }> = {
  normal: { r: 0.22, m: 1, grip: 1.15, label: '' },
  student: { r: 0.22, m: 1, grip: 2.1, label: '学' },
  kid: { r: 0.17, m: 0.5, grip: 0.75, label: '子' },
  sumo: { r: 0.38, m: 3.2, grip: 1.4, label: '力' },
};

interface Body {
  id: number;
  kind: Kind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  m: number;
  grip: number;
  look: Look;
  dest: number;
  mood: number; // 3..0
  state: 'in' | 'board' | 'exit' | 'seat';
  seat: number;
  sliding: number; // よろけている残り時間
  hitCd: number;
  crush: number;
  sitT: number;
  face: Facing;
  tx: number; // 乗ってきた客がめざす場所
  ty: number;
}

interface Seat {
  x: number;
  y: number;
  occ: Body | null;
}

interface Waiting {
  kind: Kind;
  look: Look;
  dest: number;
}

interface Popup {
  x: number;
  y: number;
  z: number;
  text: string;
  color: string;
  t: number;
}

// ---------- 状態 ----------
const POS: number[] = [0];
for (const d of GAPS) POS.push(POS[POS.length - 1] + d);

let nextId = 1;
const S = {
  xf: 0, // 先頭の位置
  v: 0,
  a: 0,
  notch: 4,
  time: 0,
  target: 0, // 次に止まる（今いる）駅
  phase: 'open' as 'run' | 'stopped' | 'open' | 'closing' | 'end',
  phaseT: 0,
  doorOpen: [false, false],
  bodies: [] as Body[],
  seats: [] as Seat[],
  queues: [] as Waiting[][],
  boardT: [0, 0],
  popups: [] as Popup[],
  fare: 0,
  ok: 0,
  missed: 0,
  left: 0,
  hurt: 0,
  maxRate: 0,
  delay: 0,
  toasts: [] as { text: string; t: number; kind: string }[],
};

function rnd(a: number, b: number): number {
  return a + Math.random() * (b - a);
}

function pickKind(): Kind {
  const r = Math.random();
  return r < 0.62 ? 'normal' : r < 0.82 ? 'student' : r < 0.92 ? 'kid' : 'sumo';
}

function pickDest(from: number): number {
  const n = STATIONS.length;
  let total = 0;
  for (let k = from + 1; k < n; k++) total += 1 / (k - from);
  let r = Math.random() * total;
  for (let k = from + 1; k < n; k++) {
    r -= 1 / (k - from);
    if (r <= 0) return k;
  }
  return n - 1;
}

function makeBody(kind: Kind, look: Look, dest: number, x: number, y: number, state: Body['state']): Body {
  const k = KIND[kind];
  return {
    id: nextId++,
    kind,
    x,
    y,
    vx: 0,
    vy: 0,
    r: k.r,
    m: k.m,
    grip: k.grip,
    look: kind === 'sumo' ? { ...look, shirt: '#F3EEE2', pants: '#3A3631', hairStyle: 2, hat: 0, bag: 0 } : kind === 'student' ? { ...look, shirt: '#2D3550', pants: '#2D3550', hat: 0 } : look,
    dest,
    mood: 3,
    state,
    seat: -1,
    sliding: 0,
    hitCd: 0,
    crush: 0,
    sitT: 0,
    face: Math.random() < 0.5 ? 0 : 1,
    tx: x,
    ty: 0,
  };
}

function fillQueues(st: number) {
  S.queues = MARKS.map(() => []);
  if (st >= STATIONS.length - 1) return;
  const total = Math.round(rnd(34, 50) + st * 4);
  for (let i = 0; i < total; i++) {
    const q = Math.floor(Math.random() * MARKS.length);
    S.queues[q].push({ kind: pickKind(), look: randomLook(Math.random), dest: pickDest(st) });
  }
}

function reset() {
  nextId = 1;
  S.xf = POS[0] - 2;
  S.v = 0;
  S.a = 0;
  S.notch = 4;
  S.time = 0;
  S.target = 0;
  S.phase = 'open';
  S.phaseT = 0;
  S.doorOpen = [true, true];
  S.bodies = [];
  S.popups = [];
  S.fare = S.ok = S.missed = S.left = S.hurt = S.maxRate = S.delay = 0;
  S.toasts = [];
  S.seats = [];
  for (const side of [-1, 1]) {
    for (const [a, b] of SEGS) {
      const n = Math.floor((b - a) / 0.5);
      const pad = (b - a - n * 0.5) / 2;
      for (let i = 0; i < n; i++) S.seats.push({ x: a + pad + 0.25 + i * 0.5, y: side * 0.98, occ: null });
    }
  }
  // 始発ですでに座っている客
  for (const seat of S.seats) {
    if (Math.random() < 0.35) {
      const b = makeBody('normal', randomLook(Math.random), pickDest(0), seat.x, seat.y, 'seat');
      sit(b, S.seats.indexOf(seat));
      S.bodies.push(b);
    }
  }
  fillQueues(0);
  $('result').hidden = true;
}

function sit(b: Body, i: number) {
  const seat = S.seats[i];
  seat.occ = b;
  b.state = 'seat';
  b.seat = i;
  b.x = seat.x;
  b.y = seat.y;
  b.vx = b.vy = 0;
}

function stand(b: Body) {
  if (b.seat >= 0) S.seats[b.seat].occ = null;
  b.seat = -1;
  b.state = 'in';
  b.y = Math.sign(b.y) * 0.5;
}

function toast(text: string, kind = '') {
  S.toasts.push({ text, t: S.time, kind });
  if (S.toasts.length > 3) S.toasts.shift();
}

function popup(x: number, y: number, text: string, color: string) {
  S.popups.push({ x, y, z: 1.9, text, color, t: S.time });
}

const carRear = () => S.xf - L;
const platStart = (st: number) => POS[st] - PLAT_LEN;
function doorInPlatform(i: number, st: number): boolean {
  const w = carRear() + DOORS[i];
  return w - DOOR_HALF >= platStart(st) && w + DOOR_HALF <= POS[st];
}
const onboard = () => S.bodies.filter((b) => b.state !== 'exit' && b.state !== 'board').length;

// ---------- 物理 ----------
function walls(b: Body): number {
  // 戻り値：壁にぶつかった速さ
  let hit = 0;
  const x0 = 0.18 + b.r;
  const x1 = L - 0.18 - b.r;
  if (b.x < x0) {
    hit = Math.max(hit, -b.vx);
    b.x = x0;
    if (b.vx < 0) b.vx = 0;
  }
  if (b.x > x1) {
    hit = Math.max(hit, b.vx);
    b.x = x1;
    if (b.vx > 0) b.vx = 0;
  }
  // 奥の壁
  const yb = -WALL + b.r;
  if (b.y < yb) {
    b.y = yb;
    if (b.vy < 0) b.vy = 0;
  }
  // 手前：開いているドアのところだけ外に出られる
  const di = DOORS.findIndex((d) => Math.abs(b.x - d) < DOOR_HALF - b.r * 0.4);
  const canPass = di >= 0 && S.doorOpen[di] && (b.state === 'exit' || b.state === 'board' || isAlighting(b));
  if (!canPass) {
    const yf = WALL - b.r;
    if (b.y > yf) {
      // 外にいるのにドアが閉まった客は押し戻す
      b.y = yf;
      if (b.vy > 0) b.vy = 0;
    }
  } else {
    // ドア枠
    const d = DOORS[di];
    if (b.y > WALL - b.r) {
      if (b.x < d - DOOR_HALF + b.r) b.x = d - DOOR_HALF + b.r;
      if (b.x > d + DOOR_HALF - b.r) b.x = d + DOOR_HALF - b.r;
    }
  }
  // 座席（箱）からの押し出し
  for (const side of [-1, 1]) {
    for (const [a, c] of SEGS) {
      const ylo = side < 0 ? -WALL : BENCH_IN;
      const yhi = side < 0 ? -BENCH_IN : WALL;
      const px = Math.max(a, Math.min(c, b.x));
      const py = Math.max(ylo, Math.min(yhi, b.y));
      const dx = b.x - px;
      const dy = b.y - py;
      const d2 = dx * dx + dy * dy;
      if (d2 < b.r * b.r) {
        const d = Math.sqrt(d2) || 1e-4;
        const nx = d2 > 0 ? dx / d : 0;
        const ny = d2 > 0 ? dy / d : -side;
        const pen = b.r - d;
        b.x += nx * pen;
        b.y += ny * pen;
        const vn = b.vx * nx + b.vy * ny;
        if (vn < 0) {
          hit = Math.max(hit, -vn);
          b.vx -= vn * nx;
          b.vy -= vn * ny;
        }
      }
    }
  }
  return hit;
}

function isAlighting(b: Body): boolean {
  return b.dest === S.target && (S.phase === 'open' || S.phase === 'stopped' || S.phase === 'run');
}

function hurt(b: Body, text: string) {
  if (b.hitCd > 0 || b.state === 'seat') return;
  b.hitCd = 1.4;
  if (b.mood > 0) b.mood--;
  S.hurt++;
  popup(b.x, b.y, text, '#B53E28');
}

function physics(dt: number) {
  const pseudo = -S.a; // 車内で客にかかる見かけの力（+ が進行方向）
  const announce = S.phase === 'run' && POS[S.target] - S.xf < 160;
  const mov = S.bodies.filter((b) => b.state !== 'seat');
  for (const b of mov) {
    b.hitCd = Math.max(0, b.hitCd - dt);
    b.sliding = Math.max(0, b.sliding - dt);
    let ax = 0;
    let ay = 0;
    // 慣性
    const excess = Math.abs(pseudo) - b.grip;
    if (excess > 0 && b.state !== 'exit') {
      ax += Math.sign(pseudo) * excess * 1.7;
      b.sliding = Math.max(b.sliding, 0.25);
    }
    // 歩く
    let tx = NaN;
    let ty = NaN;
    let sp = 0;
    let force = 0;
    if (b.state === 'board') {
      tx = b.tx;
      ty = b.ty;
      sp = 1.8;
      force = 8;
    } else if (b.state === 'exit') {
      tx = b.x;
      ty = 3.4;
      sp = 1.4;
      force = 6;
    } else if (b.dest === S.target && (S.phase === 'open' || announce)) {
      // 降りる客はドアへ
      const open = DOORS.map((d, i) => [d, i] as const).filter(([, i]) => S.phase !== 'open' || S.doorOpen[i]);
      if (open.length) {
        const [d] = open.reduce((p, c) => (Math.abs(c[0] - b.x) < Math.abs(p[0] - b.x) ? c : p));
        tx = d;
        ty = S.phase === 'open' ? 2.0 : 0.9;
        sp = S.phase === 'open' ? 1.2 : 0.22;
        force = S.phase === 'open' ? 4.5 : 0.7;
      }
    }
    if (!Number.isNaN(tx) && b.sliding <= 0) {
      const dx = tx - b.x;
      const dy = ty - b.y;
      const dl = Math.hypot(dx, dy);
      if (dl > 0.05) {
        const dvx = (dx / dl) * sp - b.vx;
        const dvy = (dy / dl) * sp - b.vy;
        const k = Math.min(force, Math.hypot(dvx, dvy) * 8);
        const dn = Math.hypot(dvx, dvy) || 1;
        ax += (dvx / dn) * k;
        ay += (dvy / dn) * k;
      }
      if (b.state === 'board' && b.y < 0.95) b.state = 'in';
    }
    b.vx += ax * dt;
    b.vy += ay * dt;
    // 摩擦：踏ん張っている客はすぐ止まる、よろけている客は滑る
    const damp = b.sliding > 0 ? 1.4 : Number.isNaN(tx) ? 7 : 2.5;
    const f = Math.exp(-damp * dt);
    b.vx *= f;
    b.vy *= f;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    if (Math.abs(b.vx) > 0.05) b.face = b.vx > 0 ? 0 : 1;
  }
  // 人どうし
  for (let it = 0; it < 4; it++) {
    for (let i = 0; i < mov.length; i++) {
      const p = mov[i];
      for (let j = i + 1; j < mov.length; j++) {
        const q = mov[j];
        const dx = q.x - p.x;
        const dy = q.y - p.y;
        const rr = p.r + q.r;
        const near = it === 0 ? 0.22 : 0;
        if (Math.abs(dx) > rr + near || Math.abs(dy) > rr + near) continue;
        const d2 = dx * dx + dy * dy;
        if (d2 >= (rr + near) * (rr + near)) continue;
        const d = Math.sqrt(d2) || 1e-4;
        const nx = dx / d;
        const ny = dy / d;
        const pen = rr - d;
        if (it === 0 && p.state === 'in' && q.state === 'in') {
          // 少しずつ空いているほうへ広がる
          const k = 1.2 * dt * 60 * 0.02;
          p.vx -= nx * k;
          p.vy -= ny * k;
          q.vx += nx * k;
          q.vy += ny * k;
        }
        if (pen <= 0.0) continue;
        // 踏ん張っている人は重い
        const mp = p.m * (p.sliding > 0 ? 1 : 2.4);
        const mq = q.m * (q.sliding > 0 ? 1 : 2.4);
        const ip = 1 / mp;
        const iq = 1 / mq;
        const w = pen / (ip + iq);
        p.x -= nx * w * ip * 0.8;
        p.y -= ny * w * ip * 0.8;
        q.x += nx * w * iq * 0.8;
        q.y += ny * w * iq * 0.8;
        if (it === 0) {
          p.crush += pen;
          q.crush += pen;
          const vn = (q.vx - p.vx) * nx + (q.vy - p.vy) * ny;
          if (vn < 0) {
            const jn = (-1.1 * vn) / (ip + iq);
            p.vx -= jn * ip * nx;
            p.vy -= jn * ip * ny;
            q.vx += jn * iq * nx;
            q.vy += jn * iq * ny;
            if (-vn > 0.5) {
              if (jn * ip > 0.3) p.sliding = Math.max(p.sliding, 0.35);
              if (jn * iq > 0.3) q.sliding = Math.max(q.sliding, 0.35);
            }
            if (-vn > 1.25) {
              hurt(p.m < q.m * 1.5 ? p : q, '痛っ');
            }
          }
        }
      }
    }
    for (const b of mov) {
      const hit = walls(b);
      if (it === 0 && hit > 1.5) hurt(b, 'ぐえっ');
    }
  }
  // ぎゅうぎゅう
  for (const b of mov) {
    if (b.crush > 0.32 && b.state === 'in') {
      b.sitT += dt;
      if (b.sitT > 5) {
        b.sitT = 0;
        hurt(b, '苦しい');
      }
    } else b.sitT = Math.max(0, b.sitT - dt * 0.5);
    b.crush = 0;
  }
  // 空いた席に座る（揺れていないとき）
  if (Math.abs(S.a) < 0.4) {
    for (const b of mov) {
      if (b.state !== 'in' || b.dest === S.target || b.kind === 'sumo' || b.sliding > 0) continue;
      for (let i = 0; i < S.seats.length; i++) {
        const s = S.seats[i];
        if (s.occ) continue;
        if (Math.abs(s.x - b.x) < 0.35 && Math.abs(s.y * 0.62 - b.y) < 0.35) {
          sit(b, i);
          break;
        }
      }
    }
  }
}

// ---------- 運転と駅 ----------
function setNotch(n: number) {
  S.notch = Math.max(0, Math.min(7, n));
  renderLever();
}

function update(dt: number) {
  if (S.phase === 'end') return;
  S.time += dt;
  S.phaseT += dt;
  const st = S.target;
  const cmd = NOTCH[S.notch];

  if (S.phase === 'open') {
    S.a = 0;
    S.v = 0;
    boarding(dt);
    // 降りきった客を消す
    for (const b of S.bodies) {
      if (b.state === 'exit' && b.y > 3.2) b.state = 'seat';
    }
    S.bodies = S.bodies.filter((b) => !(b.state === 'seat' && b.seat < 0));
    for (const b of S.bodies) {
      if (b.state === 'seat' && b.dest === st && S.phaseT > 0.4) stand(b);
      if (b.state === 'in' && b.dest === st && b.y > WALL - 0.05) {
        b.state = 'exit';
        const fare = Math.round(120 * [0, 0.3, 0.7, 1][b.mood]);
        S.fare += fare;
        S.ok++;
        popup(b.x, 1.6, fare > 0 ? `+¥${fare}` : '苦情', fare > 0 ? '#2E6B53' : '#B53E28');
      }
    }
    if (st === STATIONS.length - 1) {
      if (!S.bodies.some((b) => b.state !== 'exit') && S.phaseT > 2) finish();
      return;
    }
    if (cmd > 0) {
      S.phase = 'closing';
      S.phaseT = 0;
    }
    return;
  }
  if (S.phase === 'closing') {
    S.a = 0;
    if (S.phaseT > 0.7) {
      S.doorOpen = [false, false];
      // 乗れなかった客は列に戻す
      for (const b of S.bodies) {
        if (b.state === 'board' && b.y > WALL - 0.1) {
          S.queues[0].push({ kind: b.kind, look: b.look, dest: b.dest });
          b.state = 'exit';
          b.y = 9;
        }
      }
      S.bodies = S.bodies.filter((b) => b.state !== 'exit');
      const miss = S.bodies.filter((b) => b.dest === st);
      if (miss.length) {
        S.missed += miss.length;
        toast(`乗り過ごし ${miss.length}人`, 'bad');
        for (const b of miss) {
          b.dest = Math.min(STATIONS.length - 1, st + 1);
          if (b.mood > 0) b.mood--;
        }
      }
      const left = S.queues.reduce((n, q) => n + q.length, 0);
      if (left) {
        S.left += left;
        toast(`積み残し ${left}人`, 'bad');
      }
      const rate = Math.round((onboard() / CAPACITY) * 100);
      S.maxRate = Math.max(S.maxRate, rate);
      toast(`乗車率 ${rate}%`, rate >= 150 ? 'good' : '');
      S.queues = [];
      S.target = st + 1;
      S.delay = Math.max(0, S.time - SEG_TIME * st - 8);
      S.phase = 'run';
      S.phaseT = 0;
    }
    return;
  }
  // 走行・停止
  let a = cmd;
  if (cmd > 0) a *= Math.max(0.15, 1 - S.v / VMAX);
  a -= 0.06;
  if (S.v <= 0 && a < 0) a = 0;
  S.v = Math.max(0, S.v + a * dt);
  S.xf += S.v * dt;
  S.a = S.v > 0.01 || cmd > 0 ? a : 0;
  if (S.phase === 'run' && S.v < 0.02 && cmd <= 0) {
    S.phase = 'stopped';
    S.phaseT = 0;
  }
  if (S.phase === 'stopped') {
    if (cmd > 0) {
      S.phase = 'run';
    } else if (S.phaseT > 0.4) {
      const open = DOORS.map((_, i) => doorInPlatform(i, st));
      if (open.some(Boolean)) {
        S.doorOpen = open;
        S.phase = 'open';
        S.phaseT = 0;
        S.boardT = [0.3, 0.3];
        if (!open.every(Boolean)) toast('ドアが片方ホームにかかっていない', 'bad');
        fillQueues(st);
      }
    }
  }
  // 駅を通り過ぎた
  if (S.phase === 'run' && S.xf - L > POS[st] + 4) {
    const miss = S.bodies.filter((b) => b.dest === st);
    S.missed += miss.length;
    for (const b of miss) b.dest = Math.min(STATIONS.length - 1, st + 1);
    toast(`${STATIONS[st]}を通過してしまった`, 'bad');
    if (st === STATIONS.length - 1) finish();
    else S.target = st + 1;
  }
}

function boarding(dt: number) {
  const st = S.target;
  if (st >= STATIONS.length - 1) return;
  const rear = carRear();
  for (let i = 0; i < DOORS.length; i++) {
    if (!S.doorOpen[i]) continue;
    S.boardT[i] -= dt;
    if (S.boardT[i] > 0) continue;
    const dw = rear + DOORS[i];
    // いちばん近い列（ずれているほど乗るのが遅い）
    let best = -1;
    let bd = Infinity;
    for (let q = 0; q < MARKS.length; q++) {
      const off = Math.abs(POS[st] + MARKS[q] - dw);
      if (S.queues[q]?.length && off < bd) {
        bd = off;
        best = q;
      }
    }
    if (best < 0 || bd > 4.5) continue;
    // 降りる客が残っているうちは待つ
    const exiting = S.bodies.some((b) => b.dest === st && b.state !== 'exit' && Math.abs(b.x - DOORS[i]) < 0.75 && b.y > 0.85);
    if (exiting) {
      S.boardT[i] = 0.2;
      continue;
    }
    // 入口が詰まっているか
    const sx = DOORS[i] + rnd(-0.2, 0.2);
    const sy = 1.55;
    const w = S.queues[best][0];
    const r = KIND[w.kind].r;
    const blocked = S.bodies.some((b) => b.state !== 'seat' && Math.hypot(b.x - sx, b.y - sy) < (b.r + r) * 0.6);
    if (blocked) {
      S.boardT[i] = 0.25;
      continue;
    }
    S.queues[best].shift();
    const b = makeBody(w.kind, w.look, w.dest, sx, sy, 'board');
    b.tx = Math.max(0.8, Math.min(L - 0.8, DOORS[i] + rnd(-3.5, 3.5)));
    b.ty = rnd(-0.55, 0.55);
    S.bodies.push(b);
    S.boardT[i] = (bd < 0.8 ? 0.16 : 0.5) + (w.kind === 'sumo' ? 0.5 : 0);
  }
}

function finish() {
  S.phase = 'end';
  S.delay = Math.max(0, S.time - SEG_TIME * (STATIONS.length - 1) - 8);
  const rows: [string, string][] = [
    ['運賃', `¥${S.fare.toLocaleString()}`],
    ['降車成功', `${S.ok}人`],
    ['乗り過ごし', `${S.missed}人`],
    ['積み残し', `${S.left}人`],
    ['よろけ・苦情', `${S.hurt}回`],
    ['最高乗車率', `${S.maxRate}%`],
    ['遅れ', `${Math.round(S.delay)}秒`],
  ];
  $('result-stats').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
  $('result').hidden = false;
}

// ---------- 描画 ----------
const $ = (id: string) => document.getElementById(id) as HTMLElement;
const canvas = $('view') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const CAR = '#6FC3A0';
const MOQ = '#6FBF95';
const BENCH = '#B3A68E';

function fit(): { w: number; h: number } {
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

function draw() {
  const { w, h } = fit();
  ctx.fillStyle = '#F5EFE3';
  ctx.fillRect(0, 0, w, h);
  const barH = 46;
  drawApproach(w, barH);
  const top = barH + 8;
  const span = L + 1.2;
  const s = Math.max(10, Math.min((w - 12) / ((span + 2.8) * C30), (h - top - 10) / ((span + 6) * 0.5 + 3.4), 46));
  const iso = new Iso(ctx, s, 0, 0);
  // 中心を合わせる
  const [cx, cy] = iso.P(L / 2, 1.0, 0.6);
  iso.ox = w / 2 - cx;
  iso.oy = top + (h - top) / 2 - cy + 0.4 * s;
  iso.clipX0 = -3.5;
  iso.clipX1 = L + 3.5;

  const rear = carRear();
  const st = S.target;
  // 地面と線路
  iso.rectZ(-3.5, L + 3.5, -2.2, 1.45, -1.32, '#E6DCC8', 0);
  const off = ((rear % 1.2) + 1.2) % 1.2;
  for (let x = -3.5 - off; x < L + 3.5; x += 1.2) iso.rectZ(x, x + 0.42, -1.5, 1.5, -1.3, '#D6CBB6', 0);
  iso.rectZ(-3.5, L + 3.5, -0.72, -0.56, -1.22, '#B9B0A2', 0);
  iso.rectZ(-3.5, L + 3.5, 0.56, 0.72, -1.22, '#B9B0A2', 0);
  // ホーム
  const p0 = platStart(st) - rear;
  const p1 = POS[st] - rear;
  const platVis = p1 > -3.5 && p0 < L + 3.5;
  if (platVis) {
    iso.box(Math.max(-3.5, p0), Math.min(L + 3.5, p1), 1.45, 4.6, -1.32, -0.02, '#E9E2D2', { top: '#F2ECDF' });
    iso.rectZ(Math.max(-3.5, p0), Math.min(L + 3.5, p1), 1.55, 1.75, -0.015, '#F2C94C', 0);
    MARKS.forEach((m) => {
      const mx = POS[st] + m - rear;
      if (mx < -3 || mx > L + 3) return;
      iso.poly([[mx - 0.5, 1.85, -0.01], [mx + 0.5, 1.85, -0.01], [mx, 2.35, -0.01]], '#E9B23E', iso.lw * 0.8);
    });
    if (p1 - 1 > -3 && p1 - 1 < L + 3) {
      iso.box(p1 - 1.2, p1 - 1.1, 4.0, 4.1, 0, 1.6, '#3A3631');
      iso.box(p1 - 1.3, p1 - 1.0, 3.3, 4.8, 1.6, 2.3, '#FFFDF6');
      iso.label(p1 - 1.15, 4.05, 1.95, STATIONS[st], 13, INK);
    }
  }
  // 台車
  for (const bx of [1.6, L - 3.8]) iso.box(bx, bx + 2.2, -1.0, 1.0, -1.0, -0.42, '#2B2824');
  const spin = S.xf / 0.45;
  for (const wx of [2.1, 3.3, L - 3.3, L - 2.1]) {
    const [px, py] = iso.P(wx, 1.02, -0.92);
    iso.ell(px, py, 0.36 * s, 0.36 * s, '#3A3631', iso.lw);
    iso.ell(px + Math.cos(spin) * 0.18 * s, py + Math.sin(spin) * 0.18 * s, 0.07 * s, 0.07 * s, '#9A9184', 0);
  }
  // 床
  iso.box(0, L, -1.3, 1.3, -0.28, 0, CAR, { top: '#EADFC8', sx: shade(CAR, 0.72), sy: shade(CAR, 0.88) });
  for (const d of DOORS) {
    iso.rectZ(d - DOOR_HALF, d + DOOR_HALF, 1.04, 1.3, 0.004, '#E9B23E', 0);
    iso.rectZ(d - DOOR_HALF, d + DOOR_HALF, -1.3, -1.04, 0.004, '#E9B23E', 0);
  }
  // 奥の壁と座席
  iso.box(0, L, -1.3, -1.2, 0, 0.32, CAR, { lw: iso.lw * 0.8 });
  for (const [a, b] of SEGS) {
    iso.box(a, b, -1.2, -0.78, 0, 0.4, BENCH, { lw: iso.lw * 0.8 });
    iso.box(a, b, -1.2, -0.74, 0.4, 0.52, MOQ, { lw: iso.lw * 0.8 });
    iso.box(a, b, -1.2, -1.05, 0.52, 1.0, '#5DAA84', { lw: iso.lw * 0.8 });
    iso.box(a, b, 0.78, 1.2, 0, 0.4, BENCH, { lw: iso.lw * 0.8 });
    iso.box(a, b, 0.74, 1.2, 0.4, 0.52, MOQ, { lw: iso.lw * 0.8 });
  }
  // 中の人とポール（奥から）
  const items: { d: number; f: () => void }[] = [];
  const outside: Body[] = [];
  for (const b of S.bodies) {
    if (b.state !== 'seat' && b.y > WALL - 0.02) {
      outside.push(b);
      continue;
    }
    items.push({ d: b.x + b.y, f: () => person(iso, b) });
  }
  for (const d of DOORS) {
    for (const [px, py] of [[d - 0.72, -0.72], [d + 0.72, -0.72], [d - 0.72, 0.72], [d + 0.72, 0.72]] as [number, number][]) {
      items.push({ d: px + py + (py > 0 ? 0.3 : 0), f: () => pole(iso, px, py) });
    }
  }
  items.sort((a, b) => a.d - b.d).forEach((i) => i.f());
  // 手前の背もたれと腰壁、ドア
  for (const [a, b] of SEGS) iso.box(a, b, 1.08, 1.2, 0.52, 0.74, '#5DAA84', { lw: iso.lw * 0.8 });
  let x0 = 0;
  for (const d of DOORS) {
    iso.box(x0, d - DOOR_HALF, 1.2, 1.3, 0, 0.32, CAR, { lw: iso.lw * 0.8 });
    x0 = d + DOOR_HALF;
  }
  iso.box(x0, L, 1.2, 1.3, 0, 0.32, CAR, { lw: iso.lw * 0.8 });
  DOORS.forEach((d, i) => {
    const open = S.doorOpen[i] && (S.phase === 'open' || (S.phase === 'closing' && S.phaseT < 0.5));
    const k = open ? 0.15 : 1;
    iso.box(d - DOOR_HALF, d - DOOR_HALF + DOOR_HALF * k, 1.22, 1.28, 0, 0.32, '#D8D2C6', { lw: iso.lw * 0.7 });
    iso.box(d + DOOR_HALF - DOOR_HALF * k, d + DOOR_HALF, 1.22, 1.28, 0, 0.32, '#D8D2C6', { lw: iso.lw * 0.7 });
  });
  // 外（ドアのところ・ホームの列）
  const out: { d: number; f: () => void }[] = outside.map((b) => ({ d: b.x + b.y, f: () => person(iso, b) }));
  if (platVis) {
    S.queues.forEach((q, qi) => {
      const mx = POS[st] + MARKS[qi] - rear;
      q.slice(0, 9).forEach((wt, k) => {
        const x = mx + (k % 2 ? 0.28 : -0.28);
        const y = 2.25 + Math.floor(k / 2) * 0.62 + (k % 2) * 0.31;
        out.push({ d: x + y, f: () => drawWaiting(iso, wt, x, y) });
      });
      if (q.length > 9 && mx > -3 && mx < L + 3) out.push({ d: 99, f: () => iso.label(mx, 5.4, 0.2, `+${q.length - 9}`, 12, INK) });
    });
  }
  out.sort((a, b) => a.d - b.d).forEach((i) => i.f());
  // つり革
  for (const ry of [-0.72, 0.72]) {
    iso.line([0.4, ry, 2.05], [L - 0.4, ry, 2.05], '#9A9184', Math.max(1, s * 0.07));
    for (let sx = 1.0; sx < L - 0.6; sx += 1.3) {
      iso.line([sx, ry, 2.05], [sx, ry, 1.82], '#9A9184', 1);
      const [rx, ry2] = iso.P(sx, ry, 1.76);
      iso.ell(rx, ry2, 0.07 * s, 0.07 * s, null, 1.3, '#FFFDF6');
    }
  }
  // 降りる客の札
  for (const b of S.bodies) {
    if (b.dest !== st || b.state === 'exit') continue;
    const [hx, hy] = iso.P(b.x, b.y, b.state === 'seat' ? 1.7 : 2.1);
    tag(hx, hy, STATIONS[b.dest].slice(0, 1), DEST_COLORS[b.dest]);
  }
  // ポップ
  S.popups = S.popups.filter((p) => S.time - p.t < 1.3);
  for (const p of S.popups) {
    const k = (S.time - p.t) / 1.3;
    ctx.globalAlpha = 1 - k * k;
    iso.label(p.x, p.y, p.z + k * 1.2, p.text, 14, p.color);
    ctx.globalAlpha = 1;
  }
  // 慣性の矢印
  if (Math.abs(S.a) > 1.1 && S.phase === 'run') {
    const dir = S.a < 0 ? 1 : -1;
    const strong = Math.abs(S.a) > KIND.normal.grip;
    ctx.globalAlpha = 0.85;
    const [ax, ay] = iso.P(L / 2 - dir * 2.5, 0, 2.6);
    const [bx, by] = iso.P(L / 2 + dir * 2.5, 0, 2.6);
    ctx.strokeStyle = strong ? '#E4553A' : '#9A8064';
    ctx.lineWidth = strong ? 5 : 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    const ang = Math.atan2(by - ay, bx - ax);
    ctx.moveTo(bx, by);
    ctx.lineTo(bx - Math.cos(ang - 0.5) * 14, by - Math.sin(ang - 0.5) * 14);
    ctx.moveTo(bx, by);
    ctx.lineTo(bx - Math.cos(ang + 0.5) * 14, by - Math.sin(ang + 0.5) * 14);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

function person(iso: Iso, b: Body) {
  const seat = b.state === 'seat';
  const facing: Facing = seat ? (b.y < 0 ? 2 : 3) : b.face;
  if (!seat) {
    // 床の目印：行き先の色、ふちが機嫌
    const [mx, my] = iso.P(b.x, b.y, 0.006);
    const moodC = ['#B53E28', '#E4553A', '#E9B23E', INK][b.mood];
    iso.ell(mx, my, b.r * 0.85 * iso.s * 1.22, b.r * 0.85 * iso.s * 0.7, DEST_COLORS[b.dest] ?? '#B9B0A2', b.mood < 3 ? iso.lw * 1.6 : iso.lw * 0.8, moodC);
  }
  const tilt = b.sliding > 0 ? Math.sign(b.vx) * 0.12 : 0;
  const scale = b.kind === 'sumo' ? 1.35 : b.kind === 'kid' ? 0.72 : 1;
  const sub = new Iso(iso.ctx, iso.s * scale, 0, 0);
  const [px, py] = iso.P(b.x + tilt, b.y, 0);
  const [qx, qy] = sub.P(0, 0, 0);
  sub.ox = px - qx;
  sub.oy = py - qy;
  sub.lw = iso.lw;
  drawPerson(sub, 0, 0, 0, b.look, { pose: seat ? 'sit' : 'stand', facing });
  if (b.mood <= 1 && !seat) {
    const [hx, hy] = iso.P(b.x, b.y, 1.9 * scale);
    iso.ctx.fillStyle = '#E4553A';
    iso.ctx.font = `900 ${Math.max(10, iso.s * 0.4)}px "Zen Maru Gothic", sans-serif`;
    iso.ctx.textAlign = 'center';
    iso.ctx.fillText('💢', hx + iso.s * 0.3, hy);
  }
}

function drawWaiting(iso: Iso, w: Waiting, x: number, y: number) {
  if (x < -3.3 || x > L + 3.3) return;
  const scale = w.kind === 'sumo' ? 1.35 : w.kind === 'kid' ? 0.72 : 1;
  const sub = new Iso(iso.ctx, iso.s * scale, 0, 0);
  const [px, py] = iso.P(x, y, 0);
  const [qx, qy] = sub.P(0, 0, 0);
  sub.ox = px - qx;
  sub.oy = py - qy;
  sub.lw = iso.lw;
  const look = w.kind === 'sumo' ? { ...w.look, shirt: '#F3EEE2', pants: '#3A3631', hairStyle: 2, hat: 0, bag: 0 } : w.kind === 'student' ? { ...w.look, shirt: '#2D3550', pants: '#2D3550', hat: 0 } : w.look;
  drawPerson(sub, 0, 0, 0, look, { pose: 'stand', facing: 3 });
}

function pole(iso: Iso, x: number, y: number) {
  const w = 0.12 * iso.s;
  iso.line([x, y, 0], [x, y, 2.05], INK, w + 1.4);
  iso.line([x, y, 0], [x, y, 2.05], '#D8D2C6', Math.max(0.5, w - 0.4));
}

function tag(x: number, y: number, text: string, bg: string) {
  ctx.font = '900 12px "Zen Maru Gothic", sans-serif';
  const tw = 22;
  ctx.beginPath();
  ctx.roundRect(x - tw / 2, y - 18, tw, 18, 4);
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = INK;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y - 8.5);
}

function drawApproach(w: number, _h: number) {
  const st = S.target;
  const pad = 14;
  ctx.textBaseline = 'alphabetic';
  // 停止範囲（先頭の位置で）
  const lo = POS[st] - 7;
  const hi = POS[st] + 3;
  const span = 140;
  const x0 = pad;
  const x1 = w - pad;
  const map = (x: number) => x0 + ((x - (hi + 10 - span)) / span) * (x1 - x0);
  const y = 26;
  ctx.fillStyle = '#FFFDF6';
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(x0, y - 8, x1 - x0, 16, 8);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = 'rgba(111,195,160,0.6)';
  ctx.fillRect(map(lo), y - 6.5, map(hi) - map(lo), 13);
  // 乗車位置にドアが合う先頭位置
  for (const m of MARKS) {
    for (const d of DOORS) {
      const xf = POS[st] + m + (L - d);
      if (xf < lo - 0.01 || xf > hi + 0.01) continue;
      ctx.fillStyle = '#E9B23E';
      const mx = map(xf);
      ctx.beginPath();
      ctx.moveTo(mx - 4, y - 8);
      ctx.lineTo(mx + 4, y - 8);
      ctx.lineTo(mx, y - 2);
      ctx.fill();
    }
  }
  const tx = Math.max(x0 + 3, Math.min(x1 - 3, map(S.xf)));
  ctx.fillStyle = INK;
  ctx.fillRect(tx - 2, y - 11, 4, 22);
  ctx.font = '700 11px "Zen Maru Gothic", sans-serif';
  ctx.textAlign = 'left';
  const dist = lo - S.xf;
  ctx.fillText(
    S.phase === 'open' ? `${STATIONS[st]} 停車中` : dist > 0 ? `${STATIONS[st]}の停止範囲まで ${Math.round(dist)}m` : S.xf <= hi ? '停止範囲内' : 'オーバーラン',
    x0,
    y - 12,
  );
  ctx.textAlign = 'right';
  ctx.fillText('▼＝ドアが乗車位置に合う', x1, y - 12);
}

// ---------- HUD とレバー ----------
function renderHud() {
  const st = S.target;
  const rate = Math.round((onboard() / CAPACITY) * 100);
  $('h-station').textContent = S.phase === 'open' ? `${STATIONS[st]}（${st + 1}/${STATIONS.length}）` : `次は ${STATIONS[st]}`;
  $('h-speed').textContent = `${Math.round(S.v * 3.6)}km/h`;
  const rateEl = $('h-rate');
  rateEl.textContent = `${rate}%`;
  rateEl.className = 'rate' + (rate >= 150 ? ' hot' : rate >= 100 ? ' warm' : '');
  $('h-fare').textContent = `¥${S.fare.toLocaleString()}`;
  $('h-sub').textContent = `降車${S.ok}・乗り過ごし${S.missed}・積み残し${S.left}`;
  const hint =
    S.phase === 'open'
      ? st === STATIONS.length - 1
        ? '終点。全員降りるまで待とう'
        : 'P（力行）に入れるとドアが閉まって発車'
      : S.phase === 'closing'
        ? 'ドアが閉まります'
        : '強いブレーキ（B2以上）や加速で、立っている客が滑る';
  $('hint').textContent = hint;
  const tbox = $('toasts');
  const live = S.toasts.filter((t) => S.time - t.t < 2.6);
  const key = live.map((t) => t.text + t.t).join('|');
  if (tbox.dataset.k !== key) {
    tbox.dataset.k = key;
    tbox.innerHTML = live.map((t) => `<div class="toast ${t.kind}">${t.text}</div>`).join('');
  }
}

function renderLever() {
  document.querySelectorAll<HTMLElement>('.notch').forEach((n) => n.classList.toggle('on', Number(n.dataset.n) === S.notch));
}

const lever = $('lever');
NOTCH_NAME.forEach((name, i) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'notch' + (i < 4 ? ' brake' : i > 4 ? ' power' : '') + (i === 0 ? ' eb' : '');
  b.dataset.n = String(i);
  b.textContent = name;
  lever.appendChild(b);
});
let leverDrag = false;
const fromPoint = (e: PointerEvent) => {
  const el = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('.notch');
  if (el) setNotch(Number(el.dataset.n));
};
lever.addEventListener('pointerdown', (e) => {
  leverDrag = true;
  lever.setPointerCapture(e.pointerId);
  fromPoint(e);
});
lever.addEventListener('pointermove', (e) => leverDrag && fromPoint(e));
lever.addEventListener('pointerup', () => (leverDrag = false));
lever.addEventListener('pointercancel', () => (leverDrag = false));
window.addEventListener('keydown', (e) => {
  if (e.code === 'ArrowUp' || e.code === 'KeyW' || e.code === 'ArrowRight') setNotch(S.notch + 1);
  else if (e.code === 'ArrowDown' || e.code === 'KeyS' || e.code === 'ArrowLeft') setNotch(S.notch - 1);
  else if (e.code === 'Space') {
    e.preventDefault();
    setNotch(0);
  } else if (e.code === 'KeyN') setNotch(4);
});
$('retry').addEventListener('click', () => {
  reset();
  setNotch(4);
});

// ---------- ループ ----------
const SPEED = Math.max(1, Number(new URLSearchParams(location.search).get('speed')) || 1);
if (new URLSearchParams(location.search).has('debug')) (window as unknown as { __S: unknown; __set: unknown }).__S = S;
(window as unknown as { __set: unknown }).__set = setNotch;
reset();
renderLever();
let last = performance.now();
function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000) * SPEED;
  last = now;
  const steps = Math.ceil(dt / (1 / 120));
  for (let i = 0; i < steps; i++) {
    update(dt / steps);
    physics(dt / steps);
  }
  draw();
  renderHud();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
