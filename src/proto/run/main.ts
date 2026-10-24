// 試作 v0.7「障害突破ラン」の画面と入力。

import { DEST_COLORS } from '../../data.ts';
import { drawBar, drawInside, drawOutside, type Hit } from './draw.ts';
import {
  DELAY_LIMIT,
  KINDS,
  LINE,
  NOTCH_NAME,
  POS,
  SEATS,
  chooseOffer,
  depart,
  kmh,
  moveToSpot,
  newRun,
  nextObstacle,
  pickedSeats,
  seatsUsed,
  setNotch,
  tapObstacle,
  togglePick,
  update,
  useItem,
  type ItemId,
  type Obstacle,
  type Pax,
  type Run,
} from './state.ts';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('view');
const ctx = canvas.getContext('2d')!;
let R: Run = newRun();
let mode: 'out' | 'in' = 'out';
let hits: Hit[] = [];
let trainBox: { x0: number; y0: number; x1: number; y1: number } | null = null;
let drag: { id: number; sx: number; sy: number; pid: number; moved: boolean } | null = null;

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

// ---------- 入力 ----------
const pt = (e: PointerEvent) => {
  const b = canvas.getBoundingClientRect();
  return [e.clientX - b.left, e.clientY - b.top];
};
canvas.addEventListener('pointerdown', (e) => {
  const [x, y] = pt(e);
  if (mode === 'out') {
    // 障害のタップを優先
    let best: Hit | null = null;
    let bd = Infinity;
    for (const h of hits) {
      if (h.kind !== 'obstacle') continue;
      const d = Math.hypot(h.x - x, h.y - y);
      if (d < h.r && d < bd) {
        bd = d;
        best = h;
      }
    }
    if (best) {
      tapObstacle(R, best.ref as Obstacle);
      ripple(e.clientX, e.clientY);
      return;
    }
    const t = trainBox;
    if (t && x >= t.x0 && x <= t.x1 && y >= t.y0 && y <= t.y1) setMode('in');
    return;
  }
  let best: Hit | null = null;
  let bd = Infinity;
  for (const h of hits) {
    if (h.kind !== 'pax') continue;
    const d = Math.hypot(h.x - x, h.y - y);
    if (d < h.r && d < bd) {
      bd = d;
      best = h;
    }
  }
  if (!best) return;
  canvas.setPointerCapture(e.pointerId);
  drag = { id: (best.ref as Pax).id, sx: x, sy: y, pid: e.pointerId, moved: false };
});
canvas.addEventListener('pointermove', (e) => {
  if (!drag || drag.pid !== e.pointerId) return;
  const [x, y] = pt(e);
  if (Math.hypot(x - drag.sx, y - drag.sy) > 4) drag.moved = true;
  drag.sx = x;
  drag.sy = y;
});
canvas.addEventListener('pointerup', (e) => {
  if (!drag || drag.pid !== e.pointerId) return;
  const [x, y] = pt(e);
  let best = -1;
  let bd = Infinity;
  for (const h of hits) {
    if (h.kind !== 'spot') continue;
    const d = Math.hypot(h.x - x, h.y - (y + 20));
    if (d < 60 && d < bd) {
      bd = d;
      best = h.ref as number;
    }
  }
  if (drag.moved && best >= 0) moveToSpot(R, drag.id, best);
  drag = null;
});
canvas.addEventListener('pointercancel', () => (drag = null));

function ripple(x: number, y: number) {
  const d = document.createElement('div');
  d.className = 'ripple';
  d.style.left = `${x}px`;
  d.style.top = `${y}px`;
  document.body.appendChild(d);
  setTimeout(() => d.remove(), 400);
}

function setMode(m: 'out' | 'in') {
  mode = m;
  drag = null;
  $('btn-mode').textContent = m === 'in' ? '◀ 外へ' : '車内へ ▶';
  document.body.classList.toggle('inside', m === 'in');
}
$('btn-mode').addEventListener('click', () => setMode(mode === 'in' ? 'out' : 'in'));

// レバー
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
  if (el && R.phase === 'running') setNotch(R, Number(el.dataset.n));
};
lever.addEventListener('pointerdown', (e) => {
  leverDrag = true;
  try {
    lever.setPointerCapture(e.pointerId);
  } catch {
    // 合成イベントなど
  }
  fromPoint(e);
});
lever.addEventListener('pointermove', (e) => leverDrag && fromPoint(e));
lever.addEventListener('pointerup', () => (leverDrag = false));
lever.addEventListener('pointercancel', () => (leverDrag = false));
window.addEventListener('keydown', (e) => {
  if (R.phase !== 'running') {
    if (e.code === 'Enter') depart(R);
    return;
  }
  if (e.code === 'ArrowUp' || e.code === 'KeyW') setNotch(R, R.notch + 1);
  else if (e.code === 'ArrowDown' || e.code === 'KeyS') setNotch(R, R.notch - 1);
  else if (e.code === 'Space') {
    e.preventDefault();
    const o = nextObstacle(R);
    if (o) tapObstacle(R, o);
  } else if (e.code === 'Tab') {
    e.preventDefault();
    setMode(mode === 'in' ? 'out' : 'in');
  }
});

