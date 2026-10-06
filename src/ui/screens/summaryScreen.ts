import type { AppContext, GameResult, Screen } from '../context';
import { button, h, replace } from '../dom';
import { colorCss, formatClock } from '../format';
import { t } from '../i18n';
import { playerName } from '../labels';

interface Column {
  key: string;
  stat: string;
  time: boolean;
}

interface ColumnGroup {
  key: string;
  columns: Column[];
}

function column(stat: string, time = false): Column {
  return { key: `ui.summary.stat.${stat}`, stat, time };
}

const GROUPS: readonly ColumnGroup[] = [
  {
    key: 'ui.summary.military',
    columns: [column('unitsKilled'), column('unitsLost'), column('buildingsRazed'), column('buildingsLost')],
  },
  {
    key: 'ui.summary.economy',
    columns: [
      column('foodGathered'),
      column('woodGathered'),
      column('stoneGathered'),
      column('goldGathered'),
      column('tributeSent'),
      column('tributeReceived'),
    ],
  },
  {
    key: 'ui.summary.technology',
    columns: [
      column('technologiesResearched'),
      column('toolAgeTick', true),
      column('bronzeAgeTick', true),
      column('ironAgeTick', true),
    ],
  },
];

const EMPTY_VALUE = '—';

export function summaryScreen(ctx: AppContext, result: GameResult): Screen {
  const element = h('div', ['screen', 'menu-screen']);

  const cell = (value: number | undefined, time: boolean): string => {
    if (value === undefined || (time && value <= 0)) {
      return EMPTY_VALUE;
    }
    return time ? formatClock(value / result.tickRate) : String(Math.floor(value));
  };

  const render = (): void => {
    const won = result.winners.includes(result.viewerId);
    const groupHead = h('tr', [], [
      h('th', [], ''),
      ...GROUPS.map((group) => {
        const head = h('th', 'group-head', t(group.key));
        head.colSpan = group.columns.length;
        return head;
      }),
      h('th', [], ''),
    ]);
    const head = h('tr', [], [
      h('th', [], t('ui.summary.player')),
      ...GROUPS.flatMap((group) => group.columns.map((item) => h('th', [], t(item.key)))),
      h('th', [], t('ui.summary.score')),
    ]);
    const rows = result.players.map((player) => {
      const summary = result.summaries.find((item) => item.playerId === player.id);
      const stats = summary?.stats ?? {};
      const swatch = h('span', 'swatch');
      swatch.style.backgroundColor = colorCss(player.color);
      const winner = result.winners.includes(player.id);
      return h('tr', winner ? 'winner-row' : [], [
        h('td', 'summary-player', [
          swatch,
          playerName(result.players, player.id, result.viewerId),
          winner && h('span', 'winner-mark', t('ui.summary.winner')),
        ]),
        ...GROUPS.flatMap((group) =>
          group.columns.map((item) => h('td', [], cell(stats[item.stat], item.time))),
        ),
        h('td', [], String(Math.floor(summary?.score ?? player.score))),
      ]);
    });
    replace(element, [
      h('div', ['panel', 'summary'], [
        h('h1', ['title', won ? 'victory' : 'defeat'], t(won ? 'ui.summary.victory' : 'ui.summary.defeat')),
        h('p', 'summary-reason', t(`ui.summary.reason.${result.reason}`)),
        h('div', 'summary-scroll', [h('table', 'summary-table', [groupHead, head, ...rows])]),
        button(t('ui.summary.to_menu'), () => ctx.showMainMenu(), ['primary']),
      ]),
    ]);
  };

  render();
  return { element, refresh: render, destroy: () => {} };
}
