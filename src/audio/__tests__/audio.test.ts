import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import type { AssetManifest } from '../../shared/assetManifest';
import { emptyManifest } from '../../shared/assetManifest';
import type { SimEvent } from '../../sim/events';
import type { AudioSystem, ListenerViewport } from '../api';
import { createAudioSystem, MAX_VOICES } from '../index';
import { eventSound, uiSoundRequest } from '../mapping';

class FakeNode {
  readonly targets: unknown[] = [];

  connect(target: unknown): unknown {
    this.targets.push(target);
    return target;
  }

  disconnect(): void {}
}

class FakeParam {
  value = 1;

  setValueAtTime(): void {}

  linearRampToValueAtTime(): void {}

  exponentialRampToValueAtTime(): void {}

  setTargetAtTime(): void {}

  cancelScheduledValues(): void {}
}

class FakeGain extends FakeNode {
  readonly gain = new FakeParam();
}

class FakeFilter extends FakeNode {
  type = '';
  readonly frequency = new FakeParam();
  readonly Q = new FakeParam();
}

class FakeConvolver extends FakeNode {
  buffer: unknown = null;
}

interface FakeBuffer {
  url?: string;
  getChannelData?: () => Float32Array;
}

class FakeSource extends FakeNode {
  buffer: FakeBuffer | null = null;
  loop = false;
  onended: (() => void) | null = null;
  readonly playbackRate = new FakeParam();

  constructor(private readonly owner: FakeContext) {
    super();
  }

  start(): void {
    this.owner.started.push(this);
  }

  stop(): void {}
}

class FakeOscillator extends FakeNode {
  type = '';
  onended: (() => void) | null = null;
  readonly frequency = new FakeParam();
  readonly detune = new FakeParam();

  constructor(private readonly owner: FakeContext) {
    super();
  }

  start(): void {
    this.owner.oscillators.push(this);
  }

  stop(): void {}
}

class FakeContext {
  static instances: FakeContext[] = [];
  static corrupt = new Set<string>();

  state = 'suspended';
  currentTime = 0;
  readonly sampleRate = 2000;
  readonly oscillators: FakeOscillator[] = [];
  readonly destination = new FakeNode();
  readonly gains: FakeGain[] = [];
  readonly started: FakeSource[] = [];
  readonly decoded: string[] = [];

  constructor() {
    FakeContext.instances.push(this);
  }

  createGain(): FakeGain {
    const gain = new FakeGain();
    this.gains.push(gain);
    return gain;
  }

  createBufferSource(): FakeSource {
    return new FakeSource(this);
  }

  createMediaElementSource(): FakeNode {
    return new FakeNode();
  }

  createOscillator(): FakeOscillator {
    return new FakeOscillator(this);
  }

  createBiquadFilter(): FakeFilter {
    return new FakeFilter();
  }

  createConvolver(): FakeConvolver {
    return new FakeConvolver();
  }

  createDynamicsCompressor(): FakeNode {
    return new FakeNode();
  }

  createBuffer(_channels: number, length: number): FakeBuffer {
    const data = new Float32Array(length);
    return { getChannelData: () => data };
  }

  async decodeAudioData(data: unknown): Promise<FakeBuffer> {
    const url = String(data);
    this.decoded.push(url);
    if (FakeContext.corrupt.has(url)) {
      throw new Error('decode failed');
    }
    return { url };
  }

  async resume(): Promise<void> {
    this.state = 'running';
  }

  async suspend(): Promise<void> {
    this.state = 'suspended';
  }

  async close(): Promise<void> {
    this.state = 'closed';
  }
}

class FakeAudio {
  static instances: FakeAudio[] = [];

  src = '';
  preload = '';
  paused = true;
  readonly played: string[] = [];
  private readonly listeners = new Map<string, Set<() => void>>();

  constructor() {
    FakeAudio.instances.push(this);
  }

  addEventListener(type: string, listener: () => void): void {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener);
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, listener: () => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  play(): Promise<void> {
    this.paused = false;
    this.played.push(this.src);
    return Promise.resolve();
  }

  pause(): void {
    this.paused = true;
  }

  emit(type: string): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) {
      listener();
    }
  }
}

const missingFiles = new Set<string>();

const listener: ListenerViewport = {
  playerId: 0,
  center: { x: 50, y: 50 },
  halfWidth: 10,
  halfHeight: 8,
};

