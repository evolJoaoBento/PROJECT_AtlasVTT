import type { SettingsService } from '../services/SettingsService';
import { DEFAULT_ONLINE_SETTINGS, formatTurnServers, parseTurnServers } from '../online/onlineSettings';
import type { AtlasSettingSection } from './settingSections';

export function onlineSettingsSection(settings: SettingsService): AtlasSettingSection {
  const signaling = (): ReturnType<SettingsService['getOnlineSettings']>['signaling'] => settings.getOnlineSettings().signaling;
  const setSignaling = (partial: Partial<ReturnType<typeof signaling>>): void =>
    settings.setOnlineSettings({ signaling: { ...signaling(), ...partial } });

  return {
    heading: 'Online play',
    rows: [
      {
        name: 'Signaling server',
        desc: 'Helps players find your session; no game data goes through it. The free PeerJS cloud works out of the box. Only used while a session is running.',
        aliases: ['peerjs', 'online', 'multiplayer', 'remote'],
        render: (setting) => {
          setting.addDropdown((dropdown) => dropdown
            .addOption('cloud', 'PeerJS cloud (free)')
            .addOption('custom', 'My own server')
            .setValue(signaling().mode)
            .onChange((value) => setSignaling({ mode: value === 'custom' ? 'custom' : 'cloud' })));
        },
      },
      {
        name: 'Own server address',
        desc: 'Host, port and path of your peerjs-server, used when "My own server" is chosen.',
        render: (setting) => {
          setting
            .addText((text) => text.setPlaceholder('peer.example.org').setValue(signaling().host).onChange((host) => setSignaling({ host: host.trim() })))
            .addText((text) => text.setPlaceholder('443').setValue(String(signaling().port)).onChange((port) => setSignaling({ port: Number(port) || 443 })))
            .addText((text) => text.setPlaceholder('/').setValue(signaling().path).onChange((path) => setSignaling({ path: path.trim() || '/' })));
        },
      },
      {
        name: 'Own server key and TLS',
        render: (setting) => {
          setting
            .addText((text) => text.setPlaceholder(DEFAULT_ONLINE_SETTINGS.signaling.key).setValue(signaling().key).onChange((key) => setSignaling({ key: key.trim() || 'peerjs' })))
            .addToggle((toggle) => toggle.setValue(signaling().secure).onChange((secure) => setSignaling({ secure })));
        },
      },
      {
        name: 'Relay (TURN) servers',
        desc: 'For players whose network blocks direct connections. One per line: turn:host:port username password. Players receive these in the join link.',
        aliases: ['turn', 'relay', 'nat', 'firewall'],
        render: (setting) => {
          setting.addTextArea((area) => area
            .setPlaceholder(formatTurnServers([{ urls: 'turn:relay.example.org:3478', username: 'user', credential: 'password' }]))
            .setValue(formatTurnServers(settings.getOnlineSettings().turnServers))
            .onChange((text) => settings.setOnlineSettings({ turnServers: parseTurnServers(text) })));
        },
      },
      {
        name: 'Player page',
        desc: 'The web page players open to join. Change it if you publish the page yourself.',
        render: (setting) => {
          setting.addText((text) => text
            .setValue(settings.getOnlineSettings().playerPageUrl)
            .onChange((url) => settings.setOnlineSettings({ playerPageUrl: url.trim() })));
        },
      },
    ],
  };
}
