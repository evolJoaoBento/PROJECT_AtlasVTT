// online-client/main.mts
/**
 * The join page: the name form, the session, image loading and the map. The logic lives
 * in tested shared modules under `src/app/online/`; this file finds the page's elements
 * and connects them.
 */
import { AssetCache } from '../src/app/online/assets/AssetCache';
import { AssetLoader } from '../src/app/online/assets/AssetLoader';
import { openIndexedDbImageStore } from '../src/app/online/assets/indexedDbImageStore';
import { randomId } from '../src/app/online/ids';
import { parseJoinFragment } from '../src/app/online/joinLink';
import { INCOMPLETE_LINK_TEXT, NAME_PROBLEM_TEXT, NO_CANVAS_TEXT, pageScreen, type PageScreen } from '../src/app/online/page/pageScreen';
import type { PlayerSessionState } from '../src/app/online/PlayerSession';
import { createJoinSession } from '../src/app/online/preview/joinSession';
import { initiativeLines, playerLines, widgetLines } from '../src/app/online/preview/sceneSummary';
import { normalizePlayerName } from '../src/app/online/protocol';
import type { PlayerScene } from '../src/app/online/scene/sceneTypes';
import { createPeerClient } from '../src/app/online/transport/PeerTransport';
import { AssetsPanel, rememberedKeep } from './assetsPanel.mts';
import { createCanvasSurface } from './canvasSurface.mts';
import { decodeImage } from './imageDecoder.mts';
import { MapView } from './mapView.mts';
import { Menu } from './menu.mts';

const VERSION = '0.1.0';

function element<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

const screen = element<HTMLElement>('screen');
const form = element<HTMLFormElement>('join');
const nameInput = element<HTMLInputElement>('name');
const status = element<HTMLParagraphElement>('status');
const table = element<HTMLElement>('table');
const sessionName = element<HTMLElement>('session-name');
const connection = element<HTMLElement>('connection');
const playerList = element<HTMLUListElement>('players');
const widgetList = element<HTMLUListElement>('widgets');
const initiativeList = element<HTMLOListElement>('initiative');
const canvas = element<HTMLCanvasElement>('map');

const cache = new AssetCache({ keep: rememberedKeep(), openStore: openIndexedDbImageStore });
const panel = new AssetsPanel(cache);
new Menu(element<HTMLButtonElement>('menu-button'), element<HTMLElement>('menu'), element<HTMLButtonElement>('menu-close'));
const surface = createCanvasSurface(canvas);
// The lookup runs at draw time, in a later animation frame, so `loader` below is already set;
// it asks the loader every time, so a released image is never drawn.
const map = surface
  ? new MapView({
    canvas, surface, images: (id) => loader.image(id),
    viewButtons: element('view-buttons'), followButton: element('follow-gm'), fitButton: element('fit-map'),
  })
  : null;
let assetsFrame: number | null = null;
const loader = new AssetLoader({
  cache,
  decode: decodeImage,
  // Chunks arrive many times a second: the bar and the map update at most once per frame.
  onChange: () => {
    if (assetsFrame !== null) return;
    assetsFrame = window.requestAnimationFrame(() => {
      assetsFrame = null;
      panel.showProgress(loader.progress());
      map?.refresh();
    });
  },
});
let sessionState: PlayerSessionState | null = null;
let scene: PlayerScene | null = null;
let started = false;

/** localStorage can throw in private windows; the page still works without it. */
function stored(key: string, fallback: () => string): string {
  try {
    const value = localStorage.getItem(key) ?? fallback();
    localStorage.setItem(key, value);
    return value;
  } catch {
    return fallback();
  }
}

const listContent = new WeakMap<HTMLElement, string>();

/** Rebuilds a list only when its lines changed; scene patches arrive many times a second. */
function fillList(list: HTMLElement, lines: string[]): void {
  list.hidden = lines.length === 0;
  const joined = JSON.stringify(lines);
  if (listContent.get(list) === joined) return;
  listContent.set(list, joined);
  list.replaceChildren(...lines.map((line) => {
    const item = document.createElement('li');
    item.textContent = line;
    return item;
  }));
}

function show(view: PageScreen): void {
  screen.hidden = view.kind === 'table';
  table.hidden = view.kind !== 'table';
  form.hidden = view.kind !== 'form' || started;
  if (view.kind === 'message') status.textContent = view.text;
  if (view.kind === 'table') {
    sessionName.textContent = view.title;
    connection.textContent = view.connection;
    // The canvas has its size only once the table is shown.
    map?.measure();
  }
}

function render(state: PlayerSessionState): void {
  sessionState = state;
  let ended = false;
  if (state.status === 'denied' || state.status === 'lost') {
    // The session is over for good: free the decoded images and hide the loading bar.
    loader.dispose();
    panel.showProgress(loader.progress());
    ended = true;
  }
  fillList(playerList, playerLines(state.players));
  renderScene();
  // The scene is cleared from the view first; then it stops drawing and frees the fog image.
  if (ended) map?.dispose();
}

/** The map, and the widget and initiative lists, shown only on the table screen. */
function renderScene(): void {
  const view = pageScreen(sessionState, scene !== null);
  show(view);
  const shown = view.kind === 'table' ? scene : null;
  map?.setScene(shown);
  fillList(widgetList, shown ? widgetLines(shown.widgets) : []);
  fillList(initiativeList, shown ? initiativeLines(shown.initiative) : []);
  // Read-only, for checking in the developer tools what this page received.
  (window as unknown as { atlasScene: PlayerScene | null }).atlasScene = shown;
}

const target = parseJoinFragment(location.hash);
if (!target) {
  status.textContent = INCOMPLETE_LINK_TEXT;
} else if (!map) {
  status.textContent = NO_CANVAS_TEXT;
} else {
  form.hidden = false;
  nameInput.value = stored('atlas-online:name', () => '');
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (started) return;
    const name = normalizePlayerName(nameInput.value);
    if (!name) {
      status.textContent = NAME_PROBLEM_TEXT;
      return;
    }
    try { localStorage.setItem('atlas-online:name', name); } catch { /* private window */ }
    started = true;
    form.hidden = true;
    createJoinSession({
      loader,
      hostId: target.hostId,
      name,
      // One key per GM session, so different GMs cannot recognise or pose as the same player.
      playerKey: stored(`atlas-online:player-key:${target.hostId}`, () => randomId()),
      clientVersion: VERSION,
      transport: createPeerClient(target.server),
      onChange: render,
      onScene: (next) => {
        scene = next;
        renderScene();
      },
      onCamera: (camera) => map.setGmCamera(camera),
    }).start();
  });
}
