import { afterEach, describe, expect, it } from 'vitest';
import { TokenControl } from '../../../src/app/online/control/TokenControl';
import type { SessionPlayer } from '../../../src/app/online/GmSession';
import { onlineSessionStore, resetOnlineSessionStore } from '../../../src/app/online/onlineSessionStore';
import { CONTROLLED_BY_LABEL, controlledBySubmenu, NO_PLAYERS_LABEL } from '../../../src/app/online/ui/controlledByMenu';
import type { ContextMenuEntry } from '../../../src/app/react/root/ContextMenuContext';

type Item = Extract<ContextMenuEntry, { type: 'item' }>;

function items(entry: ContextMenuEntry | null): Item[] {
  if (entry?.type !== 'submenu') throw new Error('expected a submenu');
  const children = typeof entry.children === 'function' ? entry.children() : entry.children;
  return children as Item[];
}

const players: SessionPlayer[] = [
  { playerId: 'p1', name: 'Anna', status: 'admitted' },
  { playerId: 'p2', name: 'Bob', status: 'admitted' },
  { playerId: 'p3', name: 'Cy', status: 'pending' },
  { playerId: 'p4', name: 'Dan', status: 'gone' },
];

function hosting(list: SessionPlayer[] = players): TokenControl {
  const control = new TokenControl();
  onlineSessionStore.setState({ status: 'hosting', tokenControl: control, players: list });
  return control;
}

describe('Controlled by', () => {
  afterEach(() => { resetOnlineSessionStore(); });

  it('is not offered while no session runs', () => {
    expect(controlledBySubmenu('hero')).toBeNull();
  });

  it('lists every admitted player as a checkbox that gives or takes the token', () => {
    const control = hosting();
    const entry = controlledBySubmenu('hero');
    expect(entry).toMatchObject({ type: 'submenu', label: CONTROLLED_BY_LABEL });
    expect(items(entry).map(({ label, checked, keepOpen }) => ({ label, checked, keepOpen }))).toEqual([
      { label: 'Anna', checked: false, keepOpen: true },
      { label: 'Bob', checked: false, keepOpen: true },
    ]);
    items(entry)[1]!.onClick();
    expect(control.tokensOf('p2')).toEqual(['hero']);
    expect(items(entry)[1]!.checked).toBe(true);
    items(entry)[1]!.onClick();
    expect(control.tokensOf('p2')).toEqual([]);
  });

  it('says no players are connected while nobody is admitted', () => {
    hosting(players.slice(2));
    expect(items(controlledBySubmenu('hero')).map(({ label, disabled }) => ({ label, disabled }))).toEqual([
      { label: NO_PLAYERS_LABEL, disabled: true },
    ]);
  });

  it('tells an open submenu about assignment and player changes until it closes', () => {
    const control = hosting();
    const entry = controlledBySubmenu('hero');
    if (entry?.type !== 'submenu' || !entry.subscribe) throw new Error('expected a live submenu');
    let changes = 0;
    const stop = entry.subscribe(() => { changes++; });
    control.set('hero', 'p1', true);
    onlineSessionStore.setState({ players: players.slice(0, 1) });
    expect(changes).toBe(2);
    stop();
    control.set('hero', 'p1', false);
    expect(changes).toBe(2);
  });
});
