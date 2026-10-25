// 「障害突破ラン」の画面と入力。車両基地 → ラン → リザルト → 車両基地 の流れ。

import { DEST_COLORS } from '../data.ts';
import * as S from './state.ts';
import { hideCoach, setRewinder, startCoach, updateCoach } from './coach.ts';
import { setCarPalette } from '../exterior.ts';
import { makeDemo, stepDemo } from './demo.ts';
import { BAR_H, drawBar, drawInside, drawOutside, drawSection, ejectZone, type Hit } from './draw.ts';
import { isMuted, setIntensity, setScene, sfx, toggleMute, unlock } from './audio.ts';
import {
  KINDS,
  LINE,
  NOTCH_NAME,
  OBS_INFO,
  POS,
  LOADOUTS,
  loadoutOf,
  unlockLoadout,
  COMBOS,
  OFFER_TAGS,
  PART_NAME,
  comboDef,
  comboHint,
  type Tag,
  resetMeta,
  WAVE_PERIOD,
  brakeShock,
  buyCard,
  carryHome,
  rerollShop,
  rerollCost,
  OFFERS,
  jumpPlan,
  earnedOf,
  fareOf,
  depart,
  canReverse,
  isArmed,
  itemBlock,
  INSTANT,
  curveV,
  workV,
  FLOOD_V,
  WORK_REACH,
  seatBonus,
  obsTag,
  moveToCar,
  moveToLevel,
  DECK_NAME,
  eject,
  effTol,
  kmh,
  loadMeta,
  moveToSpot,
  newRun,
  nextObstacle,
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
  threat,
  type ItemId,
  type Obstacle,
  type Pax,
  type Run,
} from './state.ts';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('view');
const ctx = canvas.getContext('2d')!;
let meta = loadMeta();
let R: Run = newRun(meta);
let screen: 'hub' | 'run' = 'hub';
let mode: 'out' | 'in' = 'out';
let focus = 0;
let deckFocus = 0;
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
// ---------- ズーム（ピンチ・ホイール） ----------
const ZOOM_KEY = 'hakobi.run.zoom';
let userZoom = 1;
try {
  userZoom = Number(localStorage.getItem(ZOOM_KEY)) || 1;
} catch {
  // 保存できない環境
}
let zoomS = userZoom;
const clampZoom = (z: number) => Math.max(0.6, Math.min(2.4, z));
function setUserZoom(z: number) {
  userZoom = clampZoom(z);
  try {
    localStorage.setItem(ZOOM_KEY, String(userZoom));
  } catch {
    // 無視
  }
}
/** 停車中は電車を大きく */
const DWELL_ZOOM = 2.4;
const touches = new Map<number, [number, number]>();
let pinch: { d0: number; z0: number } | null = null;
let pendingTrainTap = false;
const touchDist = () => {
  const [a, b] = [...touches.values()];
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
};
canvas.addEventListener('pointerdown', (e) => {
  if (mode === 'out') touches.set(e.pointerId, pt(e) as [number, number]);
  if (touches.size === 2) {
    pinch = { d0: Math.max(20, touchDist()), z0: userZoom };
    pendingTrainTap = false;
  }
}, { capture: true });
window.addEventListener('pointermove', (e) => {
  if (!touches.has(e.pointerId)) return;
  touches.set(e.pointerId, pt(e) as [number, number]);
  if (pinch && touches.size === 2) setUserZoom(pinch.z0 * (touchDist() / pinch.d0));
});
const touchEnd = (e: PointerEvent) => {
  touches.delete(e.pointerId);
  if (touches.size < 2) pinch = null;
};
window.addEventListener('pointerup', touchEnd);
window.addEventListener('pointercancel', touchEnd);
canvas.addEventListener('wheel', (e) => {
  if (mode !== 'out') return;
  e.preventDefault();
  setUserZoom(userZoom * Math.exp(-e.deltaY * 0.0015));
}, { passive: false });

