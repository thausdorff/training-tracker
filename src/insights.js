// Derived statistics for the History screens. Pure functions over the data document.
import {
  sortedSessions, setsFor, EXERCISE_DEFAULTS, fmtNum, weekStart, sessionHasContent, lastSetRir,
} from './engine.js';

const isStrength = (ex) => ['weighted', 'band', 'bodyweight'].includes(ex.type);

function bandIdx(data, name) { return (data.bands || []).indexOf(name); }

/** Heaviest load in a set list and the weakest value at that load (mirrors the progression rule). */
function basisOf(ex, data, sets) {
  if (ex.type === 'hold') {
    return { value: Math.min(...sets.map((s) => Number(s.seconds) || 0)), load: 0, modifier: sets.every((s) => !!s.modifier) };
  }
  const loadOf = (s) => (ex.type === 'weighted' ? Number(s.weight ?? -Infinity)
    : ex.type === 'band' ? bandIdx(data, s.band) : 0);
  const top = Math.max(...sets.map(loadOf));
  const atTop = sets.filter((s) => loadOf(s) === top);
  return {
    value: Math.min(...atTop.map((s) => Number(s.reps) || 0)),
    load: top,
    modifier: atTop.every((s) => !!s.modifier),
  };
}

function loadLabel(ex, data, load) {
  if (ex.type === 'weighted') return `${fmtNum(load)} kg`;
  if (ex.type === 'band') return (data.bands || [])[load] || '';
  return '';
}

function rangeOf(ex) {
  if (ex.type === 'hold') return Array.isArray(ex.holdRange) ? ex.holdRange.map(Number) : null;
  return ex.repRange || EXERCISE_DEFAULTS.repRange;
}

/**
 * Ladder position as one number, so rep, modifier and load steps add up on a single scale.
 * One rep (or one hold step) = 1; a new stage starts one step above the top of the previous.
 */
function score(ex, data, b) {
  const range = rangeOf(ex);
  const stepSize = ex.type === 'hold' ? Number(ex.holdStep ?? EXERCISE_DEFAULTS.holdStep) : 1;
  if (!range) return b.value / stepSize; // hold without a range: just time
  const [lo, hi] = range;
  const span = Math.round((hi - lo) / stepSize) + 1;
  const stages = ex.ladder === 'modifier' ? 2 : 1;
  let loadRank = 0;
  if (ex.type === 'weighted') loadRank = b.load / Number(ex.weightStep || EXERCISE_DEFAULTS.weightStep);
  if (ex.type === 'band') loadRank = Math.max(0, b.load);
  const stage = ex.ladder === 'modifier' && b.modifier ? 1 : 0;
  return loadRank * stages * span + stage * span + (b.value - lo) / stepSize;
}

/**
 * Per-session points for the ladder chart: weakest value, load, modifier, deload, plus markers
 * where the load changed. Strength and holds only.
 */
export function ladderSeries(data, exerciseId) {
  const ex = (data.exercises || []).find((e) => e.id === exerciseId);
  if (!ex || !(isStrength(ex) || ex.type === 'hold')) return null;
  const points = [];
  for (const s of sortedSessions(data)) {
    const sets = setsFor(s, exerciseId);
    if (!sets.length) continue;
    const b = basisOf(ex, data, sets);
    if (!Number.isFinite(b.value)) continue;
    points.push({
      date: s.date, sessionId: s.id, value: b.value, load: b.load, loadLabel: loadLabel(ex, data, b.load),
      modifier: b.modifier, deload: !!s.deload, sets, score: score(ex, data, b),
    });
  }
  const markers = [];
  let prev = null;
  points.forEach((p, i) => {
    if (p.deload) return;
    if (prev && p.load !== prev.load && ex.type !== 'bodyweight' && ex.type !== 'hold') {
      let label;
      if (ex.type === 'weighted') { const d = p.load - prev.load; label = `${d > 0 ? '+' : '−'}${fmtNum(Math.abs(d))} kg`; }
      else label = p.loadLabel;
      markers.push({ index: i, label, up: p.load > prev.load });
    }
    prev = p;
  });
  return { ex, points, markers, range: rangeOf(ex), unit: ex.type === 'hold' ? 's' : 'reps' };
}

