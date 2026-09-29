import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  targetFor, nextWorkout, personalRecord, chartSeries, applyExerciseEdit,
  validateData, emptyData, summarizeSets, formatTarget, setFromTarget,
} from '../src/engine.js';

// ---- helpers ----
let n = 0;
const day = (i) => `2026-10-${String(i).padStart(2, '0')}`;
function mk(overrides = {}) {
  return {
    ...emptyData(),
    bands: ['Yellow', 'Red', 'Black'],
    exercises: [
      { id: 'bench', name: 'Bench', type: 'weighted', repRange: [8, 12], ladder: 'simple', weightStep: 2 },
      { id: 'row', name: 'Row', type: 'weighted', repRange: [8, 12], ladder: 'modifier', modifierName: 'Pause', weightStep: 2 },
      { id: 'pull', name: 'Band pull', type: 'band', repRange: [12, 16], ladder: 'simple' },
      { id: 'push', name: 'Push-up', type: 'bodyweight', repRange: [12, 16], ladder: 'modifier', modifierName: 'Pause' },
      { id: 'plank', name: 'Plank', type: 'hold', holdStep: 5, holdCeiling: null },
      { id: 'run', name: 'Run', type: 'cardio', durationStep: 3, durationCeiling: 40 },
    ],
    workouts: [
      { id: 'A', name: 'A', items: [] },
      { id: 'B', name: 'B', items: [] },
      { id: 'C', name: 'C', items: [] },
    ],
    ...overrides,
  };
}
function sess(i, entries, extra = {}) {
  n += 1;
  return { id: `s${n}`, date: day(i), startedAt: `${day(i)}T10:00:00Z`, workoutId: null, deload: false, warmupDone: [], entries, ...extra };
}
const w = (exerciseId, sets) => ({ exerciseId, sets });
const S = (weight, ...reps) => reps.map((r) => ({ weight, reps: r, modifier: false }));
const SP = (weight, ...reps) => reps.map((r) => ({ weight, reps: r, modifier: true }));

// ---- strength: reps rule ----
test('weakest set + 1', () => {
  const d = mk({ sessions: [sess(1, [w('bench', S(20, 10, 10, 9))])] });
  const t = targetFor(d, 'bench');
  assert.equal(t.reps, 10); assert.equal(t.weight, 20); assert.equal(t.modifier, false);
  assert.match(t.reason, /weakest set was 9/);
});

test('beating target skips ahead (12,12,12 vs target 10 → 13 on a 12-16 range)', () => {
  const d = mk({ sessions: [sess(1, [w('push', [{ reps: 12 }, { reps: 12 }, { reps: 12 }].map((s) => ({ ...s, modifier: false })))])] });
  // push is 12-16: weakest 12 is not top, so 13
  assert.equal(targetFor(d, 'push').reps, 13);
});

test('target can go down (8,8,7 → 8)', () => {
  const d = mk({ sessions: [sess(1, [w('bench', S(20, 11, 11, 11))]), sess(2, [w('bench', S(20, 8, 8, 7))])] });
  assert.equal(targetFor(d, 'bench').reps, 8);
});

test('different weight than suggested: continue from actual (22×8 → 22×9)', () => {
  const d = mk({ sessions: [sess(1, [w('bench', S(20, 9, 9, 9))]), sess(2, [w('bench', S(22, 8, 8, 8))])] });
  const t = targetFor(d, 'bench');
  assert.equal(t.weight, 22); assert.equal(t.reps, 9);
});

test('lighter weight than suggested: continue from actual', () => {
  const d = mk({ sessions: [sess(1, [w('bench', S(18, 10, 10, 10))])] });
  assert.equal(targetFor(d, 'bench').weight, 18);
});

test('mixed weights: heaviest weight, weakest set at that weight', () => {
  const d = mk({ sessions: [sess(1, [w('bench', [...S(22, 9, 8), ...S(20, 6)])])] });
  const t = targetFor(d, 'bench');
  assert.equal(t.weight, 22); assert.equal(t.reps, 9);
});

