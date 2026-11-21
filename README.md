# Table: a small virtual tabletop for friends

A browser-based VTT for 5e-style games: upload a map at full resolution, set a grid, drop tokens, reveal fog of war, and play
together with a link. Built for one DM and a handful of trusted friends, hosted free on GitHub Pages + Firebase + imgbb.

**Status: Phase 1 (playable core).** See the roadmap below.

## What works now

- **Maps** at full resolution (up to 8192 px a side on screen), uploaded to imgbb, kept in your library.
- **Lock the map** so box-selecting and clicking never grab it. Unlock it to move or resize it.
- **Grid overlay:** show/hide, colour, opacity, feet per square, 5e / 5-10-5 / true-distance diagonals.
  Set it by **drawing a box over a square (or many squares)** or with sliders for size and offset.
- **Hex grids:** in the Scene tab, "Grid type" switches a scene between squares (the default), hexes with a point at the top, and hexes with a flat top. Everything follows the hexes: tokens snap to the middle of a hex (a Large creature to the corner where three hexes meet, a Huge one to a middle again), arrow keys step to the neighbouring hex (up and down zigzag so they stay in line), the ruler and the drag readout count hexes (every step is 5 ft, with no diagonals to argue about, and climbing counts like it does on squares), spell templates snap to hex middles, corners and sides and light up the hexes they cover, and "Draw a box to set the grid" works around a row (or column) of hexes. The size is the distance between the middles of two neighbouring hexes. Switching back to squares is one click, and Ctrl+Z undoes a change of type.
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
- **Spell templates (2024 rules):** cone, cube, sphere, emanation and line that snap to your grid and read out their size in feet. A cone starts at the middle of a square's edge, an emanation is built around the creature it starts on (it picks up the token in the middle automatically) and is counted from the edge of that creature's space, so a Large or bigger creature's 10 ft emanation reaches 10 ft past its whole footprint, and its own space stays clear, cubes and lines line up with whole squares, and a sphere snaps to the middle of a square (or a corner, or nowhere, your choice). The squares an area covers light up (a square counts when its middle is inside); turn that off in the template panel. Hold Alt for free placement. Templates are sticky: the squares at the edge no longer flicker when the pointer sits on a boundary, and cones, cubes and lines pull onto neat 15° angles.
- **Ruler:** measure with your table's diagonal rule, in any colour you like. Private until you choose to show it. Right-click (or Esc) clears it. Switching on test move turns the ruler off, and also puts away whichever other tool you had open.
- **Test move:** try a move without making it. The token shows at the new spot, a shadow stays behind, with the distance. Keep it or reset it. Others only see it if you switch on "Show others".
- **Auras:** coloured areas around a token (radius in feet, from the edge or the centre, round or square, DM-only if you like).
- **Initiative:** the d20 button in the left menu (or **I**) opens a small pop-up with a Roll tab and an Order tab. On the Roll tab every token has a **Bonus** box (remembered for that token, also in the token editor), a **d20** box and a 🎲 button, and the total is d20 plus bonus. Use the digital dice or type what a real die showed. The order sorts itself, then you step through turns and rounds (◀ goes back and puts effect timers back too), drag lines to reorder, and hide any line from players. "Add something else" puts things like a lair action or a monster they have not met on your tracker only (tick "Hide from players"). End combat has no confirmation; Ctrl+Z brings the order back. The order itself shows as little boxes across the top middle of the screen (Settings can move it to a list down the right edge). Players see it once you tick "Show to players", and their own tokens are underlined.
- **Effects and conditions:** select a token and press **Effects** at the bottom (or right-click it). It opens as a small **window you can drag around**, so you can watch the token while you decide: the board behind stays usable, and whatever you hover over, arrow onto or pick shows on the token straight away, before anything is added. By default the view jumps so the token is on the left and the window on the right (zooming in a little if the token is tiny); a setting (in the window itself and in Settings) switches that to "stay where I was", which leaves both the view and the window where they were. **Ready-made** is a searchable drop-down of about 50 effects in groups: the 5e conditions, combat states (Raging, Dodging, cover…), spell effects (Bane, Hex, Hunter's Mark, Faerie Fire…) and a few others. **Make your own** takes any name, a colour and a picture chosen from a pop-up grid of emoji (or type or paste any emoji); the ones you make are kept in the list under "Yours". Choose how it looks on the token (a round badge, a glow, symbols orbiting the token, or a dot), whether it also **tints the whole token** (the colour follows the effect's colour unless you pick another), and how long it lasts: until you remove it, or a number of rounds that counts down at the end of its turn, the start of its turn, or every round as you press Next turn. The effects already on the token are listed at the top of the window, each with a tint switch, a pencil to change it, and a ✕. When time runs out it goes away by itself and you get a note. With no turn order running it just stays, and you can nudge the timer with − and +. Everyone who can see the token sees its effects (hover the little badges in the order for names and time left).
- **Hit points:** set on a token in the editor, shown as a bar on the token, in the initiative list and in the box at the bottom. Type a number and press − or + (Enter hurts, `+5` then Enter heals). Bloodied (half) and near death (a tenth) colour the token's edge. You choose what players see per token: nothing, colour only, or a bar. **Temp HP** are a separate pool: they soak up damage first, healing never touches them, and they can go past the maximum (type a number and press Temp next to the − / + buttons, or use the editor; it tells you what it did, and keeps the higher of the old and new amounts). Players never receive the numbers, only a percentage, and the real values sit in the DM-only part of the database.
- **Sight and fog:** give a token a sight distance (in feet) and, with "Tokens clear the fog around them" on, the fog opens around it as it moves. "Keep what they have explored" leaves the ground revealed behind them, following the route the token really took (it needs your browser open, because it is the DM's browser that adds the reveal strokes). Hold **W** (warp) while dragging a token to teleport it: only where it lands is revealed. An undo or other sudden jump counts as a teleport too. Hidden tokens never clear fog, and a test move does not peek ahead.
- **Heights and flying:** for cliffs, nests and birds. With the **Heights** tool (mountain icon, **H**) you **paint** high or low ground like a brush, in feet (a 10 ft ledge, a 40 ft nest, a -10 ft pit). By default the brush fills whole squares (or hexes) and you pick its size (1 to 8 across); turn that off for a free round brush, or hold **Alt** to flip it for one stroke. Everything you paint in one go is an **area**, and the next stroke keeps joining the selected area until you press **New area** (or **Esc**), so a big hill does not have to be painted in one drag. **Ctrl-click** an area to select it, then paint more onto it, **Rub out** part of it (with an area selected it only rubs out of that one, otherwise out of everything), **Move** it (whole squares at a time, Alt for free), change its height in the card, **Merge** several into one, or **Delete** it. Areas stack in the order they were painted, newer on top. Each one either **sets** its height ("this ground is 20 ft") or **adds to the ground** under it ("5 ft more than whatever is below"), so a 5 ft ramp on a 20 ft hill is 25 ft. The map shows each pixel at the total height there, with an edge wherever it changes and a label per area. Boxes and circles drawn with the old version still work. Anything that **walks** onto ground is lifted to its height by itself (a small ▲ tag shows it, with a shadow); anything that **flies** keeps its own altitude (↑ tag, a bigger shadow the higher it is) and is never pushed into the ground. Select a token and press **Height** at the bottom (or **]** to go up 5 ft and **[** to come down, which lands it at the ground), or set Flying and Altitude in the token editor. Players can change their own tokens' height too. The **ruler** and the distance shown while dragging count the climb in a straight 3D line using your diagonal rule ("35 ft (30 across, 20 up)"), and dragging a walker off an edge says how far it drops and how many d6 of falling damage that would be. "Show terrain heights" in Settings only hides the coloured areas on your own screen. "Clear all" drawings leaves terrain alone; the Heights panel has its own "Clear all heights".
- **Token maker:** drag and zoom the picture, colour behind it, colour dropper, and a round-cursor brush with separate *Erase paint* (rubs out your paint) and *Erase image* (cuts parts out of the picture itself). **Auto select** picks an area by colour: click it, then drag away from the click to select more (or back to select less) and the selection updates live, or use the Sensitivity slider. Shift-click adds to the selection. Paint, Erase paint and Erase image then only work inside it, or outside it with *Invert*.
- **Scenes:** prepare a scene privately, then show it to players when ready. Tokens and fog are saved per scene. Switch, add and manage scenes from the one dropdown top left.
- **Side tabs:** Scene, Tokens and Players are separate tabs down the right edge. They start folded away; click one to open it, click it again to fold it. The Scene tab opens by itself when you create your first scene. The grid is set from the Scene tab ("Draw a box to set the grid"); the toolbar button just shows or hides it.
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
| Tools | `V` select, `G` show/hide the grid (DM), `F` fog (DM), `H` heights (DM), `I` initiative (DM), `T` new token |
| Up / down | `]` raise the selected token 5 ft (it flies), `[` lower it |
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
follow a token, initiative tracker with effects/conditions and hidden enemy HP and bloodied/mortal tinting, token maker with frames and simple painting, undo/redo.

**Phase 3:** grid auto-detect for maps that already have one, best-effort hiding of a baked-in grid, walls and token vision for dynamic lighting,
handouts, "bring everyone to this view", export/import of a whole campaign.
