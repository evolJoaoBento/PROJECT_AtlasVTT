import { describe, expect, it } from 'vitest';
import { createOnlineLog, loggedSession, logPresentedScene } from '../../../src/app/online/onlineLog';
import type { ControlMessage } from '../../../src/app/online/protocol';
import { PresentedScene } from '../../../src/app/services/PresentedScene';
import { viewWithViewport } from './cameraFixtures';

function recorder(enabled: () => boolean = () => true) {
  const lines: unknown[][] = [];
  return { lines, log: createOnlineLog(enabled, (...parts) => { lines.push(parts); }) };
}

describe('online log', () => {
  it('writes nothing while the setting is off, and reads the setting on every event', () => {
    let on = false;
    const { lines, log } = recorder(() => on);
    log.event('a');
    on = true;
    log.event('b', { n: 1 });
    on = false;
    log.event('c');
    expect(lines).toEqual([['[Atlas online]', 'b', { n: 1 }]]);
  });

  it('logs every message sent to players, with the caller of a scene-clear', () => {
    const { lines, log } = recorder();
    const sent: Array<[string, ControlMessage]> = [];
    const session = loggedSession({
      use: () => () => {}, getPlayers: () => [], send: (playerId, message) => { sent.push([playerId, message]); },
    }, log);
    session.send('p1', { v: 1, type: 'scene-clear', seq: 4 });
    session.send('p1', { v: 1, type: 'scene-camera', sceneId: 's', centerX: 1, centerY: 2, width: 3, height: 4 });
    expect(sent).toHaveLength(2);
    expect(lines[0]).toEqual(['[Atlas online]', 'send scene-clear', { playerId: 'p1', seq: 4, stack: expect.any(String) }]);
    expect(lines[1]).toEqual(['[Atlas online]', 'send scene-camera', { playerId: 'p1', sceneId: 's', centerX: 1, centerY: 2, width: 3, height: 4 }]);
  });

  it("logs the presented scene's events and its view's tab changes", () => {
    const { lines, log } = recorder();
    const presented = new PresentedScene();
    const stop = logPresentedScene(presented, log);
    const { view, tabs, tavern, dungeon } = viewWithViewport(null);
    presented.present(view, tavern);
    tabs.getState().setActiveTab(dungeon);
    tabs.getState().removeTab(tavern);
    expect(lines.map((line) => line[1])).toEqual(['presented', 'held', 'tabs changed', 'cleared']);
    expect(lines[0]?.[2]).toMatchObject({ presentation: 1, tab: tavern, resumed: false, stack: expect.any(String) });
    expect(lines[2]?.[2]).toMatchObject({ presentation: 1, activeTab: dungeon, presentedTabExists: true, tabs: 2 });
    expect(lines[3]?.[2]).toMatchObject({ presentation: 1, tab: tavern, stack: expect.any(String) });
    stop();
    presented.present(view, dungeon);
    expect(lines).toHaveLength(4);
  });
});
