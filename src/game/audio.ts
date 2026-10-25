// 仮のBGMと効果音。音源ファイルは使わず Web Audio で合成する。

type Scene = 'hub' | 'run' | 'dwell' | 'none';

let ac: AudioContext | null = null;
let master: GainNode;
let bgmBus: GainNode;
let sfxBus: GainNode;
let noiseBuf: AudioBuffer;
let muted = false;
try {
  muted = localStorage.getItem('hakobi.mute') === '1';
} catch {
  // 無視
}

function init() {
  if (ac) return;
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!AC) return;
  ac = new AC();
  master = ac.createGain();
  master.gain.value = muted ? 0 : 0.9;
  master.connect(ac.destination);
  bgmBus = ac.createGain();
  bgmBus.gain.value = 0.32;
  bgmBus.connect(master);
  sfxBus = ac.createGain();
  sfxBus.gain.value = 0.7;
  sfxBus.connect(master);
  noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  schedule();
}

/** 最初のタップで音を有効にする（ブラウザの決まり） */
export function unlock() {
  init();
  // 他のアプリに切り替えたあとなどに止まった音を戻す（suspended 以外に interrupted もある）
  if (ac && ac.state !== 'running' && ac.state !== 'closed') void ac.resume().catch(() => {});
}
// 画面に戻ってきたときも音を戻す
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && ac && ac.state !== 'running' && ac.state !== 'closed') void ac.resume().catch(() => {});
});
export function isMuted() {
  return muted;
}
export function toggleMute() {
  muted = !muted;
  try {
    localStorage.setItem('hakobi.mute', muted ? '1' : '0');
  } catch {
    // 無視
  }
  if (ac) master.gain.setTargetAtTime(muted ? 0 : 0.9, ac.currentTime, 0.05);
  return muted;
}

// ---------- 基本の音 ----------
const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

function tone(t: number, freq: number, dur: number, type: OscillatorType, vol: number, bus: GainNode, slideTo?: number) {
  if (!ac) return;
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(bus);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(t: number, dur: number, vol: number, bus: GainNode, filter: BiquadFilterType = 'highpass', freq = 6000, q = 0.7) {
  if (!ac) return;
  const s = ac.createBufferSource();
  s.buffer = noiseBuf;
  const f = ac.createBiquadFilter();
  f.type = filter;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = ac.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f).connect(g).connect(bus);
  s.start(t, Math.random() * 0.5);
  s.stop(t + dur + 0.02);
}

function kick(t: number, vol = 0.9) {
  tone(t, 140, 0.18, 'sine', vol, bgmBus, 45);
}

// ---------- BGM ----------
let scene: Scene = 'none';
let intensity = 0; // 0..1（速度）
let step = 0;
let nextT = 0;

export function setScene(s: Scene) {
  if (s === scene) return;
  scene = s;
  step = 0;
}
export function setIntensity(v: number) {
  intensity = Math.max(0, Math.min(1, v));
}

// C - G - Am - F（走行）／ F - G - Em - Am（基地）
const RUN_CHORDS = [
  [48, 52, 55],
  [43, 47, 50],
  [45, 48, 52],
  [41, 45, 48],
];
const HUB_CHORDS = [
  [41, 45, 48],
  [43, 47, 50],
  [40, 43, 47],
  [45, 48, 52],
];
// 16分 × 16 のメロディ（-1 は休み）
const RUN_MEL = [
  [72, -1, 74, -1, 76, -1, 79, -1, 76, -1, 74, -1, 72, -1, 74, 76],
  [74, -1, -1, 71, 74, -1, 79, -1, 77, -1, 76, -1, 74, -1, -1, -1],
  [72, -1, 76, -1, 81, -1, 79, -1, 76, -1, 72, -1, 76, -1, 74, -1],
  [77, -1, 76, -1, 74, -1, 72, -1, 74, -1, 76, -1, 74, -1, -1, -1],
];
// 発車メロディ風（停車中）
const DWELL_MEL = [84, -1, 88, -1, 91, -1, 88, -1, 86, -1, 91, -1, 89, -1, 86, -1, 84, -1, 88, -1, 91, -1, 96, -1, 93, -1, 91, -1, -1, -1, -1, -1];

