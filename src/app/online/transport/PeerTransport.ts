import { Peer, type DataConnection, type PeerOptions } from 'peerjs';
import { randomId } from '../ids';
import type { Channel, ClientTransport, HostTransport, PeerLink, TransportError, Unsubscribe } from './types';

export interface PeerServerOptions {
  host?: string;
  port?: number;
  path?: string;
  key?: string;
  secure?: boolean;
  iceServers: RTCIceServer[];
}

export const LINK_OPEN_TIMEOUT_MS = 15_000;

function peerOptions(options: PeerServerOptions): PeerOptions {
  const { iceServers, ...server } = options;
  return { ...server, config: { iceServers } };
}

/** A TransportError that is also a real Error, so it can be a promise rejection reason. */
class TransportFailure extends Error implements TransportError {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'TransportFailure';
  }
}

function asError(error: unknown): TransportFailure {
  const e = error as { type?: string; message?: string } | undefined;
  return new TransportFailure(e?.type ?? 'network', e?.message ?? String(error));
}

/** A player's two data connections as one link. */
class PeerJsLink implements PeerLink {
  private closed = false;
  private readonly closeListeners = new Set<() => void>();

  constructor(readonly remoteId: string, private readonly channels: Record<Channel, DataConnection>, private readonly onClosed: () => void) {
    for (const connection of Object.values(channels)) {
      connection.on('close', () => this.close());
      connection.on('error', () => this.close());
    }
  }

  send(channel: Channel, data: string | ArrayBuffer): void {
    if (!this.closed) void this.channels[channel].send(data);
  }

  onMessage(cb: (channel: Channel, data: unknown) => void): Unsubscribe {
    let active = true;
    (Object.keys(this.channels) as Channel[]).forEach((channel) => {
      this.channels[channel].on('data', (data: unknown) => { if (active) cb(channel, data); });
    });
    return () => { active = false; };
  }

  onClose(cb: () => void): Unsubscribe {
    this.closeListeners.add(cb);
    return () => this.closeListeners.delete(cb);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    Object.values(this.channels).forEach((connection) => connection.close());
    this.closeListeners.forEach((cb) => cb());
    this.closeListeners.clear();
    this.onClosed();
  }
}

/**
 * Hosts a session under a fresh id. A taken id is retried once with another;
 * any other failure before the id opens rejects.
 */
export async function createPeerHost(options: PeerServerOptions): Promise<HostTransport> {
  try {
    return await openHost(options);
  } catch (error) {
    if ((error as TransportError).code === 'unavailable-id') return openHost(options);
    throw error;
  }
}

/** The connections a player has opened so far, until both channels are up. */
interface HalfLink {
  all: DataConnection[];
  open: Partial<Record<Channel, DataConnection>>;
  timer: number;
}

function openHost(options: PeerServerOptions): Promise<HostTransport> {
  return new Promise((resolve, reject) => {
    const id = randomId();
    const peer = new Peer(id, peerOptions(options));
    const connectionListeners = new Set<(link: PeerLink) => void>();
    const errorListeners = new Set<(error: TransportError) => void>();
    const halves = new Map<string, HalfLink>();
    let open = false;
    let closed = false;

    const dropHalf = (linkId: string): void => {
      const half = halves.get(linkId);
      if (!half) return;
      halves.delete(linkId);
      window.clearTimeout(half.timer);
      half.all.forEach((connection) => connection.close());
    };

    peer.on('open', () => {
      open = true;
      resolve({
        id,
        onConnection: (cb) => { connectionListeners.add(cb); return () => connectionListeners.delete(cb); },
        onError: (cb) => { errorListeners.add(cb); return () => errorListeners.delete(cb); },
        close: () => {
          closed = true;
          [...halves.keys()].forEach(dropHalf);
          peer.destroy();
        },
      });
    });

    peer.on('error', (error: unknown) => {
      const failure = asError(error);
      if (!open) {
        peer.destroy();
        reject(failure);
      } else {
        errorListeners.forEach((cb) => cb(failure));
      }
    });

    // Signaling dropped while hosting: established links keep working; get back on.
    peer.on('disconnected', () => {
      if (open && !closed && !peer.destroyed) peer.reconnect();
    });

    peer.on('connection', (connection: DataConnection) => {
      const linkId = (connection.metadata as { linkId?: unknown } | undefined)?.linkId;
      const label = connection.label;
      if (closed || typeof linkId !== 'string' || (label !== 'control' && label !== 'assets')) {
        connection.close();
        return;
      }
      let half = halves.get(linkId);
      if (!half) {
        half = { all: [], open: {}, timer: window.setTimeout(() => dropHalf(linkId), LINK_OPEN_TIMEOUT_MS) };
        halves.set(linkId, half);
      }
      const pair = half;
      pair.all.push(connection);
      connection.on('close', () => { if (halves.get(linkId) === pair) dropHalf(linkId); });
      connection.on('open', () => {
        if (halves.get(linkId) !== pair) return;
        pair.open[label] = connection;
        const { control, assets } = pair.open;
        if (!control || !assets) return;
        window.clearTimeout(pair.timer);
        halves.delete(linkId);
        const link = new PeerJsLink(connection.peer, { control, assets }, () => {});
        connectionListeners.forEach((cb) => cb(link));
      });
    });
  });
}

/** Joins hosts through PeerJS; each link has its own peer, destroyed when the link closes. */
export function createPeerClient(options: PeerServerOptions): ClientTransport {
  return {
    connect: (hostId: string): Promise<PeerLink> => new Promise((resolve, reject) => {
      const peer = new Peer(peerOptions(options));
      const connections: DataConnection[] = [];
      let settled = false;
      const fail = (error: TransportFailure): void => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        connections.forEach((connection) => connection.close());
        peer.destroy();
        reject(error);
      };
      // Bounds every path: silent signaling server, or data connections that never open.
      const timer = window.setTimeout(() => fail(new TransportFailure('timeout', 'Timed out connecting to the GM')), LINK_OPEN_TIMEOUT_MS);
      peer.on('error', (error: unknown) => fail(asError(error)));
      peer.on('open', () => {
        if (settled) return;
        const metadata = { linkId: randomId(12) };
        const control = peer.connect(hostId, { label: 'control', metadata, reliable: true, serialization: 'raw' });
        const assets = peer.connect(hostId, { label: 'assets', metadata, reliable: true, serialization: 'raw' });
        connections.push(control, assets);
        let opened = 0;
        const onOpen = (): void => {
          if (settled || ++opened < 2) return;
          settled = true;
          window.clearTimeout(timer);
          resolve(new PeerJsLink(hostId, { control, assets }, () => peer.destroy()));
        };
        for (const connection of connections) {
          connection.on('open', onOpen);
          connection.on('close', () => fail(new TransportFailure('unreachable', 'The GM closed the connection')));
          connection.on('error', (error: unknown) => fail(asError(error)));
        }
      });
    }),
  };
}
