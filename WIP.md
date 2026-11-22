# WIP

Every issue the user raises goes in this file. Open issues sit at the top; finished ones are moved to the bottom and
marked complete. The rules for keeping it are in `CLAUDE.md`.

**Entry format**

```
- [ ] **#N Short title** (added YYYY-MM-DD): what was asked, in the user's words where useful.
- [x] **#N Short title** (added YYYY-MM-DD, completed YYYY-MM-DD): what was asked. Done: what shipped.
```

Numbers are given in the order issues arrive and are never reused. More than one session can be working at once: fetch before
taking a number, and if two sessions took the same one, the one that reached `main` second renumbers its own. An issue being worked on right now gets
`(in progress)` after its title, and one that cannot move until the user does something gets `(waiting on user)`.
An issue the user says is still broken moves back up to *Open* with a note on what is left.

## Open

Carried over from the old `TASKS.md` on 2026-11-22 (asked 2026-11-21, before this file existed):

- [ ] **#3 Republish `database.rules.json` in the Firebase console** (waiting on user) (added 2026-11-21): the live
  database still has older rules. Needed for the handouts node (round 6g), the spell-template permission (round 7a) and
  saved tokens and characters (round 7i, moved in round 7j: now `tables/$tid/chars`, so paste the 96-line file from round
  7j, which replaces the whole Rules tab; the allowed emails are data and stay). Someone with access to the Firebase console has to
  paste the file into the Rules tab; it cannot be done from here.
- [ ] **#4 Players get "permission denied" when drawing or placing a template** (waiting on user) (added 2026-11-21):
  a template permission was added in round 7a, but the exact failing message was never seen. Verify with the user once
  #3 is done.
- [ ] **#5 Tell me the exact wording if "permission denied" still appears** (waiting on user) (added 2026-11-21): for a
  player drawing or placing a template, after #3. Needed to finish #4 if it is still broken.
- [ ] **#6 Handout pop-up for players** (waiting on user) (added 2026-11-21): two causes were fixed in round 7a.
  Verify with the user once #3 is done.

## Ideas (not requested)

Suggestions nobody has asked for, carried over from the old `TASKS.md`. Do not build these unless the user asks; if
they do, give the idea a number and move it to *Open*.

- Players roll their own initiative.
- DM-only hidden effects on tokens.
- Side-view strip for heights.
- Polygon height zones.
- Hex token frames.
- Remembered (explored) ground in the dark ignores walls between the light and the lit spot (known small inaccuracy).
- Handouts shown to "some players" are filtered in the app only, not in the database.

Noticed on 2026-11-22 during the grid-finder and UI work, and left alone:

- A picture dropped on a scene that has no map yet becomes a token. It could offer two places to drop: "this scene's map" and "a token".
- Hiding a printed grid also fills in a wall that lies exactly on a grid line. It could leave pixels alone that are much darker than the grid lines are.
- The grid finder has only been run on maps drawn by the tests. A folder of real published maps (with and without grids) would be a better judge.
- A scene can only be renamed while it is open (Manage scenes greys the button out otherwise).
- With the Draw tool open and a drawing selected, the box at the bottom repeats the colour, thickness and fill controls of the tool's panel. It could show only what the panel lacks (size, delete).
- The selected-token bar has six buttons for the DM. Height, Aura and Save to library could go behind a "More" button, but a dozen browser tests press them where they are, and Height shows the token's height on its face.
- Below about 1100 px wide the warnings and the test-move bar can still touch an open tool panel.

## Completed

Newest at the bottom. Work finished before 2026-11-22 was recorded in `TASKS.md`, which was deleted in issue #2; its
*Done* list is still in git (`git show 20d6619:TASKS.md`).

- [x] **#1 Set up WIP.md and the working rules** (added 2026-11-22, completed 2026-11-22): make `WIP.md` so every issue
  is logged and finished ones move to the bottom marked complete, and explain the rules in `CLAUDE.md`.
  Done: this file, plus the "Ship straight to main" and "WIP.md" sections in `CLAUDE.md`.
