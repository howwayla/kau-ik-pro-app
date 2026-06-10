// src/lib/sounds.ts — WebAudio cues: deal ding / order click / alert chirp

const STORAGE_KEY = 'sj-pro-sound';

let enabled = localStorage.getItem(STORAGE_KEY) !== 'off';
let ctx: AudioContext | null = null;

export function soundEnabled(): boolean {
    return enabled;
}

export function setSoundEnabled(on: boolean) {
    enabled = on;
    localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off');
}

function audio(): AudioContext | null {
    if (!enabled) return null;
    try {
        ctx ??= new AudioContext();
        if (ctx.state === 'suspended') void ctx.resume();
        return ctx;
    } catch {
        return null;
    }
}

function tone(
    freq: number,
    startAt: number,
    duration: number,
    volume = 0.12,
    type: OscillatorType = 'sine',
) {
    const ac = audio();
    if (!ac) return;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, ac.currentTime + startAt);
    gain.gain.linearRampToValueAtTime(volume, ac.currentTime + startAt + 0.01);
    gain.gain.exponentialRampToValueAtTime(
        0.0001,
        ac.currentTime + startAt + duration,
    );
    osc.connect(gain).connect(ac.destination);
    osc.start(ac.currentTime + startAt);
    osc.stop(ac.currentTime + startAt + duration + 0.05);
}

// 成交 — two-tone ding
export function playDeal() {
    tone(880, 0, 0.12);
    tone(1320, 0.09, 0.18);
}

// 委託回報 — soft click
export function playOrder() {
    tone(520, 0, 0.07, 0.08, 'triangle');
}

// 警示 — urgent chirp
export function playAlert() {
    tone(990, 0, 0.1, 0.14, 'square');
    tone(990, 0.16, 0.1, 0.14, 'square');
    tone(1480, 0.32, 0.2, 0.14, 'square');
}

// 錯誤 — low buzz
export function playError() {
    tone(180, 0, 0.22, 0.1, 'sawtooth');
}