test('fewer or more sets than planned: weakest logged set counts', () => {
  const d = mk({ sessions: [sess(1, [w('bench', S(20, 11))])] });
  assert.equal(targetFor(d, 'bench').reps, 12);
  const d2 = mk({ sessions: [sess(1, [w('bench', S(20, 11, 11, 11, 11, 10))])] });
  assert.equal(targetFor(d2, 'bench').reps, 11);
});

// ---- simple ladder ----
test('simple ladder: top of range → +2 kg, reset to bottom', () => {
  const d = mk({ sessions: [sess(1, [w('bench', S(20, 12, 12, 12))])] });
  const t = targetFor(d, 'bench');
  assert.equal(t.weight, 22); assert.equal(t.reps, 8); assert.equal(t.modifier, false);
});

test('simple ladder: exceeding top also steps up', () => {
  const d = mk({ sessions: [sess(1, [w('bench', S(20, 14, 13, 13))])] });
  assert.deepEqual([targetFor(d, 'bench').weight, targetFor(d, 'bench').reps], [22, 8]);
});

test('custom weight step', () => {
  const d = mk({ sessions: [sess(1, [w('bench', S(20, 12, 12))])] });
  d.exercises[0].weightStep = 2.5;
  assert.equal(targetFor(d, 'bench').weight, 22.5);
});

// ---- modifier ladder ----
test('modifier ladder: top without modifier → modifier on, back to bottom, same weight', () => {
  const d = mk({ sessions: [sess(1, [w('row', S(20, 12, 12, 12))])] });
  const t = targetFor(d, 'row');
  assert.equal(t.weight, 20); assert.equal(t.reps, 8); assert.equal(t.modifier, true);
  assert.match(t.reason, /Pause on/);
});

test('modifier ladder: climbing with modifier keeps it on', () => {
  const d = mk({ sessions: [sess(1, [w('row', SP(20, 9, 9, 10))])] });
  const t = targetFor(d, 'row');
  assert.equal(t.reps, 10); assert.equal(t.modifier, true);
});

test('modifier ladder: top with modifier → +2 kg, bottom, modifier off', () => {
  const d = mk({ sessions: [sess(1, [w('row', SP(20, 12, 12, 12))])] });
  const t = targetFor(d, 'row');
  assert.equal(t.weight, 22); assert.equal(t.reps, 8); assert.equal(t.modifier, false);
});

test('modifier only on some sets counts as modifier off', () => {
  const d = mk({ sessions: [sess(1, [w('row', [...SP(20, 12), ...S(20, 12, 12)])])] });
  const t = targetFor(d, 'row');
  assert.equal(t.modifier, true); assert.equal(t.reps, 8); assert.equal(t.weight, 20);
});

// ---- bands ----
test('band: top of range → next band', () => {
  const d = mk({ sessions: [sess(1, [w('pull', [{ band: 'Yellow', reps: 16 }, { band: 'Yellow', reps: 16 }])])] });
  const t = targetFor(d, 'pull');
  assert.equal(t.band, 'Red'); assert.equal(t.reps, 12);
});

test('band: heaviest band → keep adding reps', () => {
  const d = mk({ sessions: [sess(1, [w('pull', [{ band: 'Black', reps: 16 }, { band: 'Black', reps: 17 }])])] });
  const t = targetFor(d, 'pull');
  assert.equal(t.band, 'Black'); assert.equal(t.reps, 17);
});

test('band: mixed bands → heaviest band used', () => {
  const d = mk({ sessions: [sess(1, [w('pull', [{ band: 'Yellow', reps: 16 }, { band: 'Red', reps: 12 }])])] });
  const t = targetFor(d, 'pull');
  assert.equal(t.band, 'Red'); assert.equal(t.reps, 13);
});

// ---- bodyweight ----
test('bodyweight modifier ladder: top → modifier; top with modifier → keep climbing', () => {
  const d1 = mk({ sessions: [sess(1, [w('push', [{ reps: 16, modifier: false }, { reps: 16, modifier: false }])])] });
  const t1 = targetFor(d1, 'push');
  assert.equal(t1.reps, 12); assert.equal(t1.modifier, true);
  const d2 = mk({ sessions: [sess(1, [w('push', [{ reps: 16, modifier: true }, { reps: 18, modifier: true }])])] });
  const t2 = targetFor(d2, 'push');
  assert.equal(t2.reps, 17); assert.equal(t2.modifier, true);
});

