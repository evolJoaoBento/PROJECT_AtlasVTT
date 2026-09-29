import { Notice } from 'obsidian';
import type { SessionPlayer } from '../GmSession';

/** "Anna wants to join. Allow / Deny", until answered or hidden. The name is text, never HTML. */
export function showJoinRequestNotice(player: SessionPlayer, answer: (allow: boolean) => void): { hide(): void } {
  const fragment = createFragment();
  const body = fragment.createDiv({ cls: 'atlas-online-request' });
  body.createDiv({ cls: 'atlas-online-request__text' }).setText(`${player.name} wants to join your online session.`);
  const actions = body.createDiv({ cls: 'atlas-online-request__actions' });
  const notice = new Notice(fragment, 0);
  const reply = (allow: boolean) => (event: MouseEvent): void => {
    event.stopPropagation();
    answer(allow);
    notice.hide();
  };
  actions.createEl('button', { cls: 'mod-cta', text: 'Allow' }).addEventListener('click', reply(true));
  actions.createEl('button', { text: 'Deny' }).addEventListener('click', reply(false));
  return { hide: () => notice.hide() };
}