- [x] **#2 Move the unfinished items out of TASKS.md and delete it** (added 2026-11-22, completed 2026-11-22):
  "move them and delete tasks.md". Done: the four unfinished items are #3 to #6 above, the unrequested ideas are in
  *Ideas*, `TASKS.md` is deleted and `CLAUDE.md` no longer mentions it.
- [x] **#7 Always read CLAUDE.md first** (added 2026-11-22, completed 2026-11-22): "Always read CLAUDE.md before doing
  anything in future runs and update CLAUDE.md if it has important design precedent changes." Done: a "Read this file
  first, every run" section and a "Design precedents" section in `CLAUDE.md`.
- [x] **#8 Player character library tied to the table, reclaim by name** (added 2026-11-22, completed 2026-11-22): "if a
  players character library is tied to their browser, change it to tie it to the dm's account and when they log in they
  can select their name to reclaim their library so its not lost." Done: characters are kept at `tables/$tid/chars/$rid`;
  the join screen lists people who played here before and picking one brings their characters back; the DM's screen
  hands the old token to the new browser and removes the old entry once offline (an entry still online is left alone);
  round 7i libraries are copied across once; the player-writable `users/$uid/tokenLib` rule is gone. Needs the rules
  republished (#3). Tests: `tests/rules.test.ts`, `tests/charlib.test.ts`, `tests/e2e/batchZ10.mjs`.
- [x] **#9 Drag an image onto the board or the New scene box to upload it as a map** (added 2026-11-22, completed
  2026-11-22): "if I drag an image onto this [the empty table] or this [the New scene box] it should treat it as a map
  upload. UI should show this is possible." Done: on a table with no scenes a dropped picture opens New scene with it
  as the map; the New scene box takes a picture dropped anywhere while it is open and shows a preview; the empty table
  says "or drag a map picture anywhere onto this page"; while a picture is dragged over the page a panel says what
  dropping it will do (a map on an empty table, a token once there are scenes). A picture dragged from another web
  page fills in its link. Checked in the app with made-up drop events, not with a real drag from the desktop.
- [x] **#10 Make the printed-grid auto detection (squares and hexes) good and robust** (added 2026-11-22, completed
  2026-11-22): "make sure the auto detection code for grids and hexes and such is good and robust." Found: the old
  finder got 36 of 43 lifelike test maps right, and was wrong on every dungeon with black or white around the rooms
  and on maps with a border (walls and edges outvoted the grid, giving spacings like 1044 px), and on 35 px squares
  (it trusted the default grid size). Done: the square finder was rewritten (thin lines only, each part of the picture
  votes, spacing marked on what it explains and what it is missing, see the top of `src/core/gridcut.ts`); the hex
  finder ignores edges and walls the same way, checks the sides in all three directions (a square grid can no longer
  pass for hexes), and both mark their answer 0 to 10 so they can be compared; big pictures are searched on a small
  copy first. 63 drawn maps are now permanent tests (`tests/helpers/gridcorpus.ts`): all pass, and the project's
  browser tests for the feature pass. Not done: it has only been tried on maps drawn by the tests, not on real
  published maps; and hiding still fills in a wall that lies exactly on a grid line.
