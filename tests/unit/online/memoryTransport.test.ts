import { describe, expect, it } from 'vitest';
import { MemoryNetwork } from '../../../src/app/online/transport/MemoryTransport';
import type { PeerLink } from '../../../src/app/online/transport/types';

describe('MemoryTransport', () => {
  it('links a client to a host and carries messages both ways on both channels', async () => {
    const network = new MemoryNetwork();
    const host = network.host('gm');
    const hostLinks: PeerLink[] = [];
    host.onConnection((link) => hostLinks.push(link));

    const client = await network.client().connect('gm');
    expect(hostLinks).toHaveLength(1);

    const atHost: Array<[string, unknown]> = [];
    const atClient: Array<[string, unknown]> = [];
    hostLinks[0]!.onMessage((channel, data) => atHost.push([channel, data]));
    client.onMessage((channel, data) => atClient.push([channel, data]));

    client.send('control', 'hello');
    hostLinks[0]!.send('assets', new ArrayBuffer(4));
    expect(atHost).toEqual([['control', 'hello']]);
    expect(atClient[0]![0]).toBe('assets');
    expect(atClient[0]![1]).toBeInstanceOf(ArrayBuffer);
  });

  it('closes both ends once when client closes', async () => {
    const network = new MemoryNetwork();
    const host = network.host('gm');
    let hostLink: PeerLink | undefined;
    host.onConnection((link) => { hostLink = link; });
    const client = await network.client().connect('gm');
    let hostCloses = 0;
    let clientCloses = 0;
    hostLink!.onClose(() => hostCloses++);
    client.onClose(() => clientCloses++);
    client.close();
    client.close();
    expect(hostCloses).toBe(1);
    expect(clientCloses).toBe(1);
    expect(() => client.send('control', 'late')).not.toThrow();
  });

  it('closes both ends once when host closes', async () => {
    const network = new MemoryNetwork();
    const host = network.host('gm');
    let hostLink: PeerLink | undefined;
    host.onConnection((link) => { hostLink = link; });
    const client = await network.client().connect('gm');
    let hostCloses = 0;
    let clientCloses = 0;
    hostLink!.onClose(() => hostCloses++);
    client.onClose(() => clientCloses++);
    host.close();
    expect(hostCloses).toBe(1);
    expect(clientCloses).toBe(1);
    expect(() => client.send('control', 'late')).not.toThrow();
  });

  it('far end receives nothing after close', async () => {
    const network = new MemoryNetwork();
    const host = network.host('gm');
    let hostLink: PeerLink | undefined;
    host.onConnection((link) => { hostLink = link; });
    const client = await network.client().connect('gm');
    const messagesAtClient: Array<[string, unknown]> = [];
    client.onMessage((channel, data) => messagesAtClient.push([channel, data]));
    hostLink!.close();
    hostLink!.send('control', 'should-not-arrive');
    expect(messagesAtClient).toHaveLength(0);
  });

  it('refuses an unknown or closed host', async () => {
    const network = new MemoryNetwork();
    await expect(network.client().connect('nobody')).rejects.toMatchObject({ code: 'unreachable' });
    const host = network.host('gm');
    host.close();
    await expect(network.client().connect('gm')).rejects.toMatchObject({ code: 'unreachable' });
  });
});
