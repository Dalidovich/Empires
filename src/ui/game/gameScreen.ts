import type { ListenerViewport } from '../../audio/api';
import type { ResourceKind } from '../../data/types';
import type { Renderer, ScreenPoint, ScreenRect } from '../../render/api';
import type { Command } from '../../sim/commands';
import type { GameOverEvent, SimEvent } from '../../sim/events';
import type { SimErrorCode } from '../../sim/protocol';
import type { EntityView, PlayerView } from '../../sim/snapshot';
import type { EntityId, JsonValue, Stance, TileCoord, Vec2 } from '../../sim/types';
import type { SaveInput, SaveRecord } from '../../storage/api';
import type { AppContext, GameStart, Screen } from '../context';
import { h } from '../dom';
import { formatClock } from '../format';
import { t } from '../i18n';
import { civilizationName, playerName, storageErrorText } from '../labels';
import { gameFromRecord } from '../screens/menuScreens';
import { HUMAN_PLAYER_ID } from '../setup/model';
import type { PanelButton, PanelState } from './commandPanel';
import { SLOT_CODES, buildPanel } from './commandPanel';
import {
  attackGroundCommands,
  attackMoveCommands,
  contextCommands,
  deleteCommands,
  placeBuildingCommands,
  placeWallCommands,
  rallyCommands,
  repairCommands,
  standGroundCommands,
  stopCommands,
  unloadCommands,
} from './commandBuilder';
import { ControlGroups } from './controlGroups';
import { DiplomacyWindow } from './diplomacy';
import { SandboxWindow } from './sandbox';
import { GuideWindow } from './guideWindow';
import type { NotificationTone, TouchToolButton } from './hud';
import { Hud } from './hud';
import type { InputHost, TouchPlacement, TouchTool } from './input';
import { InputController } from './input';
import type { PauseMenuHost } from './pauseMenu';
import { PauseMenu } from './pauseMenu';
import { Occupancy, canPlace, canPlaceWall, footprintTile } from './placement';
import type { SelectionContext } from './selection';
import { boxSelect, clickSelect, pruneSelection, sameIds, sameTypeSelect } from './selection';
import { GameSession } from './session';

export const AUTOSAVE_INTERVAL_MS = 5 * 60 * 1000;

const TRAIN_BATCH = 5;

const MAX_FRAME_SECONDS = 0.1;

const THROTTLE_MS: Record<string, number> = {
  underAttack: 10000,
  housingShort: 8000,
  populationLimit: 8000,
  insufficientResources: 4000,
  commandRejected: 1500,
};

class GameScreen implements Screen, InputHost, PauseMenuHost {
  readonly element: HTMLElement;
  private readonly hud: Hud;
  private readonly overlay = h('div', 'game-overlay');
  private readonly groups = new ControlGroups();
  private readonly occupancy: Occupancy;
  private readonly throttled = new Map<string, number>();
  private readonly selectionContext: SelectionContext;
  private session: GameSession | null = null;
  private renderer: Renderer | null = null;
  private input: InputController | null = null;
  private observer: ResizeObserver | null = null;
  private pauseMenu: PauseMenu | null = null;
  private diplomacy: DiplomacyWindow | null = null;
  private guide: GuideWindow | null = null;
  private sandbox: SandboxWindow | null = null;
  private view: PlayerView | null = null;
  private index = new Map<EntityId, EntityView>();
  private selection: EntityId[] = [];
  private panel: PanelState = {
    page: 'root',
    pageIndex: 0,
    tradeGood: 'wood',
    cursor: null,
    placing: null,
  };
  private wallStart: TileCoord | null = null;
  private userPaused = false;
  private requestedPause: boolean | null = null;
  private savedTick = -1;
  private cycleCursor = 0;
  private autosaveTimer: ReturnType<typeof setInterval> | null = null;
  private frameHandle = 0;
  private lastFrame = 0;
  private finished = false;
  private destroyed = false;
  private autosaveFailed = false;

  constructor(
    private readonly ctx: AppContext,
    private readonly start: GameStart,
  ) {
    this.occupancy = new Occupancy(ctx.data);
    this.selectionContext = {
      playerId: HUMAN_PLAYER_ID,
      entity: (id) => this.index.get(id),
    };
    this.hud = new Hud(ctx.data, {
      onPanelButton: (button, shift) => this.pressPanelButton(button, shift),
      onQueueCancel: (buildingId, index) =>
        this.send([{ type: 'cancelQueueItem', playerId: HUMAN_PLAYER_ID, buildingId, index }]),
      onResearchCancel: (buildingId) =>
        this.send([{ type: 'cancelResearch', playerId: HUMAN_PLAYER_ID, buildingId }]),
      onPortrait: (id, shift) =>
        this.setSelection(shift ? this.selection.filter((other) => other !== id) : [id]),
      onMenu: () => this.openPauseMenu(),
      onDiplomacy: () => this.toggleDiplomacy(),
      onGuide: () => this.toggleGuide(),
      onSandbox: () => this.toggleSandbox(),
      onSpeed: () => this.session?.cycleSpeed(),
      onNotification: (position) => this.renderer?.centerOn(position),
      onTouchTool: (tool) => this.pressTouchTool(tool),
    });
    this.element = this.hud.element;
    this.element.appendChild(this.overlay);
    this.hud.setBanner(t('ui.loading'));
    void this.init();
  }

