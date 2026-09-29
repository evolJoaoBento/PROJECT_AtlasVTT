/**
 * The player's side of an online session: join a GM, wait for approval, keep
 * the player list, and reconnect after a drop. Shared with the web player page,
 * so it imports nothing from Obsidian.
 */
import { decodeControl, encodeControl, type PresencePlayer } from './protocol';
import type { ClientTransport, PeerLink } from './transport/types';

export type PlayerStatus = 'connecting' | 'waiting' | 'admitted' | 'denied' | 'lost';

export interface PlayerSessionState {
  status: PlayerStatus;
  playerId: string | null;
  title: string | null;
  players: PresencePlayer[];
  /** Why the session is denied or lost: a deny reason, `ended` or `unreachable`. */
  reason: string | null;
}

export const RECONNECT_DELAYS_MS = [1000, 2000, 4000, 8000, 15000] as const;
export const RECONNECT_GIVE_UP_MS = 300_000;

export interface PlayerSessionOptions {
  hostId: string;
  name: string;
  playerKey: string;
  clientVersion: string;
  transport: ClientTransport;
  onChange(state: PlayerSessionState): void;
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

  constructor(private readonly options: PlayerSessionOptions) {}

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
    link.onMessage((channel, data) => { if (channel === 'control') this.receive(link, data); });
    link.onClose(() => { if (this.link === link) { this.link = null; this.dropped(); } });
    link.send('control', encodeControl({
      v: 1, type: 'join', name: this.options.name, playerKey: this.options.playerKey,
      client: { kind: 'web', version: this.options.clientVersion },
    }));
    if (!this.wasAdmitted && this.state.status === 'connecting') this.update({ status: 'waiting' });
  }

  private receive(link: PeerLink, data: unknown): void {
    if (this.finished || this.link !== link) return;
    const decoded = decodeControl(data);
    if (decoded.kind !== 'message') return;
    const message = decoded.message;
    switch (message.type) {
      case 'admitted':
        this.wasAdmitted = true;
        this.attempt = 0;
        this.update({ status: 'admitted', playerId: message.playerId, title: message.session.title, reason: null });
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
      this.finish('lost', 'unreachable');
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
    this.update({ status, reason });
  }

  private update(partial: Partial<PlayerSessionState>): void {
    this.state = { ...this.state, ...partial };
    this.options.onChange(this.state);
  }
}