/** Short "where it is now" text from the latest non-deload session. */
function nowText(ex, data, p) {
  const range = rangeOf(ex);
  const mod = p.modifier && ex.ladder === 'modifier' ? `, ${(ex.modifierName || 'pause').toLowerCase()}` : '';
  if (ex.type === 'hold') return range ? `${p.value}/${range[1]} s${mod}` : `${p.value} s`;
  const load = p.loadLabel ? `${p.loadLabel}, ` : '';
  return `${load}${p.value}/${range[1]}${mod}`;
}

/**
 * One row per exercise with history: sparkline values, current position, change over the last
 * `days` days and whether it has stalled (no progress across its last three regular sessions).
 */
export function progressOverview(data, today, days = 28) {
  const cutoff = new Date(`${today}T00:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - days);
  const cut = cutoff.toISOString().slice(0, 10);
  const rows = [];
  for (const ex of data.exercises || []) {
    let pts; let now; let delta = null; let deltaText = ''; let unit = '';
    if (ex.type === 'cardio') {
      pts = [];
      for (const s of sortedSessions(data)) {
        const sets = setsFor(s, ex.id);
        if (!sets.length || s.deload) continue;
        const minutes = sets.reduce((a, x) => a + (Number(x.minutes) || 0), 0);
        const km = sets.reduce((a, x) => a + (Number(x.km) || 0), 0);
        pts.push({ date: s.date, minutes, km, score: minutes + km / 100 });
      }
      if (!pts.length) continue;
      const last = pts[pts.length - 1];
      now = last.km ? `${fmtNum(last.minutes)} min, ${fmtNum(Math.round(last.km * 10) / 10)} km` : `${fmtNum(last.minutes)} min`;
      const base = [...pts].reverse().find((p) => p.date <= cut) || pts[0];
      if (base !== last) {
        const dm = last.minutes - base.minutes;
        delta = dm;
        deltaText = dm ? `${dm > 0 ? '+' : '−'}${fmtNum(Math.abs(dm))} min` : (last.km > base.km ? `+${fmtNum(Math.round((last.km - base.km) * 10) / 10)} km` : '');
        if (!dm && last.km > base.km) delta = 1;
      }
      unit = 'min';
    } else {
      const series = ladderSeries(data, ex.id);
      if (!series || !series.points.length) continue;
      pts = series.points.filter((p) => !p.deload);
      if (!pts.length) continue;
      const last = pts[pts.length - 1];
      now = nowText(ex, data, last);
      const base = [...pts].reverse().find((p) => p.date <= cut) || pts[0];
      if (base !== last) {
        delta = Math.round((last.score - base.score) * 10) / 10;
        deltaText = delta > 0 ? `+${fmtNum(delta)} step${delta === 1 ? '' : 's'}` : delta < 0 ? `${fmtNum(delta)} steps` : 'no change';
      }
      unit = 'steps';
    }
    let stalled = false;
    if (pts.length >= 3) {
      const [a, b2, c] = pts.slice(-3);
      stalled = Math.max(b2.score, c.score) <= a.score;
    }
    rows.push({
      ex, now, delta, deltaText, unit, stalled, tooLight: tooLight(data, ex.id),
      spark: pts.slice(-12).map((p) => p.score),
      lastDate: pts[pts.length - 1].date,
    });
  }
  return rows.sort((a, b) => ((b.tooLight || b.stalled) - (a.tooLight || a.stalled)) || a.ex.name.localeCompare(b.ex.name));
}

/** Short label for a workout in the consistency strip: "A" from "A · Legs & Chest". */
export function workoutCode(w) {
  const head = String(w.name || '').split(/\s+[·\-–—:]\s+/)[0].trim();
  return head.length <= 3 ? head : head.slice(0, 1).toUpperCase();
}

/**
 * Last `weeks` weeks, newest first. Each week lists the rotation's workouts with done/deload state
 * and the number of unplanned sessions.
 */
export function weeklyConsistency(data, today, weeks = 12) {
  const ws = (data.settings && data.settings.weekStartsOn) || 0;
  const start = weekStart(today, ws);
  const out = [];
  for (let i = 0; i < weeks; i++) {
    const d = new Date(`${start}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 7 * i);
    out.push({ start: d.toISOString().slice(0, 10), slots: {}, unplanned: 0, sessions: 0 });
  }
  const byStart = Object.fromEntries(out.map((w) => [w.start, w]));
  for (const s of sortedSessions(data)) {
    if (!sessionHasContent(s)) continue;
    const w = byStart[weekStart(s.date, ws)];
    if (!w) continue;
    w.sessions += 1;
    if (!s.workoutId) { w.unplanned += 1; continue; }
    const prev = w.slots[s.workoutId];
    // a regular session wins over a deload one in the same week
    w.slots[s.workoutId] = prev === 'done' ? 'done' : (s.deload ? 'deload' : 'done');
  }
  const workouts = (data.workouts || []).map((w) => ({ id: w.id, code: workoutCode(w), name: w.name, optional: !!w.optional }));
  return { workouts, weeks: out };
}

