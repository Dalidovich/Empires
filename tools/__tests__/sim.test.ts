import { describe, expect, it } from 'vitest';
import { loadGameData } from '../../src/data';
import { parseArgs, runSimulation } from '../sim';

const data = loadGameData();

describe('sim cli', () => {
  it('parses the documented arguments', () => {
    const args = parseArgs(
      ['--seed', '42', '--map', 'inland', '--size', 'medium', '--players', 'assyrian:hard,greek:hard', '--max-ticks', '2000'],
      data,
    );
    expect(args).toEqual({
      seed: 42,
      map: 'inland',
      size: 'medium',
      players: [
        { civilization: 'assyrian', difficulty: 'hard' },
        { civilization: 'greek', difficulty: 'hard' },
      ],
      maxTicks: 2000,
    });
  });

  it('parses the match setup options', () => {
    const args = parseArgs(
      ['--resources', 'high', '--start', 'post_iron', '--full-tech-tree', 'true'],
      data,
    );
    expect(args).toMatchObject({ resources: 'high', start: 'post_iron', fullTechTree: true });
    expect(parseArgs(['--resources', 'default'], data).resources).toBe('default');
    expect(() => parseArgs(['--resources', 'infinite'], data)).toThrow();
    expect(() => parseArgs(['--start', 'regicide'], data)).toThrow();
    expect(() => parseArgs(['--full-tech-tree', 'maybe'], data)).toThrow();
  });

  it('finishes a nomad game between two computer players', () => {
    const args = parseArgs(
      ['--seed', '1', '--players', 'assyrian:moderate,greek:hard', '--start', 'nomad', '--max-ticks', '120000'],
      data,
    );
    const result = runSimulation(args, data, () => {});
    expect(result.winner).not.toBeNull();
    expect(result.players.some((player) => player.stats.established === 1)).toBe(true);
  }, 300000);

  it('rejects unknown arguments and values', () => {
    expect(() => parseArgs(['--bogus', '1'], data)).toThrow();
    expect(() => parseArgs(['--map', 'moon'], data)).toThrow();
    expect(() => parseArgs(['--players', 'assyrian:godlike,greek'], data)).toThrow();
    expect(() => parseArgs(['--seed'], data)).toThrow();
  });

  it('runs to the tick limit on stubs with identical output', () => {
    const args = parseArgs(['--seed', '1', '--max-ticks', '50'], data);
    const first = runSimulation(args, data, () => {});
    const second = runSimulation(args, data, () => {});
    expect(first.winner).toBeNull();
    expect(first.ticks).toBe(50);
    expect(first.players).toHaveLength(2);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });
});