  refresh(): void {
    this.hud.relabel();
    this.pauseMenu?.refresh();
    if (this.view) {
      this.diplomacy?.update(this.view);
      this.guide?.update(this.view);
      this.sandbox?.update(this.view);
    }
    this.updateBanner();
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    cancelAnimationFrame(this.frameHandle);
    if (this.autosaveTimer !== null) {
      clearInterval(this.autosaveTimer);
    }
    this.observer?.disconnect();
    this.input?.destroy();
    this.session?.stop();
    this.renderer?.destroy();
    this.ctx.audio.stopMusic();
  }

  isBlocked(): boolean {
    return (
      this.view === null ||
      this.pauseMenu !== null ||
      this.diplomacy !== null ||
      this.guide !== null ||
      this.sandbox !== null ||
      this.ctx.overlayRoot.childElementCount > 0
    );
  }

  pointerDown(point: ScreenPoint, shift: boolean): boolean {
    const building = this.panel.placing;
    if (building !== null) {
      const def = this.ctx.data.buildings[building];
      const tile = this.tileAt(point, def?.size ?? 1);
      if (def?.class.includes('wall')) {
        this.wallStart = tile;
        this.updateGhost();
      } else {
        this.place(building, tile, shift);
      }
      return true;
    }
    if (this.panel.cursor !== null) {
      this.runCursor(point, shift);
      return true;
    }
    return false;
  }

  pointerUp(point: ScreenPoint, shift: boolean): void {
    const building = this.panel.placing;
    const from = this.wallStart;
    if (building === null || from === null || !this.view) {
      return;
    }
    this.wallStart = null;
    const to = this.tileAt(point, 1);
    const occupied = this.occupancy.tilesOf(this.view);
    if (!canPlaceWall(this.view, this.ctx.data, building, from, to, occupied)) {
      this.ctx.audio.playUi('error');
      this.updateGhost();
      return;
    }
    this.sendOrders(
      placeWallCommands(this.commandContext(), this.selected(), building, from, to, shift),
    );
    this.finishPlacement(shift);
  }

  touchPlacement(): TouchPlacement | null {
    const building = this.panel.placing;
    if (building !== null) {
      return this.ctx.data.buildings[building]?.class.includes('wall') ? 'line' : 'point';
    }
    return this.panel.cursor === null ? null : 'point';
  }

  touchToolChanged(tool: TouchTool | null): void {
    this.hud.setTouchTool(tool);
  }

  private pressTouchTool(tool: TouchToolButton): void {
    if (this.isBlocked()) {
      return;
    }
    if (tool === 'box' || tool === 'order') {
      this.input?.toggleTouchTool(tool);
    } else if (tool === 'idle') {
      this.cycleOwn((entity) => this.isIdleVillager(entity));
    } else if (this.panel.placing !== null || this.panel.cursor !== null) {
      this.cancelModes();
    } else if (this.input?.touchTool) {
      this.input.toggleTouchTool(this.input.touchTool);
    } else if (this.panel.page !== 'root') {
      this.panel = { ...this.panel, page: 'root', pageIndex: 0 };
      this.refreshHud();
    } else {
      this.setSelection([]);
    }
  }

  pointerMove(_point: ScreenPoint): void {
    if (this.panel.placing !== null) {
      this.updateGhost();
    }
  }

  select(point: ScreenPoint, shift: boolean, double: boolean): void {
    const renderer = this.renderer;
    if (!renderer) {
      return;
    }
    const picked = renderer.pickEntity(point);
    if (double && picked !== null) {
      const candidates = renderer.entitiesInRect({
        x: 0,
        y: 0,
        width: this.hud.viewport.clientWidth,
        height: this.hud.viewport.clientHeight,
      });
      this.setSelection(
        sameTypeSelect(this.selection, picked, candidates, shift, this.selectionContext),
      );
      return;
    }
    this.setSelection(clickSelect(this.selection, picked, shift, this.selectionContext));
  }

  selectBox(rect: ScreenRect, shift: boolean): void {
    if (this.renderer) {
      this.setSelection(
        boxSelect(this.selection, this.renderer.entitiesInRect(rect), shift, this.selectionContext),
      );
    }
  }

