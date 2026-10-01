# Ladder

A personal strength and cardio tracker for your phone. It tells you what to do today,
logs what you actually did in a tap or two, and uses that history to suggest the next
target.

- Your data stays on the phone, in the browser's storage. The app works offline after
  the first load and never sends data anywhere.
- All data is a single JSON document. **Data → Export JSON** downloads it. The same file
  can be imported back, moved to a new phone, or read by any other tool.
- There are no accounts, servers or build step. It's plain HTML, CSS and JavaScript.

## Install on Android (one-time)

1. Push this folder to GitHub (the `thausdorff/training-tracker` repository).
2. On GitHub, open the repository's **Settings → Pages**. Under **Build and deployment**,
   set **Source** to *Deploy from a branch*, choose **Branch** `main`, keep the folder at
   `/ (root)`, and click **Save**.
3. Wait about a minute, then open `https://thausdorff.github.io/training-tracker/` in
   Chrome on the phone.
4. Open Chrome's ⋮ menu and choose **Add to Home screen** → **Install**. Launch the app
   from the home-screen icon from then on. Installing also protects the app's storage
   from automatic clean-up.

## Updating the app

After you change any file, bump `VERSION` in `sw.js` (for example `tt-v1.0.1`), then
commit and push. The installed app picks up the new version the next time it's opened
(occasionally the time after that). Your data is never touched by an update.

## How suggestions work

Suggestions are always recomputed from the logged history. None of this is stored.

- **Strength target:** the weakest working set of the last non-deload session + 1 rep, at
  the weight actually used. With mixed weights in a session, the heaviest weight is used,
  along with the weakest set at that weight.
- **Top of range:** once the weakest set reaches the top of the range (12 or 16), the next
  ladder stage starts:
  - *Reps → load*: +weight step (default 2 kg) or the next band; reps reset to the bottom.
  - *Reps → modifier → load*: first the modifier (e.g. Pause) goes on and reps reset to
    the bottom; after that, +load, reps reset to the bottom, and the modifier comes off.
  - Bodyweight exercises, and the heaviest band: reps keep climbing past the top.
- **Timed holds:** the weakest hold + 5 s, up to an optional ceiling. With an optional range
  (e.g. 30–45 s) and a modifier, holds use the same ladder as reps: climb the range, add the
  modifier, climb again, then keep adding time.
- **Per side:** for unilateral exercises, log the weaker side. Progression then waits until
  both sides are ready.
- **Cardio:** last time + 3 min (or an optional starting time for the first session), up to a
  ceiling (default 40 min). At the ceiling, the
  target is to beat the last distance in the same time.
- **Deload:** a session marked as a deload is ignored by progression, but still moves
  the rotation forward.
- **Program change:** changing an exercise's rep range or ladder restarts it at the bottom
  of the new range, at the current weight.
- **Rotation:** the next workout is the one after the last planned workout that had
  anything logged. This includes partial or abandoned sessions. Unplanned sessions don't
  move the rotation.

## Data format (`version: 1`)

```jsonc
{
  "version": 1,
  "exercises": [{ "id", "name", "type": "weighted|band|bodyweight|hold|cardio",
                  "repRange": [8,12], "ladder": "simple|modifier", "modifierName",
                  "weightStep", "holdStep", "holdCeiling", "holdRange"?, "durationStep",
                  "durationCeiling", "startMinutes"?, "perSide"?,
                  "restartAt"? }],
  "bands": ["Yellow", "Red", "Black"],            // light → heavy
  "warmup": ["Arm circles", "..."],
  "workouts": [{ "id", "name", "items": [{ "exerciseId", "sets", "supersetWithNext" }] }],
  "sessions": [{ "id", "date": "YYYY-MM-DD", "startedAt", "finishedAt",
                 "workoutId"|null, "workoutName", "deload", "warmupDone": ["..."],
                 "entries": [{ "exerciseId", "plannedSets", "supersetWithNext",
                               "sets": [{ "weight"|"band", "reps", "modifier" }
                                        | { "seconds" } | { "minutes", "km" }] }] }],
  "settings": { "backupReminderDays": 7, "lastExport": null }
}
```

## Your program

`program/3-day-home-plan.json` is the 3-day home plan, ready for **Data → Import JSON**.
To change it, edit `program/build-program.mjs` and run `node program/build-program.mjs`.
Or edit the plan inside the app.

## Design

The visual system (type, colour, spacing, components) is documented in `DESIGN.md`.
Fonts: Barlow and Barlow Semi Condensed (SIL Open Font License), vendored in `fonts/`.

## Development

- `src/engine.js` holds the progression rules as pure functions.
- `src/store.js` handles storage, import and export.
- `src/app.js` is the UI (Preact + htm, vendored in `vendor/`).
- Tests: `node --test tests/*.test.mjs` (requires Node 18+).
- To run locally, serve the folder with any static server, e.g. `python -m http.server`,
  and open `http://localhost:8000`.
