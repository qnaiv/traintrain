// 見習い車掌：研修運転の案内と、初めて出会ったときだけのヒント
import { KINDS, LINE, POS, kmh, nextObstacle, saveMeta, treeNeed, type Meta, type Run } from './state.ts';

const $ = (id: string) => document.getElementById(id)!;

interface Btn {
  label: string;
  fn: () => void;
  main?: boolean;
}
interface Say {
  text: string;
  /** 光らせる要素（CSS セレクタ） */
  target?: string;
  /** 「次へ」で進む（条件で進まない） */
  next?: boolean;
  /** ボタンを並べる（「もう一度」など） */
  buttons?: Btn[];
  step?: string;
  /** 研修の吹き出しは「とばす」つき */
  tut?: boolean;
  /** 画面のいちばん上に出す（お店の上など） */
  top?: boolean;
  /** 失敗の説明（赤い枠） */
  fail?: boolean;
  /** 走行中の説明：初めて出たときはゲームを止めて「わかった」を待つ */
  id?: string;
  /** 「わかった」のあとに景色の上に残す一行 */
  short?: string;
}

let shown = '';
let tutStep = 0;
let kidId = -1;
let tutResult = '';
let onNext: (() => void) | null = null;
/** 失敗の説明中（ゲームは止まっている） */
let failSay: Say | null = null;
/** やり直し地点：倒木の前（発車直後）と、駅の手前 */
let cpTree: Run | null = null;
let cpLaunch: Run | null = null;
let tries = 0;
/** 成功のひとこと（数秒だけ出す） */
/** 読んだ説明 */
const acked = new Set<string>();
let tipNow: Say | null = null;
let rewinder: ((r: Run) => void) | null = null;

/** 研修のやり直しで Run を差し替える方法（main から渡す） */
export function setRewinder(fn: (r: Run) => void) {
  rewinder = fn;
}
function snap(r: Run): Run {
  const { meta, ...rest } = r;
  const c = structuredClone(rest) as Omit<Run, 'meta'>;
  return { ...c, meta } as Run;
}
function rewind(cp: Run | null, step: number) {
  if (!cp || !rewinder) return;
  const r = snap(cp);
  r.paused = false;
  failSay = null;
  tutStep = step;
  tries++;
  rewinder(r);
}

/** 研修を始める */
export function startCoach(r: Run) {
  tutStep = r.tutorial ? 1 : 0;
  tutResult = '';
  failSay = null;
  cpTree = null;
  cpLaunch = null;
  tries = 0;
  acked.clear();
  tipNow = null;
  kidId = r.candidates.find((c) => c.kind === 'kid')?.id ?? -1;
  hide();
}