canvas.addEventListener('pointerdown', (e) => {
  const [x, y] = pt(e);
  if (pinch) return;
  if (y < 62) {
    openMap();
    return;
  }
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
    // 電車タップで車内へ（ピンチの1本目でないことを指が離れたときに確かめる）
    if (t && x >= t.x0 && x <= t.x1 && y >= t.y0 && y <= t.y1) pendingTrainTap = true;
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
  // 触った瞬間に説明（指を離すか、動かしたら消える）
  showPaxCard(drag.id, e.clientX, e.clientY);
});
canvas.addEventListener('pointermove', (e) => {
  if (!drag || drag.pid !== e.pointerId) return;
  const [x, y] = pt(e);
  if (Math.hypot(x - drag.sx, y - drag.sy) > 4) {
    drag.moved = true;
    hidePaxCard();
  }
  drag.sx = x;
  drag.sy = y;
});
canvas.addEventListener('pointerup', (e) => {
  if (pendingTrainTap && mode === 'out' && !pinch) {
    pendingTrainTap = false;
    setMode('in');
    return;
  }
  pendingTrainTap = false;
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
  const tab = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('.cartab');
  hidePaxCard();
  if (!drag.moved) {
    // 短いタップでは何もしない（説明は長押し）
  } else if (tab) {
    const c = tab.dataset.c != null ? Number(tab.dataset.c) : focus;
    const d = tab.dataset.d != null ? Number(tab.dataset.d) : 0;
    const ok = tab.dataset.d != null ? moveToLevel(R, drag.id, c, d) : c !== focus ? moveToCar(R, drag.id, c) : false;
    if (ok) sfx.drop();
    else sfx.bad();
  } else if (drag.moved && inEject(x, y)) {
    eject(R, drag.id);
    sfx.fly();
  } else if (drag.moved && best >= 0) {
    moveToSpot(R, drag.id, best);
    sfx.drop();
  }
  drag = null;
});
canvas.addEventListener('pointercancel', () => (drag = null));
function inEject(x: number, y: number) {
  const z = ejectZone(canvas.getBoundingClientRect().width, BAR_H);
  return x >= z.x && x <= z.x + z.w && y >= z.y && y <= z.y + z.h;
}

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
/** 各段の位置（%） */
const NOTCH_POS = NOTCH_NAME.map((_, i) => 6 + (i * 88) / 7);
const ticks = lever.querySelector<HTMLElement>('.lv-ticks')!;
NOTCH_NAME.forEach((name, i) => {
  const t = document.createElement('span');
  t.className = i === 0 ? 'eb' : i > 4 ? 'pw' : '';
  t.style.left = `${NOTCH_POS[i]}%`;
  t.dataset.n = String(i);
  t.innerHTML = i === 0 ? `${name}<small>射出</small>` : name;
  ticks.appendChild(t);
});
const handle = lever.querySelector<HTMLElement>('.lv-handle')!;
let leverDrag = false;
const fromPoint = (e: PointerEvent) => {
  if (R.phase !== 'running') return;
  const b = lever.getBoundingClientRect();
  const pct = ((e.clientX - b.left) / b.width) * 100;
  let best = 0;
  NOTCH_POS.forEach((p, i) => {
    if (Math.abs(p - pct) < Math.abs(NOTCH_POS[best] - pct)) best = i;
  });
  setNotch(R, best);
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
function renderLever() {
  handle.style.left = `${NOTCH_POS[R.notch]}%`;
  handle.classList.toggle('eb', R.notch === 0);
  ticks.querySelectorAll<HTMLElement>('span').forEach((t) => t.classList.toggle('on', Number(t.dataset.n) === R.notch));
}
window.addEventListener('keydown', (e) => {
  if (screen !== 'run') return;
  if (R.phase !== 'running') {
    if (e.code === 'Enter') depart(R);
    return;
  }
  if (e.code === 'ArrowUp' || e.code === 'KeyW') setNotch(R, R.notch + 1);
  else if (e.code === 'ArrowDown' || e.code === 'KeyS') setNotch(R, R.notch - 1);
  else if (e.code === 'Space') {
    // 非常（急ブレーキ射出）
    e.preventDefault();
    setNotch(R, 0);
  } else if (e.code === 'KeyX') {
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
  { id: 'nitro', name: 'ニトロ', ch: '爆', col: '#F08E78', tip: 'その場で +20km/h' },
  { id: 'net', name: '着地ネット', ch: '網', col: '#A6DCC3', tip: '次の射出だけホーム外4mまでGOOD' },
  { id: 'dia', name: '臨時ダイヤ', ch: '時', col: '#CFE6EE', tip: '遅れを20秒取り戻す' },
];
// 持ち物：全画面のダイアログ。開いている間は時間が止まる
let invOpen = false;
function openInv() {
  if (screen !== 'run') return;
  invOpen = true;
  R.paused = true;
  renderInv();
  $('inv').hidden = false;
  sfx.select();
}
function closeInv() {
  invOpen = false;
  R.paused = false;
  $('inv').hidden = true;
}
$('btn-inv').addEventListener('click', openInv);
$('btn-inv2').addEventListener('click', openInv);
$('btn-inv-x').addEventListener('click', closeInv);
$('btn-inv-close').addEventListener('click', closeInv);
const ITEM_DESC: Record<ItemId, string> = {
  jump: '次の障害を衝撃なしで飛び越える。速いほど遠く。空中で非常を引けば空から射出',
  saw: '倒木か電柱を一瞬で片付ける',
  airbag: '次の衝撃で誰も飛ばない（射出では開かない）',
  nitro: 'その場で +20km/h。坂の手前や遅れの取り戻しに（空中では使えない）',
  net: '次の射出だけ、ホームから4mはみ出してもGOOD',
  dia: '遅れを20秒なかったことに（予定より早くはならない）',
};
function renderInv() {
  // 持っているものを先に、持っていないものは後ろへ
  const list = [...ITEM_DEF].sort((a, b) => (R.items[a.id] > 0 || isArmed(R, a.id) ? 0 : 1) - (R.items[b.id] > 0 || isArmed(R, b.id) ? 0 : 1));
  $('inv-items').innerHTML = list.map((it) => {
    const n = R.items[it.id];
    const armed = isArmed(R, it.id);
    const zero = n <= 0 && !armed;
    const why = !zero && !armed ? itemBlock(R, it.id) : '';
    const btn = zero ? '<span class="none">なし</span>' : why ? `<span class="none">${why}</span>` : `<button type="button" class="use${armed ? ' on' : ''}" data-id="${it.id}">${armed ? '準備中・やめる' : '使う'}</button>`;
    return `<div class="ivr${zero ? ' zero' : ''}"><span class="ic" style="background:${it.col}">${it.ch}<b>${n}</b></span><span class="tx"><b>${it.name}</b><span>${ITEM_DESC[it.id]}</span></span>${btn}</div>`;
  }).join('');
  $('inv-items').querySelectorAll<HTMLButtonElement>('.use').forEach((b) =>
    b.addEventListener('click', () => {
      const id = b.dataset.id as ItemId;
      useItem(R, id);
      sfx.select();
      // その場で効くものは、閉じて効き目を見せる
      if (INSTANT.includes(id)) closeInv();
      else renderInv();
    }),
  );
  const names: Record<string, string> = Object.fromEntries(OFFERS.map((o) => [o.id, o.name]));
  $('inv-mods').innerHTML = [...R.mods].filter((m) => ![...R.mods].some((m2) => { const t = S.treeNode(m2); return t?.req === m && t.tier !== '分岐'; })).map((m) => `<span class="mchip">${tagHtml((OFFER_TAGS[m] ?? []) as Tag[])}${names[m] ?? m}${m === 'car' && R.cars - R.startCars > 1 ? ` ×${R.cars - R.startCars}` : ''}</span>`).join('');
  const lo = loadoutOf(R.lo);
  $('inv-lo').innerHTML = `<div class="lo-card"><b>${lo.name}</b><span class="lo-up">＋ ${lo.up}</span><span class="lo-down">− ${lo.down}</span></div>`;
}
function renderInvBtns() {
  const n = ITEM_DEF.reduce((a, it) => a + R.items[it.id], 0);
  const armed = ITEM_DEF.filter((it) => isArmed(R, it.id)).map((it) => it.ch + ' 準備中');
  document.querySelectorAll<HTMLElement>('.inv-btn').forEach((b) => {
    b.querySelector('.inv-n')!.textContent = n ? String(n) : '';
    b.querySelector('.inv-armed')!.textContent = armed.join('・');
  });
}

$('btn-depart').addEventListener('click', () => {
  depart(R);
  if (mode === 'in') setMode('out');
});
$('btn-shop').addEventListener('click', () => {
  shopOpen = true;
  shopKey = '';
});
$('btn-shop-close').addEventListener('click', () => (shopOpen = false));
$('btn-reroll').addEventListener('click', () => {
  shopKey = '';
  if (rerollShop(R)) sfx.select();
  else sfx.bad();
});
$('btn-seat').addEventListener('click', () => setMode(mode === 'in' ? 'out' : 'in'));
/** キーワードのタグ */
const TAG_BG: Record<Tag, string> = { 射出: '#F08E78', 守り: '#A6DCC3', 突破: '#F3D27F', 満員: '#CFE6EE' };
function tagHtml(ts: Tag[]): string {
  return ts.map((t) => `<span class="ktag" style="background:${TAG_BG[t]}">【${t}】</span>`).join('');
}
/** お金はコインのアイコン＋数字で見せる */
function coinHtml(n: number): string {
  return `<span class="cn"><i class="coin"></i>${n.toLocaleString()}</span>`;
}
function coinText(s: string): string {
  return s.replace(/¢(\d+)/g, (_, n) => coinHtml(Number(n)));
}

// バック（押している間だけ）
const revBtn = $('btn-reverse');
const revOn = (e: PointerEvent) => {
  e.preventDefault();
  try {
    revBtn.setPointerCapture(e.pointerId);
  } catch {
    // 合成イベント
  }
  R.reverse = true;
};
const revOff = () => (R.reverse = false);
revBtn.addEventListener('pointerdown', revOn);
revBtn.addEventListener('pointerup', revOff);
revBtn.addEventListener('pointercancel', revOff);
revBtn.addEventListener('lostpointercapture', revOff);
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyB' && screen === 'run') R.reverse = true;
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'KeyB') R.reverse = false;
});

