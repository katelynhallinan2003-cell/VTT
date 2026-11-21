# Table: a small virtual tabletop for friends

A browser-based VTT for 5e-style games: upload a map at full resolution, set a grid, drop tokens, reveal fog of war, and play
together with a link. Built for one DM and a handful of trusted friends, hosted free on GitHub Pages + Firebase + imgbb.

**Status: Phase 1 (playable core).** See the roadmap below.

## What works now

- **Maps** at full resolution (up to 8192 px a side on screen), uploaded to imgbb, kept in your library.
- **Lock the map** so box-selecting and clicking never grab it. Unlock it to move or resize it.
- **Grid overlay:** show/hide, colour, opacity, feet per square, 5e / 5-10-5 / true-distance diagonals.
  Set it by **drawing a box over a square (or many squares)** or with sliders for size and offset.
- **Tokens:** image upload, circle/square/frameless, ring colour and thickness, sizes from Tiny to Gargantuan, snapping (hold Alt to skip),
  box and shift selection, nudging, duplicate (with auto-numbering), z-order, name labels, drag distance readout.
- **Live play:** one shared link for players. They pick a name and colour, then claim a token (or make their own).
- **Permissions:** Trusting (default) / Standard / Strict presets plus individual toggles.
- **Hidden tokens:** DM-only tokens that players cannot even download. Reveal and hide at will.
- **Fog of war:** manual, VBM-style. Reveal or hide with boxes, free-form shapes or a brush. Undo, hide all, reveal all, and preview as players.
- **Pings:** middle-click the map or a token (configurable in Settings → Mouse: you can swap pan and ping buttons, or ping by holding the left mouse button).
- **Undo / redo:** Ctrl+Z / Ctrl+Y for token moves, edits, deletes, map moves, grid changes and fog.
- **Themes:** light (white drawing surface) and dark, plus a few fun ones, and your own accent colour, all in Settings.
- **Drawing:** pen, line, arrow, box, circle, text and an eraser. Shapes and text stay editable: click one to select it, then change its colours (outline and fill are separate; fill can be none, see-through or solid), thickness, dashing, or type a width / height / length in feet. Drag the white dots to resize, drag the shape to move it, arrow keys nudge it, Delete removes it. Text is typed right on the map at the size it will have, and can be edited again (double-click it, or select it and press Enter): font, size, bold, italic, underline, colour. Everyone with the permission can draw; you can change or delete your own (the DM can touch anything).
- **Spell templates (2024 rules):** cone, cube, sphere, emanation and line that snap to your grid and read out their size in feet. A cone starts at the middle of a square's edge, an emanation is centred on a square and counted from that square's edge (its own square stays clear), cubes and lines line up with whole squares, and a sphere is centred on a grid corner. Hold Alt for free placement.
- **Ruler:** measure with your table's diagonal rule, in any colour you like. Private until you choose to show it. Switching on test move turns the ruler off.
- **Test move:** try a move without making it. The token shows at the new spot, a shadow stays behind, with the distance. Keep it or reset it. Others only see it if you switch on "Show others".
- **Auras:** coloured areas around a token (radius in feet, from the edge or the centre, round or square, DM-only if you like).
- **Initiative (DM tab):** "Roll for initiative" pops up a number box for every token (Enter jumps to the next, or press the dice). The order sorts itself, you step through turns and rounds, drag lines to reorder, and hide any line from players. Nothing is shown to players until you tick "Show the order to players".
- **Hit points:** set on a token in the editor, shown as a bar on the token, in the initiative list and in the box at the bottom. Type a number and press − or + (Enter hurts, `+5` then Enter heals). Bloodied (half) and near death (a tenth) colour the token's edge. You choose what players see per token: nothing, colour only, or a bar. Players never receive the numbers, only a percentage, and the real values sit in the DM-only part of the database.
- **Sight and fog:** give a token a sight distance (in feet) and, with "Tokens clear the fog around them" on, the fog opens around it as it moves. "Keep what they have explored" leaves the ground revealed behind them (it needs your browser open, because it is the DM's browser that adds the reveal strokes). Hidden tokens never clear fog, and a test move does not peek ahead.
- **Token maker:** drag and zoom the picture, colour behind it, colour dropper, and a round-cursor brush with separate *Erase paint* (rubs out your paint) and *Erase image* (cuts parts out of the picture itself). A magic **Wand** selects an area by colour: click it, then drag away from the click to select more (or back to select less) and the selection updates live, or use the Sensitivity slider. Shift-click adds to the selection. Paint, Erase paint and Erase image then only work inside it, or outside it with *Invert*.
- **Scenes:** prepare a scene privately, then show it to players when ready. Tokens and fog are saved per scene. Switch, add and manage scenes from the one dropdown top left.
- **Side tabs:** Scene, Tokens, Initiative and Players are separate tabs down the right edge. They start folded away; click one to open it, click it again to fold it. The Scene tab opens by itself when you create your first scene. The grid is set from the Scene tab ("Draw a box to set the grid"); the toolbar button just shows or hides it.
- **Accounts:** Google sign-in for DMs only (allowlist), saved library of maps and token art that follows you between devices.

## Controls

| | |
| --- | --- |
| Pan | right-drag, or Space + drag (Settings → Mouse can swap this to the middle button) |
| Zoom | mouse wheel (zooms toward the cursor), `0` fits the map |
| Select | click, Shift+click, or drag a box on empty space |
| Move | drag (Alt = no snapping). Arrow keys nudge one square |
| Ping | middle click (Settings → Mouse can change this) |
| Menu | right-click a token (or empty space) |
| Draw / templates / ruler / test move | `D`, `S`, `R`, `M` |
| Hit points | select a token, type a number, `Enter` (hurt) or `+` button (heal) |
| Tools | `V` select, `G` show/hide the grid (DM), `F` fog (DM), `T` new token |
| Undo / redo | `Ctrl+Z`, `Ctrl+Y` |
| Copy / cut / paste / delete | `Ctrl+C`, `Ctrl+X`, `Ctrl+V`, `Del` |

## Run it

```bash
npm install
npm run dev        # open http://localhost:5173/?demo for demo mode (no Firebase needed)
npm test           # unit tests, including the security-rule checks
npm run build      # production build into dist/
npm run e2e        # headless-browser smoke test (needs Chrome, and `npm run dev` running)
```

To go live with friends, follow **[docs/SETUP.md](docs/SETUP.md)**.

## How it's built

- **PixiJS (WebGL)** draws the board, so big maps and many tokens stay smooth. Tokens move locally the instant you drag and sync in small batches.
- **Preact** for the panels. **Firebase Realtime Database** for sync. Both backends (Firebase and the in-browser demo) share one small interface in `src/backend/`.
- `src/state/client.ts` is the single place that knows the database layout. `database.rules.json` (generated by `scripts/build-rules.mjs`) says who may read and write what.

## Roadmap

**Phase 2:** freehand and shape drawing (with player permissions), ruler and area templates (cone, line, sphere, cube), auras and emanations that
follow a token, initiative tracker with hidden enemy HP and bloodied/mortal tinting, token maker with frames and simple painting, undo/redo.

**Phase 3:** grid auto-detect for maps that already have one, best-effort hiding of a baked-in grid, walls and token vision for dynamic lighting,
handouts, "bring everyone to this view", export/import of a whole campaign.
