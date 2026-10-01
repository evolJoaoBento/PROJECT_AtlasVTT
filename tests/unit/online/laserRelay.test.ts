import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeControl } from '../../../src/app/online/protocol';
import type { PlayerLaser } from '../../../src/app/online/tools/toolMessages';
import { LASER_COLOR_SWATCHES } from '../../../src/app/tools/laserPointerSettings';
import { toolsWorld } from './toolsFixtures';

describe('LaserRelay', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("brings a player's laser to the other players and the GM's view, never back to its sender", async () => {
    const w = toolsWorld();
    w.present();
    const heard: PlayerLaser[] = [];
    const a = await w.join('A');
    const b = await w.join('B', { onLaser: (laser) => heard.push(laser) });
    expect(a.session.sendLaser([{ x: 10, y: 20 }], false)).toBe(true);
    expect(heard).toEqual([{ from: a.playerId, sceneId: w.sceneId(), points: [{ x: 10, y: 20 }], lifted: false }]);
    expect(w.lasersOf(a)).toEqual([]);
    expect(w.shown).toEqual([{ from: a.playerId, color: LASER_COLOR_SWATCHES[1].value, points: [{ x: 10, y: 20 }], lifted: false }]);
    w.finish();
  });

  it("sends the GM's own laser to every player while the scene is live, and lets it go when the scene is held", async () => {
    const w = toolsWorld();
    w.present();
    const a = await w.join('A');
    w.hub.emitLocal({ kind: 'point', x: 1, y: 2 });
    expect(w.lasersOf(a).at(-1)).toEqual({ v: 1, type: 'laser', from: 'gm', sceneId: w.sceneId(), points: [{ x: 1, y: 2 }], lifted: false });
    w.tabs.getState().setActiveTab(w.dungeon);
    await vi.advanceTimersByTimeAsync(100);
    expect(w.lasersOf(a).at(-1)).toMatchObject({ from: 'gm', points: [], lifted: true });
    const count = w.lasersOf(a).length;
    w.hub.emitLocal({ kind: 'point', x: 5, y: 5 });
    await vi.advanceTimersByTimeAsync(600);
    expect(w.lasersOf(a)).toHaveLength(count);
    w.finish();
  });

  it("relays a player's laser on the held scene to players, but shows none on the GM's other map", async () => {
    const w = toolsWorld();
    w.present();
    const a = await w.join('A');
    const b = await w.join('B');
    w.tabs.getState().setActiveTab(w.dungeon);
    a.session.sendLaser([{ x: 3, y: 4 }], false);
    expect(w.lasersOf(b).at(-1)).toMatchObject({ from: a.playerId, points: [{ x: 3, y: 4 }] });
    expect(w.shown).toEqual([]);
    w.finish();
  });

  it("ignores a laser for another scene and a player's claim to be the GM", async () => {
    const w = toolsWorld();
    w.present();
    const a = await w.join('A');
    const b = await w.join('B');
    a.sendRaw(encodeControl({ v: 1, type: 'laser', sceneId: 'elsewhere', points: [{ x: 1, y: 1 }], lifted: false }));
    a.sendRaw(encodeControl({ v: 1, type: 'laser', from: 'gm', sceneId: w.sceneId(), points: [{ x: 1, y: 1 }], lifted: false }));
    expect(w.lasersOf(b).map((laser) => laser.from)).toEqual([a.playerId]);
    w.finish();
  });

  it('ignores more than 20 lasers a second from one player', async () => {
    const w = toolsWorld();
    w.present();
    const a = await w.join('A');
    const b = await w.join('B');
    for (let i = 0; i < 25; i++) a.session.sendLaser([{ x: i, y: 0 }], false);
    expect(w.lasersOf(b)).toHaveLength(20);
    w.finish();
  });

  it("lets a leaving player's laser go for everyone", async () => {
    const w = toolsWorld();
    w.present();
    const a = await w.join('A');
    const b = await w.join('B');
    const c = await w.join('C');
    a.session.sendLaser([{ x: 1, y: 1 }], false);
    a.session.stop();
    await vi.advanceTimersByTimeAsync(0);
    expect(w.lasersOf(b).at(-1)).toEqual({ v: 1, type: 'laser', from: a.playerId, sceneId: w.sceneId(), points: [], lifted: true });
    expect(w.shown.at(-1)).toMatchObject({ from: a.playerId, lifted: true });
    // Removed by the GM mid-stroke: the session's player list no longer has them.
    c.session.sendLaser([{ x: 2, y: 2 }], false);
    w.lasers.playersChanged(w.gm.getPlayers().filter((player) => player.playerId !== c.playerId));
    expect(w.lasersOf(b).at(-1)).toMatchObject({ from: c.playerId, lifted: true });
    w.finish();
  });
});
