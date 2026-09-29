/**
 * How the online sessions reach each other. The sessions only know these
 * interfaces; PeerJS (PeerTransport) and tests (MemoryTransport) provide them.
 */
export type Channel = 'control' | 'assets';
export type Unsubscribe = () => void;

export interface TransportError {
  /** `unavailable-id`, `unreachable`, `network`, `server-error`, `timeout`, … */
  code: string;
  message: string;
}

/** One player's connection, both channels. */
export interface PeerLink {
  readonly remoteId: string;
  /** Sending on a closed link does nothing. */
  send(channel: Channel, data: string | ArrayBuffer): void;
  onMessage(cb: (channel: Channel, data: unknown) => void): Unsubscribe;
  /** Called once, when either end closes. */
  onClose(cb: () => void): Unsubscribe;
  close(): void;
}

export interface HostTransport {
  readonly id: string;
  onConnection(cb: (link: PeerLink) => void): Unsubscribe;
  onError(cb: (error: TransportError) => void): Unsubscribe;
  close(): void;
}

export interface ClientTransport {
  /** Must settle (resolve or reject) within a bounded time; PlayerSession relies on it for its give-up. */
  connect(hostId: string): Promise<PeerLink>;
}