test('bodyweight first time: bottom of range, no start needed', () => {
  const t = targetFor(mk(), 'push');
  assert.equal(t.reps, 12); assert.ok(!t.needsStart);
});

// ---- first time ----
test('weighted first time: needs starting weight, bottom of range, no modifier', () => {
  const t = targetFor(mk(), 'bench');
  assert.equal(t.needsStart, true); assert.equal(t.reps, 8); assert.equal(t.modifier, false); assert.equal(t.weight, null);
});

// ---- deload ----
test('deload sessions are ignored by progression', () => {
  const d = mk({ sessions: [
    sess(1, [w('bench', S(24, 10, 10, 10))]),
    sess(2, [w('bench', S(16, 12, 12, 12))], { deload: true }),
  ] });
  const t = targetFor(d, 'bench');
  assert.equal(t.weight, 24); assert.equal(t.reps, 11);
});

// ---- breaks ----
test('after a long break: usual next target', () => {
  const d = mk({ sessions: [sess(1, [w('bench', S(20, 10, 10, 10))])] });
  d.sessions[0].date = '2025-01-01'; d.sessions[0].startedAt = '2025-01-01T10:00:00Z';
  assert.equal(targetFor(d, 'bench').reps, 11);
});

// ---- today's own sets never feed today's target ----
test('target excludes the in-progress session', () => {
  const cur = sess(2, [w('bench', S(20, 12, 12, 12))]);
  const d = mk({ sessions: [sess(1, [w('bench', S(20, 9, 9, 9))]), cur] });
  assert.equal(targetFor(d, 'bench', cur).reps, 10);
  assert.equal(targetFor(d, 'bench').weight, 22); // after it, it counts
});

test('editing a past session recalculates (history is the source of truth)', () => {
  const d = mk({ sessions: [sess(1, [w('bench', S(20, 10, 10, 10))])] });
  assert.equal(targetFor(d, 'bench').reps, 11);
  d.sessions[0].entries[0].sets[2].reps = 8;
  assert.equal(targetFor(d, 'bench').reps, 9);
});

// ---- program change ----
test('changing rep range restarts at bottom of new range at current weight', () => {
  const d = mk({ sessions: [sess(1, [w('bench', S(24, 10, 10, 10))])] });
  d.exercises[0] = applyExerciseEdit(d.exercises[0], { ...d.exercises[0], repRange: [12, 16] }, '2026-10-05T00:00:00Z');
  const t = targetFor(d, 'bench');
  assert.equal(t.reps, 12); assert.equal(t.weight, 24); assert.equal(t.modifier, false);
  assert.match(t.reason, /Program changed/);
  // after a new session post-change, normal rules resume
  d.sessions.push(sess(6, [w('bench', S(24, 12, 12, 13))]));
  assert.equal(targetFor(d, 'bench').reps, 13);
});

test('changing ladder restarts; changing only weight step does not', () => {
  const ex = { id: 'x', type: 'weighted', repRange: [8, 12], ladder: 'simple', weightStep: 2 };
  assert.ok(applyExerciseEdit(ex, { ...ex, ladder: 'modifier' }, 'T').restartAt);
  assert.ok(!applyExerciseEdit(ex, { ...ex, weightStep: 4 }, 'T').restartAt);
});

// ---- holds ----
test('hold: weakest + 5 s, optional ceiling', () => {
  const d = mk({ sessions: [sess(1, [w('plank', [{ seconds: 40 }, { seconds: 35 }])])] });
  assert.equal(targetFor(d, 'plank').seconds, 40);
  d.exercises.find((e) => e.id === 'plank').holdCeiling = 38;
  assert.equal(targetFor(d, 'plank').seconds, 38);
  const d2 = mk({ sessions: [sess(1, [w('plank', [{ seconds: 60 }])])] });
  d2.exercises.find((e) => e.id === 'plank').holdCeiling = 60;
  assert.equal(targetFor(d2, 'plank').seconds, 60);
  assert.equal(targetFor(mk(), 'plank').needsStart, true);
});

