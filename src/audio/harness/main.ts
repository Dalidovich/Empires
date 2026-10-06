import type { Mood } from '../music/composer';
import { describePiece } from '../music/composer';
import { GenerativeMusic } from '../music/generativeMusic';

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) {
    throw new Error(`Missing element #${id}`);
  }
  return found as T;
}

const seedInput = element<HTMLInputElement>('seed');
const volumeInput = element<HTMLInputElement>('volume');
const status = element<HTMLDivElement>('status');

function currentSeed(): number {
  const value = Number(seedInput.value);
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) >>> 0 : 0;
}

function checkedValue(group: string): string {
  return document.querySelector<HTMLInputElement>(`input[name="${group}"]:checked`)?.value ?? '';
}

const music = new GenerativeMusic({ nextSeed: currentSeed });
let context: AudioContext | null = null;
let volume: GainNode | null = null;
let playing = false;

function applyControls(): void {
  music.forceMood(checkedValue('mood') as Mood);
  music.setEra(Number(checkedValue('era')));
  if (volume) {
    volume.gain.value = Number(volumeInput.value);
  }
}

function describe(): void {
  const piece = describePiece(currentSeed());
  const root = `${NOTE_NAMES[piece.root % 12]}${Math.floor(piece.root / 12) - 1}`;
  status.textContent = [
    playing ? 'playing' : 'stopped',
    `seed ${piece.seed}`,
    `root ${root}`,
    `mode ${piece.mode.join(' ')}`,
  ].join('\n');
}

async function start(): Promise<void> {
  if (!context) {
    context = new AudioContext();
    volume = context.createGain();
    volume.connect(context.destination);
    music.attach(context, volume);
  }
  await context.resume();
  music.stop();
  applyControls();
  music.start();
  playing = true;
  describe();
}

function stop(): void {
  music.stop();
  playing = false;
  describe();
}

element<HTMLButtonElement>('start').addEventListener('click', () => void start());
element<HTMLButtonElement>('stop').addEventListener('click', stop);
element<HTMLButtonElement>('reroll').addEventListener('click', () => {
  seedInput.value = String(Math.floor(Math.random() * 4294967296));
  void start();
});
seedInput.addEventListener('change', describe);
volumeInput.addEventListener('input', applyControls);
element<HTMLFieldSetElement>('mood').addEventListener('change', applyControls);
element<HTMLFieldSetElement>('era').addEventListener('change', applyControls);

describe();
