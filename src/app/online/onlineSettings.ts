import type { PeerServerOptions } from './transport/peerOptions';

export interface TurnServer {
  urls: string;
  username: string;
  credential: string;
}

export interface OnlineSettings {
  signaling: { mode: 'cloud' | 'custom'; host: string; port: number; path: string; key: string; secure: boolean };
  turnServers: TurnServer[];
  /** Where join links point: the published `online-client/` page. */
  playerPageUrl: string;
}

export const DEFAULT_STUN = 'stun:stun.l.google.com:19302';

export const DEFAULT_ONLINE_SETTINGS: OnlineSettings = {
  signaling: { mode: 'cloud', host: '', port: 443, path: '/', key: 'peerjs', secure: true },
  turnServers: [],
  playerPageUrl: 'https://evoljoaobento.github.io/atlas-vtt/',
};

/** PeerJS options for these settings: the PeerJS cloud unless a custom server is set. */
export function peerServerOptions(settings: OnlineSettings): PeerServerOptions {
  const iceServers: RTCIceServer[] = [{ urls: DEFAULT_STUN }, ...settings.turnServers.map((server) => ({ ...server }))];
  if (settings.signaling.mode !== 'custom' || !settings.signaling.host) return { iceServers };
  const { host, port, path, key, secure } = settings.signaling;
  return { host, port, path, key, secure, iceServers };
}

/** One relay per line: `turn:host:port username credential`. */
export function parseTurnServers(text: string): TurnServer[] {
  return text.split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => line.split(/\s+/))
    .filter(([urls]) => /^turns?:/.test(urls ?? ''))
    .map(([urls = '', username = '', credential = '']) => ({ urls, username, credential }));
}

export function formatTurnServers(servers: TurnServer[]): string {
  return servers.map((server) => `${server.urls} ${server.username} ${server.credential}`).join('\n');
}
