import { afterEach, describe, expect, it, vi } from 'vitest';

type Handler = (...args: unknown[]) => void;

/** Just enough of PeerJS to drive the transport. */
class FakeEmitter {
  handlers = new Map<string, Handler[]>();
  on(event: string, handler: Handler): this { this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]); return this; }
  emit(event: string, ...args: unknown[]): void { (this.handlers.get(event) ?? []).forEach((h) => h(...args)); }
}

class FakeConnection extends FakeEmitter {
  sent: unknown[] = [];
  closed = false;
  constructor(public peer: string, public label: string, public metadata: unknown) { super(); }
  send(data: unknown): void { this.sent.push(data); }
  close(): void { if (!this.closed) { this.closed = true; this.emit('close'); } }
}

const peers: FakePeer[] = [];
class FakePeer extends FakeEmitter {
  destroyed = false;
  reconnects = 0;
  connections: FakeConnection[] = [];
  constructor(public id: string | undefined, public options: unknown) { super(); peers.push(this); }
  connect(peer: string, options: { label: string; metadata: unknown }): FakeConnection {
    const connection = new FakeConnection(peer, options.label, options.metadata);
    this.connections.push(connection);
    return connection;
  }
  reconnect(): void { if (this.destroyed) throw new Error('destroyed'); this.reconnects++; }
  destroy(): void { this.destroyed = true; }
}

vi.mock('peerjs', () => ({ Peer: FakePeer }));

const { createPeerHost, createPeerClient, LINK_OPEN_TIMEOUT_MS } = await import('../../../src/app/online/transport/PeerTransport');

afterEach(() => { peers.length = 0; vi.useRealTimers(); });

describe('PeerTransport', () => {
  it('opens a host with a 128-bit id and pairs the two connections of a player', async () => {
    const pending = createPeerHost({ iceServers: [] });
    const peer = peers[0]!;
    expect(peer.id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    peer.emit('open', peer.id);
    const host = await pending;

    const links: Array<{ remoteId: string }> = [];
    host.onConnection((link) => links.push(link));
    const control = new FakeConnection('p1', 'control', { linkId: 'L1' });
    const assets = new FakeConnection('p1', 'assets', { linkId: 'L1' });
    peer.emit('connection', control);
    peer.emit('connection', assets);
    control.emit('open');
    expect(links).toHaveLength(0);
    assets.emit('open');
    expect(links).toHaveLength(1);
    expect(links[0]!.remoteId).toBe('p1');
  });

  it('retries once with a new id when the id is taken', async () => {
    const pending = createPeerHost({ iceServers: [] });
    peers[0]!.emit('error', { type: 'unavailable-id', message: 'taken' });
    await vi.waitFor(() => expect(peers).toHaveLength(2)); // the retry starts after the first rejection settles
    const second = peers[1]!;
    expect(second.id).not.toBe(peers[0]!.id);
    second.emit('open', second.id);
    await expect(pending).resolves.toMatchObject({ id: second.id });
  });

  it('reports a signaling failure', async () => {
    const pending = createPeerHost({ iceServers: [] });
    peers[0]!.emit('error', { type: 'server-error', message: 'Could not get an ID from the server.' });
    await expect(pending).rejects.toMatchObject({ code: 'server-error', message: 'Could not get an ID from the server.' });
  });

  it('connects a client with both channels and closes both together', async () => {
    const client = createPeerClient({ iceServers: [] });
    const pending = client.connect('gm-id');
    const peer = peers[0]!;
    peer.emit('open', 'me');
    const [control, assets] = peer.connections;
    expect(control!.label).toBe('control');
    expect(assets!.label).toBe('assets');
    expect(control!.metadata).toEqual(assets!.metadata);
    control!.emit('open');
    assets!.emit('open');
    const link = await pending;
    const received: unknown[] = [];
    link.onMessage((channel, data) => received.push([channel, data]));
    assets!.emit('data', 'chunk');
    expect(received).toEqual([['assets', 'chunk']]);
    let closed = 0;
    link.onClose(() => closed++);
    control!.close();
    expect(assets!.closed).toBe(true);
    expect(closed).toBe(1);
    expect(peer.destroyed).toBe(true);
  });

  it('rejects a client whose data connections never open', async () => {
    vi.useFakeTimers();
    const pending = createPeerClient({ iceServers: [] }).connect('gm-id');
    const outcome = expect(pending).rejects.toMatchObject({ code: 'timeout' });
    const peer = peers[0]!;
    peer.emit('open', 'me');
    await vi.advanceTimersByTimeAsync(LINK_OPEN_TIMEOUT_MS);
    await outcome;
    expect(peer.destroyed).toBe(true);
    expect(peer.connections.every((c) => c.closed)).toBe(true);
  });

  it('rejects a client when the signaling server never answers', async () => {
    vi.useFakeTimers();
    const pending = createPeerClient({ iceServers: [] }).connect('gm-id');
    const outcome = expect(pending).rejects.toMatchObject({ code: 'timeout' });
    await vi.advanceTimersByTimeAsync(LINK_OPEN_TIMEOUT_MS);
    await outcome;
    expect(peers[0]!.destroyed).toBe(true);
  });

  it('drops a half-paired player after the open timeout', async () => {
    vi.useFakeTimers();
    const pending = createPeerHost({ iceServers: [] });
    const peer = peers[0]!;
    peer.emit('open', peer.id);
    const host = await pending;
    const links: unknown[] = [];
    host.onConnection((link) => links.push(link));
    const control = new FakeConnection('p1', 'control', { linkId: 'L1' });
    const assets = new FakeConnection('p1', 'assets', { linkId: 'L1' });
    peer.emit('connection', control);
    peer.emit('connection', assets);
    control.emit('open');
    await vi.advanceTimersByTimeAsync(LINK_OPEN_TIMEOUT_MS);
    expect(control.closed).toBe(true);
    expect(assets.closed).toBe(true);
    assets.emit('open');
    expect(links).toHaveLength(0);
  });

  it('reconnects signaling while hosting but never after close', async () => {
    const pending = createPeerHost({ iceServers: [] });
    const peer = peers[0]!;
    peer.emit('open', peer.id);
    const host = await pending;
    peer.emit('disconnected');
    expect(peer.reconnects).toBe(1);
    host.close();
    expect(() => peer.emit('disconnected')).not.toThrow();
    expect(peer.reconnects).toBe(1);
  });
});
