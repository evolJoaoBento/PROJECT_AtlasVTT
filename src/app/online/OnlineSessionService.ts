import type { App } from 'obsidian';
import type { SettingsService } from '../services/SettingsService';
import { GmSession, type SessionPlayer } from './GmSession';
import { buildJoinUrl, parseJoinFragment } from './joinLink';
import { onlineSessionStore, resetOnlineSessionStore } from './onlineSessionStore';
import { peerServerOptions } from './onlineSettings';
import { createPeerHost, type PeerServerOptions } from './transport/PeerTransport';
import type { HostTransport, TransportError } from './transport/types';
import { showJoinRequestNotice } from './ui/joinRequestNotice';

const RELAY_TOO_LONG = 'Your relay (TURN) settings are too long for a join link — remove some.';

interface Deps {
  createHost?: (options: PeerServerOptions) => Promise<HostTransport>;
  showRequest?: (player: SessionPlayer, answer: (allow: boolean) => void) => { hide(): void };
}

/** Hosts one online session for the vault at a time; the UI reads `onlineSessionStore`. */
export class OnlineSessionService {
  private static instances = new WeakMap<App, OnlineSessionService>();
  static forApp(app: App): OnlineSessionService | undefined {
    return this.instances.get(app);
  }

  private current: GmSession | null = null;
  private generation = 0;
  private readonly notices = new Map<string, { hide(): void }>();
  private readonly createHost: (options: PeerServerOptions) => Promise<HostTransport>;
  private readonly showRequest: NonNullable<Deps['showRequest']>;

  constructor(private readonly app: App, private readonly settings: SettingsService, deps: Deps = {}) {
    this.createHost = deps.createHost ?? createPeerHost;
    this.showRequest = deps.showRequest ?? showJoinRequestNotice;
    OnlineSessionService.instances.set(app, this);
  }

  get session(): GmSession | null {
    return this.current;
  }

  async start(): Promise<void> {
    if (this.current || onlineSessionStore.getState().status === 'starting') return;
    onlineSessionStore.setState({ status: 'starting', error: null });
    const generation = ++this.generation;
    const online = this.settings.getOnlineSettings();
    let host: HostTransport;
    try {
      host = await this.createHost(peerServerOptions(online));
    } catch (error) {
      if (generation !== this.generation) return;
      onlineSessionStore.setState({ status: 'error', error: (error as TransportError).message ?? String(error) });
      return;
    }
    if (generation !== this.generation) {
      host.close();
      return;
    }
    const session = new GmSession(host, {
      title: this.app.vault.getName(),
      onJoinRequest: (player) => {
        this.notices.set(player.playerId, this.showRequest(player, (allow) => allow ? this.allow(player.playerId) : this.deny(player.playerId)));
      },
      onRequestClosed: (playerId) => {
        this.notices.get(playerId)?.hide();
        this.notices.delete(playerId);
      },
      onPlayersChanged: (players) => onlineSessionStore.setState({ players, error: null }),
    });
    // Signaling hiccups while hosting are not fatal: keep hosting, show the note.
    host.onError((error) => onlineSessionStore.setState({ error: error.message }));
    session.start();
    this.current = session;
    const joinUrl = buildJoinUrl(online.playerPageUrl, host.id, online);
    const linkWorks = parseJoinFragment(new URL(joinUrl).hash) !== null;
    onlineSessionStore.setState({
      status: 'hosting', peerId: host.id, joinUrl, error: linkWorks ? null : RELAY_TOO_LONG,
    });
  }

  stop(): void {
    this.generation++;
    this.current?.stop();
    this.current = null;
    this.notices.forEach((notice) => notice.hide());
    this.notices.clear();
    resetOnlineSessionStore();
  }

  allow(playerId: string): void { this.current?.allow(playerId); }
  deny(playerId: string): void { this.current?.deny(playerId); }
  kick(playerId: string): void { this.current?.kick(playerId); }
}