// ---------- 画面の切り替え ----------
function startRun(tutorial = !meta.tutorialDone) {
  R = newRun(meta, tutorial);
  slowT = 0;
  slowLaunches = 0;
  setCarPalette(S.LINE.cars);
  $('h-line').textContent = S.LINE.short;
  $('h-line').style.background = S.LINE.color;
  startCoach(R);
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
  shopOpen = false;
  shopKey = '';
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
$('btn-start').addEventListener('click', () => startRun());
$('btn-tutorial').addEventListener('click', () => startRun(true));
// 研修のやり直し：チェックポイントの状態に差し替える
setRewinder((snap) => {
  R = snap;
  W.taps.clear();
  W.states.clear();
  W.phase = R.phase;
  W.money = R.money;
  candKey = '';
  offerShown = R.offer;
  shopOpen = false;
  lastTrust = R.trust;
  setMode('out');
});
// データ初期化（2回押しで確定）
let resetArmed = -Infinity;
// タブは最初は閉じておく。押すと開き、もう一度押すと閉じる
let hubTab: 'how' | 'lo' | 'tree' | 'book' | null = null;
$('tab-tree').addEventListener('click', () => {
  hubTab = hubTab === 'tree' ? null : 'tree';
  sfx.select();
  renderHub();
});
$('tab-how').addEventListener('click', () => {
  hubTab = hubTab === 'how' ? null : 'how';
  sfx.select();
  renderHub();
});
$('tab-lo').addEventListener('click', () => {
  hubTab = hubTab === 'lo' ? null : 'lo';
  sfx.select();
  renderHub();
});
$('tab-book').addEventListener('click', () => {
  hubTab = hubTab === 'book' ? null : 'book';
  sfx.select();
  renderHub();
});
$('btn-reset').addEventListener('click', () => {
  const b = $('btn-reset');
  if (performance.now() - resetArmed > 4000) {
    resetArmed = performance.now();
    b.textContent = '本当に消す？ もう一度押すと消えます';
    b.classList.add('armed');
    sfx.bad();
    setTimeout(() => {
      if (performance.now() - resetArmed >= 4000) {
        b.textContent = 'データ初期化';
        b.classList.remove('armed');
      }
    }, 4100);
    return;
  }
  resetArmed = -Infinity;
  meta = resetMeta();
  b.textContent = 'データ初期化';
  b.classList.remove('armed');
  sfx.clear();
  renderHub();
});
$('btn-hub').addEventListener('click', toHub);
$('btn-again').addEventListener('click', () => startRun());

function renderHub() {
  $('hub-bank').innerHTML = coinHtml(meta.bank);
  $('hub-sub').innerHTML = meta.runs ? `これまで ${meta.runs}回 出発・最高 ${coinHtml(meta.best)}` : 'はじめての出発。まずは1回走ってみよう';
  // はじめて：研修運転だけを見せる
  const first = !meta.tutorialDone && meta.runs === 0;
  $('hub-first').hidden = !first;
  renderLines(first);
  for (const sel of ['.hub-tabs', '.reset-row']) {
    const el = document.querySelector<HTMLElement>(sel);
    if (el) el.hidden = first;
  }
  const found = COMBOS.filter((c) => meta.combos[c.id]).length;
  $('tab-book').innerHTML = `コンボ図鑑 <small>${found}/${COMBOS.length}</small>`;
  $('lo-panel').hidden = first || hubTab !== 'lo';
  $('how-panel').hidden = first || hubTab !== 'how';
  $('tree-panel').hidden = first || hubTab !== 'tree';
  $('tab-tree').classList.toggle('on', hubTab === 'tree');
  if (hubTab === 'tree') renderTree($('tree-panel'), null);
  $('tab-how').classList.toggle('on', hubTab === 'how');
  $('book').hidden = first || hubTab !== 'book';
  $('tab-lo').classList.toggle('on', hubTab === 'lo');
  $('tab-book').classList.toggle('on', hubTab === 'book');
  $('book').innerHTML =
    `<div class="book-bar"><i style="width:${(found / COMBOS.length) * 100}%"></i></div>` +
    COMBOS.map((c) => {
      const d = meta.combos[c.id];
      if (d) return `<div class="bk"><div class="bk-head"><b>${c.name}</b>${tagHtml(c.tags)}<small>${d} 発見</small></div><span class="bk-cond">${c.cond}</span><span class="bk-eff">${coinText(c.eff)}</span></div>`;
      const h = c.parts[0] === 'many' ? PART_NAME.many : `${PART_NAME[c.parts[0]]}と、何か`;
      return `<div class="bk unknown"><b>？？？</b><span class="bk-cond">${h}</span></div>`;
    }).join('') +
    '<p class="bk-note">見つけていないコンボは片方だけヒント。発動した瞬間に名前が開く</p>';
  const box = $('ups');
  box.innerHTML = '';
  for (const l of LOADOUTS) {
    const own = meta.unlocked.includes(l.id);
    const sel = meta.loadout === l.id;
    const can = !own && meta.bank >= l.cost;
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'lo' + (sel ? ' sel' : '') + (own ? '' : ' locked') + (can ? ' can' : '');
    el.innerHTML = `<span class="lo-head"><b>${l.name}</b>${sel ? '<span class="pill">これで出発</span>' : own ? '' : `<span class="pill cost">${can ? '解放 ' : ''}${coinHtml(l.cost)}</span>`}</span><span class="lo-up">＋ ${l.up}</span><span class="lo-down">− ${l.down}</span>`;
    el.addEventListener('click', () => {
      if (own) {
        meta.loadout = l.id;
        saveMeta(meta);
        sfx.select();
      } else if (unlockLoadout(meta, l.id)) sfx.coin();
      else sfx.bad();
      renderHub();
    });
    box.appendChild(el);
  }
  $('btn-start').textContent = first ? 'はじめての運転 ▶' : `「${loadoutOf(meta.loadout).name}」で${S.LINES[meta.line].short}へ ▶`;
}

// ---------- 路線えらび ----------
const LINE_OBS: Record<string, string[]> = { enoden: ['木', '曲', '鹿', '柱', '波'], ginza: ['工', '坂', '瓦', '曲', '水'] };
function renderLines(first: boolean) {
  const box = $('lines');
  box.hidden = first;
  if (first) return;
  box.innerHTML = '';
  for (const l of Object.values(S.LINES)) {
    const open = S.lineOpen(meta, l.id);
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'line-card' + (meta.line === l.id ? ' sel' : '') + (open ? '' : ' locked');
    b.style.setProperty('--lc', l.color);
    const need = l.needs ? S.LINES[l.needs].short : '';
    b.innerHTML = `<b>${l.name}</b><span>${open ? `${l.stations.length}駅・${l.stations[0].name}→${l.stations[l.stations.length - 1].name}` : `<span class="lock">🔒 ${need}をクリアで解放</span>`}</span><span class="obs">${LINE_OBS[l.id].map((c) => `<i>${c}</i>`).join('')}</span>`;
    b.addEventListener('click', () => {
      if (!open) {
        sfx.bad();
        return;
      }
      meta.line = l.id;
      saveMeta(meta);
      sfx.select();
      renderHub();
    });
    box.appendChild(b);
  }
}

// ---------- 改造ツリー ----------
const BR: Tag[] = ['射出', '守り', '突破', '満員'];
let treeBr: Tag = '射出';
let treeOpen = false;
/** どのコンボがどの系統に出るか */
const COMBO_BR: Record<string, Tag[]> = { cannon: ['満員'], upper: ['満員'], tour: ['満員'], retro: ['突破', '射出'], bumper: ['突破'], wall: ['守り'], sling: ['守り', '射出'], salvo: ['射出'] };
function treeState(r: Run | null, o: S.Offer): 'own' | 'can' | 'lock' {
  if (!r) return o.tier === 'Ⅰ' ? 'can' : 'lock';
  if (r.mods.has(o.id as S.ModId) && o.id !== 'car') return 'own';
  if (o.id === 'car' && r.cars > r.startCars) return 'own';
  return S.modEligible(r, o) ? 'can' : 'lock';
}
function renderTree(box: HTMLElement, r: Run | null) {
  const mods = OFFERS.filter((o) => o.kind === 'mod');
  const node = (o: S.Offer) => {
    const st = treeState(r, o);
    const extra = o.id === 'car' && r && r.cars > r.startCars ? ` ×${r.cars - r.startCars}` : '';
    const price = r ? S.modPrice(r, o) : o.price;
    return `<div class="tr-node ${st}"><div class="nh"><span class="tier">${o.tier}</span><b>${o.name}${extra}</b></div><span class="ne">${o.desc}</span>${st === 'own' && o.id !== 'car' ? '' : `<span class="np">${coinHtml(price)}</span>`}</div>`;
  };
  const count = (b: Tag) => `${mods.filter((o) => o.branch === b && r && treeState(r, o) === 'own').length}/${mods.filter((o) => o.branch === b).length}`;
  let html = `<div class="tr-tabs">${BR.map((b) => `<button type="button" data-b="${b}" class="${b === treeBr ? 'on' : ''}" style="${b === treeBr ? `background:${TAG_BG[b]}` : ''}">【${b}】<small>${r ? count(b) : ''}</small></button>`).join('')}</div>`;
  html += '<div class="tr-legend"><span><i class="own"></i>持っている</span><span><i class="can"></i>お店に出る</span><span><i class="lock"></i>前の改造が必要</span></div><div class="tr-body">';
  for (const root of mods.filter((o) => o.branch === treeBr && o.tier === 'Ⅰ')) {
    const chain = [root];
    for (;;) {
      const nx = mods.find((o) => o.req === chain[chain.length - 1].id && o.tier !== '分岐');
      if (!nx) break;
      chain.push(nx);
    }
    const ids = chain.map((o) => o.id);
    const kids = mods.filter((o) => o.tier === '分岐' && o.req && ids.includes(o.req));
    html += `<div class="tr-group"><span class="gt">${root.name}</span><div class="tr-row">${chain.map(node).join('<span class="tr-arrow"></span>')}</div>${kids.map((k) => `<div class="tr-br">${node(k)}</div>`).join('')}</div>`;
  }
  for (const c of COMBOS.filter((c) => COMBO_BR[c.id]?.includes(treeBr))) {
    const known = !!meta.combos[c.id];
    const hint = c.parts.filter((p) => p !== 'many').map((p) => PART_NAME[p] ?? p).join('＋') || PART_NAME.many;
    html += `<div class="tr-combo">★ ${known ? c.name : '？？？'}：${known ? coinText(c.eff) : hint}</div>`;
  }
  html += '</div><p class="tr-note">お店の3枚は毎回ランダム（アイテムだけの時もある）。改造は白いものだけが出る。Ⅱ・Ⅲは買うと前の段と入れ替わる</p>';
  box.innerHTML = html;
  box.querySelectorAll<HTMLButtonElement>('.tr-tabs button').forEach((b) =>
    b.addEventListener('click', () => {
      treeBr = b.dataset.b as Tag;
      sfx.select();
      renderTree(box, r);
    }),
  );
}
function openTree() {
  if (screen !== 'run') return;
  treeOpen = true;
  R.paused = true;
  $('tree-sub').textContent = '開いている間は時間が止まる';
  renderTree($('tree-view'), R);
  $('tree').hidden = false;
  sfx.select();
}
function closeTree() {
  treeOpen = false;
  if (!invOpen) R.paused = false;
  $('tree').hidden = true;
}
$('btn-tree').addEventListener('click', openTree);
$('btn-shop-tree').addEventListener('click', openTree);
$('btn-tree-x').addEventListener('click', closeTree);
$('tree').addEventListener('click', (e) => {
  if (e.target === $('tree')) closeTree();
});

// ---------- HUD ----------
let candKey = '';
let offerShown: unknown = null;
let cutinShown = -1;
let shopOpen = false;
let shopKey = '';
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
  $('h-money').innerHTML = coinHtml(R.money);
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
    txt.textContent = R.ahead < -1 ? `停車中（時計停止）−${mmss(-R.ahead)}` : `停車中（時計停止）遅れ ${mmss(R.delay)}`;
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
  const names: Record<string, string> = { belt: 'シートベルト', ram: '衝角', susp: 'エアサス', car: `${R.cars}両編成`, deck: '二階建て', roof: '屋根席', rocket: 'ロケット' };
  const mods = [...R.mods].map((m) => names[m]).join('・');
  const lo = R.lo !== 'normal' ? `持ち込み：${loadoutOf(R.lo).name}` : '';
  $('h-mods').textContent = [lo, mods ? `魔改造：${mods}` : ''].filter(Boolean).join('　');
}

