/**
 * The player's side of an online session: join a GM, wait for approval, keep
 * the player list, and reconnect after a drop. Shared with the web player page,
 * so it imports nothing from Obsidian.
 */
import { decodeControl, encodeControl, type PresencePlayer } from './protocol';
import { PlayerSceneMirror } from './scene/PlayerSceneMirror';
import type { PlayerScene } from './scene/sceneTypes';
import type { ClientTransport, PeerLink } from './transport/types';

export type PlayerStatus = 'connecting' | 'waiting' | 'admitted' | 'denied' | 'lost';

export interface PlayerSessionState {
  status: PlayerStatus;
  playerId: string | null;
  title: string | null;
  players: PresencePlayer[];
  /**
   * Why the session is denied or lost: a deny reason, `ended`, `replaced`,
   * `unreachable` (never got in) or `connection-lost` (was in, retrying gave up).
   */
  reason: string | null;
}

export const RECONNECT_DELAYS_MS = [1000, 2000, 4000, 8000, 15000] as const;
export const RECONNECT_GIVE_UP_MS = 300_000;

/** The image loader's view of the session: the session only passes assets-channel data through. */
export interface PlayerAssetHandler {
  /** Admitted on a link: `send` reaches the GM's assets channel on that link until `disconnected`. */
  connected(send: (data: string) => void): void;
  receive(data: unknown): void;
  disconnected(): void;
}

export interface PlayerSessionOptions {
  hostId: string;
  name: string;
  playerKey: string;
  clientVersion: string;
  transport: ClientTransport;
  onChange(state: PlayerSessionState): void;
  /** The presented scene changed: a snapshot or patch applied, or null when the GM shows none. */
  onScene?(scene: PlayerScene | null): void;
  /** Gets the assets channel while admitted (the join page's image loader). */
  assets?: PlayerAssetHandler;
}

export class PlayerSession {
  state: PlayerSessionState = { status: 'connecting', playerId: null, title: null, players: [], reason: null };
  private link: PeerLink | null = null;
  private started = false;
  private finished = false;
  private wasAdmitted = false;
  private attempt = 0;
  private droppedAt = 0;
  private retryTimer: number | null = null;
  private assetLink: PeerLink | null = null;

  private readonly mirror: PlayerSceneMirror;

  constructor(private readonly options: PlayerSessionOptions) {
    this.mirror = new PlayerSceneMirror({
      sendResync: (seq) => this.link?.send('control', encodeControl({ v: 1, type: 'scene-resync', seq })),
      onChange: (scene) => this.options.onScene?.(scene),
    });
  }

  /** The presented scene as this player has it; null while the GM shows none. */
  get scene(): PlayerScene | null {
    return this.mirror.scene;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.update({ status: 'connecting' });
    void this.connect();
  }

  stop(): void {
    this.finished = true;
    if (this.retryTimer !== null) window.clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.mirror.dispose();
    this.leaveAssets();
    this.link?.send('control', encodeControl({ v: 1, type: 'bye', reason: 'left' }));
    this.link?.close();
  }

  private async connect(): Promise<void> {
    let link: PeerLink;
    try {
      link = await this.options.transport.connect(this.options.hostId);
    } catch {
      this.dropped();
      return;
    }
    if (this.finished) {
      link.close();
      return;
    }
    this.link = link;
    link.onMessage((channel, data) => {
      if (channel === 'control') this.receive(link, data);
      else if (this.assetLink === link && !this.finished) this.options.assets?.receive(data);
    });
    link.onClose(() => {
      if (this.assetLink === link) this.leaveAssets();
      if (this.link === link) { this.link = null; this.dropped(); }
    });
    link.send('control', encodeControl({
      v: 1, type: 'join', name: this.options.name, playerKey: this.options.playerKey,
      client: { kind: 'web', version: this.options.clientVersion },
    }));
    if (!this.wasAdmitted && this.state.status === 'connecting') this.update({ status: 'waiting' });
  }

  private receive(link: PeerLink, data: unknown): void {
    if (this.finished || this.link !== link) return;
    const decoded = decodeControl(data);
    if (decoded.kind === 'invalid' && decoded.reason.startsWith('bad-scene-')) this.mirror.invalid();
    if (decoded.kind !== 'message') return;
    const message = decoded.message;
    switch (message.type) {
      case 'admitted':
        this.wasAdmitted = true;
        this.attempt = 0;
        this.update({ status: 'admitted', playerId: message.playerId, title: message.session.title, reason: null });
        this.assetLink = link;
        this.options.assets?.connected((data) => link.send('assets', data));
        break;
      case 'denied':
        this.finish('denied', message.reason);
        link.close();
        break;
      case 'presence':
        this.update({ players: message.players });
        break;
      case 'ping':
        link.send('control', encodeControl({ v: 1, type: 'pong', t: message.t }));
        break;
      case 'bye':
        // A newer tab of this player took over, or the GM ended the session.
        this.finish('lost', message.reason === 'replaced' ? 'replaced' : 'ended');
        link.close();
        break;
      case 'scene-snapshot':
      case 'scene-fog':
      case 'scene-drawings':
      case 'scene-patch':
      case 'scene-clear':
        this.mirror.receive(message);
        break;
      default:
        break;
    }
  }

  /** The link closed or could not be made: retry if we were in, else stop. */
  private dropped(): void {
    if (this.finished) return;
    if (!this.wasAdmitted) {
      this.finish('lost', 'unreachable');
      return;
    }
    if (this.attempt === 0) this.droppedAt = Date.now();
    if (Date.now() - this.droppedAt >= RECONNECT_GIVE_UP_MS) {
      this.finish('lost', 'connection-lost');
      return;
    }
    const delay = RECONNECT_DELAYS_MS[Math.min(this.attempt, RECONNECT_DELAYS_MS.length - 1)]!;
    this.attempt++;
    this.update({ status: 'connecting' });
    this.retryTimer = window.setTimeout(() => void this.connect(), delay);
  }

  private finish(status: 'denied' | 'lost', reason: string): void {
    this.finished = true;
    if (this.retryTimer !== null) window.clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.mirror.dispose();
    this.leaveAssets();
    this.update({ status, reason });
  }

  private leaveAssets(): void {
    if (!this.assetLink) return;
    this.assetLink = null;
    this.options.assets?.disconnected();
  }

  private update(partial: Partial<PlayerSessionState>): void {
    this.state = { ...this.state, ...partial };
    this.options.onChange(this.state);
  }
}