  context(point: ScreenPoint, shift: boolean): void {
    const renderer = this.renderer;
    if (!renderer || !this.view) {
      return;
    }
    if (this.panel.placing !== null || this.panel.cursor !== null) {
      this.cancelModes();
      return;
    }
    const picked = renderer.pickEntity(point);
    const target = picked === null ? null : (this.index.get(picked) ?? null);
    const world = renderer.screenToWorld(point);
    const commands = contextCommands(
      this.commandContext(),
      this.selected(),
      target,
      world,
      shift,
      this.panel.tradeGood,
    );
    this.sendOrders(commands);
    this.markOrder(commands, target, world);
  }

  private markOrder(commands: readonly Command[], target: EntityView | null, world: Vec2): void {
    if (commands.length === 0 || commands.some((command) => command.type === 'setRallyPoint')) {
      return;
    }
    if (target !== null && commands.some((command) => command.type !== 'move')) {
      this.renderer?.addOrderMarker?.(target.position, this.footprintSize(target));
      return;
    }
    this.renderer?.addOrderMarker?.(world, 0);
  }

  private footprintSize(entity: EntityView): number {
    if (entity.kind === 'building') {
      return this.ctx.data.buildings[entity.type]?.size ?? 0;
    }
    if (entity.kind === 'resource') {
      return this.ctx.data.resourceSources[entity.type]?.size ?? 1;
    }
    return 0;
  }

  minimapContext(world: Vec2, shift: boolean): void {
    if (this.view) {
      this.sendOrders(
        contextCommands(this.commandContext(), this.selected(), null, world, shift, this.panel.tradeGood),
      );
    }
  }

  key(event: KeyboardEvent): boolean {
    const code = event.code;
    if (code === 'Escape') {
      return this.escape();
    }
    if (code === 'F10') {
      if (this.pauseMenu) {
        this.closePauseMenu();
      } else {
        this.openPauseMenu();
      }
      return true;
    }
    if (this.isBlocked() || event.altKey) {
      return false;
    }
    const digit = /^Digit([1-9])$/.exec(code);
    if (event.ctrlKey || event.metaKey) {
      if (digit) {
        this.groups.assign(Number(digit[1]), this.selection);
        return true;
      }
      return false;
    }
    if (digit) {
      this.recallGroup(Number(digit[1]), event.timeStamp);
      return true;
    }
    switch (code) {
      case 'Period':
        this.cycleOwn((entity) => this.isIdleVillager(entity));
        return true;
      case 'KeyH':
        this.cycleOwn(
          (entity) =>
            entity.kind === 'building' &&
            (this.ctx.data.buildings[entity.type]?.class.includes('town_center') ?? false),
        );
        return true;
      case 'KeyP':
      case 'Pause':
        this.userPaused = !this.userPaused;
        this.syncPause();
        return true;
      case 'Equal':
      case 'NumpadAdd':
        this.session?.shiftSpeed(1);
        return true;
      case 'Minus':
      case 'NumpadSubtract':
        this.session?.shiftSpeed(-1);
        return true;
      case 'Delete':
        this.sendOrders(this.view ? deleteCommands(this.view, this.selected()) : []);
        return true;
      default:
        break;
    }
    const slot = SLOT_CODES.indexOf(code);
    const button = slot < 0 ? undefined : this.buttons().find((item) => item.slot === slot);
    if (button) {
      this.pressPanelButton(button, event.shiftKey);
      return true;
    }
    return false;
  }

  defaultSaveName(): string {
    const view = this.view;
    if (!view) {
      return t('ui.saves.default_name');
    }
    const self = view.players.find((player) => player.id === view.playerId);
    return [
      self ? civilizationName(self.civilization) : '',
      t(`map.${view.settings.mapType}`),
      formatClock(view.tick / this.ctx.data.game.tickRate),
    ].join(' ');
  }

  async createSaveInput(name: string): Promise<SaveInput | null> {
    const session = this.session;
    const view = this.view;
    if (!session || !view) {
      return null;
    }
    try {
      const game = await session.requestSave();
      const self = view.players.find((player) => player.id === view.playerId);
      return {
        name,
        summary: {
          mapType: view.settings.mapType,
          mapSize: view.settings.mapSize,
          civilization: self?.civilization ?? '',
          gameTicks: game.state.tick,
        },
        state: game as unknown as JsonValue,
      };
    } catch (error) {
      console.warn(`Save request failed: ${String(error)}`);
      return null;
    }
  }

  isSaved(): boolean {
    return this.view !== null && this.savedTick === this.view.tick;
  }

  markSaved(): void {
    this.savedTick = this.view?.tick ?? -1;
  }

  canResign(): boolean {
    const view = this.view;
    if (!view || view.outcome !== null) {
      return false;
    }
    return !(view.players.find((player) => player.id === view.playerId)?.defeated ?? true);
  }

