/**
 * Everything one online session needs to let players move their own tokens: the
 * assignments (`TokenControl`), each player's list (`ControlLists`), the moves
 * (`TokenMoveHandler`) and dropping tokens deleted from the presented scene. Started
 * after the broadcaster and the camera sender, so its messages follow theirs.
 */
import type { SessionPlayer } from '../GmSession';
import type { CameraProjection } from '../scene/CameraSender';
import type { PresentedSceneSource, SceneSession } from '../scene/sceneSources';
import { ControlLists } from './ControlLists';
import { watchDeletedTokens } from './deletedTokens';
import { TokenControl } from './TokenControl';
import { TokenMoveHandler } from './TokenMoveHandler';

export interface TokenControlHostOptions {
  session: SceneSession;
  presented: PresentedSceneSource;
  /** The scene players have; moves are checked against it. */
  projection: Pick<CameraProjection, 'currentProjection'>;
}

export class TokenControlHost {
  readonly control = new TokenControl();
  private readonly lists: ControlLists;
  private readonly moves: TokenMoveHandler;
  private stopWatching: (() => void) | null = null;

  constructor(private readonly options: TokenControlHostOptions) {
    this.lists = new ControlLists({ session: options.session, control: this.control });
    this.moves = new TokenMoveHandler({ ...options, control: this.control });
  }

  start(): void {
    if (this.stopWatching) return;
    this.lists.start();
    this.moves.start();
    this.stopWatching = watchDeletedTokens(this.options.presented, this.control);
  }

  stop(): void {
    this.stopWatching?.();
    this.stopWatching = null;
    this.lists.stop();
    this.moves.stop();
  }

  /** The session's players changed: a removed (kicked) player loses their tokens; one who is only gone keeps them. */
  playersChanged(players: readonly SessionPlayer[]): void {
    this.control.retainPlayers(new Set(players.map((player) => player.playerId)));
  }
}
