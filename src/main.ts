import './style.css';
import { ENODEN } from './data.ts';
import {
  capacity,
  carsOnPlatform,
  loadOfCar,
  slotsPerCar,
  chooseOffer,
  countdown,
  DELAY_LIMIT,
  dismissOffer,
  isTerminal,
  load,
  newGame,
  requestDepart,
  setBrake,
  update,
  isCarFull,
  relayout,
  movePassengerToCar,
  type Game,
} from './game.ts';
import { DEST_COLORS } from './data.ts';
import type { ExtResult } from './exterior.ts';
import type { InteriorHit } from './interior.ts';
import { noteFocusChange } from './interior.ts';
import { draw } from './render.ts';
import type { UpgradeDef } from './upgrades.ts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const canvas = $<HTMLCanvasElement>('view');
const ctx = canvas.getContext('2d')!;
const stage = $('stage');

let game: Game | null = null;
let shownOffer: UpgradeDef[] | null = null;
let shownToasts = '';
let resultShown = false;

// ---- 視点（外／車内） ----
let mode: 'out' | 'in' = 'out';
let focus = 0;
let lastExt: ExtResult | null = null;
let hits: InteriorHit[] = [];
interface Drag {
  id: number;
  pointerId: number;
  x0: number;
  y0: number;
  sx: number;
  sy: number;
  active: boolean;
  over: number;
}
let drag: Drag | null = null;
const backBtn = $<HTMLButtonElement>('btn-out');
const ghost = $('drag-ghost');

function openInterior(car: number) {
  if (!game) return;
  car = Math.max(0, Math.min(game.stats.cars - 1, car));
  if (mode === 'in') noteFocusChange(focus, car);
  focus = car;
  mode = 'in';
  stripKey = '';
}
function closeInterior() {
  cancelDrag();
  mode = 'out';
  stripKey = '';
}
backBtn.addEventListener('click', closeInterior);

function stagePoint(e: PointerEvent): [number, number] {
  const r = canvas.getBoundingClientRect();
  return [e.clientX - r.left, e.clientY - r.top];
}

canvas.addEventListener('pointerdown', (e) => {
  if (!game) return;
  const [x, y] = stagePoint(e);
  if (mode === 'out') {
    const t = lastExt?.train;
    if (t && x >= t.x0 - 10 && x <= t.x1 + 10 && y >= t.y0 - 10 && y <= t.y1 + 10) {
      // 押した場所に近い車両を開く（右下が先頭＝1号車）
      const f = (x - t.x0) / Math.max(1, t.x1 - t.x0);
      openInterior(game.stats.cars - 1 - Math.floor(f * game.stats.cars));
    }
    return;
  }
  // 頭に近い順
  let best: InteriorHit | null = null;
  let bd = Infinity;
  for (const h of hits) {
    const d = Math.hypot(h.sx - x, h.sy - y);
    if (d < h.r && d < bd) {
      bd = d;
      best = h;
    }
  }
  if (!best) return;
  e.preventDefault();
  canvas.setPointerCapture(e.pointerId);
  drag = { id: best.id, pointerId: e.pointerId, x0: x, y0: y, sx: x, sy: y, active: false, over: -1 };
});
canvas.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.pointerId || !game) return;
  const [x, y] = stagePoint(e);
  drag.sx = x;
  drag.sy = y;
  if (!drag.active && Math.hypot(x - drag.x0, y - drag.y0) > 6) drag.active = true;
  if (!drag.active) return;
  const el = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('.car-btn');
  const over = el ? Number(el.dataset.k) : -1;
  drag.over = over;
  const p = game.passengers.find((q) => q.id === drag!.id);
  ghost.hidden = !(y > canvas.getBoundingClientRect().height - 4);
  ghost.style.left = `${e.clientX}px`;
  ghost.style.top = `${e.clientY}px`;
  if (p) ghost.style.setProperty('--c', DEST_COLORS[p.dest] ?? '#E9B23E');
  ghost.textContent = p ? `${game.line.stations[p.dest]?.name ?? ''}まで` : '';
  document.querySelectorAll<HTMLElement>('.car-btn').forEach((b) => {
    const k = Number(b.dataset.k);
    b.classList.toggle('drop-ok', k === over && k !== p?.car && !isCarFull(game!, k));
    b.classList.toggle('drop-full', k === over && k !== p?.car && isCarFull(game!, k));
  });
});
function endDrag(e: PointerEvent) {
  if (!drag || e.pointerId !== drag.pointerId || !game) return;
  const d = drag;
  if (d.active && d.over >= 0) {
    const p = game.passengers.find((q) => q.id === d.id);
    const btn = document.querySelector<HTMLElement>(`.car-btn[data-k="${d.over}"]`);
    if (p && p.car !== d.over) {
      if (movePassengerToCar(game, d.id, d.over)) {
        stripKey = '';
      } else if (btn) {
        btn.classList.remove('shake');
        void btn.offsetWidth;
        btn.classList.add('shake');
      }
    }
  }
  cancelDrag();
}
function cancelDrag() {
  drag = null;
  ghost.hidden = true;
  document.querySelectorAll('.car-btn').forEach((b) => b.classList.remove('drop-ok', 'drop-full'));
}
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', () => cancelDrag());