  onResume(): void {
    this.closePauseMenu();
  }

  onResign(): void {
    this.closePauseMenu();
    this.send([{ type: 'resign', playerId: HUMAN_PLAYER_ID }]);
  }

  onExit(): void {
    this.ctx.showMainMenu();
  }

  onLoad(record: SaveRecord): void {
    this.ctx.startGame({ kind: 'load', game: gameFromRecord(record) });
  }

  private async init(): Promise<void> {
    const created = await this.ctx.createRenderer({
      data: this.ctx.data,
      manifest: this.ctx.manifest,
    });
    if (this.destroyed) {
      if (created.ok) {
        created.renderer.destroy();
      }
      return;
    }
    if (!created.ok) {
      this.ctx.showError(created.error === 'webgl_unavailable' ? 'webgl' : 'renderer');
      return;
    }
    const renderer = created.renderer;
    this.renderer = renderer;
    renderer.attach(this.hud.viewport);
    const minimap = renderer.getMinimapCanvas();
    this.hud.minimap.appendChild(minimap);
    this.input = new InputController(renderer, this.hud.viewport, minimap, this);
    const resize = (): void =>
      renderer.resize(this.hud.viewport.clientWidth, this.hud.viewport.clientHeight);
    if (typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver(resize);
      this.observer.observe(this.hud.viewport);
    }
    resize();
    try {
      this.session = new GameSession(this.ctx.createWorker(), this.ctx.data, HUMAN_PLAYER_ID, {
        onView: (view) => this.applyView(view),
        onEvents: (events) => this.applyEvents(events),
        onError: (code) => this.fail(code),
      });
    } catch (error) {
      console.error(`Simulation worker could not start: ${String(error)}`);
      this.ctx.showError('simulation');
      return;
    }
    this.session.begin(this.start);
    this.ctx.audio.startMusic();
    this.autosaveTimer = setInterval(() => void this.autosave(), AUTOSAVE_INTERVAL_MS);
    this.lastFrame = performance.now();
    const frame = (now: number): void => {
      if (this.destroyed) {
        return;
      }
      const delta = Math.min(MAX_FRAME_SECONDS, Math.max(0, (now - this.lastFrame) / 1000));
      this.lastFrame = now;
      this.input?.tick(delta);
      renderer.render(this.session?.interpolation() ?? 1);
      this.frameHandle = requestAnimationFrame(frame);
    };
    this.frameHandle = requestAnimationFrame(frame);
  }

  private fail(code: SimErrorCode): void {
    this.ctx.showError(code === 'load_failed' ? 'load_failed' : 'simulation');
  }

  private applyView(view: PlayerView): void {
    const first = this.view === null;
    this.view = view;
    this.index = new Map(view.entities.map((entity) => [entity.id, entity]));
    this.renderer?.applyView(view);
    this.ctx.audio.setMusicAge?.(view.self.age);
    const alive = pruneSelection(this.selection, this.selectionContext);
    if (!sameIds(alive, this.selection)) {
      this.selection = alive;
      this.renderer?.setSelection(alive);
      this.resetPanel();
    }
    this.groups.prune((id) => this.index.has(id));
    if (first) {
      this.savedTick = this.start.kind === 'load' ? view.tick : -1;
      this.userPaused = view.paused;
    }
    if (this.requestedPause === view.paused) {
      this.requestedPause = null;
    }
    this.syncPause();
    this.refreshHud();
    this.diplomacy?.update(view);
    this.sandbox?.update(view);
    this.hud.setSandbox(view.settings.sandbox === true);
    this.guide?.update(view);
    this.updateBanner();
    if (view.outcome !== null && !this.finished) {
      this.finish(
        view.outcome.winners,
        view.outcome.reason,
        view.players.map((player) => ({
          playerId: player.id,
          winner: view.outcome?.winners.includes(player.id) ?? false,
          score: player.score,
          stats: {},
        })),
      );
    }
  }

  private finish(
    winners: GameOverEvent['winners'],
    reason: GameOverEvent['reason'],
    summaries: GameOverEvent['players'],
  ): void {
    if (this.finished) {
      return;
    }
    this.finished = true;
    this.ctx.audio.playUi(winners.includes(HUMAN_PLAYER_ID) ? 'victory' : 'defeat');
    this.ctx.showSummary({
      viewerId: HUMAN_PLAYER_ID,
      winners,
      reason,
      tickRate: this.ctx.data.game.tickRate,
      players: this.view?.players ?? [],
      summaries,
    });
  }