function endTutorial(r: Run, meta: Meta) {
  tutStep = 0;
  failSay = null;
  r.slow = 1;
  r.paused = false;
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

/** 失敗：ゲームを止めて、何が起きたかと、失敗するとどうなるかを見せる */
function fail(r: Run, text: string, cp: Run | null, step: number, delay = 0): Say {
  const show = () => {
    r.paused = true;
    failSay = {
      text,
      step: '失敗…',
      tut: true,
      fail: true,
      buttons: [{ label: 'もう一度 ▶', main: true, fn: () => rewind(cp, step) }],
    };
  };
  if (delay > 0) {
    // 着水などの様子を少し見せてから止める
    failSay = { text: 'あっ…', step: '', tut: true };
    window.setTimeout(show, delay);
  } else show();
  return failSay!;
}

function tutorial(r: Run, meta: Meta): Say | null {
  if (failSay) return failSay;
  const kidAboard = r.pax.find((p) => p.id === kidId);
  const kidFlier = r.fliers.find((f) => f.pax.id === kidId);
  const tree = r.obstacles[0]?.[0];
  if (!r.tutorial) {
    // 研修をやめた
    tutStep = 0;
    failSay = null;
    hide();
    return null;
  }
  if ((r.phase === 'clear' || r.phase === 'over') && tutStep < 6) {
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
      // 乗った客は端から詰めて座る。屋根（射出台）へは自分で移す
      if (!document.body.classList.contains('inside'))
        return { text: '乗った客は<b>端から詰めて</b>座る。子どもを<b class="hl">屋根の上</b>（射出台）に移そう。<b>車内で席を決める</b>を押して', target: '#btn-seat', step: '研修 2/5', tut: true };
      return { text: '子どもを、上の<b class="hl">「屋根の上」</b>タブまで<b>ドラッグ</b>！', target: '.cartab[data-d="2"]', step: '研修 2/5', tut: true };
    case 3:
      if (r.phase === 'running') {
        cpTree = snap(r);
        tutStep = 4;
        return tutorial(r, meta);
      }
      return { text: '屋根に乗った！ 準備OK。<b>発車</b>しよう（ほかの客を乗せてもいい）', target: '#btn-depart', step: '研修 3/5', tut: true };
    case 4: {
      const need = treeNeed(r);
      // 失敗：速すぎて屋根の子どもが飛んだ
      if (!kidAboard && kidFlier) {
        return fail(
          r,
          `速すぎて、倒木の衝撃で<b class="hl">屋根の子どもが飛んでしまった</b>。屋根は衝撃に弱い。飛んだ客は運賃がもらえず、<b>信頼も減る</b>。<b class="ok">${need}〜${need + 4}km/h</b>くらいで突き破ろう`,
          cpTree,
          4,
          1600,
        );
      }
      // 失敗：遅すぎて止められた
      if (tree && tree.state === 'hit' && r.stuck > 0) {
        return fail(r, `遅すぎて<b class="hl">倒木に止められた</b>。撤去に6秒かかって<b>遅れ</b>が増える。遅れが上限を超えると運転打ち切り。<b class="ok">${need}km/h以上</b>で突き破ろう`, cpTree, 4);
      }
      if (!tree || tree.state !== 'wait') {
        if (acked.has('treeOK')) {
          cpLaunch = null;
          tutStep = 5;
          return tutorial(r, meta);
        }
        return {
          id: 'treeOK',
          text: '突き破った！ ちなみに<b>遅すぎると止められて遅れ</b>、<b>速すぎると屋根の客が飛ぶ</b>。ちょうどいい速さを狙うのがコツ',
          step: '研修 4/5',
          tut: true,
        };
      }
      const k = kmh(r.v);
      const msg =
        k < need
          ? `倒木は<b class="hl">${need}km/h以上</b>で突き破る。レバーを<b>P3</b>にして加速！`
          : k > need + 5
            ? `速すぎると屋根の子どもが飛ぶ！ <b>N</b>や<b>B1</b>で<b class="hl">${need}〜${need + 4}km/h</b>くらいに`
            : `いい速さ！ そのまま突き破れ（速すぎると屋根の子が飛ぶ）`;
      return {
        id: 'tree',
        text: `この先に<b>倒木</b>。<b class="hl">${need}km/h以上</b>でぶつかると突き破れる。でも<b>速すぎると屋根の子どもが飛ぶ</b>。下の<b>レバー</b>で速さを合わせよう（P3で加速、N・B1で抑える）`,
        short: msg,
        target: '#lever',
        step: '研修 4/5',
        tut: true,
      };
    }
    case 5: {
      const toSt = POS[1] - r.x;
      // やり直し地点：駅の150m手前
      if (!cpLaunch && kidAboard && toSt < 150 && r.phase === 'running') cpLaunch = snap(r);
      if (kidFlier) {
        if (!kidFlier.judged) {
          if (r.time - kidFlier.t < kidFlier.tLand) r.slow = 0.4;
          return { text: '飛んだ！ 着地を見守ろう…', step: '研修 5/5', tut: true };
        }
        if (kidFlier.result === 'perfect' || kidFlier.result === 'good') {
          tutResult = kidFlier.result;
          tutStep = 6;
          return tutorial(r, meta);
        }
        return fail(
          r,
          `ホームに届かず<b class="hl">田んぼにポチャン</b>。外すと運賃がもらえず、<b>信頼が大きく減る</b>（お年寄りや子どもは特に）。<b>点線の先</b>を見て、<b class="ok">緑の丸</b>に重なった瞬間に押そう`,
          cpLaunch ?? cpTree,
          5,
          1400,
        );
      }
      if (kidAboard && r.target > 1) {
        return fail(r, `射出しないまま<b class="hl">鵠沼を通り過ぎた</b>。乗り過ごした客は次の駅まで連れて行かれて、<b>信頼が減る</b>。駅の手前でレバーを<b>非常</b>へ！`, cpLaunch ?? cpTree, 5);
      }
      if (!kidAboard && r.phase === 'dwell') {
        return fail(r, `止まって降ろすのもアリ。でも研修では<b class="hl">射出</b>を覚えよう。射出なら止まらずに届けられて、×2マットなら運賃2倍`, cpLaunch ?? cpTree, 5);
      }
      if (toSt < 110 && toSt > -10 && r.phase === 'running') {
        r.slow = 0.4;
        return {
          id: 'launch',
          text: `鵠沼が近い。屋根の子どもから<b>点線</b>が伸びているのが、今急ブレーキしたときの飛び先。点線の先が<b class="ok">緑の丸（×2マット）</b>に重なった瞬間に、レバーを左端の<b class="hl">「非常」</b>へ入れると射出！ 時間はゆっくりになっている`,
          short: `点線の先が<b class="ok">緑の丸</b>に重なったらレバーを<b class="hl">非常</b>へ！${tries ? '（速さで届く先が変わる）' : ''}`,
          target: '#lever',
          step: '研修 5/5 ・ スロー',
          tut: true,
        };
      }
      return { text: `${LINE.stations[1].name}が近づいたら、屋根の子どもを<b>急ブレーキで射出</b>してホームへ届ける`, step: '研修 5/5', tut: true };
    }
    case 6: {
      const perfect = tutResult === 'perfect';
      r.paused = true;
      return {
        text: perfect
          ? '<b class="ok">PERFECT！</b> ×2マットに着地で運賃2倍。駅ごとに続けて決めると上乗せされる。<br>ちなみに<b>外すと田んぼにポチャン</b>で、信頼が減る'
          : '<b class="ok">GOOD！</b> ホームに届いた。真ん中の<b>×2マット</b>に落とせば運賃2倍。<br>ちなみに<b>外すと田んぼにポチャン</b>で、信頼が減る',
        step: '研修',
        tut: true,
        buttons: [
          ...(perfect ? [] : [{ label: 'PERFECTを狙う', fn: () => rewind(cpLaunch ?? cpTree, 5) }]),
          {
            label: '次へ ▶',
            main: true,
            fn: () => {
              r.paused = false;
              tutStep = 7;
            },
          },
        ],
      };
    }
    case 7:
      return {
        text: '駅に<b>止まれば</b>客を乗せられて<b>お店</b>にも寄れる。射出したあとレバーを<b>P</b>に戻して<b>通過</b>すれば時間を稼げる。どっちで行くかは自由！ 研修はここまで',
        step: '研修おわり',
        tut: true,
        buttons: [{ label: 'はじめる ▶', main: true, fn: () => endTutorial(r, meta) }],
      };
  }
  return null;
}

/** 初めて出会ったときだけのヒント（6秒で消える・ゲームは止めない） */
function tip(r: Run, meta: Meta, shopOpen: boolean, _now: number): Say | null {
  if (tipNow) return tipNow;
  const fire = (id: string, text: string, top = false): Say => {
    meta.tips.push(id);
    saveMeta(meta);
    tipNow = {
      text,
      step: '初めての…',
      top,
      buttons: [
        {
          label: 'わかった ▶',
          main: true,
          fn: () => {
            tipNow = null;
            r.paused = false;
          },
        },
      ],
    };
    // 走行中なら読んでいる間は止める
    if (r.phase === 'running') r.paused = true;
    return tipNow;
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
    if (o.kind === 'work' && !seen('work')) return fire('work', '<b>工事区間</b>：30km/hまで落とせば衝撃なし。50m以内に近づいて<b>タップで警笛</b>を鳴らせば、作業員が1秒で退く');
    if (o.kind === 'slope' && !seen('slope')) return fire('slope', '<b>坂</b>：上りは速さが落ち、下りは勝手に速くなる。次の障害に備えて');
    if (o.kind === 'flood' && !seen('flood')) return fire('flood', '<b>浸水区間</b>：15km/hまで落とせば衝撃なし。速すぎるとモーターが水をかぶって止まる。ジャンプで越えてもいい');
    if (o.kind === 'tree' && r.meta.line === 'ginza' && !seen('rubble')) return fire('rubble', '<b>ガレキ</b>：倒木と同じ。40km/h以上で突き破れ');
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

function render(say0: Say | null, r: Run, meta: Meta) {
  const box = $('coach');
  const ring = $('coach-ring');
  if (!say0) {
    if (shown) hide();
    return;
  }
  // 走行中の説明：初めては止めて「わかった」、読んだあとは景色の上に一行だけ
  let say: Say = say0;
  let mini = false;
  const running = r.phase === 'running' && !say0.fail && !say0.buttons;
  if (running) {
    if (say0.id && !acked.has(say0.id)) {
      r.paused = true;
      say = {
        ...say0,
        buttons: [
          {
            label: 'わかった ▶',
            main: true,
            fn: () => {
              acked.add(say0.id!);
              r.paused = false;
            },
          },
        ],
      };
    } else {
      mini = true;
      say = { ...say0, text: say0.short ?? say0.text };
    }
  }
  const key = (mini ? 'm' : '') + say.text + (say.target ?? '') + (say.buttons?.length ?? 0) + (say.fail ? 'f' : '');
  if (key !== shown) {
    shown = key;
    box.innerHTML = `<span class="face"><i class="cap"></i><i class="badge"></i><i class="eye l"></i><i class="eye r"></i><i class="mouth"></i></span><div class="cbody">${mini ? '' : `<div class="chead"><span class="who">見習い車掌</span><span class="step">${say.step ?? ''}</span>${say.tut ? '<button type="button" class="skip">とばす</button>' : ''}</div>`}<span class="ctext">${say.text}</span>${say.next ? '<button type="button" class="cnext">次へ ▶</button>' : ''}${say.buttons ? `<div class="cbtns">${say.buttons.map((b, i) => `<button type="button" class="cbtn${b.main ? ' main' : ''}" data-i="${i}">${b.label}</button>`).join('')}</div>` : ''}</div>`;
    box.classList.toggle('fail', !!say.fail);
    box.classList.toggle('mini', mini);
    const btns = say.buttons;
    box.querySelectorAll<HTMLButtonElement>('.cbtn').forEach((el) =>
      el.addEventListener('click', () => {
        btns?.[Number(el.dataset.i)]?.fn();
        shown = '';
      }),
    );
    box.querySelector('.skip')?.addEventListener('click', () => endTutorial(r, meta));
    box.querySelector('.cnext')?.addEventListener('click', () => {
      const f = onNext;
      onNext = null;
      f?.();
      shown = '';
    });
    box.hidden = false;
  }
  // 位置：景色（キャンバス）の上に出す。下の操作パネルは隠さない
  const ar = $('app').getBoundingClientRect();
  const vr = $('view').getBoundingClientRect();
  box.style.left = `${ar.left + 10}px`;
  box.style.width = `${Math.min(ar.width, window.innerWidth) - 20}px`;
  const barH = 108;
  box.style.top = say.top ? '6px' : `${Math.round(vr.top + (mini ? barH + 12 : Math.min(barH + 10, vr.height * 0.18)))}px`;
  // 光らせる対象（一行表示のときは暗くしない）
  const el = say.target ? document.querySelector<HTMLElement>(say.target) : null;
  if (el && el.offsetParent) {
    const b = el.getBoundingClientRect();
    ring.hidden = false;
    ring.classList.toggle('soft', mini);
    ring.style.left = `${b.left - 4}px`;
    ring.style.top = `${b.top - 4}px`;
    ring.style.width = `${b.width + 8}px`;
    ring.style.height = `${b.height + 8}px`;
  } else ring.hidden = true;
}