// ---- 画面サイズ ----
// 下の操作欄の高さが変わるとステージも変わるので、毎フレーム大きさを合わせる
function fitCanvas(): { w: number; h: number } {
  const dpr = window.devicePixelRatio || 1;
  const r = stage.getBoundingClientRect();
  const cw = Math.round(r.width * dpr);
  const ch = Math.round(r.height * dpr);
  if (canvas.width !== cw || canvas.height !== ch) {
    canvas.width = cw;
    canvas.height = ch;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { w: r.width, h: r.height };
}

// ---- 入力 ----
const brakeBtn = $<HTMLButtonElement>('btn-brake');
const press = (e?: Event) => {
  e?.preventDefault();
  if (game) setBrake(game, true);
  brakeBtn.classList.add('held');
};
const release = () => {
  if (game) setBrake(game, false);
  brakeBtn.classList.remove('held');
};
brakeBtn.addEventListener('pointerdown', (e) => {
  brakeBtn.setPointerCapture(e.pointerId);
  press(e);
});
brakeBtn.addEventListener('pointerup', release);
brakeBtn.addEventListener('pointercancel', release);
brakeBtn.addEventListener('lostpointercapture', release);
brakeBtn.addEventListener('contextmenu', (e) => e.preventDefault());

window.addEventListener('keydown', (e) => {
  if (!game) return;
  if (e.code === 'Space') {
    e.preventDefault();
    if (!e.repeat) press();
  } else if (e.code === 'Enter') {
    requestDepart(game);
  } else if (['Digit1', 'Digit2', 'Digit3'].includes(e.code)) {
    chooseOffer(game, Number(e.code.slice(-1)) - 1);
  }
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'Space') release();
});
window.addEventListener('blur', release);

$('btn-depart').addEventListener('click', () => game && requestDepart(game));
$('offer-skip').addEventListener('click', () => game && dismissOffer(game));
$('btn-start').addEventListener('click', start);
$('btn-retry').addEventListener('click', start);

function start() {
  game = newGame(ENODEN);
  // 確認用：?cars=12&doors=8 で魔改造済みの状態から始める
  const q = new URLSearchParams(location.search);
  const cars = Number(q.get('cars'));
  const doors = Number(q.get('doors'));
  if (cars > 0) game.stats.cars = cars;
  if (doors > 0) game.stats.doorsPerCar = doors;
  // ?lv=capacity:2,cooler:3 で強化レベルも指定できる（見た目の確認用）
  for (const part of (q.get('lv') ?? '').split(',')) {
    const [id, n] = part.split(':');
    if (id && Number(n) > 0) game.stats.levels[id] = Number(n);
  }
  relayout(game);
  shownOffer = null;
  shownToasts = '';
  mode = 'out';
  focus = 0;
  cancelDrag();
  resultShown = false;
  $('screen-title').hidden = true;
  $('screen-result').hidden = true;
  release();
}

