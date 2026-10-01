/**
 * Sends each admitted player the tokens they control (`token-control`): on admission
 * (a reconnect and a replacing tab included), with every resync they ask for, and
 * whenever their assignments change. A `GmSession` handler registered after the
 * broadcaster and the camera sender, so the list follows the snapshot it goes with.
 * Control is per player and never part of the shared projection.
 */
import type { SessionHandler, SessionPlayer } from '../GmSession';
import type { ControlMessage } from '../protocol';
import type { SceneSession } from '../scene/sceneSources';
import type { TokenControl } from './TokenControl';

export interface ControlListsOptions {
  session: SceneSession;
  control: TokenControl;
}

export class ControlLists implements SessionHandler {
  private readonly stops: Array<() => void> = [];

  constructor(private readonly options: ControlListsOptions) {}

  start(): void {
    this.stops.push(
      this.options.session.use(this),
      this.options.control.onChange((playerIds) => playerIds.forEach((playerId) => this.send(playerId))),
    );
  }

  stop(): void {
    this.stops.splice(0).forEach((stop) => stop());
  }

  onAdmitted(player: SessionPlayer): void {
    this.send(player.playerId);
  }

  onMessage(player: SessionPlayer, message: ControlMessage): void {
    if (message.type === 'scene-resync') this.send(player.playerId);
  }

  /** The session sends to admitted players only, so a gone or removed player gets nothing. */
  private send(playerId: string): void {
    this.options.session.send(playerId, { v: 1, type: 'token-control', tokenIds: this.options.control.tokensOf(playerId) });
  }
}