  private listenerViewport(): ListenerViewport {
    const renderer = this.renderer;
    const width = this.hud.viewport.clientWidth;
    const height = this.hud.viewport.clientHeight;
    if (!renderer) {
      return { playerId: HUMAN_PLAYER_ID, center: { x: 0, y: 0 }, halfWidth: 0, halfHeight: 0 };
    }
    const center = renderer.screenToWorld({ x: width / 2, y: height / 2 });
    const corners = [renderer.screenToWorld({ x: 0, y: 0 }), renderer.screenToWorld({ x: width, y: 0 })];
    return {
      playerId: HUMAN_PLAYER_ID,
      center,
      halfWidth: Math.max(...corners.map((corner) => Math.abs(corner.x - center.x))),
      halfHeight: Math.max(...corners.map((corner) => Math.abs(corner.y - center.y))),
    };
  }

  private allow(key: string, now: number): boolean {
    const interval = THROTTLE_MS[key];
    if (interval === undefined) {
      return true;
    }
    if (now - (this.throttled.get(key) ?? Number.NEGATIVE_INFINITY) < interval) {
      return false;
    }
    this.throttled.set(key, now);
    return true;
  }

  private applyEvents(events: SimEvent[]): void {
    this.renderer?.applyEvents?.(events);
    this.ctx.audio.handleEvents(events, this.listenerViewport());
    const now = performance.now();
    for (const event of events) {
      this.notifyEvent(event, now);
    }
  }

  private player(id: number): string {
    return playerName(this.view?.players ?? [], id, HUMAN_PLAYER_ID);
  }

  private resource(kind: ResourceKind): string {
    return t(`resource.${kind}`);
  }

  private notifyEvent(event: SimEvent, now: number): void {
    const me = HUMAN_PLAYER_ID;
    const say = (text: () => string, position: Vec2 | null = null, tone: NotificationTone = 'info'): void =>
      this.hud.notify(text, position, tone);
    switch (event.type) {
      case 'underAttack':
        if (event.playerId === me && this.allow(event.type, now)) {
          say(() => t('notify.under_attack'), event.position, 'danger');
          this.renderer?.addPing(event.position);
        }
        break;
      case 'housingShort':
        if (event.playerId === me && this.allow(event.type, now)) {
          say(() => t('notify.housing_short'), null, 'warning');
        }
        break;
      case 'populationLimit':
        if (event.playerId === me && this.allow(event.type, now)) {
          say(() => t('notify.population_limit'), null, 'warning');
        }
        break;
      case 'insufficientResources':
        if (event.playerId === me && this.allow(event.type, now)) {
          say(() => t('notify.insufficient_resources', { resource: this.resource(event.resource) }), null, 'warning');
        }
        break;
      case 'researchCompleted':
        if (event.playerId === me) {
          say(() => t('notify.research_completed', { name: t(`tech.${event.technology}.name`) }), event.position);
        }
        break;
      case 'ageAdvanced':
        say(() => t('notify.age_advanced', { player: this.player(event.playerId), age: t(`age.${event.age}`) }));
        break;
      case 'victoryTimerStarted':
        say(() => t(`notify.timer_started.${event.kind}`, { player: this.player(event.playerId) }), null, 'danger');
        break;
      case 'victoryTimerReset':
        say(() => t(`notify.timer_reset.${event.kind}`, { player: this.player(event.playerId) }));
        break;
      case 'playerDefeated':
        say(
          () => t(event.resigned ? 'notify.player_resigned' : 'notify.player_defeated', {
            player: this.player(event.playerId),
          }),
          null,
          'warning',
        );
        break;
      case 'commandRejected':
        if (event.playerId === me) {
          this.ctx.audio.playUi('error');
          if (this.allow(event.type, now)) {
            say(() => t(`notify.rejected.${event.reason}`), null, 'warning');
          }
        }
        break;
      case 'tribute':
        if (event.toPlayerId === me) {
          say(
            () => t('notify.tribute_received', {
              player: this.player(event.fromPlayerId),
              amount: Math.floor(event.amount),
              resource: this.resource(event.resource),
            }),
          );
        }
        break;
      case 'stanceChanged':
        if (event.targetPlayerId === me) {
          say(
            () => t('notify.stance_changed', {
              player: this.player(event.playerId),
              stance: t(`ui.stance.${event.stance}`),
            }),
            null,
            'warning',
          );
        }
        break;
      case 'unitConverted':
        if (event.fromPlayerId === me) {
          say(() => t('notify.unit_converted.lost'), event.position, 'danger');
        } else if (event.toPlayerId === me) {
          say(() => t('notify.unit_converted.gained'), event.position);
        }
        break;
      case 'relicCaptured': {
        const kind = this.ctx.data.mapObjects[event.entityType]?.kind ?? 'ruin';
        say(
          () => t(`notify.relic_captured.${kind}`, { player: this.player(event.playerId) }),
          event.playerId === me ? event.position : null,
        );
        break;
      }
      case 'gameOver':
        this.finish(event.winners, event.reason, event.players);
        break;
      default:
        break;
    }
  }

