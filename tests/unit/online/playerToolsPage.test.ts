import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MapView } from '../../../online-client/mapView.mts';
import { fakeFrames, RecordingSurface } from './recordingSurface';
import { toolsWorld } from './toolsFixtures';
import type { MovePlayer } from './tokenMoveFixtures';

function pointer(target: EventTarget, type: string, x: number, y: number): void {
  const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 });
  Object.defineProperties(event, { pointerId: { value: 1 }, pointerType: { value: 'mouse' } });
  target.dispatchEvent(event);
}

/** What `main.mts` does for the tools: a `MapView` whose laser goes through a real `PlayerSession` to the GM. */
async function page() {
  document.body.innerHTML = [
    '<section><canvas id="map"></canvas>',
    '<div id="view-buttons" hidden><button id="follow-gm" type="button">Follow GM</button>',
    '<button id="fit-map" type="button">Fit map</button></div>',
    '<p id="move-notice" hidden></p></section>',
  ].join('');
  const element = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
  const canvas = element<HTMLCanvasElement>('map');
  Object.defineProperties(canvas, { clientWidth: { value: 800 }, clientHeight: { value: 600 } });
  const w = toolsWorld();
  let player: MovePlayer | null = null;
  const view = new MapView({
    canvas, surface: new RecordingSurface(), images: () => null, frames: fakeFrames(), isHidden: () => false,
    viewButtons: element('view-buttons'), followButton: element('follow-gm'), fitButton: element('fit-map'),
    sendMove: (tokenId, x, y) => player?.session.sendTokenMove(tokenId, x, y) ?? false,
    sendLaser: (points, lifted) => player?.session.sendLaser(points, lifted) ?? false,
    notice: element('move-notice'),
  });
  w.present();
  const seen: string[] = [];
  player = await w.join('A', {
    onChange: (state) => {
      view.setConnected(state.status === 'admitted');
      view.setPlayers(state.players.map((entry) => entry.playerId), state.playerId);
    },
    onScene: (scene) => view.setScene(scene),
    onLaser: (laser) => view.receiveLaser(laser),
  });
  const other = await w.join('B');
  w.gm.use({ onMessage: (_player, message) => { seen.push(message.type); } });
  return { w, view, canvas, seen, player, other };
}

describe('the player tools on the join page', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('never sends a measurement, and sends the laser to the other players until it is let go', async () => {
    const { w, view, canvas, seen, player, other } = await page();
    view.selectTool('measure');
    pointer(canvas, 'pointerdown', 300, 300);
    pointer(canvas, 'pointermove', 400, 300);
    pointer(canvas, 'pointerup', 400, 300);
    expect(seen).toEqual([]);
    view.selectTool('laser');
    pointer(canvas, 'pointerdown', 300, 300);
    pointer(canvas, 'pointermove', 400, 300);
    pointer(canvas, 'pointerup', 400, 300);
    await vi.advanceTimersByTimeAsync(100);
    expect(new Set(seen)).toEqual(new Set(['laser']));
    const relayed = w.lasersOf(other);
    expect(relayed.every((laser) => laser.from === player.playerId)).toBe(true);
    expect(relayed.at(-1)?.lifted).toBe(true);
    w.finish();
  });
});
