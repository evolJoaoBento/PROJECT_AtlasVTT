// src/app/online/scene/SceneBroadcaster.ts
/**
 * Sends the presented scene to every admitted player: a snapshot on
 * presenting, on resume, on admission and on a player's resync; patches at
 * most every 50 ms in between; `scene-clear` when presenting stops. There is
 * one projection per scene and everyone gets the same messages. It plugs into
 * `GmSession` through `session.use`, so the session never learns about maps.
 */
import type { SessionHandler, SessionPlayer } from '../GmSession';
import { randomId } from '../ids';
import type { ControlMessage } from '../protocol';
import type { PresentedSceneInfo } from '../../services/PresentedScene';
import type { ViewAtlasState } from '../../storeFactory';
import { AssetRegistry } from './AssetRegistry';
import { pickPlayerViewRules, samePlayerViewRules, type PlayerViewRules } from './playerViewRules';
import { projectForPlayers } from './projectForPlayers';
import { createProjectionMemo, type ProjectionMemo } from './projectRecords';
import { diffScenes } from './sceneDiff';
import type { FogCoverage } from './FogCoverage';
import type { FogOperation } from '../../types/fogTypes';
import { patchMessage, snapshotMessages, type SceneOutgoing } from './sceneMessages';
import {
  FogCoverageCache, sameSlice, sliceOf, type Slice,
  type PlayerViewSettingsSource, type PresentedSceneSource, type SceneSession,
} from './sceneSources';
import type { PlayerScene } from './sceneTypes';

export type { PlayerViewSettingsSource, PresentedSceneSource, SceneSession } from './sceneSources';

/** Changes are batched and sent at most this often. */
export const SCENE_TICK_MS = 50;

export const SCENE_TOO_LARGE_NOTICE = 'This scene is too large to send to online players.';
export const FOG_TRUNCATED_NOTICE = 'This scene has too much fog to send all of it to online players.';

export interface SceneBroadcasterOptions {
  session: SceneSession;
  presented: PresentedSceneSource;
  settings: PlayerViewSettingsSource;
  /** Tells the GM something; `OnlineSessionService` shows an Obsidian notice. */
  notify(message: string): void;
}

/** The presented scene while it is shown (not held). */
interface LiveScene {
  readonly scene: PresentedSceneInfo;
  readonly sceneId: string;
  loading: boolean;
  slice: Slice | null;
  readonly unsubscribe: () => void;
}

export class SceneBroadcaster implements SessionHandler {
  private readonly assets = new AssetRegistry();
  private readonly seqs = new Map<string, number>();
  private readonly stops: Array<() => void> = [];
  private memo: ProjectionMemo = createProjectionMemo();
  private rules: PlayerViewRules;
  private live: LiveScene | null = null;
  private sceneId: string | null = null;
  /** What players have: the last projection sent. Held scenes keep it; nothing re-projects it. */
  private lastSent: PlayerScene | null = null;
  private snapshot: { scene: PlayerScene; messages: SceneOutgoing[] | null } | null = null;
  private readonly fogCache = new FogCoverageCache();
  private tickTimer: number | null = null;
  /** The presentation whose oversize the GM was told about, so the notice shows once. */
  private noticeShownFor: string | null = null;
  private fogNoticeShownFor: string | null = null;

  constructor(private readonly options: SceneBroadcasterOptions) {
    this.rules = pickPlayerViewRules(options.settings.getLocalPlayerViewSettings());
  }

  start(): void {
    const { session, presented, settings } = this.options;
    this.stops.push(
      session.use(this),
      presented.subscribe({
        presented: (scene, resumed) => this.showScene(scene, resumed),
        held: () => this.detach(),
        cleared: () => this.clearScene(),
      }),
      settings.onChange(() => this.settingsChanged()),
    );
    const current = presented.current();
    if (current && !presented.isHeld()) this.showScene(current, false);
  }

  stop(): void {
    this.detach();
    this.stops.splice(0).forEach((stop) => stop());
  }

  /** The scene players have now; null when none was sent or it was cleared. */
  currentProjection(): PlayerScene | null {
    return this.lastSent;
  }

  /** Also fires when a newer tab of a player replaces an older one: always a full snapshot. */
  onAdmitted(player: SessionPlayer): void {
    this.sendCurrent(player.playerId);
  }

  onMessage(player: SessionPlayer, message: ControlMessage): void {
    // Players never send scene data; a resync is the only scene message the GM acts on.
    if (message.type === 'scene-resync') this.sendCurrent(player.playerId);
  }

  private showScene(scene: PresentedSceneInfo, resumed: boolean): void {
    this.detach();
    const sceneId = resumed && this.sceneId !== null ? this.sceneId : randomId();
    if (sceneId !== this.sceneId) this.memo = createProjectionMemo();
    this.sceneId = sceneId;
    const live: LiveScene = {
      scene,
      sceneId,
      loading: scene.store.getState().isMapLoading,
      slice: null,
      unsubscribe: scene.store.subscribe((state) => this.storeChanged(live, state)),
    };
    this.live = live;
    if (!live.loading) this.broadcastSnapshot(live);
  }

