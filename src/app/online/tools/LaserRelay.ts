/**
 * Lasers in an online session. A player's `laser` goes to every other admitted player with
 * `from`, the sender's session id (anything the player put there is ignored), and shows in the
 * GM's view while the presented scene is live. The GM's own laser in that view goes to every
 * player from `gm`, batched like the page's. Lasers for another scene than the one players have
 * are dropped, more than 40 a second from one player are ignored (a lift of a laser being held still goes on, without points), and nothing is stored. A
 * player who leaves or is removed mid-stroke is let go everywhere. A `GmSession` handler.
 */
import type { PresentedSceneInfo } from '../../services/PresentedScene';
import type { SessionHandler, SessionPlayer } from '../GmSession';
import type { ControlMessage } from '../protocol';
import { RateLimit } from '../rateLimit';
import type { CameraProjection } from '../scene/CameraSender';
import type { PresentedSceneSource, SceneSession } from '../scene/sceneSources';
import type { ScenePoint } from '../scene/sceneTypes';
import { LaserBatcher } from './LaserBatcher';
import { GM_LASER_ID, laserColor } from './laserColors';
import { LASER_LIMITS } from './toolMessages';

export interface LaserRelayOptions {
  session: SceneSession;
  presented: PresentedSceneSource;
  /** The scene players have: lasers for any other are dropped. */
  projection: Pick<CameraProjection, 'currentProjection'>;
}

export class LaserRelay implements SessionHandler {
  private readonly limit = new RateLimit(LASER_LIMITS.perSecond * 2);
  private readonly batcher = new LaserBatcher((points, lifted) => this.relay(GM_LASER_ID, points, lifted, null));
  private readonly stops: Array<() => void> = [];
  /** The presented scene while it is live; the GM's laser is read from its view. */
  private live: PresentedSceneInfo | null = null;
  private stopLocal: (() => void) | null = null;
  /** Players with a stroke in progress, so leaving lets it go. */
  private readonly drawing = new Set<string>();

  constructor(private readonly options: LaserRelayOptions) {}

  start(): void {
    if (this.stops.length > 0) return;
    const { session, presented } = this.options;
    this.stops.push(
      session.use(this),
      presented.subscribe({
        presented: (scene) => this.attach(scene),
        held: () => this.detach(),
        cleared: () => this.detach(),
      }),
    );
    const current = presented.current();
    if (current && !presented.isHeld()) this.attach(current);
  }

  stop(): void {
    this.detach();
    this.batcher.dispose();
    this.stops.splice(0).forEach((stop) => stop());
  }

  onMessage(player: SessionPlayer, message: ControlMessage): void {
    if (message.type !== 'laser') return;
    // Over the limit (40 a second, twice the sender's rate) only a lift of a laser being held goes on, with no points.
    const allowed = this.limit.allow(player.playerId, Date.now());
    if (!allowed && !(message.lifted && this.drawing.has(player.playerId))) return;
    const points = allowed ? message.points : [];
    if (message.sceneId !== this.options.projection.currentProjection()?.sceneId) return;
    if (message.lifted) this.drawing.delete(player.playerId);
    else this.drawing.add(player.playerId);
    // Field by field: a page may add keys to its points.
    this.relay(player.playerId, points.map(({ x, y }) => ({ x, y })), message.lifted, player.playerId);
  }

  onGone(player: SessionPlayer): void {
    this.letGo(player.playerId);
  }

  /** The session's players changed: a removed player's laser goes, and so does their rate window. */
  playersChanged(players: readonly SessionPlayer[]): void {
    const known = new Set(players.map((player) => player.playerId));
    this.limit.retain(known);
    for (const playerId of [...this.drawing]) if (!known.has(playerId)) this.letGo(playerId);
  }

  private attach(scene: PresentedSceneInfo): void {
    this.detach();
    this.live = scene;
    this.stopLocal = scene.laser()?.onLocal((event) => {
      if (event.kind === 'point') this.batcher.point(event);
      else this.batcher.lift();
    }) ?? null;
  }

  /** The GM's laser was on the view that stops being shown: it is let go. */
  private detach(): void {
    this.batcher.lift();
    this.stopLocal?.();
    this.stopLocal = null;
    this.live = null;
  }

  private letGo(playerId: string): void {
    if (this.drawing.delete(playerId)) this.relay(playerId, [], true, playerId);
  }

  /** To every admitted player but the sender; a player's laser also into the GM's view while the scene is live. */
  private relay(from: string, points: ScenePoint[], lifted: boolean, sender: string | null): void {
    const scene = this.options.projection.currentProjection();
    if (!scene) return;
    const { session, presented } = this.options;
    const players = session.getPlayers();
    for (const player of players) {
      if (player.status !== 'admitted' || player.playerId === sender) continue;
      session.send(player.playerId, { v: 1, type: 'laser', from, sceneId: scene.sceneId, points, lifted });
    }
    if (sender === null || !this.live || presented.isHeld()) return;
    const order = players.filter((player) => player.status !== 'pending').map((player) => player.playerId);
    this.live.laser()?.showRemote({ from, color: laserColor(from, order), points, lifted });
  }
}
