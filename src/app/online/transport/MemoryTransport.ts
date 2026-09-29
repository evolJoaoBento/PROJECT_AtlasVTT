import type { Channel, ClientTransport, HostTransport, PeerLink, TransportError, Unsubscribe } from './types';

type Listener<T extends unknown[]> = (...args: T) => void;

function listeners<T extends unknown[]>(): { add(cb: Listener<T>): Unsubscribe; emit(...args: T): void; clear(): void } {
  const set = new Set<Listener<T>>();
  return {
    add: (cb) => { set.add(cb); return () => set.delete(cb); },
    emit: (...args) => { for (const cb of [...set]) cb(...args); },
    clear: () => set.clear(),
  };
}

/** One end of an in-memory link; `peer` is the other end. */
class MemoryLink implements PeerLink {
  peer!: MemoryLink;
  private closed = false;
  private readonly messages = listeners<[Channel, unknown]>();
  private readonly closes = listeners<[]>();

  constructor(readonly remoteId: string) {}

  send(channel: Channel, data: string | ArrayBuffer): void {
    if (this.closed) return;
    this.peer.messages.emit(channel, data);
  }
  onMessage(cb: (channel: Channel, data: unknown) => void): Unsubscribe { return this.messages.add(cb); }
  onClose(cb: () => void): Unsubscribe { return this.closes.add(cb); }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.peer.close();
    this.closes.emit();
    this.messages.clear();
    this.closes.clear();
  }
}

class MemoryHost implements HostTransport {
  closed = false;
  private readonly hostSideLinks: MemoryLink[] = [];
  readonly connections = listeners<[PeerLink]>();
  private readonly errors = listeners<[TransportError]>();
  constructor(readonly id: string, private readonly remove: () => void) {}
  onConnection(cb: (link: PeerLink) => void): Unsubscribe { return this.connections.add(cb); }
  onError(cb: (error: TransportError) => void): Unsubscribe { return this.errors.add(cb); }
  fail(error: TransportError): void { this.errors.emit(error); }
  registerLink(link: MemoryLink): void { this.hostSideLinks.push(link); }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const link of this.hostSideLinks) {
      link.close();
    }
    this.remove();
  }
}

/** Hosts and clients in one process, for tests. */
export class MemoryNetwork {
  private readonly hosts = new Map<string, MemoryHost>();
  private clients = 0;
  private nextHostId = 1;

  host(id?: string): MemoryHost {
    const hostId = id ?? `host-${this.nextHostId++}`;
    const host = new MemoryHost(hostId, () => {
      if (this.hosts.get(hostId) === host) {
        this.hosts.delete(hostId);
      }
    });
    this.hosts.set(hostId, host);
    return host;
  }

  client(): ClientTransport {
    return {
      connect: async (hostId: string): Promise<PeerLink> => {
        const host = this.hosts.get(hostId);
        if (!host || host.closed) {
          const error: TransportError = { code: 'unreachable', message: `No host ${hostId}` };
          throw Object.assign(new Error(error.message), error);
        }
        const clientEnd = new MemoryLink(hostId);
        const hostEnd = new MemoryLink(`client-${++this.clients}`);
        clientEnd.peer = hostEnd;
        hostEnd.peer = clientEnd;
        // The host sees the link before the client can subscribe, which is safe because the GM session
        // sends nothing until the player's join arrives.
        host.registerLink(hostEnd);
        host.connections.emit(hostEnd);
        return clientEnd;
      },
    };
  }
}
