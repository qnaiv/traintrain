import './style.css';
import { ENODEN } from './data.ts';
import {
  capacity,
  chooseOffer,
  countdown,
  DELAY_LIMIT,
  dismissOffer,
  doorCutCars,
  isTerminal,
  load,
  newGame,
  requestDepart,
  setBrake,
  toggleDoors,
  update,
  type Game,
} from './game.ts';
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

// ---- 画面サイズ ----
function resize() {
  const dpr = window.devicePixelRatio || 1;
  const r = stage.getBoundingClientRect();
  canvas.width = Math.round(r.width * dpr);
  canvas.height = Math.round(r.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', resize);
resize();

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
  } else if (e.code === 'KeyD') {
    toggleDoors(game);
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

$('btn-doors').addEventListener('click', () => game && toggleDoors(game));
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
  shownOffer = null;
  shownToasts = '';
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

  if (running) {
    $('run-speed').textContent = String(Math.round(g.v * 3.6));
    const remain = g.pos[g.target] - g.x;
    $('run-dist').textContent = remain >= 0 ? `${remain.toFixed(1)} m` : `${(-remain).toFixed(1)} m 超過`;
    $('g-brake').style.width = `${g.brake * 100}%`;
  } else {
    const info: string[] = [];
    if (g.phase === 'adjust') info.push('<span class="warn">停止位置を直しています…</span>');
    const alight = g.onboard[g.target];
    if (alight > 0) info.push(`降車待ち ${alight}人`);
    info.push(`乗車待ち ${g.waiting}人`);
    const cut = doorCutCars(g);
    if (cut > 0) info.push(`<span class="warn">${cut}両ドアカット</span>`);
    if (load(g) >= capacity(g) && g.waiting > 0) info.push('<span class="warn">満員</span>');
    $('dwell-info').innerHTML = info.join('');
    const doorsBtn = $<HTMLButtonElement>('btn-doors');
    doorsBtn.textContent = g.doorsWant ? 'ドアを閉める' : 'ドアを開ける';
    doorsBtn.disabled = g.phase !== 'dwell';
    const dep = $<HTMLButtonElement>('btn-depart');
    dep.disabled = g.phase !== 'dwell' || isTerminal(g) || g.departQueued;
    dep.textContent = isTerminal(g)
      ? '終点（全員降ろす）'
      : g.departQueued
        ? 'ドアを閉めています…'
        : g.doorsWant || g.doorAnim > 0
          ? '閉めて発車 ▶'
          : '発車 ▶';
  }

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
let last = performance.now();
function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000) * SPEED;
  last = now;
  if (game) {
    update(game, dt);
    const r = stage.getBoundingClientRect();
    draw(ctx, game, r.width, r.height);
    renderHud(game);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