function schedule() {
  if (!ac) return;
  const look = 0.12;
  if (nextT < ac.currentTime) nextT = ac.currentTime + 0.05;
  while (nextT < ac.currentTime + look) {
    playStep(nextT, step);
    const bpm = scene === 'run' ? 112 + intensity * 40 : scene === 'dwell' ? 104 : 92;
    nextT += 60 / bpm / 4;
    step++;
  }
  setTimeout(schedule, 30);
}

function playStep(t: number, s: number) {
  if (scene === 'none') return;
  const bar = Math.floor(s / 16) % 4;
  const i = s % 16;
  if (scene === 'run') {
    const ch = RUN_CHORDS[bar];
    // ベース（8分）
    if (i % 2 === 0) tone(t, mtof(ch[0] - 12 + (i % 4 === 2 ? 12 : 0)), 0.16, 'triangle', 0.5, bgmBus);
    // 裏拍のコード
    if (i % 4 === 2) for (const n of ch) tone(t, mtof(n + 12), 0.09, 'square', 0.05, bgmBus);
    // ドラム
    if (i % 4 === 0) kick(t, 0.7);
    if (i % 8 === 4) noise(t, 0.12, 0.25, bgmBus, 'bandpass', 2200, 1.2);
    if (intensity > 0.45 ? true : i % 2 === 0) noise(t, 0.03, intensity > 0.45 ? 0.08 : 0.05, bgmBus, 'highpass', 8000);
    // メロディ（速いほど目立つ）
    const m = RUN_MEL[bar][i];
    if (m > 0) tone(t, mtof(m), 0.14, 'square', 0.05 + intensity * 0.05, bgmBus);
    if (intensity > 0.75 && m > 0) tone(t, mtof(m + 12), 0.08, 'triangle', 0.05, bgmBus);
  } else if (scene === 'dwell') {
    const m = DWELL_MEL[s % 32];
    if (m > 0) {
      tone(t, mtof(m), 0.6, 'sine', 0.13, bgmBus);
      tone(t, mtof(m) * 3.01, 0.25, 'sine', 0.03, bgmBus);
    }
    if (i % 8 === 0) tone(t, mtof(RUN_CHORDS[Math.floor(s / 32) % 4][0] - 12), 0.4, 'triangle', 0.3, bgmBus);
    if (i % 4 === 2) noise(t, 0.03, 0.03, bgmBus, 'highpass', 9000);
  } else if (scene === 'hub') {
    const ch = HUB_CHORDS[bar];
    if (i === 0 || i === 6 || i === 10) tone(t, mtof(ch[0] - 12), 0.5, 'triangle', 0.4, bgmBus);
    if (i % 4 === 0) ch.forEach((n, k) => tone(t + k * 0.03, mtof(n + 12), 0.5, 'sine', 0.06, bgmBus));
    if (i % 8 === 4) tone(t, mtof(ch[2] + 24), 0.35, 'sine', 0.05, bgmBus);
    if (i % 2 === 1) noise(t, 0.02, 0.025, bgmBus, 'highpass', 9000);
  }
}

// ---------- 効果音 ----------
const now = () => (ac ? ac.currentTime : 0);

