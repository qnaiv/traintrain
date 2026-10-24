// 「障害突破ラン」の画面と入力。車両基地 → ラン → リザルト → 車両基地 の流れ。

import { DEST_COLORS } from '../../data.ts';
import { drawBar, drawInside, drawOutside, type Hit } from './draw.ts';
import { isMuted, setIntensity, setScene, sfx, toggleMute, unlock } from './audio.ts';
import {
  CURVE_V,
  KINDS,
  LINE,
  NOTCH_NAME,
  OBS_INFO,
  POS,
  SHOCK,
  UPGRADES,
  WAVE_PERIOD,
  buyUpgrade,
  chooseOffer,
  depart,
  effTol,
  kmh,
  loadMeta,
  moveToSpot,
  newRun,
  nextObstacle,
  pickedSeats,
  predictShock,
  saveMeta,
  seatsUsed,
  setNotch,
  tapObstacle,
  togglePick,
  treeNeed,
  update,
  useItem,
  waveUp,
  wouldFly,
  type ItemId,
  type Obstacle,
  type Pax,
  type Run,
} from './state.ts';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('view');
const ctx = canvas.getContext('2d')!;
const meta = loadMeta();
let R: Run = newRun(meta);
let screen: 'hub' | 'run' = 'hub';
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

// ---------- 入力：キャンバス ----------
const pt = (e: PointerEvent) => {
  const b = canvas.getBoundingClientRect();
  return [e.clientX - b.left, e.clientY - b.top];
};
canvas.addEventListener('pointerdown', (e) => {
  const [x, y] = pt(e);
  if (mode === 'out') {
    let best: Hit | null = null;
    let bd = Infinity;
    for (const h of hits) {
      if (h.kind !== 'obstacle') continue;
      const d = Math.hypot(h.x - x, h.y - y);
      if (d < h.r * 1.5 && d < bd) {
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
  try {
    canvas.setPointerCapture(e.pointerId);
  } catch {
    // 合成イベント
  }
  drag = { id: (best.ref as Pax).id, sx: x, sy: y, pid: e.pointerId, moved: false };
  sfx.drag();
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
  if (drag.moved && best >= 0) {
    moveToSpot(R, drag.id, best);
    sfx.drop();
  }
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
  $('btn-mode').textContent = m === 'in' ? '◀ 外へ' : '車内 ▶';
  document.body.classList.toggle('inside', m === 'in');
}
$('btn-mode').addEventListener('click', () => setMode(mode === 'in' ? 'out' : 'in'));

// ---------- レバー ----------
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
    // 合成イベント
  }
  fromPoint(e);
});
lever.addEventListener('pointermove', (e) => leverDrag && fromPoint(e));
lever.addEventListener('pointerup', () => (leverDrag = false));
lever.addEventListener('pointercancel', () => (leverDrag = false));
window.addEventListener('keydown', (e) => {
  if (screen !== 'run') return;
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

// ---------- アイテム ----------
const ITEM_DEF: { id: ItemId; name: string; ch: string; col: string; tip: string }[] = [
  { id: 'jump', name: 'ジャンプ', ch: '跳', col: '#8299E0', tip: '次の障害を飛び越える' },
  { id: 'saw', name: 'チェーンソー', ch: '鋸', col: '#E9B23E', tip: '電柱か倒木を即撤去' },
  { id: 'airbag', name: 'エアバッグ', ch: '袋', col: '#F0A79C', tip: '次の衝撃で誰も飛ばない' },
];
const itemsBox = $('items');
for (const it of ITEM_DEF) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'item';
  b.dataset.id = it.id;
  b.title = it.tip;
  b.innerHTML = `<span class="ic" style="background:${it.col}">${it.ch}</span><span class="nm">${it.name}</span><span class="ct"></span>`;
  b.addEventListener('click', () => useItem(R, it.id));
  itemsBox.appendChild(b);
}

$('btn-depart').addEventListener('click', () => depart(R));

// ---------- 画面の切り替え ----------
function startRun() {
  R = newRun(meta);
  W.taps.clear();
  W.states.clear();
  W.phase = '';
  W.money = 0;
  W.picked = 0;
  screen = 'run';
  setMode('out');
  resultShown = false;
  candKey = '';
  offerShown = null;
  lastTrust = 100;
  $('hub').hidden = true;
  $('result').hidden = true;
}
function toHub() {
  screen = 'hub';
  $('result').hidden = true;
  renderHub();
  $('hub').hidden = false;
}
$('btn-start').addEventListener('click', startRun);
$('btn-hub').addEventListener('click', toHub);
$('btn-again').addEventListener('click', startRun);

function renderHub() {
  $('hub-bank').textContent = `¥${meta.bank.toLocaleString()}`;
  $('hub-sub').textContent = meta.runs ? `これまで ${meta.runs}回 出発・最高 ¥${meta.best.toLocaleString()}` : 'はじめての出発。まずは1回走ってみよう';
  const box = $('ups');
  box.innerHTML = '';
  for (const u of UPGRADES) {
    const lv = meta.lv[u.id];
    const max = u.cost.length;
    const cost = u.cost[lv];
    const el = document.createElement('div');
    el.className = 'up';
    const dots = Array.from({ length: max }, (_, i) => `<i class="${i < lv ? 'on' : ''}"></i>`).join('');
    const can = cost != null && meta.bank >= cost;
    el.innerHTML = `<div class="up-main"><b>${u.name}</b><span class="dots">${dots}</span><span class="desc">${cost == null ? '最大まで強化済み' : u.desc(lv)}</span></div>`;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'buy' + (can ? '' : ' no');
    btn.disabled = cost == null || !can;
    btn.innerHTML = cost == null ? '完了' : can ? `¥${cost.toLocaleString()}` : `¥${cost.toLocaleString()}<small>あと¥${(cost - meta.bank).toLocaleString()}</small>`;
    btn.addEventListener('click', () => {
      if (buyUpgrade(meta, u.id)) {
        sfx.coin();
        renderHub();
      }
    });
    el.appendChild(btn);
    box.appendChild(el);
  }
}

// ---------- HUD ----------
let candKey = '';
let offerShown: unknown = null;
let resultShown = false;
let shockShown = 0;
let lastAhead = 0;
let lastTrust = 100;
let trendT = 0;
let trend = 0;

function mmss(sec: number) {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function renderStatus() {
  const st = Math.min(R.target, LINE.stations.length - 1);
  $('h-station').textContent = R.phase === 'dwell' ? `${LINE.stations[st].name} 停車中（${st + 1}/${LINE.stations.length}）` : `次は ${LINE.stations[st].name}`;
  $('h-money').textContent = `¥${R.money.toLocaleString()}`;
  // 遅れ
  const dg = $('g-delay');
  const fill = $('g-delay-fill');
  const txt = $('g-delay-text');
  // 遅れが増えているか、減っているか（少しならす）
  trendT += 1;
  if (trendT >= 20) {
    trend = R.ahead - lastAhead;
    lastAhead = R.ahead;
    trendT = 0;
  }
  if (R.phase === 'dwell') {
    const left = R.depart - R.time;
    txt.textContent = left > 0 ? `発車まで ${Math.ceil(left)}秒` : `発車遅れ ${mmss(-left)} / ${mmss(R.delayLimit)}`;
  } else {
    txt.textContent = R.ahead < -1 ? `−${mmss(-R.ahead)} 早着ペース` : `遅れ ${mmss(R.delay)} / ${mmss(R.delayLimit)}`;
  }
  $('tk1').querySelector('b')!.textContent = mmss(R.delayLimit * 0.5);
  $('tk2').querySelector('b')!.textContent = mmss(R.delayLimit * 0.75);
  const ratio = Math.min(1, R.delay / R.delayLimit);
  fill.style.width = `${ratio * 100}%`;
  dg.className = 'gauge big' + (ratio >= 0.75 ? ' red' : ratio >= 0.5 ? ' amber' : '') + (R.ahead < -1 && R.phase === 'running' ? ' early' : '');
  $('g-delay-trend').textContent = R.phase !== 'running' ? '' : trend > 0.3 ? '▲' : trend < -0.3 ? '▼' : '';
  $('g-delay-trend').className = 'trend ' + (trend > 0 ? 'up' : 'down');
  // 信頼
  $('g-trust-fill').style.width = `${R.trust}%`;
  $('g-trust-text').textContent = `信頼 ${Math.round(R.trust)}`;
  $('g-trust').className = 'gauge big trust' + (R.trust <= 30 ? ' red' : '');
  if (R.trust < lastTrust - 0.5) {
    const f = document.createElement('div');
    f.className = 'float-minus';
    f.textContent = `−${Math.round(lastTrust - R.trust)}`;
    $('g-trust').appendChild(f);
    setTimeout(() => f.remove(), 1000);
    $('g-trust').classList.add('shake');
    setTimeout(() => $('g-trust').classList.remove('shake'), 300);
  }
  lastTrust = R.trust;
  document.body.classList.toggle('danger', R.delay > R.delayLimit * 0.8 || R.trust <= 20);
  const mods = [...R.mods].map((m) => ({ belt: 'シートベルト', ram: '衝角', susp: 'エアサス' })[m]).join('・');
  $('h-mods').textContent = mods ? `魔改造：${mods}` : '';
}

/** 衝撃予測パネル */
function renderForecast() {
  const o = nextObstacle(R);
  const line1 = $('fc-1');
  const line3 = $('fc-3');
  const scale = $('fc-scale');
  const k = kmh(R.v);
  let shock = 0;
  if (R.phase === 'running' && o) {
    const d = o.x - R.x;
    const secs = R.v > 0.5 ? Math.max(0, d / R.v) : null;
    shock = predictShock(R, o);
    const name = OBS_INFO[o.kind].name;
    const when = d < 0 ? '通過中' : secs == null ? `あと${Math.round(d)}m` : `あと${secs.toFixed(0)}秒`;
    let cond = '';
    if (o.kind === 'tree') cond = k >= treeNeed(R) ? '突破できる速さ' : `${treeNeed(R)}km/h 未満だと止められる`;
    else if (o.kind === 'curve') cond = k > CURVE_V ? `${CURVE_V}km/h まで落とせ` : '安全な速さ';
    else if (o.kind === 'deer') cond = 'タップで追い払え';
    else if (o.kind === 'pole') cond = `連打 あと${o.taps}回`;
    else if (o.kind === 'wave') cond = waveUp(R.time) ? '波が来ている' : `今なら通れる（${(WAVE_PERIOD - (R.time % WAVE_PERIOD)).toFixed(1)}秒）`;
    line1.innerHTML = `<span class="obs">${name}</span><span>${when}</span><span class="cond">${cond}</span><span class="shock ${shock > 0 ? 'on' : ''}">衝撃 ${shock > 0 ? '≈' + shock : '0'}</span>`;
    // ヒント
    const fly = wouldFly(R, shock);
    let hint = '';
    if (R.armed === 'jump') hint = 'ジャンプ台で飛び越える（着地の衝撃あり）';
    else if (fly.length === 0) hint = shock > 0 ? '全員耐えられる' : '';
    else if (o.kind === 'tree') {
      const atNeed = predictShock(R, o, (treeNeed(R) + 0.5) / 3.6);
      const flyNeed = wouldFly(R, atNeed);
      hint = flyNeed.length < fly.length ? `${Math.round(treeNeed(R) + 1)}km/h まで落とせば ${fly.length - flyNeed.length}人助かる` : `${fly.map((p) => KINDS[p.kind].name).join('・')}を座席へ移せ`;
    } else if (o.kind === 'curve') hint = `${CURVE_V}km/h 以下なら衝撃0`;
    else if (o.kind === 'deer') hint = '追い払えば衝撃0';
    else if (o.kind === 'wave') hint = '波が引いたすきに通れば衝撃0';
    line3.textContent = hint;
    line3.className = fly.length ? 'warn' : '';
  } else if (R.phase === 'dwell') {
    const nxt = R.obstacles[R.target] ?? [];
    const worst = Math.max(0, ...nxt.map((q) => (q.kind === 'tree' ? predictShock(R, q, (treeNeed(R) + 2) / 3.6) : 0)));
    shock = worst;
    line1.innerHTML = `<span class="obs">次の区間</span><span>${nxt.map((q) => OBS_INFO[q.kind].name).join('・')}</span><span class="shock ${worst ? 'on' : ''}">${worst ? `倒木の突破 ≈${worst}` : ''}</span>`;
    line3.textContent = '乗せる客と席を考えよう';
    line3.className = '';
  } else if (R.phase === 'running') {
    line1.innerHTML = `<span class="obs">障害なし</span><span>${LINE.stations[Math.min(R.target, LINE.stations.length - 1)].name}に止めよう</span><span class="shock">衝撃 0</span>`;
    line3.textContent = '停止範囲（上のバーの駅の手前）で止まれば停車';
    line3.className = '';
  } else {
    line1.textContent = '';
    line3.textContent = '';
  }
  // 揺れ（60km/h超）
  const jolt = $('fc-jolt');
  let joltShock = 0;
  if (k > SHOCK.joltFrom && R.phase === 'running') {
    joltShock = Math.max(0, Math.round((k - SHOCK.joltBase) * SHOCK.joltK - (R.mods.has('susp') ? 10 : 0) - R.meta.lv.susp * 3));
    const jf = wouldFly(R, joltShock);
    jolt.textContent = `揺れまで ${Math.max(0, R.jolt).toFixed(1)}秒 衝撃${joltShock}${jf.length ? `・${jf.length}人飛ぶ` : ''}`;
    jolt.hidden = false;
    if (jf.length) {
      line3.textContent = `揺れで ${jf.map((p) => KINDS[p.kind].name).join('・')} が飛ぶ！ 60km/h以下に落とせ`;
      line3.className = 'warn';
    }
    if (!o) line1.innerHTML = `<span class="obs">高速走行</span><span>${Math.round(k)}km/h</span><span class="shock on">揺れ ≈${joltShock}</span>`;
  } else jolt.hidden = true;
  // 耐衝撃の目盛り
  const key = R.pax.map((p) => `${p.id}:${effTol(R, p)}`).join(',') + '|' + shock + '|' + joltShock;
  if (scale.dataset.k !== key) {
    scale.dataset.k = key;
    const max = 100;
    let html = `<div class="axis"></div>`;
    if (shock > 0) html += `<div class="line" style="left:${Math.min(100, (shock / max) * 100)}%"><span>${shock}</span></div>`;
    if (joltShock > 0) html += `<div class="line jolt" style="left:${Math.min(100, (joltShock / max) * 100)}%"><span>揺${joltShock}</span></div>`;
    const sorted = [...R.pax].sort((a, b) => effTol(R, a) - effTol(R, b));
    sorted.forEach((p, i) => {
      const t = effTol(R, p);
      const flies = Math.max(shock, joltShock) > t && !R.airbag;
      html += `<div class="face ${flies ? 'fly' : ''}" style="left:${Math.min(100, (t / max) * 100)}%;top:${i % 2 ? 22 : 2}px" title="${KINDS[p.kind].name} 耐${t}"><b>${KINDS[p.kind].ch}</b><small>${t}</small></div>`;
    });
    if (!R.pax.length) html += '<div class="empty">乗っている客はいない</div>';
    scale.innerHTML = html;
  }
}

function renderSpeedo() {
  const k = kmh(R.v);
  $('sp-num').textContent = String(Math.round(k));
  const o = nextObstacle(R);
  const band = $('sp-band');
  const max = 80;
  if (o && R.phase === 'running' && (o.kind === 'tree' || o.kind === 'curve')) {
    const lo = o.kind === 'tree' ? treeNeed(R) : 0;
    const hi = o.kind === 'tree' ? max : CURVE_V;
    band.style.left = `${(lo / max) * 100}%`;
    band.style.width = `${((hi - lo) / max) * 100}%`;
    band.hidden = false;
    const inBand = k >= lo && k <= hi;
    $('sp-needle').classList.toggle('bad', !inBand);
    $('sp-label').textContent = o.kind === 'tree' ? `${treeNeed(R)}↑` : `${CURVE_V}↓`;
  } else {
    band.hidden = true;
    $('sp-needle').classList.remove('bad');
    $('sp-label').textContent = '';
  }
  $('sp-needle').style.left = `${Math.min(100, (k / max) * 100)}%`;
  $('sp-jolt').style.left = `${(SHOCK.joltFrom / max) * 100}%`;
  $('speedo').classList.toggle('jolting', k > SHOCK.joltFrom);
}

function renderHud() {
  renderStatus();
  renderForecast();
  renderSpeedo();
  document.body.classList.toggle('dwell', R.phase === 'dwell');
  document.querySelectorAll<HTMLElement>('.notch').forEach((n) => n.classList.toggle('on', Number(n.dataset.n) === R.notch));
  itemsBox.querySelectorAll<HTMLButtonElement>('.item').forEach((b) => {
    const id = b.dataset.id as ItemId;
    const n = R.items[id];
    b.querySelector('.ct')!.textContent = `×${n}`;
    b.classList.toggle('zero', n <= 0);
    b.disabled = n <= 0 || R.phase !== 'running';
    b.classList.toggle('armed', (id === 'jump' && R.armed === 'jump') || (id === 'airbag' && R.airbag));
  });

  // ホームの候補
  if (R.phase === 'dwell') {
    const nxt = R.obstacles[R.target] ?? [];
    const worst = Math.max(0, ...nxt.map((q) => (q.kind === 'tree' ? predictShock(R, q, (treeNeed(R) + 2) / 3.6) : 0)));
    const key = JSON.stringify([R.candidates.map((c) => c.id), [...R.picked], seatsUsed(R), worst]);
    if (key !== candKey) {
      candKey = key;
      const box = $('cands');
      box.innerHTML = '';
      for (const c of R.candidates) {
        const k = KINDS[c.kind];
        const sel = R.picked.has(c.id);
        const risky = worst > k.tol + 20 ? '座席でも危ない' : worst > k.tol ? '座らせないと飛ぶ' : '';
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'cand' + (sel ? ' sel' : '') + (c.kind === 'vip' ? ' req' : '') + (risky ? ' risky' : '');
        const fare = c.kind === 'vip' ? 2000 : k.fare * (c.dest - c.from);
        b.innerHTML = `${sel ? '<span class="flag">乗せる</span>' : c.kind === 'vip' ? '<span class="flag req">依頼</span>' : ''}<span class="ic" style="background:${k.color}">${k.ch}</span><b>${k.name}${k.size > 1 ? `<small>席${k.size}</small>` : ''}</b><span class="dest"><i style="background:${DEST_COLORS[c.dest]}"></i>${LINE.stations[c.dest].name}</span><span class="nums"><span>¥${fare.toLocaleString()}</span><span class="tol">耐${k.tol}</span></span><span class="note ${risky ? 'warn' : ''}">${risky ? '⚠' + risky : k.note}</span>`;
        b.addEventListener('click', () => togglePick(R, c.id));
        box.appendChild(b);
      }
      $('seats').textContent = `席 ${seatsUsed(R) + pickedSeats(R)}/${R.cap}（${R.pax.length + R.picked.size}人）`;
      $('seats-sub').textContent = R.pax.length ? `うち乗車中 ${R.pax.length}人` : '力士は席を3つ使う';
      const n = R.picked.size;
      $('btn-depart').textContent = n ? `${n}人を乗せて発車 ▶` : '誰も乗せずに発車 ▶';
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
      b.innerHTML = `<span class="tag">${o.kind === 'item' ? 'アイテム' : '魔改造（このラン中ずっと）'}</span><b>${o.name}</b><span>${o.desc}</span>`;
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
    showResult();
  }
}

function showResult() {
  const clear = R.phase === 'clear';
  const st = Math.min(R.target, LINE.stations.length - 1);
  const bonus = clear ? Math.round(R.money * 0.3) : 0;
  const total = R.money + bonus;
  meta.bank += total;
  meta.runs += 1;
  meta.best = Math.max(meta.best, total);
  saveMeta(meta);
  $('result-title').textContent = clear ? `終点 ${LINE.stations[LINE.stations.length - 1].name} 到着！` : `${LINE.stations[st].name}の手前で運転打ち切り`;
  $('result-reason').textContent = clear ? '江ノ電を走りきった！' : `${R.overReason}。`;
  const rows: [string, string][] = [
    ['進んだ駅', `${clear ? LINE.stations.length : st}/${LINE.stations.length}`],
    ['運んだ客', `${R.stats.carried}人`],
    ['吹っ飛ばした客', `${R.stats.flew}人`],
    ['最大の衝撃', `${R.stats.maxShock}`],
    ['早着', `${R.stats.early}回`],
  ];
  $('result-stats').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
  const money: [string, string][] = [
    ['運賃', `¥${(R.money - R.earlyBonus).toLocaleString()}`],
    ['早着ボーナス', `¥${R.earlyBonus.toLocaleString()}`],
  ];
  if (clear) money.push(['完走ボーナス（+30%）', `¥${bonus.toLocaleString()}`]);
  $('result-money').innerHTML = money.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('') + `<dt class="sum">今回の稼ぎ</dt><dd class="sum">¥${total.toLocaleString()}</dd>`;
  $('result-bank').textContent = `貯金 ¥${meta.bank.toLocaleString()}`;
  $('result').hidden = false;
}

// ---------- 音 ----------
window.addEventListener('pointerdown', unlock, { capture: true });
window.addEventListener('keydown', unlock, { capture: true });
const soundBtn = $('btn-sound');
const paintSound = () => (soundBtn.textContent = isMuted() ? '×' : '♪');
paintSound();
soundBtn.addEventListener('click', () => {
  toggleMute();
  paintSound();
});
const W = { notch: -1, phase: '', money: 0, shock: 0, picked: 0, offer: false, taps: new Map<Obstacle, number>(), states: new Map<Obstacle, string>(), screen: '' };
function watchSounds() {
  if (screen !== W.screen) {
    W.screen = screen;
    if (screen === 'hub') setScene('hub');
  }
  if (screen !== 'run') return;
  setScene(R.phase === 'dwell' ? 'dwell' : R.phase === 'running' ? 'run' : 'none');
  setIntensity(kmh(R.v) / 72);
  if (W.notch !== -1 && R.notch !== W.notch && R.phase === 'running') {
    sfx.notch(R.notch < 4);
    if (R.notch === 0) sfx.brake();
  }
  W.notch = R.notch;
  if (W.phase && W.phase !== R.phase) {
    if (R.phase === 'dwell') sfx.arrive();
    if (W.phase === 'dwell' && R.phase === 'running') sfx.depart();
    if (R.phase === 'clear') sfx.clear();
    if (R.phase === 'over') sfx.over();
  }
  W.phase = R.phase;
  if (R.money > W.money) sfx.coin();
  W.money = R.money;
  const sh = R.shocks[R.shocks.length - 1];
  if (sh && sh.t !== W.shock) {
    W.shock = sh.t;
    if (sh.label.startsWith('高速走行')) sfx.jolt();
    sfx.shock(sh.value);
    if (sh.flew.length) sfx.fly();
  }
  if (R.picked.size !== W.picked) sfx.pick(R.picked.size > W.picked);
  W.picked = R.picked.size;
  if (W.offer && !R.offer) sfx.select();
  W.offer = !!R.offer;
  for (const list of R.obstacles) {
    for (const o of list) {
      const pt = W.taps.get(o);
      if (pt != null && o.taps < pt && o.kind === 'pole') sfx.knock();
      W.taps.set(o, o.taps);
      const ps = W.states.get(o);
      if (ps === 'wait' && o.state === 'cleared') {
        if (o.kind === 'deer') sfx.horn();
        else sfx.cleared();
      }
      W.states.set(o, o.state);
    }
  }
}

// ---------- ループ ----------
const params = new URLSearchParams(location.search);
const SPEED = Math.max(1, Number(params.get('speed')) || 1);
if (params.has('debug')) Object.assign(window, { __R: () => R, __mode: setMode, __start: startRun, __meta: meta });
if (params.has('go')) startRun();
else renderHub();
let last = performance.now();
function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000) * SPEED;
  last = now;
  if (screen === 'run') {
    const steps = Math.ceil(dt / 0.02);
    for (let i = 0; i < steps; i++) update(R, dt / steps);
    if (mode === 'in' && R.phase === 'running') {
      const o = nextObstacle(R);
      const near = (o && o.x - R.x < 40 && o.x - R.x > -5 && o.kind !== 'curve') || POS[R.target] - R.x < 80;
      if (near) setMode('out');
    }
    if (mode === 'in' && R.phase !== 'running' && R.phase !== 'dwell') setMode('out');
    const { w, h } = fit();
    ctx.fillStyle = '#F5EFE3';
    ctx.fillRect(0, 0, w, h);
    hits = [];
    if (mode === 'out') {
      const res = drawOutside(ctx, R, w, 52, h - 2, hits);
      trainBox = res.train;
    } else {
      drawInside(ctx, R, w, 52, h - 2, drag && drag.moved ? drag : null, hits);
    }
    drawBar(ctx, R, w, 16);
    renderHud();
  }
  watchSounds();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
