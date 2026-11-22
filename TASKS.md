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

- [ ] Round 7e: three-zone fog; lights visible to players; darkvision toggles + distances; custom lights; Lights section in the token editor (next).

## To do (asked for, not done)

Asked 2026-11-21 18:34 PT:

- [ ] Fog of war has three zones: black (never seen), gray (seen before, not visible now), clear (visible now). Update how sight works to match.
- [ ] Light sources must not be invisible to players (today light-only tokens show a DM-only marker).
- [ ] Tokens get darkvision toggles and distances; custom lights can be defined; lights are their own section inside the token editor.
- [ ] Printed-grid detection: when a grid is found on an imported map and hidden, also size the app grid automatically (square and hex), so the user need not draw it.
- [ ] Printed-grid hiding: more precise, with averaging.
- [ ] A second map can be added to the same scene.
- [ ] Scene folders in the scene selector: make folders, swap between them, to prep many scenes over a campaign.
- [ ] DM token library: tokens remember their settings and can be dropped in whenever wanted.
- [ ] Player token library; players claim a token and bring it to other scenes; it remembers HP, effects and other settings.
- [ ] Player can place templates and draw without a "permission denied": **verify with the user** after they republish `database.rules.json` (a template permission was added; the exact failing message was never seen).
- [ ] Handout pop-up for players: **verify with the user** (two causes fixed in round 7a; needs the rules republished).

Earlier requests that were reported again or only partly met:

- [ ] Printed-grid removal "can be better and more precise" (asked 2026-11-21 15:59 and again 18:34).

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
