// 見習い車掌：研修運転の案内と、初めて出会ったときだけのヒント
import { KINDS, LINE, POS, kmh, nextObstacle, saveMeta, treeNeed, type Meta, type Run } from './state.ts';

const $ = (id: string) => document.getElementById(id)!;

interface Say {
  text: string;
  /** 光らせる要素（CSS セレクタ） */
  target?: string;
  /** 「次へ」で進む（条件で進まない） */
  next?: boolean;
  step?: string;
  /** 研修の吹き出しは「とばす」つき */
  tut?: boolean;
  /** 画面のいちばん上に出す（お店の上など） */
  top?: boolean;
}

let shown = '';
let tipUntil = 0;
let tipText = '';
let tipTop = false;
let tutStep = 0;
let tutWait = false;
let kidId = -1;
let resultSaid = false;
let tutResult = '';
let onNext: (() => void) | null = null;

/** 研修を始める */
export function startCoach(r: Run) {
  tutStep = r.tutorial ? 1 : 0;
  tutWait = false;
  resultSaid = false;
  tutResult = '';
  kidId = r.candidates.find((c) => c.kind === 'kid')?.id ?? -1;
  tipUntil = 0;
  hide();
}

function endTutorial(r: Run, meta: Meta) {
  tutStep = 0;
  r.slow = 1;
  r.tutorial = false;
  meta.tutorialDone = true;
  saveMeta(meta);
  hide();
}

/** 毎フレーム呼ぶ。今出すべき吹き出しを決める */
export function updateCoach(r: Run, meta: Meta, shopOpen: boolean, now: number) {
  r.slow = 1;
  let say: Say | null = null;
  if (tutStep > 0) say = tutorial(r, meta);
  if (!say) say = tip(r, meta, shopOpen, now);
  render(say, r, meta);
}

function tutorial(r: Run, meta: Meta): Say | null {
  const kidAboard = r.pax.find((p) => p.id === kidId);
  const kidFlier = r.fliers.find((f) => f.pax.id === kidId);
  const tree = r.obstacles[0]?.[0];
  if (r.phase === 'clear' || r.phase === 'over') {
    endTutorial(r, meta);
    return null;
  }
  switch (tutStep) {
    case 1:
      if (r.picked.has(kidId) || kidAboard) {
        tutStep = 2;
        return tutorial(r, meta);
      }
      return { text: 'まずは<b class="hl">鵠沼まで行く子ども</b>を乗せよう。カードをタップ！', target: `.cand[data-id="${kidId}"]`, step: '研修 1/5', tut: true };
    case 2:
      if (kidAboard && r.spots[kidAboard.spot]?.deck === 2) {
        tutStep = 3;
        return tutorial(r, meta);
      }
      return { text: '<b>おまかせ配置</b>を押すと、次の駅で降りる客が<b class="hl">屋根の上</b>に乗る。屋根は射出台！', target: '#btn-auto', step: '研修 2/5', tut: true };
    case 3:
      if (r.phase === 'running') {
        tutStep = 4;
        return tutorial(r, meta);
      }
      return { text: '準備OK。<b>発車</b>しよう！（ほかの客を乗せてもいい）', target: '#btn-depart', step: '研修 3/5', tut: true };
    case 4: {
      if (!tree || tree.state !== 'wait') {
        tutStep = 5;
        return tutorial(r, meta);
      }
      const k = kmh(r.v);
      const need = treeNeed(r);
      const msg =
        k < need
          ? `倒木は<b class="hl">${need}km/h以上</b>で突き破る。レバーを<b>P3</b>にして加速！`
          : k > need + 5
            ? `速すぎると屋根の子どもが飛ぶ！ <b>N</b>にして<b class="hl">${need}〜${need + 4}km/h</b>くらいに`
            : `いい速さ！ そのまま突き破れ（速すぎると屋根の子が飛ぶ）`;
      return { text: msg, target: '#lever', step: '研修 4/5', tut: true };
    }
    case 5: {
      // 子どもの行方
      if (kidFlier || (!kidAboard && r.phase === 'dwell')) {
        if (kidFlier && !kidFlier.judged) return { text: '飛んだ！ 着地を見守ろう…', step: '研修 5/5', tut: true };
        tutResult = kidFlier?.result ?? '';
        tutStep = 6;
        return tutorial(r, meta);
      }
      if (!kidAboard) {
        tutResult = 'flew';
        tutStep = 6;
        return tutorial(r, meta);
      }
      const toSt = POS[1] - r.x;
      if (toSt < 110 && toSt > -10 && r.phase === 'running') {
        r.slow = 0.4;
        return { text: '点線の先が<b class="ok">緑の丸（×2マット）</b>に重なったら、<b class="hl">急ブレーキ射出！</b>', target: '#btn-eb', step: '研修 5/5 ・ スロー', tut: true };
      }
      return { text: `${LINE.stations[1].name}が近づいたら、屋根の子どもを<b>急ブレーキで射出</b>してホームへ届ける。まずは走ろう`, step: '研修 5/5', tut: true };
    }
    case 6: {
      const res = tutResult;
      const text =
        res === 'perfect'
          ? '<b class="ok">PERFECT！</b> ×2マットに着地で運賃2倍。駅ごとに続けて決めると上乗せされる'
          : res === 'good'
            ? '<b class="ok">GOOD！</b> ホームに届いた。真ん中の<b>×2マット</b>に落とせば運賃2倍'
            : res === 'miss' || res === 'lost' || res === 'flew'
              ? '惜しい！ 点線の先を見ながら、<b>速さ</b>と<b>押すタイミング</b>で着地点が変わる。次の駅で'
              : '止まって降ろしてもOK。でも射出なら止まらずに届けられる';
      if (!resultSaid) {
        resultSaid = true;
        tutWait = true;
        onNext = () => {
          tutStep = 7;
          tutWait = false;
        };
      }
      return { text, next: true, step: '研修', tut: true };
    }
    case 7:
      if (!tutWait) {
        tutWait = true;
        onNext = () => endTutorial(r, meta);
      }
      return {
        text: '駅に<b>止まれば</b>客を乗せられて<b>お店</b>にも寄れる。<b>射出で通過</b>すれば時間を稼げる。どっちで行くかは自由！ 研修はここまで',
        next: true,
        step: '研修おわり',
        tut: true,
      };
  }
  return null;
}

