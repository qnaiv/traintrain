// 見習い車掌：研修運転の案内と、初めて出会ったときだけのヒント
import { KINDS, LINE, NEAR, POS, kmh, nextObstacle, saveMeta, treeNeed, tutorialStation1, PRIO_LOSS, type Meta, type Run } from './state.ts';

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
  /** 一行表示のときに光らせる要素 */
  shortTarget?: string;
  /** この客（車内の絵）から target までドラッグする手本を見せる */
  dragPax?: number;
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
let locator: ((id: number) => { x: number; y: number } | null) | null = null;
/** 車内の客の画面上の位置を返す方法（main から渡す） */
export function setPaxLocator(fn: (id: number) => { x: number; y: number } | null) {
  locator = fn;
}

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
  // 研修で説明したものは、初回ヒントを出さない
  for (const id of ['shop', 'prio']) if (!meta.tips.includes(id)) meta.tips.push(id);
  saveMeta(meta);
  hide();
}

/** 毎フレーム呼ぶ。今出すべき吹き出しを決める */
export function updateCoach(r: Run, meta: Meta, shopOpen: boolean, now: number) {
  r.slow = 1;
  let say: Say | null = null;
  if (tutStep > 0) say = tutorial(r, meta, shopOpen);
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

function tutorial(r: Run, meta: Meta, shopOpen = false): Say | null {
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
        return tutorial(r, meta, shopOpen);
      }
      return { text: 'まずは<b class="hl">入地まで行く子ども</b>を乗せよう。カードをタップ！', target: `.cand[data-id="${kidId}"]`, step: '研修 1/8', tut: true };
    case 2:
      if (kidAboard && r.spots[kidAboard.spot]?.deck === 2) {
        tutStep = 3;
        return tutorial(r, meta, shopOpen);
      }
      // 乗った客は端から詰めて座る。屋根（射出台）へは自分で移す
      if (!document.body.classList.contains('inside'))
        return { text: '乗った客は<b>端から詰めて</b>座る。子どもを<b class="hl">屋根の上</b>（射出台）に移そう。<b>車内で席を決める</b>を押して', target: '#btn-seat', step: '研修 2/8', tut: true };
      return { text: '光っている<b class="hl">子ども</b>をつかんで、下の<b class="hl">「屋根の上」</b>タブまで<b>ドラッグ</b>！', target: '.cartab[data-d="2"]', dragPax: kidId, step: '研修 2/8', tut: true };
    case 3:
      if (r.phase === 'running') {
        cpTree = snap(r);
        tutStep = 4;
        return tutorial(r, meta, shopOpen);
      }
      return { text: '屋根に乗った！ 準備OK。<b>発車</b>しよう（ほかの客を乗せてもいい）', target: '#btn-depart', step: '研修 3/8', tut: true };
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
          return tutorial(r, meta, shopOpen);
        }
        return {
          id: 'treeOK',
          text: '突き破った！ ちなみに<b>遅すぎると止められて遅れ</b>、<b>速すぎると屋根の客が飛ぶ</b>。ちょうどいい速さを狙うのがコツ',
          step: '研修 4/8',
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
      // まだ倒木が下のパネルに出ていない（遠い）あいだは、まず走り出すことだけ伝える
      if (tree.x - r.x > NEAR) {
        return {
          text: k < 1 ? '発車！ <b class="hl">レバー</b>を<b>P3</b>まで上げて加速しよう' : 'この先に<b>倒木</b>がある。近づくと<b class="hl">下のパネル</b>に出るので、それまで加速しておこう',
          target: k < 1 ? '#lever' : undefined,
          shortTarget: '#lever',
          step: '研修 4/8',
          tut: true,
        };
      }
      return {
        id: 'tree',
        text: `この先に<b>倒木</b>。光っている<b>下のパネル</b>に、横から見た倒木までの距離と、<b class="hl">${need}km/h以上</b>で突き破れることが出ている。電車の上の顔は乗客で、数字は<b>耐えられる衝撃</b>。赤くなった客は飛んでしまう。<b>レバー</b>で速さを合わせよう（P3で加速、N・B1で抑える）`,
        short: msg,
        target: '#fc-side',
        shortTarget: '#lever',
        step: '研修 4/8',
        tut: true,
      };
    }
    case 5: {
      const toSt = POS[1] - r.x;
      // やり直し地点：駅の150m手前
      if (!cpLaunch && kidAboard && toSt < 150 && r.phase === 'running') cpLaunch = snap(r);
      if (kidFlier) {
        if (!kidFlier.judged) {
          return { text: '飛んだ！ 着地を見守ろう…', step: '研修 5/8', tut: true };
        }
        if (kidFlier.result === 'perfect' || kidFlier.result === 'good') {
          tutResult = kidFlier.result;
          tutStep = 6;
          return tutorial(r, meta, shopOpen);
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
        return fail(r, `射出しないまま<b class="hl">入地を通り過ぎた</b>。乗り過ごした客は次の駅まで連れて行かれて、<b>信頼が減る</b>。駅の手前でレバーを<b>非常</b>へ！`, cpLaunch ?? cpTree, 5);
      }
      if (!kidAboard && r.phase === 'dwell') {
        return fail(r, `止まって降ろすのもアリ。でも研修では<b class="hl">射出</b>を覚えよう。射出なら止まらずに届けられて、◎マットなら運賃アップ`, cpLaunch ?? cpTree, 5);
      }
      if (toSt < 110 && toSt > -10 && r.phase === 'running') {
        r.slow = 0.4;
        return {
          id: 'launch',
          text: `入地が近い。光っている<b>下のパネル</b>の<b>点線</b>が、今急ブレーキしたときの子どもの飛び先。点線の先が<b class="ok">緑（PERFECT）</b>になった瞬間に、レバーを左端の<b class="hl">「非常」</b>へ入れると射出！ 時間はゆっくりになっている`,
          short: `下のパネルの点線が<b class="ok">緑</b>になったらレバーを<b class="hl">非常</b>へ！${tries ? '（速さで届く先が変わる）' : ''}`,
          target: '#fc-side',
          shortTarget: '#lever',
          step: '研修 5/8 ・ スロー',
          tut: true,
        };
      }
      return { text: `${LINE.stations[1].name}が近づいたら、屋根の子どもを<b>急ブレーキで射出</b>してホームへ届ける`, step: '研修 5/8', tut: true };
    }
    case 6: {
      const perfect = tutResult === 'perfect';
      r.paused = true;
      return {
        text: perfect
          ? '<b class="ok">PERFECT！</b> ◎マットに着地で運賃アップ。駅ごとに続けて決めると上乗せされる。<br>ちなみに<b>外すと田んぼにポチャン</b>で、信頼が減る'
          : '<b class="ok">GOOD！</b> ホームに届いた。真ん中の<b>◎マット</b>に落とせば運賃アップ。<br>ちなみに<b>外すと田んぼにポチャン</b>で、信頼が減る',
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
    case 7: {
      // 入地に止まる
      if (r.phase === 'dwell' && r.target === 1) {
        tutorialStation1(r);
        tutStep = 8;
        return tutorial(r, meta, shopOpen);
      }
      if (r.target > 1) return fail(r, `止まらずに<b class="hl">入地を通り過ぎた</b>。今回は入地に止まって、お店と乗客を見てみよう。射出したあとはレバーを<b>非常</b>のまま止まる`, cpLaunch ?? cpTree, 5);
      const back = r.x > POS[1] + 4;
      return {
        text: back
          ? '少し行き過ぎた。下の<b class="hl">◀ バック</b>を押している間だけ戻れる。駅の手前まで戻ろう'
          : r.v < 0.1
            ? 'ホームの手前で止まった。レバーを<b>P1</b>にしてゆっくり進み、<b>N</b>に戻して止まろう（上の路線バーで駅の手前に入れば停車）'
            : '射出したら、そのままレバーを<b>非常</b>かB3にして<b>入地で止まろう</b>。止まれば客を乗せられて、お店にも寄れる',
        target: back ? '#btn-reverse' : '#lever',
        step: '研修 6/8',
        tut: true,
      };
    }
    case 8: {
      // お店：決まった3枚。◎を体験して屋根席を買う
      if (r.mods.has('roof')) {
        if (!shopOpen) {
          tutStep = 9;
          return tutorial(r, meta, shopOpen);
        }
        return { text: '買えた！ 屋根に乗れる人数が増えた。<b>買い物を終える</b>を押そう', target: '#btn-shop-close', step: '研修 7/8 お店', tut: true, top: true };
      }
      if (!shopOpen) return { text: '駅に着いたら<b>お店</b>に寄れる。光っているボタンで開こう', target: '#btn-shop', step: '研修 7/8 お店', tut: true };
      return {
        text: '<b>駅のお店</b>。稼いだコインで<b>アイテム</b>（使い切り）や<b>魔改造</b>（ずっと効く）を買える。光っている<b>屋根席</b>には<b class="ok">◎</b>が付いている。今持っている<b>ジャンプ台</b>と組むと<b>コンボ</b>が起きる印。買ってみよう！',
        target: '.ocard[data-id="roof"]',
        step: '研修 7/8 お店',
        tut: true,
        top: true,
      };
    }
    case 9: {
      // 優先客
      const prio = r.candidates.find((c) => c.prio);
      if (!prio || r.picked.has(prio.id)) {
        tutStep = 10;
        return tutorial(r, meta, shopOpen);
      }
      return {
        text: `<b class="hl">「優先」</b>の札の客は、乗せずに発車したり駅を通過したりすると<b>信頼−${PRIO_LOSS}</b>。行き先は近い駅。光っている<b>お年寄り</b>を乗せよう`,
        target: `.cand[data-id="${prio.id}"]`,
        step: '研修 8/8 優先客',
        tut: true,
      };
    }
    case 10:
      r.paused = true;
      return {
        text: `最後に<b>ノルマ</b>。本番では上の<b>路線バーの左下</b>に「ノルマ 0/8人」と出る。終点までに<b>届ける人数</b>で、足りないとクリアにならない。止まる駅・射出で飛ばす駅・通過する駅を選んで進もう。<br>研修は次の<b>竜ヶ崎</b>が終点。急カーブに気をつけて、着けば修了！`,
        target: '#view',
        step: '研修 最後',
        tut: true,
        buttons: [
          {
            label: '竜ヶ崎へ ▶',
            main: true,
            fn: () => {
              r.paused = false;
              tutStep = 11;
            },
          },
        ],
      };
    case 11:
      if (r.phase === 'clear' || r.phase === 'over') {
        endTutorial(r, meta);
        return null;
      }
      if (r.phase === 'dwell') return { text: '客を乗せたら<b>発車</b>。竜ヶ崎に着けば研修修了！', target: '#btn-depart', step: '研修 最後', tut: true };
      return { text: '<b>竜ヶ崎</b>に着けば研修修了！ 急カーブは<b>20km/h以下</b>で（超えると脱輪）。客は止まって降ろしても、射出してもいい', step: '研修 最後', tut: true };
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
  if (r.phase === 'dwell' && !r.tutorial && r.candidates.some((c) => c.prio) && !seen('prio'))
    return fire('prio', `<b>優先客</b>：「優先」の札の客は、乗せずに発車したり駅を通過したりすると<b class="hl">信頼−${PRIO_LOSS}</b>。終点までに<b>ノルマの人数</b>を届けないとクリアにならない（上の路線バーの左下に表示）`);
  if (r.phase === 'dwell' && !r.tutorial && r.roles.some((x) => x !== 'normal') && !seen('roles'))
    return fire('roles', '<b>駅の役割は毎回ちがう</b>：路線バーの<b class="hl">混</b>は大混雑駅（優先客が多い。通過すると信頼が大きく減る）、<b>射</b>は止まれない駅（ホーム工事中。そこ行きの客は<b>射出</b>で届けるしかない）。止まって降ろすと1人2秒かかる');
  if (r.phase !== 'running') return null;
  const o = nextObstacle(r);
  if (o && o.x - r.x < 130) {
    if (o.kind === 'curve' && !seen('curve')) return fire('curve', '<b>急カーブ！</b> 20km/hを1km/hでも超えると<b class="hl">脱輪して止まる</b>（衝撃も大きい）。<b>B2</b>で早めに減速');
    if (o.kind === 'deer' && !seen('deer')) return fire('deer', '<b>鹿！</b> 画面の鹿をタップして警笛で追い払え');
    if (o.kind === 'pole' && !seen('pole')) return fire('pole', '<b>倒れた電柱</b>：タップ連打で片付ける。学生が乗っていると手伝ってくれる');
    if (o.kind === 'wave' && !seen('wave')) return fire('wave', '<b>江ノ島の大波</b>：波が引いたすきに通れば衝撃なし。ジャンプで越えてもいい');
    if (o.kind === 'work' && !seen('work')) return fire('work', '<b>工事区間</b>：30km/hまで落とせば衝撃なし。50m以内に近づいて<b>タップで警笛</b>を鳴らせば、作業員が1秒で退く');
    if (o.kind === 'slope' && !seen('slope')) return fire('slope', '<b>坂</b>：上りは速さが落ち、下りは勝手に速くなる。次の障害に備えて');
    if (o.kind === 'flood' && !seen('flood')) return fire('flood', '<b>浸水区間</b>：15km/hまで落とせば衝撃なし。速すぎるとモーターが水をかぶって止まる。ジャンプで越えてもいい');
    if (o.kind === 'tree' && r.meta.line === 'ginza' && !seen('rubble')) return fire('rubble', '<b>ガレキ</b>：倒木と同じ。40km/h以上で突き破れ');
  }
  if (r.items.jump > 0 && o && !seen('jump')) return fire('jump', '<b>ジャンプ台</b>：押すと次の障害の手前で電車ごと跳んで<b>衝撃なしで越える</b>。速いほど遠く。空中で<b>非常</b>を引けば空から射出！');
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
  $('coach-pax').hidden = true;
  $('coach-hand').hidden = true;
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
        // 次の説明があれば次のフレームで出し直す（なければ閉じたまま）
        hide();
      }),
    );
    box.querySelector('.skip')?.addEventListener('click', () => endTutorial(r, meta));
    box.querySelector('.cnext')?.addEventListener('click', () => {
      const f = onNext;
      onNext = null;
      f?.();
      hide();
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
  const tgt = mini ? (say0.shortTarget ?? say.target) : say.target;
  const el = tgt ? document.querySelector<HTMLElement>(tgt) : null;
  if (el && el.offsetParent) {
    const b = el.getBoundingClientRect();
    ring.hidden = false;
    ring.classList.toggle('soft', mini);
    ring.style.left = `${b.left - 4}px`;
    ring.style.top = `${b.top - 4}px`;
    ring.style.width = `${b.width + 8}px`;
    ring.style.height = `${b.height + 8}px`;
  } else ring.hidden = true;
  // ドラッグの手本：客を光らせ、指が客→対象へ動く。全体は暗くしない
  const ring2 = $('coach-pax');
  const hand = $('coach-hand');
  const pp = say.dragPax != null && !mini && locator ? locator(say.dragPax) : null;
  if (pp && el && el.offsetParent) {
    ring.classList.add('soft');
    ring2.hidden = false;
    hand.hidden = false;
    ring2.style.left = `${pp.x}px`;
    ring2.style.top = `${pp.y}px`;
    const b = el.getBoundingClientRect();
    hand.style.setProperty('--x0', `${pp.x}px`);
    hand.style.setProperty('--y0', `${pp.y}px`);
    hand.style.setProperty('--x1', `${b.left + b.width / 2}px`);
    hand.style.setProperty('--y1', `${b.top + b.height / 2}px`);
  } else {
    ring2.hidden = true;
    hand.hidden = true;
  }
}