// ---- cardio ----
test('cardio: +3 min until ceiling', () => {
  const d = mk({ sessions: [sess(1, [w('run', [{ minutes: 24, km: 4 }])])] });
  const t = targetFor(d, 'run');
  assert.equal(t.minutes, 27); assert.equal(t.beatDistance, undefined);
});

test('cardio: capped at ceiling', () => {
  const d = mk({ sessions: [sess(1, [w('run', [{ minutes: 39, km: 6 }])])] });
  assert.equal(targetFor(d, 'run').minutes, 40);
});

test('cardio: at ceiling → beat distance at fixed time', () => {
  const d = mk({ sessions: [sess(1, [w('run', [{ minutes: 40, km: 6.2 }])])] });
  const t = targetFor(d, 'run');
  assert.equal(t.minutes, 40); assert.equal(t.beatDistance, true); assert.equal(t.km, 6.2);
  assert.match(formatTarget(d.exercises[5], t), /> 6.2 km/);
});

test('cardio: editable ceiling and no ceiling', () => {
  const d = mk({ sessions: [sess(1, [w('run', [{ minutes: 40, km: 6 }])])] });
  d.exercises[5].durationCeiling = 50;
  assert.equal(targetFor(d, 'run').minutes, 43);
  d.exercises[5].durationCeiling = null;
  assert.equal(targetFor(d, 'run').minutes, 43);
});

test('cardio: ignores deload', () => {
  const d = mk({ sessions: [sess(1, [w('run', [{ minutes: 30, km: 5 }])]), sess(2, [w('run', [{ minutes: 15, km: 2 }])], { deload: true })] });
  assert.equal(targetFor(d, 'run').minutes, 33);
});

// ---- rotation ----
const planned = (i, wid, extra) => sess(i, [w('bench', S(20, 10))], { workoutId: wid, ...extra });

test('rotation: nothing logged → first workout', () => {
  assert.equal(nextWorkout(mk()).id, 'A');
});

test('rotation: after A → B, after C → A', () => {
  assert.equal(nextWorkout(mk({ sessions: [planned(1, 'A')] })).id, 'B');
  assert.equal(nextWorkout(mk({ sessions: [planned(1, 'C')] })).id, 'A');
});

test('rotation: doing B out of order → C next', () => {
  assert.equal(nextWorkout(mk({ sessions: [planned(1, 'B')] })).id, 'C');
});

test('rotation: partial/abandoned A still counts → B', () => {
  const s = sess(1, [w('bench', S(20, 10))], { workoutId: 'A', finishedAt: null });
  assert.equal(nextWorkout(mk({ sessions: [s] })).id, 'B');
});

test('rotation: unplanned session does not advance', () => {
  assert.equal(nextWorkout(mk({ sessions: [planned(1, 'A'), sess(2, [w('bench', S(20, 10))])] })).id, 'B');
});

test('rotation: deload session advances (A deload → B)', () => {
  assert.equal(nextWorkout(mk({ sessions: [planned(1, 'A', { deload: true })] })).id, 'B');
});

test('rotation: empty started session does not count', () => {
  const s = sess(2, [], { workoutId: 'B' });
  assert.equal(nextWorkout(mk({ sessions: [planned(1, 'A'), s] })).id, 'B');
});

test('rotation: warm-up only counts as started', () => {
  const s = sess(2, [], { workoutId: 'B', warmupDone: ['Arm circles'] });
  assert.equal(nextWorkout(mk({ sessions: [planned(1, 'A'), s] })).id, 'C');
});

