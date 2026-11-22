# Task ledger

The single list of what has been asked for, what is being worked on, and what is finished. It is tracked in git so
nothing gets forgotten between sessions. **Read this first at the start of every session.**

## How this file is kept (always, without being asked)

1. **When the user asks for something, add it here straight away** (in *To do*, with the date and, if useful, their
   own words), then carry on with what you were doing. Do not wait until the current work is finished.
2. **When you start something, move it to *In progress*.** When it is built, tested and pushed, move it to *Done*
   with the date and commit (`git log --oneline`). Never delete items; the *Done* list is the record.
3. **If a request is only partly done, or the user says it still does not work, move it back** to *To do* or
   *In progress* and say what is left. Do not call something done that the user has reported broken.
4. **Audit before every report to the user:** re-read the user's latest messages (and the earlier ones in the
   summary if the conversation was compacted) line by line and check each request against this file and the code.
   Anything not in the file goes in *To do*.
5. Commit this file together with the code it describes. Keep entries to one line each plus a short note.

## In progress

- [ ] Round 7h: scene folders (next).

## To do (asked for, not done)

Asked 2026-11-21 18:34 PT:

- [ ] Scene folders in the scene selector: make folders, swap between them, to prep many scenes over a campaign.
- [ ] DM token library: tokens remember their settings and can be dropped in whenever wanted.
- [ ] Player token library; players claim a token and bring it to other scenes; it remembers HP, effects and other settings.
- [ ] Player can place templates and draw without a "permission denied": **verify with the user** after they republish `database.rules.json` (a template permission was added; the exact failing message was never seen).
- [ ] Handout pop-up for players: **verify with the user** (two causes fixed in round 7a; needs the rules republished).


## Waiting on the user

- [ ] Republish `database.rules.json` in the Firebase console (handouts node in round 6g; template permission in round 7a; a player library rule will be needed for the player token library).
- [ ] Tell me the exact wording if "permission denied" still appears for a player drawing or placing a template.

## Ideas (mine, not requested; do only if time allows or the user wants them)

- Players roll their own initiative.
- DM-only hidden effects on tokens.
- Side-view strip for heights.
- Polygon height zones.
- Hex token frames.
- Remembered (explored) ground in the dark ignores walls between the light and the lit spot (known small inaccuracy).
- Handouts shown to "some players" are filtered in the app only, not in the database.

## Done