  private async autosave(): Promise<void> {
    const view = this.view;
    if (!this.ctx.getSettings().autosave || !view || view.outcome !== null || this.finished) {
      return;
    }
    const input = await this.createSaveInput(t('ui.saves.autosave'));
    if (input === null || this.destroyed) {
      return;
    }
    const result = await this.ctx.saveStore.saveAuto(input);
    if (!result.ok && !this.autosaveFailed && !this.destroyed) {
      this.autosaveFailed = true;
      this.hud.notify(() => storageErrorText(result.error), null, 'warning');
    }
  }

  private commandContext(): { view: PlayerView; data: AppContext['data'] } {
    if (!this.view) {
      throw new Error('view');
    }
    return { view: this.view, data: this.ctx.data };
  }

  private selected(): EntityView[] {
    const views: EntityView[] = [];
    for (const id of this.selection) {
      const entity = this.index.get(id);
      if (entity) {
        views.push(entity);
      }
    }
    return views;
  }

  private buttons(): PanelButton[] {
    return this.view ? buildPanel(this.selected(), this.view, this.ctx.data, this.panel) : [];
  }

  private send(commands: readonly Command[]): void {
    this.session?.send(commands);
  }

  private sendOrders(commands: readonly Command[]): void {
    if (commands.length === 0) {
      return;
    }
    this.send(commands);
    const first = this.selected()[0];
    this.ctx.audio.playUi('acknowledge', first ? { entityType: first.type } : undefined);
  }

  private setSelection(ids: EntityId[]): void {
    if (sameIds(ids, this.selection)) {
      return;
    }
    this.selection = ids;
    this.renderer?.setSelection(ids);
    this.resetPanel();
    const first = this.selected()[0];
    if (first && first.owner === HUMAN_PLAYER_ID) {
      this.ctx.audio.playUi('select', { entityType: first.type });
    }
    this.refreshHud();
  }

  private resetPanel(): void {
    this.panel = { ...this.panel, page: 'root', pageIndex: 0, cursor: null, placing: null };
    this.wallStart = null;
    this.clearGhosts();
  }

  private cancelModes(): void {
    this.panel = { ...this.panel, cursor: null, placing: null };
    this.wallStart = null;
    this.clearGhosts();
    this.refreshHud();
  }

  private clearGhosts(): void {
    this.renderer?.setPlacementGhost(null);
    this.renderer?.setWallGhost(null);
  }

  private refreshHud(): void {
    const view = this.view;
    if (!view) {
      return;
    }
    const selection = this.selected();
    this.hud.update({ view, selection, buttons: buildPanel(selection, view, this.ctx.data, this.panel) });
    this.renderer?.setRallyMarkers(
      selection.flatMap((entity) =>
        entity.own?.rallyPoint
          ? [{ buildingId: entity.id, position: entity.own.rallyPoint.position }]
          : [],
      ),
    );
  }

  private updateBanner(): void {
    if (!this.view) {
      this.hud.setBanner(t('ui.loading'));
    } else if (this.view.paused && this.pauseMenu === null) {
      this.hud.setBanner(t('ui.hud.paused'));
    } else {
      this.hud.setBanner(null);
    }
  }

  private syncPause(): void {
    const view = this.view;
    if (!view || view.outcome !== null) {
      return;
    }
    const desired = this.userPaused || this.pauseMenu !== null;
    if (view.paused !== desired && this.requestedPause !== desired) {
      this.requestedPause = desired;
      this.session?.setPaused(desired);
    }
  }

  private tileAt(point: ScreenPoint, size: number): TileCoord {
    const world = this.renderer?.screenToWorld(point) ?? { x: 0, y: 0 };
    return footprintTile(world, size);
  }

  private updateGhost(): void {
    const renderer = this.renderer;
    const view = this.view;
    const building = this.panel.placing;
    const def = building === null ? undefined : this.ctx.data.buildings[building];
    if (!renderer || !view || building === null || !def || !this.input) {
      this.clearGhosts();
      return;
    }
    const occupied = this.occupancy.tilesOf(view);
    const pointer = this.input.pointerPosition;
    if (this.wallStart !== null) {
      const to = this.tileAt(pointer, 1);
      renderer.setPlacementGhost(null);
      renderer.setWallGhost({
        building,
        from: this.wallStart,
        to,
        valid: canPlaceWall(view, this.ctx.data, building, this.wallStart, to, occupied),
      });
      return;
    }
    const tile = this.tileAt(pointer, def.size);
    renderer.setWallGhost(null);
    renderer.setPlacementGhost({
      building,
      tile,
      valid: canPlace(view, this.ctx.data, building, tile, occupied),
    });
  }

