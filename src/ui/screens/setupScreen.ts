import type { AiDifficulty, MapSizeId, MapTypeId } from '../../data/types';
import { AGE_ORDER, AI_DIFFICULTIES } from '../../data/types';
import type { VictoryMode } from '../../sim/types';
import { MAX_PLAYERS } from '../../sim/types';
import { civilizationOverview } from '../civilization';
import { civilizationSummary, civilizationTree, plainRef } from '../civilizationView';
import type { AppContext, Screen } from '../context';
import { openDialog } from '../dialogs';
import type { SelectOption } from '../dom';
import { button, checkbox, h, labeled, replace, select } from '../dom';
import { colorCss } from '../format';
import { t } from '../i18n';
import { civilizationName } from '../labels';
import type { SetupState, StartChoice } from '../setup/model';
import {
  HUMAN_PLAYER_ID,
  MIN_PLAYERS,
  PLAYER_COLORS,
  RANDOM_CIVILIZATION,
  TEAM_COUNT,
  VICTORY_MODES,
  buildNewGame,
  mapSizeIds,
  mapTypeIds,
  randomSeed,
  rememberedSetup,
  resourceLevelIds,
  setPlayerCount,
  setSeedText,
  setupFromSaved,
  startChoiceOf,
  startChoicePatch,
  startChoices,
  updatePlayer,
  updateSettings,
  validateSetup,
} from '../setup/model';

const NO_TEAM = 'none';

function range(from: number, to: number): number[] {
  const values: number[] = [];
  for (let value = from; value <= to; value++) {
    values.push(value);
  }
  return values;
}