/** 衝撃予測パネル */
function renderForecast() {
  const o = nextObstacle(R);
  const line1 = $('fc-1');
  const line3 = $('fc-3');
  const scale = $('fc-scale');
  const k = kmh(R.v);
  let shock = 0;
  const stopX = POS[Math.min(R.target, LINE.stations.length - 1)];
  const toStop = stopX - R.x;
  const o2 = o && o.x - R.x < toStop ? o : null;
  if (R.phase === 'running' && !o2 && toStop < 160 && toStop > -60) {
    const sh = brakeShock(R);
    const fly = R.pax.filter((p) => sh > effTol(R, p, true));
    const here = fly.filter((p) => p.dest === R.target);
    const wrong = fly.filter((p) => p.dest !== R.target);
    shock = sh;
    line1.innerHTML = `<span class="obs">${LINE.stations[Math.min(R.target, LINE.stations.length - 1)].name}</span><span>あと${Math.max(0, Math.round(toStop))}m</span><span class="cond">${S.roleOf(R, R.target) === 'nostop' ? '止まれない駅：射出だけ' : S.roleOf(R, R.target) === 'crowd' ? '大混雑駅：止まろう' : R.streak >= 2 ? `連続着地 ${R.streak}駅` : '止まる？飛ばす？'}</span><span class="shock ${sh > 0 ? 'on' : ''}">急ブレーキ ${sh}</span>`;
    if (!fly.length) line3.textContent = R.pax.some((p) => p.dest === R.target) ? 'このまま急ブレーキしても誰も飛ばない。もっと速く！' : S.roleOf(R, R.target) === 'nostop' ? '止まれない駅。そのまま通過しよう' : '止まって客を乗せよう';
    else line3.textContent = `今 急ブレーキ → ${here.map((p) => KINDS[p.kind].name).join('・') || 'なし'} が飛ぶ` + (wrong.length ? `　⚠ ${wrong.map((p) => KINDS[p.kind].name + '(' + LINE.stations[p.dest].name + ')').join('・')} も飛んでしまう` : '');
    line3.className = wrong.length ? 'warn' : '';
  } else if (R.phase === 'running' && o) {
    const d = o.x - R.x;
    const secs = R.v > 0.5 ? Math.max(0, d / R.v) : null;
    shock = predictShock(R, o);
    const name = OBS_INFO[o.kind].name;
    const when = d < 0 ? '通過中' : secs == null ? `あと${Math.round(d)}m` : `あと${secs.toFixed(0)}秒`;
    let cond = '';
    if (o.kind === 'tree') cond = k >= treeNeed(R) ? '突破できる速さ' : `${treeNeed(R)}km/h 未満だと止められる`;
    else if (o.kind === 'curve') cond = k > curveV(R) ? `${curveV(R)}km/h まで落とせ` : '安全な速さ';
    else if (o.kind === 'work') cond = o.taps === 0 ? '作業員が退避中' : k > workV(R) ? `${workV(R)}km/h まで落とすか、近づいて警笛${o.taps}回` : '安全な速さ';
    else if (o.kind === 'slope') cond = (o.dir ?? 1) > 0 ? '上り坂：速さが落ちる' : '下り坂：勝手に速くなる';
    else if (o.kind === 'flood') cond = k > FLOOD_V ? `${FLOOD_V}km/h まで落とせ` : 'そろそろと';
    else if (o.kind === 'deer') cond = 'タップで追い払え';
    else if (o.kind === 'pole') cond = `連打 あと${o.taps}回`;
    else if (o.kind === 'wave') cond = waveUp(R.time) ? '波が来ている' : `今なら通れる（${(WAVE_PERIOD - (R.time % WAVE_PERIOD)).toFixed(1)}秒）`;
    line1.innerHTML = `<span class="obs">${name}</span><span>${when}</span><span class="cond">${cond}</span><span class="shock ${shock > 0 ? 'on' : ''}">衝撃 ${shock > 0 ? '≈' + shock : '0'}</span>`;
    // ヒント
    const fly = wouldFly(R, shock);
    let hint = '';
    const jp = jumpPlan(R);
    if (jp) {
      const n = (R.obstacles[R.target - 1] ?? []).filter((q) => q.state === 'wait' && q.x + q.len > jp.from && q.x < jp.land).length;
      hint = R.air ? `空中！ レバーで着地点を調整・非常で空から射出（着地まで${Math.max(0, Math.round(jp.land - R.x))}m）` : `今の速さなら${Math.round(jp.land - jp.from)}m跳んで障害${n}つ越え（速いほど遠く）`;
    }
    else if (fly.length === 0) hint = shock > 0 ? '全員耐えられる' : '';
    else if (o.kind === 'tree') {
      const atNeed = predictShock(R, o, (treeNeed(R) + 0.5) / 3.6);
      const flyNeed = wouldFly(R, atNeed);
      hint = flyNeed.length < fly.length ? `${Math.round(treeNeed(R) + 1)}km/h まで落とせば ${fly.length - flyNeed.length}人助かる` : `${fly.map((p) => KINDS[p.kind].name).join('・')}を座席へ移せ`;
    } else if (o.kind === 'curve') hint = `${curveV(R)}km/h 以下なら衝撃0`;
    else if (o.kind === 'work') hint = o.x - R.x > WORK_REACH ? `${WORK_REACH}m まで近づいたらタップで警笛` : 'タップで警笛！ 作業員が退く';
    else if (o.kind === 'flood') hint = `${FLOOD_V}km/h 以下なら衝撃0。ジャンプで越えてもいい`;
    else if (o.kind === 'deer') hint = '追い払えば衝撃0';
    else if (o.kind === 'wave') hint = '波が引いたすきに通れば衝撃0';
    line3.textContent = hint;
    line3.className = fly.length ? 'warn' : '';
  } else if (R.phase === 'dwell') {
    const nxt = R.obstacles[R.target] ?? [];
    const worst = Math.max(0, ...nxt.map((q) => (q.kind === 'tree' ? predictShock(R, q, (treeNeed(R) + 2) / 3.6) : 0)));
    shock = worst;
    // 走行中の障害バーと同じ書き方：アイコン＋条件
    const cond = (q: Obstacle) => obsTag(R, q);
    line1.innerHTML = `<span class="obs">次の区間</span><span class="chips">${nxt.map((q) => `<span><i>${OBS_INFO[q.kind].ch}</i>${cond(q)}</span>`).join('')}</span>`;
    void worst;
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
  const joltShock = 0;
  // 耐衝撃の目盛り
  const key = R.pax.map((p) => `${p.id}:${effTol(R, p)}`).join(',') + '|' + shock + '|' + joltShock;
  if (scale.dataset.k !== key) {
    scale.dataset.k = key;
    const max = 100;
    let html = `<div class="axis"></div>`;
    if (shock > 0) html += `<div class="line" style="left:${Math.min(100, (shock / max) * 100)}%"><span>${shock}</span></div>`;
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
  $('speedo').classList.toggle('jolting', k > 100);
}


function renderHud() {
  renderStatus();
  if (mode === 'in') {
    renderPaxList();
    renderCarTabs();
  }
  renderForecast();
  renderSpeedo();
  document.body.classList.toggle('dwell', R.phase === 'dwell');
  revBtn.hidden = !(canReverse(R) || R.reverse);
  if (revBtn.hidden) R.reverse = false;
  renderLever();
  renderInvBtns();
  if (invOpen && R.phase !== 'running' && R.phase !== 'dwell') closeInv();
  if (treeOpen && R.phase !== 'running' && R.phase !== 'dwell') closeTree();

  // ホームの候補
  if (R.phase === 'dwell') {
    const nxt = R.obstacles[R.target] ?? [];
    const worst = Math.max(0, ...nxt.map((q) => (q.kind === 'tree' ? predictShock(R, q, (treeNeed(R) + 2) / 3.6) : 0)));
    const key = JSON.stringify([R.candidates.map((c) => c.id), [...R.picked], seatsUsed(R), worst]);
    if (key !== candKey) {
      candKey = key;
      const box = $('cands');
      box.innerHTML = '';
      const shownGroups = new Set<number>();
      for (const c of R.candidates) {
        const k = KINDS[c.kind];
        const sel = R.picked.has(c.id);
        const g = c.group != null ? R.groups[c.group] : null;
        if (c.group != null) {
          if (shownGroups.has(c.group)) continue;
          shownGroups.add(c.group);
        }
        const risky = '';
        const b = document.createElement('button');
        b.type = 'button';
        b.dataset.id = String(c.id);
        b.className = 'cand' + (g ? ' grp' : '') + (sel ? ' sel' : '') + (c.prio ? ' req' : '') + (risky ? ' risky' : '');
        const fare = fareOf(R, c);
        // 3行：アイコン／行き先／運賃と耐衝撃。特性は★を長押しで
        if (g) b.innerHTML = `${sel ? '<span class="flag">乗せる</span>' : '<span class="flag grp">団体</span>'}<span class="star">★</span><span class="gtop"><span class="ic" style="background:${k.color}">${k.ch}</span><b>${g.name}<small>×${g.size}</small></b></span><span class="dest"><i style="background:${DEST_COLORS[c.dest]}"></i>${LINE.stations[c.dest].name}</span><span class="nums"><span>${coinHtml(fare)}×${g.size}</span><span class="bonus">そろって+${coinHtml(g.size)}</span><span class="tol">🛡${k.tol}</span></span>`;
        else b.innerHTML = `${sel ? '<span class="flag">乗せる</span>' : c.prio ? '<span class="flag req">優先</span>' : ''}<span class="star">★</span><span class="ic" style="background:${k.color}">${k.ch}</span><span class="dest"><i style="background:${DEST_COLORS[c.dest]}"></i>${LINE.stations[c.dest].name}</span>${S.roleOf(R, c.dest) === 'nostop' ? '<span class="shoot">射出のみ</span>' : ''}<span class="nums"><span>${coinHtml(fare)}</span><span class="tol">🛡${k.tol}</span></span>`;
        let pressT = 0;
        let long = false;
        b.addEventListener('pointerdown', () => {
          long = false;
          pressT = window.setTimeout(() => {
            long = true;
            const tip = $('cand-tip');
            const bb = b.getBoundingClientRect();
            tip.innerHTML = g
              ? `<b>団体：${g.name}（${k.name}${g.size}人）</b><br>${g.size}人まとめて乗る。全員を${LINE.stations[g.dest].name}にそろって届けると ${coinHtml(g.size)}。1人でも落とすとボーナスなし`
              : `<b>${k.name}${k.size > 1 ? `（席${k.size}つ）` : ''}${c.prio ? '・優先客' : ''}</b><br>${coinText(k.note)}${c.prio ? `<br><span style="color:#B53E28">乗せずに発車すると信頼−${S.PRIO_LOSS}</span>` : ''}`;
            tip.hidden = false;
            tip.style.left = `${Math.max(8, Math.min(window.innerWidth - 230, bb.left))}px`;
            tip.style.top = `${bb.top - tip.offsetHeight - 8}px`;
          }, 380);
        });
        const endPress = () => {
          window.clearTimeout(pressT);
          $('cand-tip').hidden = true;
        };
        b.addEventListener('pointerup', endPress);
        b.addEventListener('pointerleave', endPress);
        b.addEventListener('pointercancel', endPress);
        b.addEventListener('contextmenu', (e) => e.preventDefault());
        b.addEventListener('click', () => {
          if (long) return;
          togglePick(R, c.id);
        });
        box.appendChild(b);
      }
      $('seats').textContent = `${seatsUsed(R)}/${R.cap}`;
      const n = R.picked.size;
      $('btn-depart').textContent = n ? `${n}人を乗せて発車 ▶` : '誰も乗せずに発車 ▶';
    }
    const left = R.offer?.filter((o) => !o.sold).length ?? 0;
    $('btn-shop').innerHTML = `お店<small>${left}品</small>`;
    ($('btn-shop') as HTMLButtonElement).disabled = !R.offer;
    $('btn-seat').textContent = mode === 'in' ? '◀ 客選びに戻る' : `車内で席を決める（${R.pax.length}人）`;
    $('dwell-hint').textContent = mode === 'in' ? '客をドラッグして席を決めよう。触ると説明' : R.picked.size ? '乗せた客は端から詰めて座る。屋根などへは「車内で席を決める」で移そう' : '';
  } else candKey = '';

  // お店（停車中に何枚でも買える）
  if (R.offer !== offerShown) {
    // 着いたら自動で開く
    if (R.offer && !offerShown) shopOpen = true;
    offerShown = R.offer;
  }
  if (!R.offer) shopOpen = false;
  $('offer').hidden = !shopOpen;
  if (shopOpen && R.offer) {
    const key = R.money + '|' + R.rerolls + '|' + R.offer.map((o) => o.id + o.price + (o.sold ? 's' : '')).join(',');
    if (key !== shopKey) {
      shopKey = key;
      $('shop-money').innerHTML = `所持金 ${coinHtml(R.money)}`;
      const owned = [...R.mods];
      const bt = owned.flatMap((m) => OFFER_TAGS[m] ?? []) as Tag[];
      $('shop-build').innerHTML = owned.length ? `いまのビルド ${tagHtml(bt)}` : 'まだ魔改造なし。タグをそろえるとコンボが起きやすい';
      const cards = $('offer-cards');
      cards.innerHTML = '';
      R.offer.forEach((o, i) => {
        const b = document.createElement('button');
        b.type = 'button';
        const can = !o.sold && R.money >= o.price;
        b.className = 'ocard ' + (o.kind === 'mod' ? 'o-mod' : 'o-item') + (o.sold ? ' sold' : can ? '' : ' poor');
        b.disabled = o.sold;
        const hint = o.sold ? null : comboHint(R, o.id);
        const known = hint && meta.combos[hint.combo.id];
        if (hint) b.classList.add('hint');
        b.innerHTML = `<span class="tagrow"><span class="tag">${o.kind === 'item' ? 'アイテム' : '魔改造' + (o.tier && o.tier !== 'Ⅰ' ? ' ' + o.tier : '')}</span>${tagHtml(OFFER_TAGS[o.id] ?? [])}</span><span class="price">${o.sold ? '購入済み' : (o.price < o.full ? `<s>${o.full}</s> ` : '') + coinHtml(o.price)}</span>${!o.sold && o.price < o.full ? '<span class="sale">セール</span>' : ''}<b>${o.name}</b><span class="d">${o.desc}</span>${hint ? `<span class="combo-hint">◎ ${known ? `${hint.combo.name}：` : ''}${hint.partner}と相性${known ? '' : '（何かが起きる…）'}</span>` : ''}`;
        b.addEventListener('click', () => {
          if (buyCard(R, i)) sfx.select();
          else sfx.bad();
        });
        cards.appendChild(b);
      });
      const rb = $('btn-reroll') as HTMLButtonElement;
      rb.innerHTML = `リロール ${coinHtml(rerollCost(R))}`;
      rb.disabled = R.money < rerollCost(R);
    }
  }

  // コンボの演出
  const ci = R.cutins[R.cutins.length - 1];
  if (ci && ci.t !== cutinShown) {
    cutinShown = ci.t;
    const d = comboDef(ci.id);
    const el = $('cutin');
    el.className = ci.first ? 'first' : 'again';
    el.innerHTML = `<span class="ci-kicker">${ci.first ? 'COMBO 発見！' : 'COMBO'}</span><span class="ci-name">${d.name}</span><span class="ci-sub">${tagHtml(d.tags)} ${coinText(ci.extra || d.eff.replace('¢', '¢'))}</span>`;
    void el.offsetWidth;
    el.classList.add('show');
    sfx.combo(ci.first);
  }
  // 衝撃
  const sh = R.shocks[R.shocks.length - 1];
  if (sh && sh.t !== shockShown) {
    shockShown = sh.t;
    const el = $('shock');
    const launch = sh.label.startsWith('急ブレーキ射出');
    if (launch) el.innerHTML = `<span class="lbl">${sh.label}</span><span class="num">${sh.flew.length ? `${sh.flew.join('・')} 射出！` : '…誰も飛ばない'}</span>`;
    else el.innerHTML = `<span class="lbl">${coinText(sh.label)}</span><span class="num">衝撃 ${sh.value}！</span>${sh.flew.length ? `<span class="flew">${sh.flew.join('・')}が吹っ飛んだ！</span>` : sh.safe ? '<span class="safe">全員セーフ</span>' : ''}`;
    el.classList.toggle('launch', launch);
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
    tb.innerHTML = R.toasts.map((t) => `<div class="toast ${t.kind}">${coinText(t.text)}</div>`).join('');
  }

  if ((R.phase === 'clear' || R.phase === 'over') && !resultShown) {
    resultShown = true;
    showResult();
  }
}

function showResult() {
  const clear = R.phase === 'clear';
  const st = Math.min(R.target, LINE.stations.length - 1);
  const mult = clear && R.rank ? R.rank.mult : 1;
  const total = carryHome(R);
  meta.bank += total;
  meta.runs += 1;
  meta.best = Math.max(meta.best, total);
  saveMeta(meta);
  $('result-title').textContent = clear ? (R.kaisou ? `回送扱い（ノルマ未達）` : `終点 ${LINE.stations[LINE.stations.length - 1].name} 到着！`) : `${LINE.stations[st].name}の手前で運転打ち切り`;
  $('result-reason').textContent = clear
    ? R.kaisou
      ? `終点には着いたが、届けた客は ${R.delivered}/${LINE.quota}人。ノルマに届かずクリアにならない`
      : `評価「${R.rank?.name}」 終点で ${R.ahead <= 0 ? `${mmss(-R.ahead)} 早着` : `${mmss(R.ahead)} 遅れ`}`
    : `${R.overReason}。`;
  const rows: [string, string][] = [
    ['進んだ駅', `${clear ? LINE.stations.length : st}/${LINE.stations.length}`],
    ['届けた客（ノルマ）', `${R.delivered}/${LINE.quota}人`],
    ['吹っ飛ばした客', `${R.stats.flew}人`],
    ['最大の衝撃', `${R.stats.maxShock}`],
    ['早着', `${R.stats.early}回`],
    ['射出', `${R.stats.launches}回`],
    ['PERFECT / GOOD', `${R.stats.perfect} / ${R.stats.good}`],
    ['最高連続着地', `${R.stats.bestStreak}駅`],
    ['コンボ', `${R.stats.combos}回`],
  ];
  $('result-stats').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
  const earned = earnedOf(R);
  const money: [string, string][] = [
    ['稼いだコイン', coinHtml(earned)],
    ['（うち早着ボーナス）', coinHtml(R.earlyBonus)],
    ['お店で使った', `−${coinHtml(R.spent)}`],
    ['残り', coinHtml(R.money)],
  ];
  if (clear && R.lo === 'debt') money.push(['借金の返済', R.money >= 12 ? `−${coinHtml(12)}` : '返せない…持ち帰り0']);
  money.push([clear && !R.kaisou ? `持ち帰り＝（稼ぎ÷6＋残り÷3）×${mult}（${R.rank?.name}）${LINE.carry !== 1 ? `×${LINE.carry}（${LINE.short}）` : ''}` : `${R.kaisou ? '回送扱い' : '運転打ち切り'}：稼ぎ÷12`, '']);
  $('result-money').innerHTML = money.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('') + `<dt class="sum">持ち帰り</dt><dd class="sum">${coinHtml(total)}</dd>`;
  $('result-bank').innerHTML = `貯金 ${coinHtml(meta.bank)}`;
  // 運行記録：区間ごとに
  let lastSt = -1;
  let logHtml = '';
  for (const e of R.log) {
    if (e.st !== lastSt) {
      lastSt = e.st;
      logHtml += `<li class="st">${e.st === 0 ? `${LINE.stations[0].name}（始発）` : `${LINE.stations[e.st - 1].name} → ${LINE.stations[e.st].name}`}</li>`;
    }
    logHtml += `<li class="${e.good ? 'good' : 'bad'}">${coinText(e.text)}</li>`;
  }
  $('result-log-list').innerHTML = logHtml || '<li class="st">記録なし</li>';
  ($('result-log') as HTMLDetailsElement).open = false;
  $('result').hidden = false;
}


// ---------- 路線図・ダイヤ（開いている間はゲームが止まる） ----------
function openMap() {
  if (screen !== 'run' || R.phase === 'clear' || R.phase === 'over') return;
  R.paused = true;
  R.reverse = false;
  const n = LINE.stations.length;
  const curSec = R.phase === 'dwell' ? R.target : R.target - 1;
  let html = '';
  for (let i = 0; i < n; i++) {
    const plan = R.schedule[i];
    const act = R.arrivals[i];
    const diff = act == null ? null : act - plan;
    const here = (R.phase === 'dwell' && i === R.target) || false;
    const next = R.phase === 'running' && i === R.target;
    const alight = R.pax.filter((p) => p.dest === i).length;
    html += `<div class="m-st ${here ? 'here' : ''} ${next ? 'next' : ''} ${act != null && !here ? 'done' : ''}">
      <span class="dot" style="background:${DEST_COLORS[i]}"></span>
      <b>${LINE.stations[i].name}</b>
      <span class="al">${alight ? `降りる客 ${alight}人` : ''}</span>
      <span class="t">予定 ${mmss(plan)}</span>
      <span class="t">${act == null ? '—' : `実際 ${mmss(act)}`}</span>
      <span class="d ${diff == null ? '' : diff <= 0 ? 'ok' : 'late'}">${diff == null ? '' : diff <= 0 ? `−${mmss(-diff)}` : `+${mmss(diff)}`}</span>
    </div>`;
    if (i < n - 1) {
      const visible = i <= curSec + 1;
      const obs = R.obstacles[i];
      const icons = visible ? obs.map((o) => `<span class="ob ${o.state !== 'wait' ? 'gone' : ''}">${OBS_INFO[o.kind].ch}</span>`).join('') : '<span class="ob unk">？</span><span class="ob unk">？</span>';
      const cur = i === curSec && R.phase === 'running';
      html += `<div class="m-sec ${cur ? 'cur' : ''}"><span class="bar"></span>${icons}<span class="len">${LINE.sections[i]}m</span>${cur ? '<span class="now">いまここ</span>' : ''}</div>`;
    }
  }
  $('map-list').innerHTML = html;
  const ahead = R.ahead;
  const remain = n - 1 - (R.phase === 'dwell' ? R.target : R.target - 1);
  let advice = '';
  if (ahead > 1 && remain > 0) {
    const per = ahead / remain;
    advice = `残り${remain}区間で ${mmss(ahead)} 取り戻すには、1区間あたり約 ${Math.ceil(per)}秒 短縮`;
  } else advice = ahead <= 0 ? `ダイヤより ${mmss(-ahead)} 早い。このままなら評価「定時運行」` : 'ほぼダイヤどおり';
  $('map-advice').textContent = advice;
  $('map').hidden = false;
}
function closeMap() {
  $('map').hidden = true;
  R.paused = false;
}
$('btn-map-close').addEventListener('click', closeMap);
$('btn-map').addEventListener('click', openMap);

// ---------- 客の詳細カード ----------
function showPaxCard(id: number, cx: number, cy: number) {
  const p = R.pax.find((q) => q.id === id);
  if (!p) return;
  const k = KINDS[p.kind];
  const sp = R.spots[p.spot];
  const parts = [`基本 ${k.tol}`];
  if (sp?.kind === 'seat') parts.push(`座席 +${seatBonus(R)}`);
  if (sp?.kind === 'strap') parts.push('つり革 +10');
  const tol = effTol(R, p);
  const sumo = tol - k.tol - (sp?.kind === 'seat' ? seatBonus(R) : sp?.kind === 'strap' ? 10 : 0);
  if (sumo > 0) parts.push(`力士の隣 +${sumo}`);
  const nextStop = R.phase === 'dwell' ? R.target + 1 : R.target;
  const left = p.dest - nextStop + 1;
  const card = $('pax-card');
  card.innerHTML = `<b>${k.name}</b><span class="dest"><i style="background:${DEST_COLORS[p.dest]}"></i>${LINE.stations[p.dest].name}まで（${left <= 1 ? '次で降りる' : `あと${left}駅`}）</span><span>耐衝撃 <b class="num">${tol}</b>（${parts.join('＋')}）</span><span class="note">${k.note}</span>`;
  const b = card.parentElement!.getBoundingClientRect();
  card.style.left = `${Math.min(b.width - 230, Math.max(8, cx - b.left - 110))}px`;
  card.hidden = false;
  // 指で隠れないよう、触った位置より上に出す（上に入らなければ下へ）
  const h = card.offsetHeight;
  const above = cy - b.top - h - 64;
  card.style.top = `${above >= 8 ? above : cy - b.top + 56}px`;
}
function hidePaxCard() {
  $('pax-card').hidden = true;
}
canvas.addEventListener('pointercancel', hidePaxCard);
canvas.addEventListener('lostpointercapture', hidePaxCard);

// ---------- 車内の一覧 ----------
let listKey = '';
let tabKey = '';
function renderCarTabs() {
  const box = $('cartabs');
  const key = `${R.cars}|${R.decks}|${R.spots.length}|${focus}|${deckFocus}|` + R.pax.map((p) => `${R.spots[p.spot]?.car}.${R.spots[p.spot]?.deck}`).join(',');
  if (key === tabKey) return;
  tabKey = key;
  box.innerHTML = '';
  // 段のタブ
  const decks = [0, ...(R.spots.some((sp) => sp.car === focus && sp.deck === 1) ? [1] : []), ...(R.spots.some((sp) => sp.car === focus && sp.deck === 2) ? [2] : [])];
  if (decks.length > 1) {
    for (const d of decks) {
      const n = R.pax.filter((p) => R.spots[p.spot]?.car === focus && R.spots[p.spot]?.deck === d).length;
      const cap = R.spots.filter((sp) => sp.car === focus && sp.deck === d).length;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'cartab deck' + (d === deckFocus ? ' cur' : '');
      b.dataset.c = String(focus);
      b.dataset.d = String(d);
      b.innerHTML = `<b>${DECK_NAME[d]}</b><small>${n}/${cap}</small>`;
      b.addEventListener('click', () => {
        deckFocus = d;
        tabKey = '';
      });
      box.appendChild(b);
    }
  }
  if (R.cars < 2) return;
  for (let c = 0; c < R.cars; c++) {
    const n = R.pax.filter((p) => R.spots[p.spot]?.car === c).length;
    const cap = R.spots.filter((sp) => sp.car === c).length;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'cartab' + (c === focus ? ' cur' : '');
    b.dataset.c = String(c);
    b.innerHTML = `<b>${c + 1}号車</b><small>${n}/${cap}</small>`;
    b.addEventListener('click', () => {
      focus = c;
      deckFocus = 0;
      tabKey = '';
    });
    box.appendChild(b);
  }
}
function renderPaxList() {
  const box = $('paxlist');
  const th = threat(R);
  const nextStop = R.phase === 'dwell' ? R.target + 1 : R.target;
  const sorted = [...R.pax].sort((a, b) => a.dest - b.dest || effTol(R, a) - effTol(R, b));
  const key = sorted.map((p) => `${p.id}:${effTol(R, p)}`).join(',') + '|' + th + '|' + nextStop;
  if (key === listKey) return;
  listKey = key;
  box.innerHTML = sorted.length
    ? sorted
        .map((p) => {
          const t = effTol(R, p);
          const bad = th > t && !R.airbag;
          const left = p.dest - nextStop + 1;
          return `<span class="pl ${bad ? 'bad' : th ? 'ok' : ''}"><i style="background:${DEST_COLORS[p.dest]}">${left <= 1 ? '降' : left}</i>${KINDS[p.kind].name}<b>${t}</b>${th ? (bad ? '✕' : '◯') : ''}</span>`;
        })
        .join('')
    : '<span class="pl-empty">乗っている客はいない</span>';
}

// ---------- 音 ----------
window.addEventListener('pointerdown', unlock, { capture: true });
window.addEventListener('keydown', unlock, { capture: true });
// ---------- 一時停止メニュー（途中でやめて車両基地へ） ----------
let menuOpen = false;
let quitArmed = false;
function openMenu() {
  if (screen !== 'run' || R.phase === 'clear' || R.phase === 'over') return;
  menuOpen = true;
  quitArmed = false;
  R.paused = true;
  const qb = $('btn-quit');
  qb.textContent = R.tutorial ? '研修をやめて車両基地へ' : '車両基地へ戻る';
  qb.classList.remove('armed');
  $('menu-note').textContent = R.tutorial ? (meta.tutorialDone ? '研修は車両基地の「研修運転をもう一度」からいつでもできる' : '研修は次に出発したとき、また最初から始まる') : `このランは打ち切り。稼いだコインの1/4（今なら${Math.floor(earnedOf(R) / 4)}枚）を持ち帰る`;
  $('menu').hidden = false;
}
function closeMenu() {
  menuOpen = false;
  R.paused = false;
  $('menu').hidden = true;
}
$('btn-menu').addEventListener('click', openMenu);
$('btn-resume').addEventListener('click', closeMenu);
$('btn-quit').addEventListener('click', () => {
  const qb = $('btn-quit');
  if (!quitArmed) {
    quitArmed = true;
    qb.textContent = 'もう一度押すと戻る';
    qb.classList.add('armed');
    sfx.bad();
    return;
  }
  closeMenu();
  if (R.tutorial) {
    // 研修は済みにしない
    R.tutorial = false;
    hideCoach();
    toHub();
    return;
  }
  R.phase = 'over';
  R.overReason = '途中でやめた';
});
window.addEventListener('keydown', (e) => {
  if (e.code !== 'Escape' || screen !== 'run') return;
  if (menuOpen) closeMenu();
  else openMenu();
});

const soundBtn = $('btn-sound');
const paintSound = () => (soundBtn.textContent = isMuted() ? '×' : '♪');
paintSound();
soundBtn.addEventListener('click', () => {
  toggleMute();
  paintSound();
});
const W = { pops: 0, notch: -1, phase: '', money: 0, shock: 0, picked: 0, offer: false, taps: new Map<Obstacle, number>(), states: new Map<Obstacle, string>(), screen: '' };
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
  const lp = R.pops[R.pops.length - 1];
  if (lp && lp.t !== W.pops) {
    W.pops = lp.t;
    if (lp.good) (lp.text.startsWith('PERFECT') ? sfx.cleared : sfx.coin)();
    else sfx.bad();
  }
  const sh = R.shocks[R.shocks.length - 1];
  if (sh && sh.t !== W.shock) {
    W.shock = sh.t;
    if (sh.label.startsWith('高速走行')) sfx.jolt();
    sfx.shock(sh.value);
    if (sh.flew.length) sfx.fly();
  }
  if (R.picked.size !== W.picked) sfx.pick(R.picked.size > W.picked);
  W.picked = R.picked.size;
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

// ---------- トップ画面の走行映像（自動運転で射出・停車まで見せる） ----------
let demo: Run | null = null;
let demoZoom = 1;
function drawHubScene(dt: number) {
  const cv = $('hub-scene') as HTMLCanvasElement;
  const rc = cv.getBoundingClientRect();
  if (!rc.width) return;
  if (!demo || demo.meta.line !== meta.line) {
    demo = makeDemo(meta);
    setCarPalette(S.LINE.cars);
  }
  if (!stepDemo(demo, dt)) demo = null;
  if (!demo) return;
  const r = demo;
  const dpr = window.devicePixelRatio || 1;
  const W2 = Math.round(rc.width * dpr);
  const H2 = Math.round(rc.height * dpr);
  if (cv.width !== W2 || cv.height !== H2) {
    cv.width = W2;
    cv.height = H2;
  }
  const c = cv.getContext('2d')!;
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.fillStyle = '#F5EFE3';
  c.fillRect(0, 0, rc.width, rc.height);
  const zt = r.phase === 'dwell' ? 1.9 : 1.15;
  demoZoom += (zt - demoZoom) * Math.min(1, dt * 3);
  drawOutside(c, r, rc.width, 0, rc.height - 2, [], demoZoom);
}

// ---------- 射出のスロー ----------
const SLOWMO = 0.4;
let slowT = 0;
let slowLaunches = 0;
let camOff = 4;

// ---------- ループ ----------
const params = new URLSearchParams(location.search);
const SPEED = Math.max(1, Number(params.get('speed')) || 1);
if (params.has('debug')) Object.assign(window, { __cam: () => ({ zoomS, slowT, camOff, userZoom, tw: trainBox ? Math.round(trainBox.x1 - trainBox.x0) : 0 }), __demo: () => demo, __hits: () => hits, __S: S, __R: () => R, __mode: setMode, __start: startRun, __meta: meta });
if (params.has('go')) startRun(params.has('tutorial'));
else renderHub();
let last = performance.now();
function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000) * SPEED;
  last = now;
  if (screen === 'run') {
    // 射出のスローモーション：客が飛んでいる間はゆっくり、カメラも客を追う
    if (R.stats.launches !== slowLaunches) {
      if (R.stats.launches > slowLaunches && R.fliers.some((f) => !f.judged && f.launch)) slowT = 3.5;
      slowLaunches = R.stats.launches;
    }
    const flying = R.fliers.filter((f) => !f.judged && f.launch);
    if (slowT > 0) slowT = flying.length ? slowT - dt : Math.min(slowT, 0.35) - dt;
    const slowing = slowT > 0 && !R.paused;
    const sdt = dt * R.slow * (slowing ? SLOWMO : 1);
    const steps = Math.ceil(sdt / 0.02);
    for (let i = 0; i < steps; i++) update(R, sdt / steps);
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
      const zt = userZoom * (R.phase === 'dwell' ? DWELL_ZOOM : 1) * (slowing ? 1.8 : 1);
      zoomS += (zt - zoomS) * Math.min(1, dt * 6);
      // スロー中は飛んでいる客と電車の間を見る
      const fx = slowing && flying.length ? (R.x + Math.max(...flying.map((f) => f.x + f.vx * Math.min(f.tLand, R.time - f.t)))) / 2 : null;
      // 電車からのずれで追う（速く走っていても遅れない）
      const offT = fx != null ? fx - R.x : R.phase === 'dwell' ? -(R.cars * 12) / 2 : 4;
      camOff += (offT - camOff) * Math.min(1, dt * 4);
      const res = drawOutside(ctx, R, w, BAR_H, h - 2, hits, zoomS, R.x + camOff);
      trainBox = res.train;
    } else {
      if (focus >= R.cars) focus = 0;
      if (deckFocus === 2 && !R.spots.some((sp) => sp.car === focus && sp.deck === 2)) deckFocus = 0;
      if (deckFocus === 1 && !R.spots.some((sp) => sp.car === focus && sp.deck === 1)) deckFocus = 0;
      drawInside(ctx, R, w, BAR_H, h - 2, drag && drag.moved ? drag : null, hits, focus, deckFocus);
    }
    drawBar(ctx, R, w, 22);
    // 下のパネルの障害バー（走行中）
    if (R.phase === 'running' && mode === 'out') {
      const sb = $('secbar') as HTMLCanvasElement;
      const sr = sb.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      if (sb.width !== Math.round(sr.width * dpr) || sb.height !== Math.round(sr.height * dpr)) {
        sb.width = Math.round(sr.width * dpr);
        sb.height = Math.round(sr.height * dpr);
      }
      const sc = sb.getContext('2d')!;
      sc.setTransform(dpr, 0, 0, dpr, 0, 0);
      sc.clearRect(0, 0, sr.width, sr.height);
      drawSection(sc, R, sr.width, 12);
    }
    renderHud();
    updateCoach(R, meta, shopOpen && !!R.offer, now);
  } else {
    hideCoach();
    if (screen === 'hub' && !$('hub').hidden) drawHubScene(dt);
  }
  watchSounds();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