- [x] **#11 General UI cleanup** (added 2026-11-22, completed 2026-11-22): "the UI is just a little bit cluttered/wordy
  in some places ... core/basic VTT features are easy access while advanced features are deeper down and phrasing is
  always clear ... spend a full hour." The user called time after about 45 minutes of it ("you can stop").
  Done, where things are: Settings in four tabs (Table, Pictures and files, You, Mouse and keys; `?` opens the last);
  the toolbar in groups (everyday tools, then the DM's scene tools) with names that show at once on hover; Add token
  asks for the picture first, tucks the paint tools away, and takes a dropped picture while open; the token editor,
  the Players tab and "Pick your character" put the basics first; the Scene tab shows fog options only when fog is on,
  folds Light away, and has "Preview as players" (with a Stop link on the note at the top).
  Done, wording: long hints cut to a sentence in every panel; "picture" everywhere instead of a mix with "image";
  walls and extra maps both say "Players can see it"; a wall height of 0 says it means full height; notes stay on
  screen long enough to read.
  Done, layout: rows of choices in the tool panels are no longer cut off; at laptop widths the test-move bar, warnings,
  the turn order and the selected-token bar no longer cover the top bar, the side panel or each other (they stack);
  the initiative window opens beside an open tool panel; the handout text box looks like the other inputs.
  Bugs found on the way and fixed: the right-click menu never opened on Windows; Fit map was undone by a view that was
  still gliding; a demo map lost on reload blamed the internet connection; letting go of Alt handed the keyboard to
  the browser's menu on Windows (not checked in a real browser window). New browser test: `tests/e2e/batchZ11.mjs`;
  `node tests/e2e/all.mjs` runs them all. Things noticed and left alone are under *Ideas*.
- [x] **#12 Blank board after uploading the gridless asteroid base** (added 2026-11-22, completed 2026-11-22):
  reproduced an off-map camera and an older decode installing a destroyed texture when the same scene opened twice.
  New and replacement maps fit the view, and only the current load can install the picture or finish its grid scan.
  Large-map scans use a smaller canvas and report when no clear printed grid was found. Checked the supplied
  10,240 × 12,800 WebP and its gridded counterpart. `tests/e2e/largeMap.mjs` covers both rendering failures.
- [x] **#13 Explain a forbidden picture upload and let the DM recover** (added 2026-11-22, completed 2026-11-22):
  the upload error now identifies ImgBB, shows the returned HTTP status, and points to Test upload and direct picture links.
  Verified that a simulated refusal preserves the existing map and that adding a link through Library → Maps works
  without another upload. Covered by `tests/imgbb.test.ts` and `tests/e2e/uploadRefusal.mjs`.
- [x] **#14 Align the scene grid with the dotted map grid** (added 2026-11-22, completed 2026-11-22):
  the reduced preview of the cavern JPEG emphasized alternate dots. The old finder picked a 114 px grid and hid every
  other line. The full-resolution check now compares the smaller spacings that could produce that repeat. Verified
  57 px squares on the original JPEG both on upload and through “Look again” in a scene with the old grid.
  Added two dotted maps to the corpus and checked for extra lines as well as missing lines.
- [x] **#15 Calibrate gridless pictures** (added 2026-11-22, completed 2026-11-22): an inconclusive scan turns off the overlay and snapping and invites the DM to mark ten feet with two clicks. Verified the diagonal ruler on the supplied snow map.
- [x] **#16 Name the four scene overlay choices** (added 2026-11-22, completed 2026-11-22): the setup prompt and Scene panel offer Squares, Hex, rows, Hex, columns and Gridless. Switching overlays keeps the calibrated scale.
- [x] **#17 Delete pictures from the scene picker** (added 2026-11-22, completed 2026-11-22): a top-right trash button removes a library picture from New scene or My library and clears a deleted selection.
- [x] **#18 Remove hosted library pictures from ImgBB** (added 2026-11-22, completed 2026-11-22): new library uploads retain the private ImgBB deletion page. The DM confirms at the host and then removes the entry. Older entries can be removed locally.
- [x] **#19 Compare five grid removal methods** (added 2026-11-22, completed 2026-11-22): rendered five original-size cavern maps and matching crops from the reported rock edge for the DM to choose from.
- [x] **#20 Preserve artwork between printed dots** (added 2026-11-22, completed 2026-11-22): square-grid cleanup measures the dot rhythm and checks local ink contrast. The cavern repair changes 3.75% of its pixels. Light and dark fixtures verify that clear gaps and unprinted artwork survive.
