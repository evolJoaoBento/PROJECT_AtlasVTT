/**
 * Dice in an online session. A player's roll (`dice-roll`) is rolled here with Atlas's dice
 * code, so it cannot be faked, and joins Atlas's dice log, toasts and sounds through the dice
 * feed under the player's name. Every roll the dice log gets, the GM's and players', goes to
 * every admitted player as `dice-log`; each admission replays the latest 50, newest first.
 * More than 2 rolls a second from one player are ignored. A `GmSession` handler, started after
 * the token control host.
 */
import { diceFormula, rollerName, rollFormula, withoutHiddenToken, type DiceRollResult } from '../../tools/diceRolling';
import type { SessionHandler, SessionPlayer } from '../GmSession';
import type { ControlMessage } from '../protocol';
import { RateLimit } from '../rateLimit';
import type { PresentedSceneSource, SceneSession } from '../scene/sceneSources';
import type { DiceFeed } from './diceFeed';
import { DICE_LIMITS, diceLogEntry, GM_ROLLER_NAME, type DiceLogEntry } from './toolMessages';

export interface DiceHostOptions {
  session: SceneSession;
  /** Tells which tokens are hidden from players, for roll names. */
  presented: PresentedSceneSource;
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

  /** A roll for a token hidden on the presented scene is named "GM", as the player window hides it. */
  private nameOf(result: DiceRollResult): string {
    const store = this.options.presented.current()?.store;
    const isHidden = (tokenId: string): boolean => Boolean(store?.getState().objects?.tokens?.[tokenId]?.isHidden);
    return rollerName(withoutHiddenToken(result, isHidden)) ?? GM_ROLLER_NAME;
  }
}
