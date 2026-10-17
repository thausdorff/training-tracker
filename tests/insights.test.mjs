import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyData } from '../src/engine.js';
import { ladderSeries, progressOverview, weeklyConsistency, setsPerMuscle, workoutCode } from '../src/insights.js';

const ex = {
  id: 'row', name: 'Row', type: 'weighted', repRange: [8, 12], ladder: 'modifier', modifierName: 'Pause', weightStep: 2, muscles: ['Lats', 'Upper Back'],
};
const run = { id: 'run', name: 'Run', type: 'cardio', durationStep: 3, durationCeiling: 40 };
let n = 0;
const S = (date, sets, extra = {}) => ({ id: `s${++n}`, date, startedAt: `${date}T08:00:00Z`, workoutId: 'A', entries: [{ exerciseId: 'row', sets }], ...extra });
const W = (w, mod, ...reps) => reps.map((r) => ({ weight: w, reps: r, modifier: mod }));
const data = (sessions, more = {}) => ({ ...emptyData(), exercises: [ex, run], workouts: [{ id: 'A', name: 'A · Legs', items: [] }, { id: 'B', name: 'B · Back', items: [] }, { id: 'D', name: 'D · Extra', items: [], optional: true }], sessions, ...more });

test('ladder series: weakest set per session, modifier and load markers', () => {
  const d = data([
    S('2026-09-01', W(20, false, 11, 10)),
    S('2026-09-04', W(20, false, 12, 12)),
    S('2026-09-08', W(20, true, 8, 8)),
    S('2026-09-11', W(20, true, 12, 12)),
    S('2026-09-15', W(22, false, 9, 8)),
  ]);
  const s = ladderSeries(d, 'row');
  assert.deepEqual(s.points.map((p) => p.value), [10, 12, 8, 12, 8]);
  assert.deepEqual(s.points.map((p) => p.modifier), [false, false, true, true, false]);
  assert.deepEqual(s.markers, [{ index: 4, label: '+2 kg', up: true }]);
  // the score climbs by one step at each stage change
  const sc = s.points.map((p) => p.score);
  assert.equal(sc[2] - sc[1], 1); // 12 plain → 8 with pause
  assert.equal(sc[4] - sc[3], 1); // 12 with pause → 8 at +2 kg
});

test('deload sessions do not create load markers', () => {
  const d = data([S('2026-09-01', W(20, false, 10)), S('2026-09-04', W(14, false, 12), { deload: true }), S('2026-09-08', W(20, false, 11))]);
  assert.equal(ladderSeries(d, 'row').markers.length, 0);
});

test('progress overview: steps over 28 days, current position, stall detection', () => {
  const d = data([
    S('2026-09-01', W(20, false, 9)),
    S('2026-09-20', W(20, false, 10)),
    S('2026-09-27', W(20, false, 12)),
    S('2026-10-04', W(20, true, 8)),
  ]);
  const [r] = progressOverview(d, '2026-10-05').filter((x) => x.ex.id === 'row');
  assert.equal(r.now, '20 kg, 8/12, pause');
  assert.equal(r.delta, 4); // 9 on 1 Sep (before window) → pause 8: 3 reps + 1 stage
  assert.equal(r.stalled, false);
  const d2 = data([S('2026-09-01', W(20, false, 10)), S('2026-09-04', W(20, false, 10)), S('2026-09-08', W(20, false, 9))]);
  assert.equal(progressOverview(d2, '2026-09-10').find((x) => x.ex.id === 'row').stalled, true);
});

test('progress overview: cardio minutes change', () => {
  const d = data([
    { id: 'c1', date: '2026-09-01', workoutId: 'A', entries: [{ exerciseId: 'run', sets: [{ minutes: 24, km: 4 }] }] },
    { id: 'c2', date: '2026-10-01', workoutId: 'A', entries: [{ exerciseId: 'run', sets: [{ minutes: 30, km: 4.8 }] }] },
  ]);
  const r = progressOverview(d, '2026-10-02').find((x) => x.ex.id === 'run');
  assert.equal(r.deltaText, '+6 min');
  assert.equal(r.now, '30 min, 4.8 km');
});

test('weekly consistency: Sunday weeks, deload vs done, unplanned', () => {
  const d = data([
    S('2026-10-11', W(20, false, 10)), // Sun
    { ...S('2026-10-13', W(20, false, 10)), workoutId: 'B', deload: true },
    { ...S('2026-10-14', W(20, false, 10)), workoutId: null },
    S('2026-10-05', W(20, false, 10)), // previous week (Mon)
  ]);
  const c = weeklyConsistency(d, '2026-10-17', 3);
  assert.deepEqual(c.workouts.map((w) => w.code), ['A', 'B', 'D']);
  assert.equal(c.weeks[0].start, '2026-10-11');
  assert.deepEqual(c.weeks[0].slots, { A: 'done', B: 'deload' });
  assert.equal(c.weeks[0].unplanned, 1);
  assert.deepEqual(c.weeks[1].slots, { A: 'done' });
  assert.equal(c.weeks[2].sessions, 0);
});

test('workout codes', () => {
  assert.equal(workoutCode({ name: 'C · Full Body' }), 'C');
  assert.equal(workoutCode({ name: 'Upper' }), 'U');
  assert.equal(workoutCode({ name: 'D2 - Extra' }), 'D2');
});

test('sets per muscle: this week and 4-week average, cardio excluded', () => {
  const d = data([
    S('2026-10-12', W(20, false, 10, 10, 10)),
    S('2026-10-06', W(20, false, 10, 10)),
    { id: 'c', date: '2026-10-12', workoutId: 'A', entries: [{ exerciseId: 'run', sets: [{ minutes: 30 }] }] },
  ]);
  const m = setsPerMuscle(d, '2026-10-17');
  const lats = m.rows.find((r) => r.muscle === 'Lats');
  assert.equal(lats.thisWeek, 3);
  assert.equal(lats.average, 0.5); // 2 sets over 4 weeks
  assert.equal(m.rows.length, 2);
});