  private place(building: string, tile: TileCoord, shift: boolean): void {
    const view = this.view;
    if (!view) {
      return;
    }
    if (!canPlace(view, this.ctx.data, building, tile, this.occupancy.tilesOf(view))) {
      this.ctx.audio.playUi('error');
      return;
    }
    this.sendOrders(placeBuildingCommands(this.commandContext(), this.selected(), building, tile, shift));
    this.finishPlacement(shift);
  }

  private finishPlacement(keep: boolean): void {
    if (keep) {
      this.updateGhost();
      return;
    }
    this.panel = { ...this.panel, placing: null, page: 'root', pageIndex: 0 };
    this.clearGhosts();
    this.refreshHud();
  }

  private runCursor(point: ScreenPoint, shift: boolean): void {
    const renderer = this.renderer;
    const view = this.view;
    const cursor = this.panel.cursor;
    if (!renderer || !view || cursor === null) {
      return;
    }
    const world = renderer.screenToWorld(point);
    const picked = renderer.pickEntity(point);
    const target = picked === null ? null : (this.index.get(picked) ?? null);
    const selection = this.selected();
    let commands: Command[];
    switch (cursor) {
      case 'attackMove':
        commands = attackMoveCommands(view, selection, world, shift);
        break;
      case 'attackGround':
        commands = attackGroundCommands(this.commandContext(), selection, world, shift);
        break;
      case 'repair':
        commands = repairCommands(this.commandContext(), selection, target, shift);
        break;
      case 'unload':
        commands = unloadCommands(this.commandContext(), selection, world, shift);
        break;
      default:
        commands = rallyCommands(view, selection, target, world);
    }
    if (commands.length === 0) {
      this.ctx.audio.playUi('error');
    }
    this.sendOrders(commands);
    if (!shift) {
      this.panel = { ...this.panel, cursor: null };
      this.refreshHud();
    }
  }

  private pressPanelButton(button: PanelButton, shift: boolean): void {
    const view = this.view;
    if (!view) {
      return;
    }
    if (button.availability.blocked) {
      this.ctx.audio.playUi('error');
      return;
    }
    const selection = this.selected();
    const action = button.action;
    const building = selection.find((entity) => entity.kind === 'building');
    switch (action.type) {
      case 'cursor':
        this.panel = {
          ...this.panel,
          cursor: this.panel.cursor === action.mode ? null : action.mode,
          placing: null,
        };
        this.clearGhosts();
        break;
      case 'page':
        this.panel = { ...this.panel, page: action.page, pageIndex: 0, placing: null, cursor: null };
        this.clearGhosts();
        break;
      case 'nextPage':
        this.panel = { ...this.panel, pageIndex: this.panel.pageIndex + 1 };
        break;
      case 'stop':
        this.sendOrders(stopCommands(view, selection));
        break;
      case 'standGround':
        this.sendOrders(standGroundCommands(view, selection, action.enabled));
        break;
      case 'delete':
        this.sendOrders(deleteCommands(view, selection));
        break;
      case 'place':
        this.panel = { ...this.panel, placing: action.building, cursor: null };
        this.wallStart = null;
        if (this.input?.usingTouch) {
          this.input.centerPointer();
        }
        this.updateGhost();
        break;
      case 'train':
        if (building) {
          this.send([
            {
              type: 'train',
              playerId: view.playerId,
              buildingId: building.id,
              unit: action.unit,
              count: shift ? TRAIN_BATCH : 1,
            },
          ]);
        }
        break;
      case 'research':
        if (building) {
          this.send([
            {
              type: 'research',
              playerId: view.playerId,
              buildingId: building.id,
              technology: action.technology,
            },
          ]);
        }
        break;
      case 'tradeGood':
        this.panel = { ...this.panel, tradeGood: action.good };
        break;
    }
    this.refreshHud();
  }

  private escape(): boolean {
    if (this.ctx.overlayRoot.childElementCount > 0) {
      return false;
    }
    if (this.sandbox) {
      this.toggleSandbox();
    } else if (this.guide) {
      this.toggleGuide();
    } else if (this.diplomacy) {
      this.toggleDiplomacy();
    } else if (this.pauseMenu) {
      if (!this.pauseMenu.back()) {
        this.closePauseMenu();
      }
    } else if (this.panel.placing !== null || this.panel.cursor !== null) {
      this.cancelModes();
    } else if (this.panel.page !== 'root') {
      this.panel = { ...this.panel, page: 'root', pageIndex: 0 };
      this.refreshHud();
    } else {
      this.openPauseMenu();
    }
    return true;
  }

