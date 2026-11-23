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

- [ ] **#4 Players get "permission denied" when drawing or placing a template** (waiting on user) (added 2026-11-21):
  a template permission was added in round 7a, but the exact failing message was never seen. #3 is done (rules
  republished 2026-11-22), so the user can try it again.
- [ ] **#5 Tell me the exact wording if "permission denied" still appears** (waiting on user) (added 2026-11-21): for a
  player drawing or placing a template, after #3. Needed to finish #4 if it is still broken.
- [ ] **#6 Handout pop-up for players** (waiting on user) (added 2026-11-21): two causes were fixed in round 7a.
  #3 is done (rules republished 2026-11-22), so the user can check it now.

Asked 2026-11-23, all in one message (the user also attached `SeasideMap.jpg` and `tunnel.webp` as maps the wall detector handles badly):



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
- [x] **#20 Preserve artwork between printed dots** (added 2026-11-22, completed 2026-11-22): square-grid cleanup learns the ink color over different terrain, checks dot spacing along cliffs, and repairs repeated JPEG fringes. Checked three magnified regions each on the coast, skeleton, and cavern maps, including the reported floor and wall.
- [x] **#21 Coast map opens the scale prompt despite its printed squares** (added 2026-11-22, completed 2026-11-22). Reproduced the miss with the hosted JPEG and a 2,048-pixel texture limit. Scene creation and manual retry now scan the source picture. Verified coast, skeleton and cavern spacings of 99.96, 70 and 57 original pixels at that limit.
- [x] **#22 One-click deletion from the picture library** (added 2026-11-22, completed 2026-11-22). The trash button removes the picture in one click. Any saved ImgBB deletion link moves to the DM's private cleanup list in My library.
- [x] **#23 Make Added on top stack height strokes** (added 2026-11-22, completed 2026-11-22). Each additive stroke raises or lowers the terrain underneath once. Switching to the additive brush keeps the selected base intact, and undo removes one stroke.
- [x] **#24 Paint gridless heights with freehand brushes** (added 2026-11-22, completed 2026-11-22). Gridless paint and erasers follow the pointer with a round brush sized in calibrated feet. Large brushes retain their full diameter.
- [x] **#25 Declutter overlapping terrain labels** (added 2026-11-22, completed 2026-11-22). Each connected patch shows its finished elevation once when the text fits. Removed the additive suffix from the map and brush readout.
- [x] **#26 Treat five-foot ground changes as stairs** (added 2026-11-22, completed 2026-11-22). Walkable elevation changes grade smoothly across five horizontal feet. Movement reports stair rise once and measures the slope on gridless maps. Authored walls block at the crossing according to their local height.
- [x] **#27 Test move: show each step's distance** (added 2026-11-22, completed 2026-11-22): "in test move, when doing multi step it should show the distance moved at each step as well as full combined distance moved." Done: a test move in several steps puts each step's own distance on the step and "N ft total" at the token, both while dragging and after dropping (the steps add up to the total, with stairs and difficult ground counted once). Test: `tests/e2e/batchZ2.mjs`.
- [x] **#28 Light sources are not tokens in the token menu or claimable** (added 2026-11-22, completed 2026-11-22): "Torches/light sources should not be in the token menu, maybe have a submenu inside tokens for them but they also shouldnt be claimable by a player as a token like a normal token." Done: the DM's Tokens list no longer lists torches (and its search counts only tokens); they are in a folded "Lights (n)" list under it (opens by itself when a search matches one). A player cannot take one (not offered in "Pick your character", no "Take control", refused by `can('claim')`), and the DM has no "Give to" entries or "Controlled by" box for one. A creature that carries a light is still an ordinary token. Tests: `tests/core.test.ts`, `tests/e2e/batchZ11.mjs`.
- [x] **#29 Do any more work on the WIP** (added 2026-11-22, completed 2026-11-22): "do any more work on the WIP". Done: #27 and #28 built. Everything else open (#3 to #6) is waiting on the user (republish the rules, then check the template and handout problems); the Ideas are not built unless asked.
- [x] **#30 Stop walkers at tightly stacked painted cliffs** (added 2026-11-22, completed 2026-11-23). Walking follows the painted edge and counts nearby uphill contours together. Browser tests cover a walker dragging into six overlapping circles twice and then teleporting onto the 30 ft top.
- [x] **#31 Show the teleport gesture at the bottom of Settings shortcuts** (added 2026-11-22, completed 2026-11-23). The last entry in Mouse and keys explains how the DM can hold Q and drag a token across a wall or cliff.
- [x] **#3 Republish `database.rules.json` in the Firebase console** (added 2026-11-21, completed 2026-11-22): the user pasted the 96-line file from round 7j into the Rules tab and confirmed it. It covers handouts (6g), the spell-template and draw permission (7a), and players' characters kept with the table (7j). Nothing else needs republishing until the rules change again.
- [x] **#32 Auto-add walls and heights from a map picture: is it a good idea, and how?** (added 2026-11-23, completed 2026-11-23): answered in chat; the user said go ahead with both, assuming walls are 10 ft high. Built as #33 (walls) and #34 (heights).
- [x] **#33 "Detect walls" button: draft walls from the map picture** (added 2026-11-23, completed 2026-11-23): "Yeah go ahead and try it, and I think we can assume walls are 10ft high? ... They would be 0 if they are like, a cliff edge and being put in for one way vision blocking but I get that will be tricky for the auto placer to do." Done: **Detect walls from the map…** in the Walls tool. Click a bit of wall on the picture (a first guess is made); the walls found are drawn over it; sliders for colour closeness and the shortest piece, a switch to ignore a thin printed grid, snapping to grid corners, players can see them, and a height (10 ft). It tells thin wall lines from dark rock round light rooms and follows the right thing (lines, or the edge of the rock), and the DM can switch. "Add N walls" is one undoable step. Doors, windows and cliff edges stay manual. Tests: `tests/walltrace.test.ts`, `tests/e2e/batchZ12.mjs` (also on the sample dungeon).
- [x] **#34 "Paint height from colour" button: auto-add height mapping** (added 2026-11-23, completed 2026-11-23): same message. Done: **Paint height from a colour…** in the Heights tool (Paint mode). Click the colour of water, a pit or a platform, give it a height, and every square or hex that is mostly that colour (a slider sets how much) is painted as one area; optional "only the patch I clicked"; preview on the picture; one undoable step. Heights are not guessed from shading. Tests: `tests/colorcells.test.ts`, `tests/e2e/batchZ13.mjs`.
- [x] **#41 Grid colour shows white when black is selected** (added 2026-11-23, completed 2026-11-23): "Grid color is showing as white when black is selected? white default." Done: black was read as "no colour" and drawn white (the same slip made black token rings white). Black now draws black, and white is the default for new scenes and detected grids. Scenes saved with the old default black keep showing white, as they always did; black picked on purpose is saved as `#010101`. Tests: `tests/colornum.test.ts`.
- [x] **#45 Heights: select a section and edit its height in one click** (added 2026-11-23, completed 2026-11-23): "Heights should have a way to select a section and edit its height after its been placed in one click." Done: the Heights mode that was called Move is now **Select**: one click picks an area, and its card shows the height box and presets to change at once; dragging a selected area still moves it. The hint says so. `tests/e2e/batchN.mjs`.
- [x] **#47 "Private scene, players can't see this yet" goes to the lower left corner** (added 2026-11-23, completed 2026-11-23): "instead of the top middle". Done: the note sits at the bottom left, below the toolbar; tool panels get shorter while it is showing so nothing is covered (checked at 1366 by 768).
- [x] **#50 Remove the line "Walls shape what tokens can see once their sight is on."** (added 2026-11-23, completed 2026-11-23): Done: removed; the "Turn on fog and token sight" button stays.
- [x] **#51 "I can walk through walls" becomes "DM can move tokens through walls"** (added 2026-11-23, completed 2026-11-23): and remove the "only for you" text under it. Done: renamed, and "Only for you." is gone from under it (the hold-Q tip stays).
- [x] **#52 Remove the "Paint high and low ground…" text** (added 2026-11-23, completed 2026-11-23): Done: removed from the Heights panel.
- [x] **#53 "Cliffs: drops over X ft" is unclear** (added 2026-11-23, completed 2026-11-23): "I see a 'cliffs: drops over x ft' but im not sure what that means mechnanically." Make the label and hint say what it does (a walker cannot climb a rise bigger than this within 10 ft; see *Walking up painted cliffs* in `CLAUDE.md`). Done: now **Steepest climb** with a one-line hint: ground that rises more than this is a cliff that walkers cannot climb (they can walk down it); 0 turns cliffs off. The tooltip has the exact rule.
- [x] **#54 Rename "Rub out" to "Erase"** (added 2026-11-23, completed 2026-11-23): Done: in the Heights panel (heights and difficult ground), the history labels, the README and the browser tests.
- [x] **#55 Rename the "Move" tool** (added 2026-11-23, completed 2026-11-23): "Move should be called select or something better." Done: the Heights mode is now **Select** (see #45). The picture editor's own Move button is unchanged.
- [x] **#61 Top-right dropdown menus are as wide as their words** (added 2026-11-23, completed 2026-11-23): "so they arent unecessarily long." Done: every dropdown now takes the width of the choice shown instead of filling its panel. The top-right pills have only buttons, so if a particular dropdown still looks too long, tell me which one.
- [x] **#35 Delete a table from the list of your tables** (added 2026-11-23, completed 2026-11-23): "There should be a button to delete a table on the list of your tables." Needs a confirmation, because it is not undoable. Done: each table on the start page has **Delete** (it asks first). It clears the table's scenes, players, saved characters, handouts and DM notes and removes it from the list; pictures on ImgBB are not touched. The database rules have no write at the level of `players`, `chars` or `scenes`, so those are cleared entry by entry. Removing the table's `owner` marker (so its old link stops working) needs the rules republished (#62); until then the contents are deleted and the old link opens an empty table, and the app says so. Tests: `tests/tables.test.ts`, `tests/rules.test.ts`, `tests/e2e/batchZ14.mjs`.
- [x] **#36 Deleting an uploaded picture also deletes it from ImgBB if possible** (added 2026-11-23, completed 2026-11-23): "IDK if youve done this already, but when you delete a uploaded image in the VTT, it should also delete it from IMGBB if possible." #18 and #22 only keep the private deletion link for the DM to use by hand; check what a browser can really do and make it automatic where it can. Done: removing a library picture still moves its private deletion link to *ImgBB cleanup* in the same write, then asks ImgBB to delete it from the browser (a DELETE on the deletion link with the DM's key); only when ImgBB answers with JSON success is the cleanup link dropped. **Not checked against the real ImgBB:** ImgBB documents only uploads and my environment cannot reach it, and a browser may be blocked by the host; if so the toast says to finish under ImgBB cleanup, as before. Tests: `tests/imgbb.test.ts`, `tests/e2e/libraryDelete.mjs`.
- [x] **#37 Tables should be renamable** (added 2026-11-23, completed 2026-11-23): Done: **Rename** on each table in the start page (Enter saves, Esc cancels). It changes the name on the table itself and in the list, and the in-table Settings rename still works. Tests: `tests/tables.test.ts`, `tests/e2e/batchZ14.mjs`.
- [x] **#38 Remove "paste a link to a picture"** (added 2026-11-23, completed 2026-11-23): "Remove the paste a link to a picture option, i dont think its needed." Scene and picture pickers; the token maker is #58. Done: gone from New scene and My library (and from Add token, #58). A picture dragged in from another web page still works and shows as "Using the picture from <site>" with a remove button. The two messages that suggested a link no longer do.
- [x] **#39 No "bring players to it as soon as it's made" tick on a first table** (added 2026-11-23, completed 2026-11-23): "On first table creation, i dont think theres any way for a player to be existent since they didnt have the add player link yet, so there shouldnt be a 'summon players to it as soon as its made' check." Done: the tick only shows once someone other than the DM has joined the table. The first scene is still live straight away. Test: `tests/e2e/batchY.mjs`, `tests/e2e/batchZ14.mjs`.
- [x] **#40 Library maps: expandable, searchable, hover preview** (added 2026-11-23, completed 2026-11-23): "From your library when looking through map options should be expandable and searchable if you want to look through things in the library. Maybe even a hover preview of the full image." Done: in New scene the library shows the newest dozen with a search box (words match names) and **Show all N**, which opens every picture out in a wider window with names; My library has the same search; pointing at a picture shows it larger with its name and size. New uploads keep ImgBB's medium copy for that preview, and a very large original (over 12 megapixels) is never loaded just to look at it. Test: `tests/e2e/batchZ14.mjs`.
- [x] **#58 Token maker: remove the add-picture-by-pasted-link option** (added 2026-11-23, completed 2026-11-23): Done: removed from Add token (a dropped picture from a web page still fills the token).
- [x] **#44 Paint height from colour: a plus button to add another colour at the same height** (added 2026-11-23, completed 2026-11-23): "you should be able to add a color for that same height so a plus button." Done: the Colour row has a swatch per colour and a **+** (it waits for a click on the picture before another can be added); click a swatch to say the next click changes that one, ✕ removes it. The picked colours add up into one area at the one height (`colorsRegion`, unit-tested).
- [x] **#46 Paint height from colour: only the patch I clicked is on by default** (added 2026-11-23, completed 2026-11-23): "Only patch i clicked should be on by default." Done: the switch starts on; the hint says what off does (every place on the map with these colours). With several colours, each keeps its own clicked patch.
- [x] **#48 Height tools: the "On this map" toggles can be collapsed** (added 2026-11-23, completed 2026-11-23): "more something you set once and leave for long periods of time." Done: in the Walls tool the three switches sit under a folded **On this map** heading (folded by default, and the choice is remembered in that browser). The "Turn on fog and token sight" button stays outside the fold while sight is off.
- [x] **#49 Windows can be opened and closed, closed by default** (added 2026-11-23, completed 2026-11-23): "Windows should be openable and closable as well, closed by default." Done: a window is shut when drawn, and shut it still lets sight and spells through but stops walking; open, nothing stops a walker. The DM clicks its small square (any tool) or double-clicks it in Edit mode, or uses the Closed/Open buttons in the Walls card. Windows saved earlier load shut. Players still cannot open them.
- [x] **#56 A spell template can be marked as difficult terrain and counts when moving tokens** (added 2026-11-23, completed 2026-11-23): "calcualted in moving tokens." Done: **Counts as difficult ground** in the spell-template panel (for the ones you place next) and **Difficult ground** on the bar of a selected template. A marked template becomes strokes of difficult ground for the squares the spell reaches (`templateRoughDraws`), so the hatching, the drag readout and test moves all count it, and a wall that stops the spell stops it too. It goes when the template does; undo brings it back. No rules change.
- [x] **#57 Ruler: show the distance at every step, including the first two** (added 2026-11-23, completed 2026-11-23): "it shows all but the first 2 distances, it should show those too when doing several steps." Done: the corner labels started at the second corner, so the end of the first leg never got its distance; every corner now shows the distance so far (`cornerTotals`).
- [x] **#60 Light source tokens are their own kind of token** (added 2026-11-23, completed 2026-11-23): "remove all the stuff a light source would never need" (keep things like flying and hit points, since a light can be a spell effect). Done: a light (a marker with no picture, no frame and a light) opens a short editor with the light itself (presets, bright, dim, colour, saved lights), name, hidden, locked, how its name shows, flying and height, and hit points. Gone for lights: picture and its tools, ring, size, shape, ring thickness, controlled-by, sight, darkvision, the initiative bonus and auras. Its tag at the bottom shows what it shines and drops Effects, Aura and Save to library; its right-click menu says Edit light and drops Effects, Save to library and the stacking order.
- [x] **#59 "Add light sources" button that places them smartly** (added 2026-11-23, completed 2026-11-23): "i would like a auto add light sources button that places them smartly." Done: **Auto-add lights…** in Scene, Light and darkness. It finds lamps and torches drawn on the picture (small bright warm blobs that stand out from the floor) and, for each walled room with no light, adds as few lights as will light about 90% of it with walls stopping the light (`core/autolight.ts`). The window draws the proposals over the map, lets you pick the kind of light and switch either source off, and adds them in one undoable step. Placed by working from the walls and the picture only, so a map with neither gets nothing: place those by hand.
- [x] **#43 Detect walls is poor on the much simpler `tunnel.webp`** (added 2026-11-23, completed 2026-11-23): "it also didnt do a good job on guessing walls for the much more straightforward tunnel.webp file." Cause, found by running it on the real picture: the dark rock fades softly into a crystal fringe and a blue-grey floor, and the fixed "how close the colour must be" of 22 let the rock colour run into the floor, while the ragged outline was cut into stubs shorter than the minimum wall and thrown away (20 scraps came out). Done: the setting is now **worked out from the picture** (`suggestSensitivity`: the flat colour is a tall narrow peak in the colour distances and the setting goes just past where it drops to the background, 4.7 here); solid areas are **traced as outlines directly** (`traceContours`, no centre-line step), the fringe is smoothed (`closeMask`, `smoothPath`) and the outline is simplified to about a quarter of a square, so the walls come out as long pieces; rock that runs off the picture gets no wall along the picture's own border. On the real tunnel: 74 long walls following both sides of the dark rock (was 20 scraps).
- [x] **#42 Detect walls does not help on `SeasideMap.jpg`** (added 2026-11-23, completed 2026-11-23, **partly**): "attached is a map that it is really struggling to auto add walls to in a useful way." Looked at honestly: that picture has **no flat wall colour**. Its darkest colour is jungle shadow spread over the whole map, grass and sand and rock are all textured, so no colour separates "wall" from "floor", and no setting of this tool can find the cliffs and rocks reliably. Done: the window now **says so** ("This colour is spread all over the picture ... a guess"), draws such guesses as a **coarse outline** (about 110 pieces round the lit grass plateaus, which are roughly where the cliff edges are) instead of 236 scribbles, and still lets you pick another colour. For a map like this, draw the walls by hand (Freehand turns an outline into straight walls). Both maps are tested as drawn pictures with the same traits (soft rock on a close-coloured floor; texture with no flat colour) in `tests/walltrace.test.ts`, not as the copyrighted pictures themselves.
- [x] **#62 Republish `database.rules.json` in the Firebase console** (added 2026-11-23, completed 2026-11-23): the user republished the rules (the table's `owner` can now be removed by its owner, which is how Delete makes a table's link stop working).
- [x] **#63 The scene dropdowns are not centred in their bar** (added 2026-11-23, completed 2026-11-23): "The scenes dropdown things are not sitting centered in the bar they are in." Done: the generic `select` rule pinned every dropdown to the start of its row, so the two in the top bar rode high; `.pill select` now centres them (checked at 1366 by 768 and on a big screen: both sit within a pixel of the middle).
- [x] **#64 Spell templates need a Select button** (added 2026-11-23, completed 2026-11-23): "so i can click and move around and delete a single placed template instead of clearing all of them." Done: the spell-template panel has **Place** and **Select**. In Select mode a click picks the template under the pointer (Shift adds more), a drag moves it a square at a time (Alt: freely), its dots resize it, Delete removes just that one (Ctrl+Z brings it back). Place mode and **Clear all templates** work as before.
- [x] **#65 Light sources move through walls by default** (added 2026-11-23, completed 2026-11-23): "since its mostly just something i place as the dm and then dont touch again." Done: a light-only mark is never stopped by a wall or a painted cliff when it is moved (`stepBlocked`); creatures still are. Walls still stop the light it gives.
- [x] **#66 Paint daylight onto part of a map** (added 2026-11-23, completed 2026-11-23): "if a map is half cave half outside it can show the outside as lit by that." Done: **Daylight** beside Heights and Difficult in the Heights panel. Paint (or erase) with the same brush where the sun shines; in a Twilight or Dark scene that ground is fully lit and a token that can see it sees it (walls still stop sight). It is a ground layer of its own (`dl`): it never changes height or movement, "Clear all heights" leaves it alone, and it has its own "Clear daylight". It shows gold only to the DM while painting. No rules change.
- [x] **#67 A DM toggle to see the player view** (added 2026-11-23, completed 2026-11-23): "an easy toggle to see player view, maybe between toggle grid and fog of war buttons." Done: an **eye** button in the toolbar between the grid and fog buttons (key **O**) switches the player preview on and off; it reads "Back to the DM view" while it is on. The Scene panel and fog switches and the note's Stop button still work and agree with it.
- [x] **#68 Shorter wording for "Private scene, players can't see this yet"** (added 2026-11-23, completed 2026-11-23): "something shorter and more succinct." Done: "Hidden from players" (the longer reason is its tooltip).
- [x] **#69 Token maker says "Upload a picture", not "Choose a picture"** (added 2026-11-23, completed 2026-11-23). Done: the picture button in the token maker (and every other file picker that used the default label) says "Upload a picture…".
