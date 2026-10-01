# Ladder — design system

Ladder is a training logbook used mid-workout, one-handed, between sets. Every
decision below serves that: numbers first, glanceable state, flat structure,
nothing that has to be read twice.

## Direction

- **A logbook, not a dashboard.** The content is lists of numbers. Structure
  comes from type, alignment and hairlines, not boxes. No screen nests cards.
- **Numbers carry the weight.** Targets and logged sets are set in Barlow
  Semi Condensed, the narrow DIN-like face used on gym equipment and
  scoreboards, with tabular figures so columns line up.
- **One ink colour.** A deep fountain-pen blue marks what is yours to act on
  (the primary action, the next set, logged sets, links). Everything else is
  neutral. State is shown by weight and position before colour.
- **Quiet chrome.** Reorder and delete controls are hidden until "Edit".
  Secondary actions are text buttons. Only one filled button per screen.

## Tokens

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--bg` | #ffffff | #141516 | Page |
| `--fill` | #f2f2ef | #1f2123 | Input fields, segmented track, set editor |
| `--line` | #e4e4e0 | #2c2f32 | Hairlines and borders |
| `--line-strong` | #c9c9c3 | #45494d | Unchecked boxes, input borders |
| `--ink` | #1b1b1b | #ececea | Primary text |
| `--ink-2` | #55554f | #b0b1ad | Secondary text |
| `--ink-3` | #8a8a83 | #7d7f7b | Labels, meta |
| `--accent` | #283a8e | #9fb0ff | Primary action, logged sets, links |
| `--accent-weak` | #e9ecf7 | #222a4a | Selected states |
| `--warn` | #9a5b00 | #e8b057 | Deload, backup reminder |
| `--danger` | #b3261e | #f2867e | Destructive actions, errors |

## Type

Barlow (UI text) and Barlow Semi Condensed (titles and numbers), vendored in
`fonts/`.

| Role | Face | Size / line | Weight |
| --- | --- | --- | --- |
| Screen title (tab roots) | Semi Condensed | 30 / 34 | 600 |
| Screen title (pushed) | Semi Condensed | 22 / 28 | 600 |
| Section heading | Barlow | 17 / 22 | 600 |
| Exercise name | Barlow | 18 / 24 | 600 |
| Target / set value | Semi Condensed | 22 / 28, 20 / 26 | 600 |
| Body | Barlow | 16 / 22 | 400 |
| Secondary | Barlow | 14 / 20 | 400 |
| Meta | Barlow | 13 / 18 | 500 |

No all-caps labels. Sentence case everywhere except exercise and workout names.

## Space, radius, elevation

- Spacing scale: 4, 8, 12, 16, 24, 32, 48. Page gutter 16.
- Radius: 6 (check boxes, steppers), 10 (buttons, inputs, segmented),
  16 (bottom sheet top corners). Nothing else is rounded.
- Elevation: none on content. The bottom sheet and sticky headers separate
  by a hairline; the sheet alone has a shadow.

## Components

- **Header**: sticky, white, hairline under it. Tab roots use a large title;
  pushed screens use back + title + one right-hand action.
- **List row**: 52 px min, title + optional meta line, right-aligned value,
  chevron only when the row navigates.
- **Buttons**: primary (filled ink, 48 px), secondary (1 px border), text
  (ink colour, no box), danger text.
- **Set row**: index, value in Semi Condensed, 40 px check box. Unchecked =
  outline, next = ink outline, logged = filled ink.
- **Switch**: for binary settings (Deload, Per side, modifier on a set).
- **States**: pressed = darker fill / opacity .7; disabled = 40% opacity;
  focus = 2 px ink ring; empty = one sentence plus the action that fixes it;
  errors = danger text under the field, saying what to change.