  private openPauseMenu(): void {
    if (this.pauseMenu || !this.view || this.finished) {
      return;
    }
    if (this.diplomacy) {
      this.toggleDiplomacy();
    }
    if (this.guide) {
      this.toggleGuide();
    }
    if (this.sandbox) {
      this.toggleSandbox();
    }
    this.cancelModes();
    this.pauseMenu = new PauseMenu(this.ctx, this);
    this.overlay.appendChild(this.pauseMenu.element);
    this.syncPause();
    this.updateBanner();
  }

  private closePauseMenu(): void {
    if (!this.pauseMenu) {
      return;
    }
    this.pauseMenu.element.remove();
    this.pauseMenu = null;
    this.syncPause();
    this.updateBanner();
  }

  private toggleDiplomacy(): void {
    if (this.diplomacy) {
      this.diplomacy.element.remove();
      this.diplomacy = null;
      return;
    }
    if (!this.view || this.pauseMenu) {
      return;
    }
    if (this.guide) {
      this.toggleGuide();
    }
    if (this.sandbox) {
      this.toggleSandbox();
    }
    this.cancelModes();
    this.diplomacy = new DiplomacyWindow(this.ctx.data, {
      onStance: (targetPlayerId, stance: Stance) =>
        this.send([{ type: 'setStance', playerId: HUMAN_PLAYER_ID, targetPlayerId, stance }]),
      onTribute: (targetPlayerId, resource, amount) =>
        this.send([{ type: 'tribute', playerId: HUMAN_PLAYER_ID, targetPlayerId, resource, amount }]),
      onClose: () => this.toggleDiplomacy(),
    });
    this.diplomacy.update(this.view);
    this.overlay.appendChild(this.diplomacy.element);
  }

  private toggleGuide(): void {
    if (this.guide) {
      this.guide.element.remove();
      this.guide = null;
      return;
    }
    if (!this.view || this.pauseMenu) {
      return;
    }
    if (this.diplomacy) {
      this.toggleDiplomacy();
    }
    if (this.sandbox) {
      this.toggleSandbox();
    }
    this.cancelModes();
    this.guide = new GuideWindow(this.ctx.data, { onClose: () => this.toggleGuide() });
    this.guide.update(this.view);
    this.overlay.appendChild(this.guide.element);
  }

  private toggleSandbox(): void {
    if (this.sandbox) {
      this.sandbox.element.remove();
      this.sandbox = null;
      return;
    }
    if (!this.view || this.pauseMenu || this.view.settings.sandbox !== true) {
      return;
    }
    if (this.diplomacy) {
      this.toggleDiplomacy();
    }
    if (this.guide) {
      this.toggleGuide();
    }
    this.cancelModes();
    this.sandbox = new SandboxWindow({
      onDirective: (targetPlayerId, mode, victimId) =>
        this.send([{ type: 'sandboxAi', playerId: HUMAN_PLAYER_ID, targetPlayerId, mode, victimId }]),
      onGrant: (targetPlayerId, amount) =>
        this.send([{ type: 'sandboxResources', playerId: HUMAN_PLAYER_ID, targetPlayerId, amount }]),
      onClose: () => this.toggleSandbox(),
    });
    this.sandbox.update(this.view);
    this.overlay.appendChild(this.sandbox.element);
  }

  private recallGroup(index: number, now: number): void {
    const recall = this.groups.recall(index, now);
    if (!recall) {
      return;
    }
    this.setSelection(recall.ids);
    if (recall.center) {
      this.centerOnSelection();
    }
  }

  private centerOnSelection(): void {
    const selection = this.selected();
    if (selection.length === 0) {
      return;
    }
    const sum = selection.reduce(
      (total, entity) => ({ x: total.x + entity.position.x, y: total.y + entity.position.y }),
      { x: 0, y: 0 },
    );
    this.renderer?.centerOn({ x: sum.x / selection.length, y: sum.y / selection.length });
  }

  private isIdleVillager(entity: EntityView): boolean {
    return (
      entity.kind === 'unit' &&
      entity.state === 'idle' &&
      (entity.own?.orders.length ?? 0) === 0 &&
      (this.ctx.data.units[entity.type]?.class.includes('villager') ?? false)
    );
  }

  private cycleOwn(matches: (entity: EntityView) => boolean): void {
    const view = this.view;
    if (!view) {
      return;
    }
    const candidates = view.entities
      .filter((entity) => entity.owner === view.playerId && matches(entity))
      .sort((a, b) => a.id - b.id);
    if (candidates.length === 0) {
      this.ctx.audio.playUi('error');
      return;
    }
    const next = candidates.find((entity) => entity.id > this.cycleCursor) ?? candidates[0];
    this.cycleCursor = next.id;
    this.setSelection([next.id]);
    this.renderer?.centerOn(next.position);
  }
}

export function gameScreen(ctx: AppContext, start: GameStart): Screen {
  return new GameScreen(ctx, start);
}