// ---- HUD ----
function clock(sec: number): string {
  const base = 10 * 3600 + Math.floor(sec);
  const h = Math.floor(base / 3600) % 24;
  const m = Math.floor(base / 60) % 60;
  const s = base % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function mmss(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function renderHud(g: Game) {
  const st = g.line.stations[g.target];
  const n = g.line.stations.length;
  $('hud-line').textContent = g.line.name;
  $('hud-station').textContent =
    g.phase === 'running' ? `次は ${st.name}（${g.target + 1}/${n}）` : `${st.name}（${g.target + 1}/${n}）`;
  $('hud-clock').textContent = clock(g.time);

  const cd = countdown(g);
  const cdEl = $('hud-countdown');
  const label = g.phase === 'running' ? '到着予定' : '発車';
  if (cd >= 0) {
    cdEl.textContent = `${label}まで ${mmss(cd)}`;
    cdEl.classList.remove('chip-late');
  } else {
    cdEl.textContent = `遅れ +${mmss(-cd)}`;
    cdEl.classList.add('chip-late');
  }
  $('g-delay').style.width = `${Math.min(100, (g.delay / DELAY_LIMIT) * 100)}%`;
  $('g-trust').style.width = `${g.trust}%`;
  $('hud-trust').textContent = String(Math.round(g.trust));
  $('hud-load').textContent = `乗車 ${load(g)}/${capacity(g)}人`;
  $('hud-formation').textContent = `${g.stats.cars}両・ドア${g.stats.doorsPerCar}枚/両`;
  $('hud-money').textContent = `¥${g.money.toLocaleString()}`;

  const running = g.phase === 'running';
  $('ctl-run').hidden = !running;
  $('ctl-dwell').hidden = running || g.phase === 'clear' || g.phase === 'over';

  if (!running) {
    const dep = $<HTMLButtonElement>('btn-depart');
    dep.disabled = g.phase !== 'dwell' || isTerminal(g) || g.departQueued;
    dep.textContent = isTerminal(g)
      ? '終点（全員降ろす）'
      : g.departQueued
        ? 'ドアを閉めています…'
        : '発車 ▶';
  }

  renderCarStrip(g);

  // 強化の3択
  if (g.offer !== shownOffer) {
    shownOffer = g.offer;
    const box = $('offer');
    box.hidden = !g.offer;
    const cards = $('offer-cards');
    cards.innerHTML = '';
    g.offer?.forEach((u, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `card ${u.rarity}`;
      const tag = u.rarity === 'rare' ? 'レア' : u.rarity === 'risk' ? 'リスク' : '強化';
      const lv = (g.stats.levels[u.id] ?? 0) + 1;
      b.innerHTML = `<span class="tag">${tag} Lv.${lv}</span><span class="name"></span><span class="desc"></span>`;
      b.querySelector('.name')!.textContent = u.name(g.stats);
      b.querySelector('.desc')!.textContent = u.desc(g.stats);
      b.addEventListener('click', () => game && chooseOffer(game, i));
      cards.appendChild(b);
    });
  }

  // トースト
  const key = g.toasts.map((t) => t.text).join('|');
  if (key !== shownToasts) {
    shownToasts = key;
    const box = $('toasts');
    box.innerHTML = '';
    for (const t of g.toasts) {
      const d = document.createElement('div');
      d.className = `toast ${t.kind}`;
      d.textContent = t.text;
      box.appendChild(d);
    }
  }

  if ((g.phase === 'clear' || g.phase === 'over') && !resultShown) {
    resultShown = true;
    showResult(g);
  }
}

let stripKey = '';
function renderCarStrip(g: Game) {
  const on = carsOnPlatform(g);
  const per = slotsPerCar(g);
  const cars: { load: number; alight: number; cut: boolean }[] = [];
  for (let k = 0; k < g.stats.cars; k++) cars.push({ load: loadOfCar(g, k), alight: 0, cut: k >= on });
  for (const p of g.passengers) if (p.dest === g.target) cars[p.car].alight++;
  const key = JSON.stringify([per, cars, mode, focus]);
  if (key === stripKey) return;
  stripKey = key;
  const box = $('car-strip');
  // ドラッグ中に要素が作り直されないよう、数が同じなら中身だけ差し替える
  while (box.children.length < cars.length) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.k = String(box.children.length);
    b.addEventListener('click', () => openInterior(Number(b.dataset.k)));
    b.addEventListener('animationend', () => b.classList.remove('shake'));
    box.appendChild(b);
  }
  while (box.children.length > cars.length) box.lastElementChild!.remove();
  cars.forEach((c, k) => {
    const b = box.children[k] as HTMLButtonElement;
    const keep = ['drop-ok', 'drop-full', 'shake'].filter((x) => b.classList.contains(x));
    b.className =
      'car-btn' +
      (c.cut ? ' cut' : '') +
      (c.cut && c.alight > 0 ? ' warn' : '') +
      (c.load >= per ? ' full' : '') +
      (mode === 'in' && k === focus ? ' cur' : '') +
      keep.map((x) => ' ' + x).join('');
    const right = c.load >= per ? '満' : c.alight > 0 ? `降${c.alight}${c.cut ? '！' : ''}` : '';
    b.innerHTML = `<span class="row"><span>${k + 1}号車</span><span>${right}</span></span><span class="bar"><i style="width:${Math.round((c.load / Math.max(1, per)) * 100)}%"></i></span><span class="sub">${c.cut ? '開かない' : `${c.load}/${per}人`}</span><span class="drop-label"></span>`;
  });
  if (mode === 'in') (box.children[focus] as HTMLElement | undefined)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function showResult(g: Game) {
  const clear = g.phase === 'clear';
  $('result-led').textContent = clear ? 'ご乗車ありがとうございました' : '運転を見合わせています';
  $('result-title').textContent = clear ? '終点 鎌倉 到着' : '運転打ち切り';
  $('result-reason').textContent = clear
    ? `${g.line.name}を走りきった！`
    : `${g.line.stations[g.target].name}付近で、${g.overReason}。`;
  const rows: [string, string][] = [
    ['運んだ人数', `${g.carried}人`],
    ['ぴったり停車', `${g.perfect}回`],
    ['積み残し', `${g.leftBehind}人`],
    ['最後の信頼', `${Math.round(g.trust)}`],
    ['最終編成', `${g.stats.cars}両・ドア${g.stats.doorsPerCar}枚/両・定員${capacity(g)}人`],
    ['運賃', `¥${g.money.toLocaleString()}`],
  ];
  const dl = $('result-stats');
  dl.innerHTML = '';
  for (const [k, v] of rows) {
    const dt = document.createElement('dt');
    dt.textContent = k;
    const dd = document.createElement('dd');
    dd.textContent = v;
    dl.append(dt, dd);
  }
  $('screen-result').hidden = false;
}

// ---- ループ ----
// 確認用：?speed=4 で時間を早回し
const SPEED = Math.max(1, Number(new URLSearchParams(location.search).get('speed')) || 1);
const DEBUG = new URLSearchParams(location.search).has('debug');
let last = performance.now();
function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000) * SPEED;
  last = now;
  if (game) {
    update(game, dt);
    // 駅が近づいたら外の視点に戻す（ブレーキの見極めは外で）
    if (mode === 'in' && game.phase === 'running' && game.pos[game.target] - game.x < 160) closeInterior();
    if (mode === 'in' && (game.phase === 'clear' || game.phase === 'over')) closeInterior();
    if (focus >= game.stats.cars) focus = game.stats.cars - 1;
    const r = fitCanvas();
    const res = draw(ctx, game, r.w, r.h, {
      mode,
      focus,
      drag: drag && drag.active ? { id: drag.id, sx: drag.sx, sy: drag.sy } : null,
      dt,
    });
    lastExt = res.ext;
    hits = res.hits;
    if (DEBUG) (window as unknown as { __hakobi: unknown }).__hakobi = { game, hits };
    backBtn.hidden = mode !== 'in';
    document.body.classList.toggle('view-in', mode === 'in');
    renderHud(game);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
