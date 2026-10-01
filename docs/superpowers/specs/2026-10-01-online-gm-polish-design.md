# Online play polish A: the GM's online controls inside Atlas

Date: 2026-10-01. Status: design, awaiting review. Builds on pieces 1–5, merged
to the fork's `main` (310ed0b).

## Context

The GM runs online play through Obsidian commands and an Obsidian modal
(**Online session…**). This piece moves those controls into Atlas itself: a
toolbar button opening an Atlas panel, entries in Atlas's own command palette,
and the scene tab's eye button presenting to online players while a session
runs.

## Goals

- One place for online play inside an Atlas map view: a toolbar button that
  opens an online panel styled like the loot roller.
- The four online actions in Atlas's command palette.
- While a session runs, the eye button presents to players only; the local
  player window is still one right-click away.

## Non-goals

- Player-side tools (drag ruler, dice, measure, laser): polish B.
- Changes to session behaviour, protocol or the join page.

## Toolbar button

- A main-toolbar control built with `ToolButton`, with a network icon, a
  `PRIORITY` entry and a `menuEntry` for **More tools** (`MainToolbar.tsx`,
  `toolbarFit.ts`). It is pinned while its panel is open.
- Its state shows the session: a dot while hosting; a count badge with the
  number of waiting join requests.
- Clicking it toggles the online panel.

## Online panel

A floating Atlas panel with the loot roller's treatment (`atlas-panel-radius`,
`CloseButton`, `atlas-close-header`, panel motion), reading the existing
`onlineSessionStore` and calling `OnlineSessionService`.

- Not hosting: **Start online session** and one line on what it does.
- Hosting, top to bottom:
  - status (connected, reconnecting, error);
  - the join link with a copy button;
  - waiting players with **Allow** and **Deny**;
  - connected players: each with their controlled tokens as chips, a
    **Controlled by** picker to add or remove tokens of the presented scene
    (the same `TokenControl` the token context menu uses), and **Remove
    player**;
  - the presented scene's name with **Present to players** or **Stop
    presenting**;
  - **Stop online session**.
- Join-request notices still appear while the panel is closed.
- The Obsidian command **Online session…** opens the panel in the active Atlas
  view; with no Atlas view open it opens the existing modal, which stays for
  that case.

## Command palette

Atlas's `CommandPalette` gains, in an "Online play" section:

- **Online session** (opens the panel) — always;
- **Present to players** — when a scene is open and not already presented;
- **Stop presenting** — while a scene is presented;
- **Stop online session** — while hosting.

## Eye button

- While a session is hosting, the scene tab's eye button presents that scene
  with `presentViewToPlayers` and does not open the local player window; its
  label reads "Present to players".
- Its context menu offers **Open player window**, which runs today's
  behaviour (presents and opens the window).
- Without a session it behaves as today.

## Testing

- Panel: what it shows for not hosting, hosting with no players, waiting
  players, connected players with tokens, presented and not presented;
  actions call the service.
- Toolbar button: dot and badge follow the store; priority and menu entry.
- Palette: each entry appears only when it applies and runs its action.
- Eye button: with a session presents to players without the window; context
  menu opens the window; without a session unchanged.
- Manual: start from the toolbar, allow a player, assign a token in the panel,
  present with the eye, open the player window from its menu, stop.