export function setupScreen(ctx: AppContext): Screen {
  const data = ctx.data;
  let state: SetupState = setupFromSaved(ctx.getSettings().lastGameSetup, data, randomSeed());
  const humanCivilization = state.players[HUMAN_PLAYER_ID].civilization;
  let shownCivilization: string | null =
    humanCivilization === RANDOM_CIVILIZATION ? null : humanCivilization;
  const element = h('div', ['screen', 'menu-screen']);
  const footer = h('div', 'setup-footer');

  const start = (): void => {
    if (validateSetup(state).length > 0) {
      return;
    }
    ctx.updateSettings({ lastGameSetup: rememberedSetup(state) });
    ctx.startGame({ kind: 'new', setup: buildNewGame(state, data) });
  };

  const renderFooter = (): void => {
    const issues = validateSetup(state);
    const startButton = button(t('ui.setup.start'), start, ['primary']);
    startButton.disabled = issues.length > 0;
    startButton.dataset.role = 'start';
    replace(footer, [
      h(
        'div',
        'setup-issues',
        issues.map((issue) => h('p', 'error-text', t(`ui.setup.issue.${issue}`))),
      ),
      h('div', 'setup-buttons', [
        startButton,
        button(t('ui.common.back'), () => ctx.showMainMenu()),
      ]),
    ]);
  };

  const apply = (next: SetupState): void => {
    state = next;
    render();
  };

  const settingsForm = (): HTMLElement => {
    const settings = state.settings;
    const seed = h('input', 'text-input');
    seed.type = 'text';
    seed.inputMode = 'numeric';
    seed.value = state.seedText;
    seed.dataset.role = 'seed';
    seed.addEventListener('input', () => {
      state = setSeedText(state, seed.value);
      renderFooter();
    });
    const options = (ids: readonly string[], prefix: string): SelectOption[] =>
      ids.map((id) => ({ value: id, label: t(`${prefix}.${id}`) }));
    const hint = (key: string): HTMLElement => h('p', 'field-hint', t(key));
    const startChoice = startChoiceOf(settings);
    const startOptions: SelectOption[] = startChoices().map((choice) => ({
      value: choice,
      label: t(AGE_ORDER.some((age) => age === choice) ? `age.${choice}` : `ui.start.${choice}`),
    }));
    return h('div', ['form', 'setup-settings'], [
      labeled(
        t('ui.setup.map_type'),
        select(options(mapTypeIds(data), 'map'), settings.mapType, (value) =>
          apply(updateSettings(state, { mapType: value as MapTypeId })),
        ),
      ),
      hint(`map.${settings.mapType}.desc`),
      labeled(
        t('ui.setup.map_size'),
        select(options(mapSizeIds(data), 'map'), settings.mapSize, (value) =>
          apply(updateSettings(state, { mapSize: value as MapSizeId })),
        ),
      ),
      labeled(
        t('ui.setup.seed'),
        h('span', 'seed-row', [
          seed,
          button(t('ui.setup.seed_random'), () => apply(setSeedText(state, String(randomSeed())))),
        ]),
      ),
      labeled(
        t('ui.setup.players'),
        select(
          range(MIN_PLAYERS, MAX_PLAYERS).map((count) => ({
            value: String(count),
            label: String(count),
          })),
          String(state.players.length),
          (value) => apply(setPlayerCount(state, Number(value))),
        ),
      ),
      labeled(
        t('ui.setup.victory'),
        select(options(VICTORY_MODES, 'ui.victory'), settings.victoryMode, (value) =>
          apply(updateSettings(state, { victoryMode: value as VictoryMode })),
        ),
      ),
      hint(`ui.victory.${settings.victoryMode}.desc`),
      labeled(
        t('ui.setup.population_limit'),
        select(
          data.game.populationLimits.map((limit) => ({ value: String(limit), label: String(limit) })),
          String(settings.populationLimit),
          (value) => apply(updateSettings(state, { populationLimit: Number(value) })),
        ),
      ),
      labeled(
        t('ui.setup.starting_age'),
        select(startOptions, startChoice, (value) =>
          apply(updateSettings(state, startChoicePatch(value as StartChoice))),
        ),
      ),
      settings.startMode !== undefined && settings.startMode !== 'standard'
        ? hint(`ui.start.${settings.startMode}.desc`)
        : null,
      labeled(
        t('ui.setup.resource_level'),
        select(
          options(resourceLevelIds(data), 'ui.resource_level'),
          settings.resourceLevel ?? resourceLevelIds(data)[0],
          (resourceLevel) => apply(updateSettings(state, { resourceLevel })),
        ),
      ),
      labeled(
        t('ui.setup.full_tech_tree'),
        checkbox(settings.fullTechTree === true, (fullTechTree) =>
          apply(updateSettings(state, { fullTechTree })),
        ),
      ),
      hint('ui.setup.full_tech_tree_hint'),
      labeled(
        t('ui.setup.reveal_map'),
        checkbox(settings.revealMap, (revealMap) => apply(updateSettings(state, { revealMap }))),
      ),
      hint('ui.setup.reveal_map_hint'),
      labeled(
        t('ui.setup.no_fog'),
        checkbox(settings.noFog === true, (noFog) => apply(updateSettings(state, { noFog }))),
      ),
      hint('ui.setup.no_fog_hint'),
      labeled(
        t('ui.setup.sandbox'),
        checkbox(settings.sandbox === true, (sandbox) => apply(updateSettings(state, { sandbox }))),
      ),
      hint('ui.setup.sandbox_hint'),
      labeled(
        t('ui.setup.lock_teams'),
        checkbox(settings.lockTeams, (lockTeams) => apply(updateSettings(state, { lockTeams }))),
      ),
      hint('ui.setup.lock_teams_hint'),
    ]);
  };

  const playerCell = (labelKey: string, control: HTMLElement): HTMLElement => {
    const cell = h('span', 'player-cell', [control]);
    cell.dataset.label = t(labelKey);
    return cell;
  };

  const playerRow = (index: number): HTMLElement => {
    const player = state.players[index];
    const human = index === HUMAN_PLAYER_ID;
    const civilizations: SelectOption[] = [
      { value: RANDOM_CIVILIZATION, label: t('ui.setup.random') },
      ...Object.keys(data.civilizations).map((id) => ({ value: id, label: t(`civ.${id}.name`) })),
    ];
    const teams: SelectOption[] = [
      { value: NO_TEAM, label: t('ui.setup.no_team') },
      ...range(1, TEAM_COUNT).map((team) => ({ value: String(team), label: String(team) })),
    ];
    const swatch = h('span', 'swatch');
    swatch.style.backgroundColor = colorCss(player.color);
    const bonuses =
      player.civilization === RANDOM_CIVILIZATION ? '' : t(`civ.${player.civilization}.bonuses`);
    const row = h('div', 'player-row', [
      h('span', 'player-label', human ? t('ui.setup.you') : t('ui.setup.computer', { n: index + 1 })),
      playerCell(
        'ui.setup.col_civilization',
        select(civilizations, player.civilization, (civilization) => {
          if (civilization !== RANDOM_CIVILIZATION) {
            shownCivilization = civilization;
          }
          apply(updatePlayer(state, index, { civilization }));
        }),
      ),
      playerCell(
        'ui.setup.col_team',
        select(teams, player.team === null ? NO_TEAM : String(player.team), (value) =>
          apply(updatePlayer(state, index, { team: value === NO_TEAM ? null : Number(value) })),
        ),
      ),
      playerCell(
        'ui.setup.col_color',
        h('span', 'color-cell', [
          swatch,
          select(
            PLAYER_COLORS.map((color, at) => ({ value: String(color), label: t(`ui.color.${at}`) })),
            String(player.color),
            (value) => apply(updatePlayer(state, index, { color: Number(value) })),
          ),
        ]),
      ),
      human
        ? h('span', 'player-difficulty')
        : playerCell(
            'ui.setup.col_difficulty',
            select(
              AI_DIFFICULTIES.map((id) => ({ value: id, label: t(`ui.difficulty.${id}`) })),
              player.difficulty,
              (value) => apply(updatePlayer(state, index, { difficulty: value as AiDifficulty })),
            ),
          ),
      h('span', 'player-bonuses', bonuses),
    ]);
    row.dataset.player = String(index);
    return row;
  };

  const playersTable = (): HTMLElement =>
    h('div', 'setup-players', [
      h('div', ['player-row', 'player-head'], [
        h('span', [], t('ui.setup.col_player')),
        h('span', [], t('ui.setup.col_civilization')),
        h('span', [], t('ui.setup.col_team')),
        h('span', [], t('ui.setup.col_color')),
        h('span', [], t('ui.setup.col_difficulty')),
        h('span', [], t('ui.setup.col_bonuses')),
      ]),
      ...state.players.map((_, index) => playerRow(index)),
    ]);

  const openCivilizationDetails = (id: string): void => {
    const overview = civilizationOverview(data, id);
    const dialog = openDialog(
      ctx.overlayRoot,
      civilizationName(id),
      [
        ...civilizationSummary(overview, state.settings.fullTechTree === true, plainRef),
        ...civilizationTree(overview, plainRef),
      ],
      (close) => [button(t('ui.common.close'), close, ['primary'])],
    );
    dialog.element.firstElementChild?.classList.add('civ-dialog');
  };

  const civilizationPanel = (): HTMLElement => {
    const tabs = Object.keys(data.civilizations).map((id) => {
      const tab = button(
        civilizationName(id),
        () => {
          shownCivilization = id;
          render();
        },
        id === shownCivilization ? ['active'] : [],
      );
      tab.dataset.civ = id;
      return tab;
    });
    const shown = shownCivilization;
    if (shown === null) {
      return h('div', 'civ-panel', [
        h('h3', 'civ-panel-title', t('ui.civ.browse')),
        h('div', 'civ-tabs', tabs),
        h('p', 'field-hint', t('ui.civ.pick_hint')),
      ]);
    }
    const details = button(t('ui.civ.details'), () => openCivilizationDetails(shown));
    details.dataset.role = 'civ-details';
    return h('div', 'civ-panel', [
      h('h3', 'civ-panel-title', t('ui.civ.browse')),
      h('div', 'civ-tabs', tabs),
      h('h3', 'guide-name', civilizationName(shown)),
      ...civilizationSummary(civilizationOverview(data, shown), state.settings.fullTechTree === true, plainRef),
      h('div', 'civ-panel-actions', [details]),
    ]);
  };

  function render(): void {
    renderFooter();
    replace(element, [
      h('div', ['panel', 'setup'], [
        h('h1', 'title', t('ui.setup.title')),
        h('div', 'setup-body', [
          settingsForm(),
          h('div', 'setup-main', [playersTable(), civilizationPanel()]),
        ]),
        footer,
      ]),
    ]);
  }

  render();
  return { element, refresh: render, destroy: () => {} };
}