/**
 * Working sets per muscle. Each logged set counts once for every muscle listed on its exercise.
 * Returns this week's counts and the weekly average over the previous `avgWeeks` full weeks.
 */
export function setsPerMuscle(data, today, avgWeeks = 4) {
  const ws = (data.settings && data.settings.weekStartsOn) || 0;
  const thisWeek = weekStart(today, ws);
  const prevStarts = new Set();
  for (let i = 1; i <= avgWeeks; i++) {
    const d = new Date(`${thisWeek}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 7 * i);
    prevStarts.add(d.toISOString().slice(0, 10));
  }
  const exById = Object.fromEntries((data.exercises || []).map((e) => [e.id, e]));
  const cur = {}; const prev = {};
  let anyMuscles = false;
  for (const s of sortedSessions(data)) {
    const wk = weekStart(s.date, ws);
    const bucket = wk === thisWeek ? cur : prevStarts.has(wk) ? prev : null;
    if (!bucket) continue;
    for (const e of s.entries || []) {
      const ex = exById[e.exerciseId];
      if (!ex || ex.type === 'cardio' || !Array.isArray(ex.muscles) || !ex.muscles.length) continue;
      anyMuscles = true;
      const n = setsFor({ entries: [e] }, e.exerciseId).length;
      for (const m of ex.muscles) bucket[m] = (bucket[m] || 0) + n;
    }
  }
  const muscles = new Set([...Object.keys(cur), ...Object.keys(prev)]);
  const rows = [...muscles].map((m) => ({
    muscle: m,
    thisWeek: cur[m] || 0,
    average: Math.round(((prev[m] || 0) / avgWeeks) * 10) / 10,
  }));
  return { rows, anyMuscles, weekStart: thisWeek };
}

/** True when the last two regular sessions both ended with 3+ reps in reserve. */
export function tooLight(data, exerciseId) {
  const recent = sortedSessions(data).filter((s) => !s.deload && setsFor(s, exerciseId).length).slice(-2);
  return recent.length === 2 && recent.every((s) => (lastSetRir(setsFor(s, exerciseId)) ?? -1) >= 3);
}

/**
 * Estimated one-rep max per session for weighted exercises, using Epley with reps in reserve:
 * weight × (1 + (reps + RIR) / 30). Sets without a logged RIR use the exercise's target RIR.
 * Sessions done with the modifier (e.g. a pause) or as a deload are left out, so harder variants
 * don't show up as fake drops.
 */
export function e1rmSeries(data, exerciseId) {
  const ex = (data.exercises || []).find((e) => e.id === exerciseId);
  if (!ex || ex.type !== 'weighted') return null;
  const fallback = Number(ex.targetRir ?? EXERCISE_DEFAULTS.targetRir);
  const points = [];
  for (const s of sortedSessions(data)) {
    if (s.deload) continue;
    const sets = setsFor(s, exerciseId).filter((x) => !x.modifier && Number(x.weight) > 0 && Number(x.reps) > 0);
    if (!sets.length) continue;
    const best = Math.max(...sets.map((x) => {
      const rir = x.rir != null && x.rir !== '' ? Number(x.rir) : fallback;
      return Number(x.weight) * (1 + (Number(x.reps) + rir) / 30);
    }));
    points.push({ date: s.date, value: Math.round(best * 10) / 10, deload: false });
  }
  return { points, unit: 'kg', title: 'Estimated 1-rep max' };
}