// ---- records & charts ----
test('PRs: heaviest weight and longest distance', () => {
  const d = mk({ sessions: [
    sess(1, [w('bench', S(20, 10)), w('run', [{ minutes: 30, km: 5.5 }])]),
    sess(2, [w('bench', S(24, 6)), w('run', [{ minutes: 33, km: 5.2 }])]),
    sess(3, [w('bench', S(22, 10))]),
  ] });
  assert.equal(personalRecord(d, 'bench').value, 24);
  assert.equal(personalRecord(d, 'bench').date, day(2));
  assert.equal(personalRecord(d, 'run').value, 5.5);
  assert.equal(personalRecord(d, 'pull'), null);
});

test('chart series: heaviest weight per session', () => {
  const d = mk({ sessions: [sess(1, [w('bench', S(20, 10))]), sess(2, [w('bench', [...S(22, 8), ...S(20, 10)])])] });
  assert.deepEqual(chartSeries(d, 'bench').points.map((p) => p.value), [20, 22]);
});

// ---- misc ----
test('summaries', () => {
  const ex = mk().exercises[1];
  assert.equal(summarizeSets(ex, SP(20, 10, 10, 9)), '20 kg × 10, 10, 9 · Pause');
  assert.deepEqual(setFromTarget(ex, { reps: 9, weight: 20, modifier: true }), { reps: 9, modifier: true, weight: 20 });
});

test('validateData rejects bad input and fills defaults', () => {
  assert.throws(() => validateData({ version: 2 }));
  assert.throws(() => validateData({ ...emptyData(), sessions: [{ id: 'x', date: '2026-01-01', entries: [{ exerciseId: 'nope', sets: [] }] }] }));
  const ok = validateData({ ...emptyData(), settings: undefined });
  assert.equal(ok.settings.backupReminderDays, 7);
});

// ---- hold ladder (range + modifier) ----
function sideplank(extra = {}) {
  return { id: 'sp', name: 'Side plank', type: 'hold', holdStep: 5, holdRange: [30, 45], ladder: 'modifier', modifierName: 'Top leg raised', ...extra };
}
test('hold ladder: first time starts at bottom of range, no start needed', () => {
  const d = mk(); d.exercises.push(sideplank());
  const t = targetFor(d, 'sp');
  assert.equal(t.seconds, 30); assert.ok(!t.needsStart); assert.equal(t.modifier, false);
});
test('hold ladder: +5 s below top, weakest set counts', () => {
  const d = mk({ sessions: [sess(1, [w('sp', [{ seconds: 40 }, { seconds: 35 }])])] }); d.exercises.push(sideplank());
  assert.equal(targetFor(d, 'sp').seconds, 40);
});
test('hold ladder: top without modifier → modifier on, back to bottom', () => {
  const d = mk({ sessions: [sess(1, [w('sp', [{ seconds: 45 }, { seconds: 46 }])])] }); d.exercises.push(sideplank());
  const t = targetFor(d, 'sp');
  assert.equal(t.seconds, 30); assert.equal(t.modifier, true);
});
test('hold ladder: climbing with modifier keeps it; top with modifier keeps adding time', () => {
  const d = mk({ sessions: [sess(1, [w('sp', [{ seconds: 35, modifier: true }])])] }); d.exercises.push(sideplank());
  assert.deepEqual([targetFor(d, 'sp').seconds, targetFor(d, 'sp').modifier], [40, true]);
  const d2 = mk({ sessions: [sess(1, [w('sp', [{ seconds: 45, modifier: true }])])] }); d2.exercises.push(sideplank());
  assert.deepEqual([targetFor(d2, 'sp').seconds, targetFor(d2, 'sp').modifier], [50, true]);
});
test('hold ladder: range change restarts at bottom', () => {
  const d = mk({ sessions: [sess(1, [w('sp', [{ seconds: 40 }])])] });
  const ex = sideplank(); d.exercises.push(applyExerciseEdit(ex, { ...ex, holdRange: [20, 40] }, '2026-10-05T00:00:00Z'));
  assert.equal(targetFor(d, 'sp').seconds, 20);
});

test('cardio: optional starting minutes for the first session', () => {
  const d = mk(); d.exercises[5].startMinutes = 20;
  const t = targetFor(d, 'run');
  assert.equal(t.minutes, 20); assert.ok(!t.needsStart);
});
