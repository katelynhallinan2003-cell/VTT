# WIP

Every issue the user raises goes in this file. Open issues sit at the top; finished ones are moved to the bottom and
marked complete. The rules for keeping it are in `CLAUDE.md`.

**Entry format**

```
- [ ] **#N Short title** (added YYYY-MM-DD): what was asked, in the user's words where useful.
- [x] **#N Short title** (added YYYY-MM-DD, completed YYYY-MM-DD): what was asked. Done: what shipped.
```

Numbers are given in the order issues arrive and are never reused. An issue being worked on right now gets
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