2026-11-21 (round 7g): **a second map can be added to a scene** (Scene → Map → "Add a second map…", up to four extra): each has a name, "Players can see it", "Locked in place" and Size; unlocked ones are dragged on the board; fog, grid, light and walls cover all the maps (`sceneRect`); Ctrl+Z undoes; the view moves clear of the side panel after adding. Stored in scene meta (`maps`), no new rules.
Tests: `tests/extramaps.test.ts`, `tests/e2e/batchZ6.mjs`. Also fixed old e2e checks that expected the earlier fog/test-move/token-editor wording (batchB2, C, J, U).
2026-11-21 (round 7f): **a new map is looked at once for a printed grid** (square or hex, the clearer wins; setting "Look for a printed grid when I add a map", on by default); when
clearly there it is hidden **and the app grid is set on it** in one undo step ("Find and hide it" does both too); the lines are located to a fraction of a pixel (spacing fitted to where
every line is) and hidden by filling from an **average of the ground on both sides** with soft edges (squares and hexes); the grid size you already had only wins when its lines are as clear
as the best anywhere (a wrong guess found 6 in 7 of the real lines). New scene field `gridTried` (old scenes: true). No new database rules.
Tests: `tests/gridcut.test.ts` (soft lines, big pictures, averaging), `tests/mapgrid.test.ts`, `tests/e2e/batchZ5.mjs`; batchO/T updated for the new behaviour.
2026-11-21 (round 7e): **three kinds of ground in the fog** (black never seen, grey seen before but out of sight now, clear where a token sees this moment; new fog op `x` =
"explored", kept apart from the fog and put together on one canvas, so putting fog back over a place un-sees it; a scene setting "Grey out what they cannot see right now"
(on by default) — off writes plain reveals as before; players do not see or pick tokens standing on grey ground unless a player owns them, and lights stay);
**light markers are visible to everyone** (a hidden light stays hidden); token editor has a **Sight and lights** tab with a **Darkvision** switch and distance, light presets,
and **custom lights** you can name and keep (browser storage, listed in the Scene panel's "Place a light"). No new database rules.
Tests: `tests/fog3.test.ts`, `tests/e2e/batchZ4.mjs`.
2026-11-21 (round 7d): Heights **Ramp** mode (start and end height, drag from one end to the other, 5 ft steps, one undo); drops of more than 10 ft between
neighbouring squares are **cliffs** (derived wall pieces: stop sight, spells and walking from the low side, nothing from the top; scene setting "Cliffs", 0 = off);
steps of 5 ft or less are **stairs** and cost like diagonals by the distance rule (readouts for drags, test moves; flyers exempt); **difficult ground** painted with the
Heights brush in its own layer (hatched, +1 square per square entered, "Clear difficult ground"). Also fixed: the docs and a test still said "hold W to pass walls" (it is Q since 7a).
Tests: `tests/walk.test.ts`, `tests/e2e/batchZ3.mjs`.
2026-11-21 (round 7c): test move "Multi-step" switch (each drag adds a leg; dashed path with corners; the whole distance; right-click or the Back button goes back one step,
arrow keys count as steps); ruler "Measure in several steps" switch (each drag adds a leg, distance so far at each corner, right-click takes back the last leg, Shift+drag
starts a new one); the 5-10-5 rule counts along the whole path (`pathFt`); corners are shared with others when "Show others" is on.
Tests: `tests/multistep.test.ts`, `tests/e2e/batchZ2.mjs`.
2026-11-21 (round 7b): auras follow the grid lines (per-aura "on grid" switch, on by default); the template flicker is fixed (squares exactly on the edge of a
sphere/emanation were dropped or kept by a floating-point error that depended on the pointer's direction: the search box is now padded); lines snap to
the nearer of a side middle or a corner; a spell sphere starting at a given ground height is not stopped by walls lower than that, so it spreads over
and down a cliff edge but is stopped by taller ones (walls with no height still stop everything). Not done on purpose: spheres do not clip by true 3-D distance.
Tests: `tests/templates7b.test.ts`, `tests/e2e/batchZ.mjs`.

2026-11-21 (round 7a, commit 145e969): test-move box flush at the top; private-scene note at the top centre; WASD pan; Draw is P, Templates C;
new hotkeys (Tab, Z, N, K, L, ?) and the Settings key list rewritten; teleport hotkey is Q (plus right-click "Teleport selected token here");
"Show to players" for scenes is now "Summon players" and the new-scene setting is explained; "Bring players here" only on the live scene and
Summon only on a private one; handout pop-up opens over any other window; Esc closes only the top window; spell-template permission and
"Show others my templates" toggle (on by default); picking another tool ends test move.

2026-11-21 (commit 8aca375): "Bring players here" camera call; handouts (show to everyone or chosen players); campaign file export and import.

2026-11-21 (commits 1a5548d, b36de7c): light and darkness (ambient, lights, darkvision); hex printed-grid hiding; one-way and tall walls;
freehand walls; heights shown only when relevant and flyers measured from the ground; live colour edits on a selected drawing;
"Picture tools" menu; HP numbers option.

Earlier rounds (see `git log`): walls, doors and windows; printed-grid detection; height brush; effects window; Temp HP; emanations from larger
creatures; hex grids; heights and flying; initiative and effects; token maker; spell templates per the 2024 rules; drawing, shapes and the ruler;
themes, undo/redo, copy/paste; fog and sight; Firebase setup and the first playable version.
