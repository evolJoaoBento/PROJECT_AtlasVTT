/**
 * Join links: `<page>#id=<gm id>[&signal=...][&ice=...]`. Everything sits in the
 * fragment, which browsers never send to the page's host. Shared with the web
 * player page, so it imports no Obsidian code.
 */
import { DEFAULT_STUN, peerServerOptions, type OnlineSettings } from './onlineSettings';
import type { PeerServerOptions } from './transport/peerOptions';

export interface JoinTarget {
  hostId: string;
  server: PeerServerOptions;
}

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

function toBase64Url(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): unknown {
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0))));
}

export function buildJoinUrl(pageUrl: string, hostId: string, settings: OnlineSettings): string {
  const base = pageUrl.split('#')[0];
  const { iceServers, ...server } = peerServerOptions(settings);
  const params = [`id=${hostId}`];
  if (Object.keys(server).length) params.push(`signal=${toBase64Url(server)}`);
  const relays = iceServers.filter((ice) => ice.urls !== DEFAULT_STUN);
  if (relays.length) params.push(`ice=${toBase64Url(relays)}`);
  return `${base}#${params.join('&')}`;
}

/** The GM and servers a join link names; null for an incomplete or broken link. */
export function parseJoinFragment(hash: string): JoinTarget | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const hostId = params.get('id') ?? '';
  if (!ID_PATTERN.test(hostId)) return null;
  try {
    const signal = params.get('signal');
    const ice = params.get('ice');
    const server = signal ? fromBase64Url(signal) as Omit<PeerServerOptions, 'iceServers'> : {};
    const relays = ice ? fromBase64Url(ice) as RTCIceServer[] : [];
    if (typeof server !== 'object' || server === null || !Array.isArray(relays)) return null;
    return { hostId, server: { ...server, iceServers: [{ urls: DEFAULT_STUN }, ...relays] } };
  } catch {
    return null;
  }
}