const ON_SCREEN = { x: 52, y: 48 };
const OFF_SCREEN = { x: 90, y: 50 };

function manifestWith(sounds: Record<string, string[]>, music: string[] = []): AssetManifest {
  return { ...emptyManifest(), sounds, music };
}

function hit(position = ON_SCREEN, attackerType = 'clubman'): SimEvent {
  return { type: 'attackHit', attackerId: 1, attackerType, targetId: 2, position };
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function context(): FakeContext {
  const instance = FakeContext.instances[0];
  if (!instance) {
    throw new Error('context was not created');
  }
  return instance;
}

function playedUrls(): string[] {
  return context()
    .started.map((source) => source.buffer?.url)
    .filter((url) => url !== undefined);
}

function setPageHidden(hidden: boolean): void {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  document.dispatchEvent(new Event('visibilitychange'));
}

async function running(manifest: AssetManifest): Promise<AudioSystem> {
  const audio = createAudioSystem({ manifest });
  await audio.resume();
  return audio;
}

let warn: MockInstance<typeof console.warn>;

beforeEach(() => {
  FakeContext.instances = [];
  FakeContext.corrupt = new Set();
  FakeAudio.instances = [];
  missingFiles.clear();
  vi.stubGlobal('AudioContext', FakeContext);
  vi.stubGlobal('Audio', FakeAudio);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => ({
      ok: !missingFiles.has(url),
      status: missingFiles.has(url) ? 404 : 200,
      arrayBuffer: async () => url,
    })),
  );
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('event mapping', () => {
  const position = { x: 1, y: 2 };

  it('maps positional simulation events to sound ids with fallbacks', () => {
    const cases: [SimEvent, string[]][] = [
      [hit(position, 'axeman'), ['hit.axeman', 'hit']],
      [{ type: 'projectileLaunched', sourceId: 1, sourceType: 'bowman', position }, ['shot.bowman', 'shot']],
      [
        {
          type: 'entityDied',
          entityId: 1,
          entityKind: 'unit',
          entityType: 'villager',
          owner: 1,
          killerOwner: 0,
          position,
        },
        ['death.villager', 'death.unit'],
      ],
      [{ type: 'gatherStrike', entityId: 1, gatherKind: 'wood', position }, ['gather.wood', 'gather']],
      [{ type: 'constructionStrike', entityId: 1, buildingId: 2, position }, ['build']],
      [{ type: 'buildingPlaced', playerId: 1, buildingId: 2, buildingType: 'house', position }, ['place']],
    ];
    for (const [event, candidates] of cases) {
      const request = eventSound(event, 0);
      expect(request?.candidates).toEqual(candidates);
      expect(request?.position).toEqual(position);
      expect(request?.priority).toBe(false);
    }
  });

  it('maps own completion, attack and age events to alerts without a position', () => {
    const cases: [SimEvent, string][] = [
      [
        { type: 'buildingCompleted', playerId: 0, buildingId: 2, buildingType: 'house', position },
        'alert.building_complete',
      ],
      [{ type: 'unitTrained', playerId: 0, entityId: 3, unitType: 'villager', position }, 'alert.unit_ready'],
      [{ type: 'researchCompleted', playerId: 0, technology: 'wheel', position }, 'alert.research_complete'],
      [{ type: 'ageAdvanced', playerId: 0, age: 'tool' }, 'alert.age_advance'],
      [{ type: 'underAttack', playerId: 0, attackerOwner: 1, position }, 'alert.under_attack'],
    ];
    for (const [event, id] of cases) {
      const request = eventSound(event, 0);
      expect(request?.candidates).toEqual([id]);
      expect(request?.position).toBeNull();
      expect(request?.priority).toBe(true);
      expect(eventSound(event, 1)).toBeNull();
    }
  });

  it('ignores events without a sound', () => {
    expect(eventSound({ type: 'housingShort', playerId: 0 }, 0)).toBeNull();
    expect(
      eventSound(
        {
          type: 'entityDied',
          entityId: 1,
          entityKind: 'resource',
          entityType: 'tree',
          owner: -1,
          killerOwner: null,
          position,
        },
        0,
      ),
    ).toBeNull();
  });

  it('maps interface sounds', () => {
    expect(uiSoundRequest('click').candidates).toEqual(['ui.click']);
    expect(uiSoundRequest('error').candidates).toEqual(['ui.error']);
    expect(uiSoundRequest('victory').candidates).toEqual(['ui.victory']);
    expect(uiSoundRequest('defeat').candidates).toEqual(['ui.defeat']);
    expect(uiSoundRequest('select').candidates).toEqual(['select']);
    expect(uiSoundRequest('select', { entityType: 'priest' }).candidates).toEqual(['select.priest', 'select']);
    expect(uiSoundRequest('acknowledge', { entityType: 'priest' }).candidates).toEqual([
      'acknowledge.priest',
      'acknowledge',
    ]);
  });
});

describe('effects playback', () => {
  it('plays the most specific sound present in the manifest', async () => {
    const audio = await running(manifestWith({ hit: ['hit.ogg'], 'hit.axeman': ['axe.ogg'] }));
    audio.handleEvents([hit(ON_SCREEN, 'axeman'), hit(ON_SCREEN, 'clubman')], listener);
    await flush();
    expect(playedUrls()).toEqual(['assets/axe.ogg', 'assets/hit.ogg']);
  });

  it('drops positional sounds outside the viewport', async () => {
    const audio = await running(manifestWith({ hit: ['hit.ogg'] }));
    audio.handleEvents([hit(OFF_SCREEN)], listener);
    await flush();
    expect(playedUrls()).toEqual([]);
  });

  it('plays alerts regardless of the viewport', async () => {
    const audio = await running(
      manifestWith({
        'alert.under_attack': ['attack.ogg'],
        'alert.building_complete': ['done.ogg'],
        'alert.age_advance': ['age.ogg'],
      }),
    );
    audio.handleEvents(
      [
        { type: 'underAttack', playerId: 0, attackerOwner: 1, position: OFF_SCREEN },
        { type: 'buildingCompleted', playerId: 0, buildingId: 2, buildingType: 'house', position: OFF_SCREEN },
        { type: 'ageAdvanced', playerId: 0, age: 'bronze' },
      ],
      listener,
    );
    await flush();
    expect(playedUrls()).toEqual(['assets/attack.ogg', 'assets/done.ogg', 'assets/age.ogg']);
  });

  it('throttles identical sounds', async () => {
    const audio = await running(manifestWith({ hit: ['hit.ogg'] }));
    audio.handleEvents([hit(), hit(), hit()], listener);
    await flush();
    expect(playedUrls()).toHaveLength(1);
    context().currentTime = 1;
    audio.handleEvents([hit()], listener);
    await flush();
    expect(playedUrls()).toHaveLength(2);
  });

  it('limits simultaneous voices but lets alerts through', async () => {
    const audio = await running(manifestWith({ hit: ['hit.ogg'], 'alert.age_advance': ['age.ogg'] }));
    for (let index = 0; index < MAX_VOICES + 4; index += 1) {
      context().currentTime = index;
      audio.handleEvents([hit()], listener);
      await flush();
    }
    expect(playedUrls()).toHaveLength(MAX_VOICES);
    audio.handleEvents([{ type: 'ageAdvanced', playerId: 0, age: 'iron' }], listener);
    await flush();
    expect(playedUrls()).toHaveLength(MAX_VOICES + 1);
    context().started[0]?.onended?.();
    context().started[1]?.onended?.();
    context().currentTime += 1;
    audio.handleEvents([hit()], listener);
    await flush();
    expect(playedUrls()).toHaveLength(MAX_VOICES + 2);
  });

  it('decodes each file once and cycles through variants', async () => {
    const audio = await running(manifestWith({ hit: ['a.ogg', 'b.ogg'] }));
    for (let index = 0; index < 4; index += 1) {
      context().currentTime = index;
      audio.handleEvents([hit()], listener);
      await flush();
    }
    expect(playedUrls()).toEqual(['assets/a.ogg', 'assets/b.ogg', 'assets/a.ogg', 'assets/b.ogg']);
    expect(context().decoded).toEqual(['assets/a.ogg', 'assets/b.ogg']);
  });

  it('does not load anything before a sound is requested', async () => {
    await running(manifestWith({ hit: ['hit.ogg'] }));
    expect(fetch).not.toHaveBeenCalled();
  });

  it('stays silent before the context is resumed', async () => {
    const audio = createAudioSystem({ manifest: manifestWith({ 'ui.click': ['click.ogg'] }) });
    audio.playUi('click');
    await flush();
    expect(FakeContext.instances).toHaveLength(0);
    await audio.resume();
    audio.playUi('click');
    await flush();
    expect(playedUrls()).toEqual(['assets/click.ogg']);
  });

  it('uses the configured asset base path', async () => {
    const audio = createAudioSystem({ manifest: manifestWith({ 'ui.click': ['click.ogg'] }), assetBasePath: 'cdn/' });
    await audio.resume();
    audio.playUi('click');
    await flush();
    expect(playedUrls()).toEqual(['cdn/click.ogg']);
  });
});

describe('missing assets', () => {
  it('runs on an empty manifest with one warning per sound id', async () => {
    const audio = await running(emptyManifest());
    for (let index = 0; index < 3; index += 1) {
      audio.handleEvents([hit(), { type: 'ageAdvanced', playerId: 0, age: 'tool' }], listener);
      audio.playUi('click');
    }
    await flush();
    expect(playedUrls()).toEqual([]);
    expect(warn.mock.calls.map((call) => String(call[0]))).toEqual([
      'Audio asset missing: sound "hit" is not in the manifest',
      'Audio asset missing: sound "alert.age_advance" is not in the manifest',
      'Audio asset missing: sound "ui.click" is not in the manifest',
    ]);
  });

  it('treats a missing file as silence with a single warning', async () => {
    missingFiles.add('assets/hit.ogg');
    const audio = await running(manifestWith({ hit: ['hit.ogg'] }));
    for (let index = 0; index < 3; index += 1) {
      context().currentTime = index;
      audio.handleEvents([hit()], listener);
      await flush();
    }
    expect(playedUrls()).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('treats an undecodable file as silence with a single warning', async () => {
    FakeContext.corrupt.add('assets/hit.ogg');
    const audio = await running(manifestWith({ hit: ['hit.ogg'] }));
    for (let index = 0; index < 3; index += 1) {
      context().currentTime = index;
      audio.handleEvents([hit()], listener);
      await flush();
    }
    expect(playedUrls()).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('is a no-op when Web Audio is unavailable', async () => {
    vi.stubGlobal('AudioContext', undefined);
    const audio = createAudioSystem({ manifest: manifestWith({ 'ui.click': ['click.ogg'] }, ['a.ogg']) });
    await audio.resume();
    audio.playUi('click');
    audio.startMusic();
    audio.setMuted(true);
    audio.destroy();
    await flush();
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('volume and mute', () => {
  it('applies separate gains and a master mute', async () => {
    const audio = createAudioSystem({ manifest: emptyManifest() });
    audio.setEffectsVolume(0.4);
    audio.setMusicVolume(0.7);
    await audio.resume();
    const [master, effects, music] = context().gains;
    expect(master?.targets).toEqual([context().destination]);
    expect(effects?.targets).toEqual([master]);
    expect(music?.targets).toEqual([master]);
    expect(master?.gain.value).toBe(1);
    expect(effects?.gain.value).toBe(0.4);
    expect(music?.gain.value).toBe(0.7);

    audio.setMuted(true);
    expect(master?.gain.value).toBe(0);
    expect(effects?.gain.value).toBe(0.4);
    audio.setMuted(false);
    expect(master?.gain.value).toBe(1);

    audio.setEffectsVolume(3);
    audio.setMusicVolume(-1);
    expect(effects?.gain.value).toBe(1);
    expect(music?.gain.value).toBe(0);
  });

  it('routes effects through the effects gain', async () => {
    const audio = await running(manifestWith({ 'ui.click': ['click.ogg'] }));
    audio.playUi('click');
    await flush();
    expect(context().started[0]?.targets).toEqual([context().gains[1]]);
  });
});

describe('music', () => {
  function element(): FakeAudio {
    const instance = FakeAudio.instances[0];
    if (!instance) {
      throw new Error('music element was not created');
    }
    return instance;
  }

  it('plays the playlist continuously and wraps around', async () => {
    const audio = await running(manifestWith({}, ['a.ogg', 'b.ogg']));
    audio.startMusic();
    element().emit('ended');
    element().emit('ended');
    expect(element().played).toEqual(['assets/a.ogg', 'assets/b.ogg', 'assets/a.ogg']);
  });

  it('starts once the context is resumed', async () => {
    const audio = createAudioSystem({ manifest: manifestWith({}, ['a.ogg']) });
    audio.startMusic();
    expect(FakeAudio.instances).toHaveLength(0);
    await audio.resume();
    expect(element().played).toEqual(['assets/a.ogg']);
  });

  it('stops and continues the current track', async () => {
    const audio = await running(manifestWith({}, ['a.ogg', 'b.ogg']));
    audio.startMusic();
    audio.stopMusic();
    expect(element().paused).toBe(true);
    element().emit('ended');
    expect(element().played).toEqual(['assets/a.ogg']);
    audio.startMusic();
    expect(element().played).toEqual(['assets/a.ogg', 'assets/b.ogg']);
  });

  it('skips broken tracks and gives up when all are broken', async () => {
    const audio = await running(manifestWith({}, ['a.ogg', 'b.ogg']));
    audio.startMusic();
    element().emit('error');
    expect(element().played).toEqual(['assets/a.ogg', 'assets/b.ogg']);
    element().emit('ended');
    expect(element().played).toEqual(['assets/a.ogg', 'assets/b.ogg', 'assets/b.ogg']);
    element().emit('error');
    expect(element().played).toHaveLength(3);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('pauses the playlist while the page is hidden', async () => {
    const audio = await running(manifestWith({}, ['a.ogg']));
    audio.startMusic();
    setPageHidden(true);
    await flush();
    expect(element().paused).toBe(true);
    expect(context().state).toBe('suspended');
    setPageHidden(false);
    await flush();
    expect(element().paused).toBe(false);
    expect(element().played).toEqual(['assets/a.ogg', 'assets/a.ogg']);
    audio.destroy();
  });

  it('routes music through the music gain and stops on destroy', async () => {
    const audio = await running(manifestWith({}, ['a.ogg']));
    audio.startMusic();
    audio.destroy();
    expect(element().paused).toBe(true);
    expect(context().state).toBe('closed');
    element().emit('ended');
    expect(element().played).toEqual(['assets/a.ogg']);
  });
});

describe('generative music', () => {
  it('plays synthesized music when the playlist is empty', async () => {
    const audio = await running(emptyManifest());
    audio.startMusic();
    expect(FakeAudio.instances).toHaveLength(0);
    expect(context().oscillators.length).toBeGreaterThan(0);
    expect(context().started.length).toBeGreaterThan(0);
    expect(warn).not.toHaveBeenCalled();
    audio.destroy();
  });

  it('starts once the context is resumed', async () => {
    const audio = createAudioSystem({ manifest: emptyManifest() });
    audio.startMusic();
    await audio.resume();
    expect(context().oscillators.length).toBeGreaterThan(0);
    audio.destroy();
  });

  it('accepts the player age', async () => {
    const audio = await running(emptyManifest());
    audio.setMusicAge?.('iron');
    audio.startMusic();
    expect(context().oscillators.length).toBeGreaterThan(0);
    audio.destroy();
  });
});

describe('hidden page', () => {
  it('silences every sound until the page is visible again', async () => {
    const audio = await running(manifestWith({ 'ui.click': ['click.ogg'], 'alert.age_advance': ['age.ogg'] }));
    setPageHidden(true);
    await flush();
    expect(context().state).toBe('suspended');
    audio.playUi('click');
    audio.handleEvents([{ type: 'ageAdvanced', playerId: 0, age: 'tool' }], listener);
    await flush();
    expect(playedUrls()).toEqual([]);
    setPageHidden(false);
    await flush();
    expect(context().state).toBe('running');
    audio.playUi('click');
    await flush();
    expect(playedUrls()).toEqual(['assets/click.ogg']);
    audio.destroy();
  });

  it('does not start the context while the page is hidden', async () => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    const audio = createAudioSystem({ manifest: emptyManifest() });
    audio.startMusic();
    await audio.resume();
    expect(context().state).toBe('suspended');
    expect(context().oscillators).toHaveLength(0);
    setPageHidden(false);
    await flush();
    expect(context().state).toBe('running');
    expect(context().oscillators.length).toBeGreaterThan(0);
    audio.destroy();
  });

  it('ignores visibility changes before the first user gesture', async () => {
    createAudioSystem({ manifest: emptyManifest() });
    setPageHidden(false);
    await flush();
    expect(FakeContext.instances).toHaveLength(0);
  });
});