export const sfx = {
  notch(brake: boolean) {
    if (!ac) return;
    const t = now();
    tone(t, brake ? 520 : 780, 0.04, 'square', 0.12, sfxBus);
    noise(t, 0.03, 0.15, sfxBus, 'bandpass', 3000, 2);
  },
  knock() {
    if (!ac) return;
    const t = now();
    tone(t, 220 + Math.random() * 60, 0.07, 'triangle', 0.5, sfxBus, 120);
    noise(t, 0.05, 0.25, sfxBus, 'bandpass', 1500, 3);
  },
  cleared() {
    if (!ac) return;
    const t = now();
    [72, 76, 79, 84].forEach((m, k) => tone(t + k * 0.06, mtof(m), 0.18, 'square', 0.12, sfxBus));
  },
  horn() {
    if (!ac) return;
    const t = now();
    for (const f of [311, 370]) {
      tone(t, f, 0.5, 'sawtooth', 0.09, sfxBus);
      tone(t + 0.55, f, 0.35, 'sawtooth', 0.08, sfxBus);
    }
  },
  shock(value: number) {
    if (!ac) return;
    const t = now();
    const v = Math.min(1, value / 70);
    tone(t, 110, 0.35 + v * 0.3, 'sine', 0.6 + v * 0.4, sfxBus, 35);
    noise(t, 0.25 + v * 0.35, 0.3 + v * 0.5, sfxBus, 'lowpass', 1200 + v * 2500);
    if (value >= 40) noise(t + 0.05, 0.4, 0.25, sfxBus, 'bandpass', 3500, 0.8);
  },
  fly() {
    if (!ac) return;
    const t = now();
    tone(t, 1400, 1.2, 'sine', 0.12, sfxBus, 260);
    tone(t + 0.02, 1480, 1.2, 'sine', 0.05, sfxBus, 280);
    noise(t + 1.5, 0.6, 0.35, sfxBus, 'lowpass', 1400);
  },
  brake() {
    if (!ac) return;
    const t = now();
    noise(t, 0.7, 0.18, sfxBus, 'bandpass', 4200, 6);
    tone(t, 2100, 0.7, 'sine', 0.04, sfxBus, 1900);
  },
  jolt() {
    if (!ac) return;
    const t = now();
    for (let k = 0; k < 3; k++) tone(t + k * 0.07, 90, 0.08, 'square', 0.15, sfxBus, 60);
  },
  arrive() {
    if (!ac) return;
    const t = now();
    tone(t, mtof(76), 0.7, 'sine', 0.22, sfxBus);
    tone(t + 0.35, mtof(72), 0.9, 'sine', 0.22, sfxBus);
    noise(t + 0.1, 0.5, 0.06, sfxBus, 'highpass', 5000);
  },
  coin() {
    if (!ac) return;
    const t = now();
    tone(t, mtof(88), 0.08, 'square', 0.1, sfxBus);
    tone(t + 0.08, mtof(95), 0.25, 'square', 0.1, sfxBus);
  },
  depart() {
    if (!ac) return;
    const t = now();
    noise(t, 0.35, 0.12, sfxBus, 'bandpass', 900, 1);
    tone(t + 0.3, mtof(79), 0.12, 'square', 0.08, sfxBus);
    tone(t + 0.42, mtof(84), 0.2, 'square', 0.08, sfxBus);
  },
  pick(on: boolean) {
    if (!ac) return;
    const t = now();
    tone(t, mtof(on ? 79 : 72), 0.08, 'triangle', 0.25, sfxBus);
    if (on) tone(t + 0.05, mtof(84), 0.1, 'triangle', 0.2, sfxBus);
  },
  select() {
    if (!ac) return;
    const t = now();
    [67, 72, 76, 79].forEach((m, k) => tone(t + k * 0.05, mtof(m), 0.2, 'square', 0.09, sfxBus));
  },
  bad() {
    if (!ac) return;
    const t = now();
    tone(t, 220, 0.18, 'square', 0.1, sfxBus);
    tone(t + 0.12, 185, 0.25, 'square', 0.1, sfxBus);
  },
  drag() {
    if (!ac) return;
    tone(now(), 600, 0.05, 'triangle', 0.15, sfxBus, 900);
  },
  drop() {
    if (!ac) return;
    tone(now(), 400, 0.07, 'triangle', 0.2, sfxBus, 260);
  },
  clear() {
    if (!ac) return;
    const t = now();
    [72, 76, 79, 84, 79, 84, 88].forEach((m, k) => tone(t + k * 0.12, mtof(m), 0.3, 'square', 0.1, sfxBus));
  },
  combo(first: boolean) {
    if (!ac) return;
    const t = now();
    noise(t, 0.25, 0.35, sfxBus, 'highpass', 2500, 1);
    (first ? [72, 76, 79, 84, 88, 91] : [79, 84, 88]).forEach((m, k) => tone(t + 0.05 + k * 0.07, mtof(m), 0.22, 'square', 0.12, sfxBus));
  },
  over() {
    if (!ac) return;
    const t = now();
    [67, 63, 60, 55].forEach((m, k) => tone(t + k * 0.2, mtof(m), 0.4, 'triangle', 0.25, sfxBus));
  },
};