/** 初めて出会ったときだけのヒント（6秒で消える・ゲームは止めない） */
function tip(r: Run, meta: Meta, shopOpen: boolean, now: number): Say | null {
  if (now < tipUntil) return { text: tipText, next: true, step: '初めての…', top: tipTop };
  const fire = (id: string, text: string, top = false): Say => {
    tipTop = top;
    meta.tips.push(id);
    saveMeta(meta);
    tipText = text;
    tipUntil = now + 6500;
    onNext = () => (tipUntil = 0);
    return { text, next: true, step: '初めての…', top };
  };
  const seen = (id: string) => meta.tips.includes(id);
  if (shopOpen && !seen('shop')) return fire('shop', '<b>駅のお店</b>：お金が続くかぎり何枚でも買える。<b class="ok">◎</b>は持ち物と組むとコンボになる印', true);
  if (r.phase !== 'running') return null;
  const o = nextObstacle(r);
  if (o && o.x - r.x < 130) {
    if (o.kind === 'curve' && !seen('curve')) return fire('curve', '<b>急カーブ！</b> 20km/hまで落とせば衝撃なし。<b>B2</b>で早めに減速');
    if (o.kind === 'deer' && !seen('deer')) return fire('deer', '<b>鹿！</b> 画面の鹿をタップして警笛で追い払え');
    if (o.kind === 'pole' && !seen('pole')) return fire('pole', '<b>倒れた電柱</b>：タップ連打で片付ける。学生が乗っていると手伝ってくれる');
    if (o.kind === 'wave' && !seen('wave')) return fire('wave', '<b>江ノ島の大波</b>：波が引いたすきに通れば衝撃なし。ジャンプで越えてもいい');
  }
  if (r.items.jump > 0 && o && !seen('jump')) return fire('jump', '<b>ジャンプ台</b>：押すと次の障害の手前で電車ごと跳ぶ。<b>速いほど遠く</b>へ');
  const sumo = r.pax.find((p) => p.kind === 'sumo');
  if (sumo && !seen('sumo')) return fire('sumo', `<b>${KINDS.sumo.name}</b>は席を3つ使うけど、隣の客の耐衝撃が上がる`);
  return null;
}

export function hideCoach() {
  hide();
}
function hide() {
  $('coach').hidden = true;
  $('coach-ring').hidden = true;
  shown = '';
}

function render(say: Say | null, r: Run, meta: Meta) {
  const box = $('coach');
  const ring = $('coach-ring');
  if (!say) {
    if (shown) hide();
    return;
  }
  const key = say.text + (say.target ?? '');
  if (key !== shown) {
    shown = key;
    box.innerHTML = `<span class="face"><i class="cap"></i><i class="badge"></i><i class="eye l"></i><i class="eye r"></i><i class="mouth"></i></span><div class="cbody"><div class="chead"><span class="who">見習い車掌</span><span class="step">${say.step ?? ''}</span>${say.tut ? '<button type="button" class="skip">とばす</button>' : ''}</div><span class="ctext">${say.text}</span>${say.next ? '<button type="button" class="cnext">次へ ▶</button>' : ''}</div>`;
    box.querySelector('.skip')?.addEventListener('click', () => endTutorial(r, meta));
    box.querySelector('.cnext')?.addEventListener('click', () => {
      const f = onNext;
      onNext = null;
      f?.();
      shown = '';
    });
    box.hidden = false;
  }
  // 光らせる対象
  const el = say.target ? document.querySelector<HTMLElement>(say.target) : null;
  // 画面に固定（お店のモーダルより上）。横幅はゲーム画面に合わせる
  const ar = $('app').getBoundingClientRect();
  const ab = { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
  box.style.left = `${ar.left + 10}px`;
  box.style.width = `${Math.min(ar.width, window.innerWidth) - 20}px`;
  if (el && el.offsetParent) {
    const b = el.getBoundingClientRect();
    ring.hidden = false;
    ring.style.left = `${b.left - ab.left - 4}px`;
    ring.style.top = `${b.top - ab.top - 4}px`;
    ring.style.width = `${b.width + 8}px`;
    ring.style.height = `${b.height + 8}px`;
    // 吹き出しは対象の上（上半分にあるなら下）
    const h = box.offsetHeight;
    const above = b.top - ab.top > ab.height / 2;
    const top = above ? b.top - ab.top - h - 18 : b.bottom - ab.top + 18;
    box.style.top = `${Math.max(8, Math.min(ab.height - h - 8, top))}px`;
    box.classList.toggle('above', above);
    box.classList.toggle('below', !above);
    const ax = Math.max(24, Math.min(ar.width - 40, b.left - ar.left - 10 + b.width / 2));
    box.style.setProperty('--ax', `${ax - 12}px`);
  } else {
    ring.hidden = true;
    box.classList.remove('above', 'below');
    box.style.top = say.top ? '6px' : `${Math.round(ab.height * 0.16)}px`;
  }
}
