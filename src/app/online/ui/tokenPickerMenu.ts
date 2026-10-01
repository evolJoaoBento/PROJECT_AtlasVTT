/**
 * The entries of a player's "Controlled by" picker in the online panel: the presented
 * scene's characters, checked where the player controls them. Assignments go through
 * the session's `TokenControl`, as in the token context menu.
 */
import type { ContextMenuEntry } from '../../react/root/ContextMenuContext';
import type { TokenControl } from '../control/TokenControl';
import { onlineSessionStore } from '../onlineSessionStore';
import { readPresentedScene, type PresentedCharacter } from './presentedSceneSummary';

export const NO_CHARACTERS_LABEL = 'No characters in the presented scene';

export function tokenPickerEntries(control: TokenControl, playerId: string, characters: readonly PresentedCharacter[]): ContextMenuEntry[] {
  if (characters.length === 0) {
    return [{ type: 'item', label: NO_CHARACTERS_LABEL, disabled: true, onClick: () => undefined }];
  }
  return characters.map((character): ContextMenuEntry => ({
    type: 'item',
    label: character.name,
    checked: control.controls(playerId, character.id),
    onClick: () => {
      if (!stillAssignable(control, playerId, character.id)) return;
      control.set(character.id, playerId, !control.controls(playerId, character.id));
    },
  }));
}

/** The menu is a snapshot: the session may have stopped, the player left or the token gone since it opened. */
function stillAssignable(control: TokenControl, playerId: string, tokenId: string): boolean {
  const { status, tokenControl, players } = onlineSessionStore.getState();
  if (status !== 'hosting' || tokenControl !== control) return false;
  if (!players.some((player) => player.playerId === playerId && player.status !== 'pending')) return false;
  return readPresentedScene().characters.some((character) => character.id === tokenId);
}
