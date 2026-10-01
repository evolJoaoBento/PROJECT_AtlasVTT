/** What the broadcaster needs of its neighbours, and the change detection it shares with them. */
import type { SessionHandler, SessionPlayer } from '../GmSession';
import type { ControlMessage } from '../protocol';
import type { PresentedSceneInfo, PresentedSceneListener } from '../../services/PresentedScene';
import type { ViewAtlasState } from '../../storeFactory';
import type { FogOperation } from '../../types/fogTypes';
import type { AssetRegistry } from './AssetRegistry';
import { FogCoverage } from './FogCoverage';
import type { PlayerViewRules } from './playerViewRules';
import { projectFog, type ProjectionMemo } from './projectRecords';
import { SCENE_LIMITS } from './sceneTypes';

export interface SceneSession {
  use(handler: SessionHandler): () => void;
  send(playerId: string, message: ControlMessage): void;
  getPlayers(): SessionPlayer[];
}

export interface PresentedSceneSource {
  current(): PresentedSceneInfo | null;
  isHeld(): boolean;
  subscribe(listener: PresentedSceneListener): () => void;
}

export interface PlayerViewSettingsSource {
  getLocalPlayerViewSettings(): PlayerViewRules;
  onChange(listener: () => void): () => void;
}

export interface SceneBroadcasterOptions {
  session: SceneSession;
  presented: PresentedSceneSource;
  settings: PlayerViewSettingsSource;
  /** The session's content registry: fingerprints for the projection, and when to project again. */
  assets: AssetRegistry;
  /** Tells the GM something; `OnlineSessionService` shows an Obsidian notice. */
  notify(message: string): void;
}

export type Slice = readonly unknown[];

/** The store fields the projection reads; changes elsewhere (camera, selection, tools) send nothing. */
export function sliceOf(state: ViewAtlasState): Slice {
  return [
    state.background, state.grid, state.objects, state.widgetSettings,
    state.widgetValues, state.initiative, state.initiativeTrackerOpen,
  ];
}

export function sameSlice(a: Slice, b: Slice): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/** Changes are batched and sent at most this often. */
export const SCENE_TICK_MS = 50;

export const SCENE_TOO_LARGE_NOTICE = 'This scene is too large to send to online players.';
export const FOG_TRUNCATED_NOTICE = 'This scene has too much fog to show to online players.';

/** The presented scene while it is shown (not held). */
export interface LiveScene {
  readonly scene: PresentedSceneInfo;
  readonly sceneId: string;
  loading: boolean;
  slice: Slice | null;
  readonly unsubscribe: () => void;
}

/** Coverage rasterised from the fog players receive, rebuilt only when the fog reference changes. */
export class FogCoverageCache {
  private entry: { fog: Readonly<Record<string, FogOperation>>; coverage: FogCoverage; truncated: boolean } | null = null;

  /** `truncated`: the GM's fog has more operations than the limit, so some are not sent. */
  get(fog: Readonly<Record<string, FogOperation>>, memo: ProjectionMemo): { coverage: FogCoverage; truncated: boolean } {
    if (this.entry?.fog !== fog) {
      const sent = projectFog(fog, memo);
      this.entry = {
        fog,
        coverage: FogCoverage.fromPlayerFog(sent),
        truncated: Object.keys(fog).length > SCENE_LIMITS.records,
      };
    }
    return this.entry;
  }
}