// アイテム
const ITEM_DEF: { id: ItemId; name: string; ch: string; desc: string; col: string }[] = [
  { id: 'jump', name: 'ジャンプ台', ch: '跳', desc: '次を飛び越す', col: '#8299E0' },
  { id: 'saw', name: 'チェーンソー', ch: '鋸', desc: '柱と木を即撤去', col: '#E9B23E' },
  { id: 'airbag', name: 'エアバッグ', ch: '袋', desc: '次の衝撃で無事', col: '#F0A79C' },
];
const itemsBox = $('items');
for (const it of ITEM_DEF) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'item';
  b.dataset.id = it.id;
  b.innerHTML = `<span class="ic" style="background:${it.col}">${it.ch}</span><span class="nm">${it.name}<small>${it.desc}</small></span><span class="ct"></span>`;
  b.addEventListener('click', () => useItem(R, it.id));
  itemsBox.appendChild(b);
}

$('btn-depart').addEventListener('click', () => depart(R));
$('retry').addEventListener('click', () => {
  R = newRun();
  setMode('out');
  $('result').hidden = true;
  resultShown = false;
  candKey = '';
  offerShown = null;
});

// ---------- HUD ----------
function clock(t: number) {
  const s = 10 * 3600 + Math.floor(t);
  return `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

let candKey = '';
let offerShown: unknown = null;
let resultShown = false;
let shockShown = 0;

function renderHud() {
  const st = Math.min(R.target, LINE.stations.length - 1);
  $('h-station').textContent = R.phase === 'dwell' ? `${LINE.stations[st].name}（${st + 1}/${LINE.stations.length}）停車中` : `次は ${LINE.stations[st].name}`;
  $('h-clock').textContent = clock(R.time);
  $('h-delay').textContent = R.phase === 'dwell' ? (R.time < R.depart ? `発車まで ${Math.ceil(R.depart - R.time)}秒` : `発車遅れ +${Math.round(R.time - R.depart)}秒`) : `遅れ +${Math.round(R.delay)}秒`;
  $('h-delay').classList.toggle('late', R.delay > 0);
  ($('g-delay') as HTMLElement).style.width = `${Math.min(100, (R.delay / DELAY_LIMIT) * 100)}%`;
  ($('g-trust') as HTMLElement).style.width = `${R.trust}%`;
  $('h-trust').textContent = String(Math.round(R.trust));
  $('h-money').textContent = `¥${R.money.toLocaleString()}`;
  $('h-speed').textContent = `${Math.round(kmh(R.v))}km/h`;
  const mods = [...R.mods].map((m) => ({ belt: 'シートベルト', ram: '衝角', susp: 'サス' })[m]).join('・');
  $('h-mods').textContent = mods ? `改造：${mods}` : '';

  document.body.classList.toggle('dwell', R.phase === 'dwell');
  document.querySelectorAll<HTMLElement>('.notch').forEach((n) => n.classList.toggle('on', Number(n.dataset.n) === R.notch));
  itemsBox.querySelectorAll<HTMLButtonElement>('.item').forEach((b) => {
    const id = b.dataset.id as ItemId;
    b.querySelector('.ct')!.textContent = `×${R.items[id]}`;
    b.disabled = R.items[id] <= 0 || R.phase !== 'running';
    b.classList.toggle('armed', (id === 'jump' && R.armed === 'jump') || (id === 'airbag' && R.airbag));
  });

  // ホームの候補
  if (R.phase === 'dwell') {
    const key = JSON.stringify([R.candidates.map((c) => c.id), [...R.picked], seatsUsed(R)]);
    if (key !== candKey) {
      candKey = key;
      const box = $('cands');
      box.innerHTML = '';
      for (const c of R.candidates) {
        const k = KINDS[c.kind];
        const sel = R.picked.has(c.id);
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'cand' + (sel ? ' sel' : '') + (c.kind === 'vip' ? ' req' : '');
        const fare = c.kind === 'vip' ? 2000 : k.fare * (c.dest - c.from);
        b.innerHTML = `${sel ? '<span class="flag">乗せる</span>' : c.kind === 'vip' ? '<span class="flag req">依頼</span>' : ''}<span class="ic" style="background:${k.color}">${k.ch}</span><b>${k.name}${k.size > 1 ? `<small>席${k.size}</small>` : ''}</b><span class="dest"><i style="background:${DEST_COLORS[c.dest]}"></i>${LINE.stations[c.dest].name}</span><span class="nums"><span>¥${fare}</span><span class="tol">耐${k.tol}</span></span><span class="note">${k.note}</span>`;
        b.addEventListener('click', () => togglePick(R, c.id));
        box.appendChild(b);
      }
      $('seats').textContent = `席 ${seatsUsed(R) + pickedSeats(R)}/${SEATS}（乗車中 ${R.pax.length}人）`;
      const n = R.picked.size;
      ($('btn-depart') as HTMLButtonElement).textContent = R.target >= LINE.stations.length - 1 ? '終点' : n ? `${n}人を乗せて発車 ▶` : '誰も乗せずに発車 ▶';
    }
    ($('btn-depart') as HTMLButtonElement).disabled = !!R.offer;
  } else candKey = '';

  // 3択
  if (R.offer !== offerShown) {
    offerShown = R.offer;
    const box = $('offer');
    box.hidden = !R.offer;
    const cards = $('offer-cards');
    cards.innerHTML = '';
    R.offer?.forEach((o, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ocard ' + o.kind;
      b.innerHTML = `<span class="tag">${o.kind === 'item' ? 'アイテム' : '魔改造'}</span><b>${o.name}</b><span>${o.desc}</span>`;
      b.addEventListener('click', () => chooseOffer(R, i));
      cards.appendChild(b);
    });
  }

  // 衝撃
  const sh = R.shocks[R.shocks.length - 1];
  if (sh && sh.t !== shockShown) {
    shockShown = sh.t;
    const el = $('shock');
    el.innerHTML = `<span class="lbl">${sh.label}</span><span class="num">衝撃 ${sh.value}！</span>${sh.flew.length ? `<span class="flew">${sh.flew.join('・')}が吹っ飛んだ！</span>` : sh.safe ? '<span class="safe">全員セーフ</span>' : ''}`;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
    if (sh.flew.length && mode === 'in') setMode('out');
  }

  // トースト
  const tb = $('toasts');
  const key = R.toasts.map((t) => t.text + t.t).join('|');
  if (tb.dataset.k !== key) {
    tb.dataset.k = key;
    tb.innerHTML = R.toasts.map((t) => `<div class="toast ${t.kind}">${t.text}</div>`).join('');
  }

  if ((R.phase === 'clear' || R.phase === 'over') && !resultShown) {
    resultShown = true;
    const clear = R.phase === 'clear';
    $('result-title').textContent = clear ? `終点 ${LINE.stations[LINE.stations.length - 1].name} 到着` : '運転打ち切り';
    $('result-reason').textContent = clear ? '試作の区間を走りきった！' : `${R.overReason}。`;
    const rows: [string, string][] = [
      ['運賃', `¥${R.money.toLocaleString()}`],
      ['運んだ客', `${R.stats.carried}人`],
      ['吹っ飛ばした客', `${R.stats.flew}人`],
      ['最大の衝撃', `${R.stats.maxShock}`],
      ['信頼', `${Math.round(R.trust)}`],
      ['遅れ', `${Math.round(R.delay)}秒`],
    ];
    $('result-stats').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
    $('result').hidden = false;
  }
}

// ---------- ループ ----------
const SPEED = Math.max(1, Number(new URLSearchParams(location.search).get('speed')) || 1);
if (new URLSearchParams(location.search).has('debug')) Object.assign(window, { __R: () => R, __mode: setMode });
let last = performance.now();
function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000) * SPEED;
  last = now;
  const steps = Math.ceil(dt / 0.02);
  for (let i = 0; i < steps; i++) update(R, dt / steps);
  // 障害や駅が近づいたら外へ戻す
  if (mode === 'in' && R.phase === 'running') {
    const o = nextObstacle(R);
    const near = (o && o.x - R.x < 45 && o.x - R.x > -5) || POS[R.target] - R.x < 90;
    if (near) setMode('out');
  }
  if (mode === 'in' && R.phase !== 'running' && R.phase !== 'dwell') setMode('out');
  const { w, h } = fit();
  ctx.fillStyle = '#F5EFE3';
  ctx.fillRect(0, 0, w, h);
  hits = [];
  if (mode === 'out') {
    const res = drawOutside(ctx, R, w, 56, h - 4, hits);
    trainBox = res.train;
  } else {
    drawInside(ctx, R, w, 56, h - 4, drag && drag.moved ? drag : null, hits);
  }
  drawBar(ctx, R, w, 22);
  renderHud();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
