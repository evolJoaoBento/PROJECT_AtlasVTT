/**
 * Dice in an online session. A player's roll (`dice-roll`) is rolled here with Atlas's dice
 * code, so it cannot be faked, and joins Atlas's dice log, toasts and sounds through the dice
 * feed under the player's name. Every roll the dice log gets, the GM's and players', goes to
 * every admitted player as `dice-log`; each admission replays the latest 50, newest first.
 * More than 2 rolls a second from one player are ignored. A `GmSession` handler, started after
 * the token control host.
 */
import { diceFormula, rollFormula, type DiceRollResult } from '../../tools/diceRolling';
import type { SessionHandler, SessionPlayer } from '../GmSession';
import type { ControlMessage } from '../protocol';
import { RateLimit } from '../rateLimit';
import type { CameraProjection } from '../scene/CameraSender';
import type { PresentedSceneSource, SceneSession } from '../scene/sceneSources';
import type { DiceFeed } from '../diceFeed';
import { DICE_LIMITS, diceLogEntry, GM_ROLLER_NAME, type DiceLogEntry } from './toolMessages';

export interface DiceHostOptions {
  session: SceneSession;
  /** Tells whether the GM looks at another scene than the one players have: ids of another map name nothing. */
  presented: PresentedSceneSource;
  /** The scene players have: a roll names a token only when players see it there, by name. */
  projection: Pick<CameraProjection, 'currentProjection'>;
  feed: DiceFeed;
  /** Tests pass their own; `Math.random` otherwise. */
  random?: () => number;
}

export class DiceHost implements SessionHandler {
  private readonly limit = new RateLimit(DICE_LIMITS.rollsPerSecond);
  /** The latest rolls, newest first. */
  private readonly history: DiceLogEntry[] = [];
  private readonly stops: Array<() => void> = [];

  constructor(private readonly options: DiceHostOptions) {}

  start(): void {
    if (this.stops.length > 0) return;
    this.stops.push(this.options.session.use(this), this.options.feed.subscribe((result) => this.rolled(result)));
  }

  stop(): void {
    this.stops.splice(0).forEach((stop) => stop());
  }

  /** Every admission, a reconnect or a new tab included, replaces the player's log. */
  onAdmitted(player: SessionPlayer): void {
    this.options.session.send(player.playerId, { v: 1, type: 'dice-log', entries: [...this.history], replay: true });
  }

  onMessage(player: SessionPlayer, message: ControlMessage): void {
    if (message.type !== 'dice-roll' || !this.limit.allow(player.playerId, Date.now())) return;
    const result = rollFormula(diceFormula(message.dice, message.modifier), this.options.random);
    this.options.feed.publish({ ...result, rolledBy: player.name });
  }

  /** Drops the windows of players who left the session: a reconnect must not reset one. */
  playersChanged(players: readonly SessionPlayer[]): void {
    this.limit.retain(new Set(players.map((player) => player.playerId)));
  }

  private rolled(result: DiceRollResult): void {
    const entry = diceLogEntry(result, this.nameOf(result));
    if (!entry) return;
    this.history.unshift(entry);
    if (this.history.length > DICE_LIMITS.logEntries) this.history.length = DICE_LIMITS.logEntries;
    const { session } = this.options;
    for (const player of session.getPlayers()) {
      if (player.status === 'admitted') session.send(player.playerId, { v: 1, type: 'dice-log', entries: [entry], replay: false });
    }
  }

  /**
   * An online player's roll carries their name ("GM (player)" for a player called GM). A statblock
   * roll carries its token's name only when `tokenId` is a token players have in their scene, with
   * a name, and the GM looks at that scene (hidden, fogged and unnamed tokens, a held scene and nothing presented are not); else "GM".
   */
  private nameOf(result: DiceRollResult): string {
    if (result.rolledBy) return result.rolledBy.trim().toLowerCase() === GM_ROLLER_NAME.toLowerCase() ? `${GM_ROLLER_NAME} (player)` : result.rolledBy;
    const { source } = result;
    if (source?.type !== 'statblock' || !source.tokenId || this.options.presented.isHeld()) return GM_ROLLER_NAME;
    const tokens = this.options.projection.currentProjection()?.tokens ?? {};
    const name = Object.hasOwn(tokens, source.tokenId) ? tokens[source.tokenId]?.name : null;
    return name || GM_ROLLER_NAME;
  }
}
