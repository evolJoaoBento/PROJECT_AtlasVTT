import React, { useEffect } from 'react';
import { ChevronDown } from 'lucide-react';
import { Button } from '../../../packages/components/primitives/button';
import type { TokenControl } from '../../../online/control/TokenControl';
import type { SessionPlayer } from '../../../online/GmSession';
import type { OnlineSessionService } from '../../../online/OnlineSessionService';
import { REMOVE_PLAYER_LABEL, TOKEN_PICKER_LABEL } from '../../../online/ui/onlineCopy';
import type { PresentedSceneSummary } from '../../../online/ui/presentedSceneSummary';
import { tokenPickerEntries } from '../../../online/ui/tokenPickerMenu';
import { useContextMenu } from '../../root/ContextMenuContext';
import { usePresentedSceneSummary, useTokenControlVersion } from './useOnlineState';

interface OnlinePlayerListProps {
  players: readonly SessionPlayer[];
  control: TokenControl | null;
  service: Pick<OnlineSessionService, 'allow' | 'deny' | 'kick'>;
}

/** Why tokens cannot be given right now; null when they can. */
function assignHint(scene: PresentedSceneSummary): string | null {
  if (scene.tabId === null) return 'Present a scene to give players tokens.';
  if (!scene.assignable) return `Switch back to ${scene.name ?? 'the presented scene'} to change tokens.`;
  return null;
}

/** Players waiting to join, and the players in the session with their tokens. */
export function OnlinePlayerList({ players, control, service }: OnlinePlayerListProps): React.ReactElement {
  const { open, close } = useContextMenu();
  const scene = usePresentedSceneSummary();
  useTokenControlVersion(control);
  // The picker belongs to this list: it closes when the session stops or the panel closes.
  useEffect(() => close, [close]);

  const waiting = players.filter((player) => player.status === 'pending');
  const joined = players.filter((player) => player.status !== 'pending');
  const names = new Map(scene.characters.map((character) => [character.id, character.name]));
  const hint = assignHint(scene);

  const pick = (player: SessionPlayer, anchor: HTMLElement): void => {
    if (!control) return;
    const rect = anchor.getBoundingClientRect();
    open(tokenPickerEntries(control, player.playerId, scene.characters), { x: rect.left, y: rect.bottom });
  };

  return (
    <>
      {waiting.length > 0 && (
        <section className="atlas-online-panel__section" aria-label="Waiting to join">
          <h3 className="atlas-online-panel__heading">Waiting to join</h3>
          <ul className="atlas-online-panel__players">
            {waiting.map((player) => (
              <li key={player.playerId} className="atlas-online-panel__player" aria-label={player.name}>
                <div className="atlas-online-panel__player-row">
                  <span className="atlas-online-panel__name">{player.name}</span>
                  <Button variant="default" size="sm" onClick={() => service.allow(player.playerId)}>Allow</Button>
                  <Button variant="outline" size="sm" onClick={() => service.deny(player.playerId)}>Deny</Button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="atlas-online-panel__section" aria-label="Players">
        <h3 className="atlas-online-panel__heading">Players</h3>
        {joined.length === 0 ? (
          <p className="atlas-online-panel__help">No players yet. Share the link to invite them.</p>
        ) : (
          <ul className="atlas-online-panel__players">
            {joined.map((player) => {
              const tokens = control
                ? control.tokensOf(player.playerId).flatMap((id) => {
                  const name = names.get(id);
                  return name ? [{ id, name }] : [];
                })
                : [];
              return (
                <li key={player.playerId} className="atlas-online-panel__player" aria-label={player.name}>
                  <div className="atlas-online-panel__player-row">
                    <span className="atlas-online-panel__name">{player.name}</span>
                    {player.status === 'gone' && <span className="atlas-online-panel__note">Disconnected</span>}
                  </div>
                  {tokens.length > 0 && (
                    <ul className="atlas-online-panel__chips" aria-label={`Tokens of ${player.name}`}>
                      {tokens.map((token) => <li key={token.id} className="atlas-online-panel__chip">{token.name}</li>)}
                    </ul>
                  )}
                  <div className="atlas-online-panel__actions">
                    <Button
                      variant="outline"
                      size="sm"
                      aria-haspopup="menu"
                      disabled={!control || !scene.assignable}
                      onClick={(event) => pick(player, event.currentTarget)}
                    >
                      {TOKEN_PICKER_LABEL}
                      <ChevronDown />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => service.kick(player.playerId)}>{REMOVE_PLAYER_LABEL}</Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {joined.length > 0 && hint && <p className="atlas-online-panel__help">{hint}</p>}
      </section>
    </>
  );
}