  private storeChanged(live: LiveScene, state: ViewAtlasState): void {
    if (this.live !== live) return;
    if (state.isMapLoading) {
      // Writes made by loading are not edits: nothing is sent until the map is ready.
      live.loading = true;
      this.cancelTick();
      return;
    }
    if (live.loading) {
      live.loading = false;
      this.broadcastSnapshot(live);
      return;
    }
    if (live.slice && sameSlice(live.slice, sliceOf(state))) return;
    this.scheduleTick();
  }

  private settingsChanged(): void {
    const rules = pickPlayerViewRules(this.options.settings.getLocalPlayerViewSettings());
    if (samePlayerViewRules(rules, this.rules)) return;
    this.rules = rules;
    // A held scene is not projected again; it gets the new rules when it resumes.
    if (this.live && !this.live.loading) this.scheduleTick();
  }

  private detach(): void {
    this.cancelTick();
    this.live?.unsubscribe();
    this.live = null;
  }

  private clearScene(): void {
    this.detach();
    this.sceneId = null;
    this.lastSent = null;
    this.snapshot = null;
    for (const playerId of this.admitted()) this.sendSequenced(playerId, { v: 1, type: 'scene-clear' });
  }

  private scheduleTick(): void {
    if (this.tickTimer !== null) return;
    this.tickTimer = window.setTimeout(() => {
      this.tickTimer = null;
      this.tick();
    }, SCENE_TICK_MS);
  }

  private cancelTick(): void {
    if (this.tickTimer !== null) window.clearTimeout(this.tickTimer);
    this.tickTimer = null;
  }

  private tick(): void {
    const live = this.live;
    if (!live || live.loading) return;
    const previous = this.lastSent;
    // Players who got a clear instead of an oversized scene need a snapshot, not a patch.
    if (!previous || previous.sceneId !== live.sceneId || this.snapshotFailed(previous)) {
      this.broadcastSnapshot(live);
      return;
    }
    const next = this.project(live);
    const patch = diffScenes(previous, next);
    if (!patch) return;
    this.lastSent = next;
    const message = patchMessage(patch);
    for (const playerId of this.admitted()) {
      if (message) this.sendSequenced(playerId, message);
      else this.sendSnapshot(playerId);
    }
  }

  private broadcastSnapshot(live: LiveScene): void {
    this.cancelTick();
    this.lastSent = this.project(live);
    for (const playerId of this.admitted()) this.sendSnapshot(playerId);
  }

  private project(live: LiveScene): PlayerScene {
    const state = live.scene.store.getState();
    live.slice = sliceOf(state);
    return projectForPlayers(state, {
      sceneId: live.sceneId,
      rules: this.rules,
      coverage: this.coverageOf(state.objects?.fog ?? {}, live.sceneId),
      assets: this.assets,
      mapSize: live.scene.mapSize(),
      memo: this.memo,
    });
  }

  /** Rebuilt only when the fog operations change; tells the GM once per presentation if fog is dropped. */
  private coverageOf(fog: Readonly<Record<string, FogOperation>>, sceneId: string): FogCoverage {
    const { coverage, truncated } = this.fogCache.get(fog, this.memo);
    if (truncated && this.fogNoticeShownFor !== sceneId) {
      this.fogNoticeShownFor = sceneId;
      this.options.notify(FOG_TRUNCATED_NOTICE);
    }
    return coverage;
  }

  /** What players have, or a clear when they have nothing: never a new projection. */
  private sendCurrent(playerId: string): void {
    if (this.lastSent) this.sendSnapshot(playerId);
    else this.sendSequenced(playerId, { v: 1, type: 'scene-clear' });
  }

  /** A scene too large to send reaches players as a clear, never as a stale or partial scene. */
  private sendSnapshot(playerId: string): void {
    const scene = this.lastSent;
    if (!scene) return;
    const messages = this.snapshotOf(scene);
    if (!messages) {
      this.sendSequenced(playerId, { v: 1, type: 'scene-clear' });
      return;
    }
    for (const message of messages) this.sendSequenced(playerId, message);
  }

  private snapshotOf(scene: PlayerScene): SceneOutgoing[] | null {
    if (this.snapshot?.scene !== scene) {
      this.snapshot = { scene, messages: snapshotMessages(scene) };
      if (!this.snapshot.messages && this.noticeShownFor !== scene.sceneId) {
        this.noticeShownFor = scene.sceneId;
        this.options.notify(SCENE_TOO_LARGE_NOTICE);
      }
    }
    return this.snapshot.messages;
  }

  /** Whether the snapshot of `scene` was tried and was too large. */
  private snapshotFailed(scene: PlayerScene): boolean {
    return this.snapshot?.scene === scene && this.snapshot.messages === null;
  }

  private sendSequenced(playerId: string, message: SceneOutgoing): void {
    const seq = (this.seqs.get(playerId) ?? 0) + 1;
    this.seqs.set(playerId, seq);
    this.options.session.send(playerId, { ...message, seq });
  }

  private admitted(): string[] {
    return this.options.session.getPlayers()
      .filter((player) => player.status === 'admitted')
      .map((player) => player.playerId);
  }
}
