// Progression engine — pure functions, no DOM, no storage.
// Everything here is derived from `data` (the JSON document). Nothing is cached.

export const TYPES = ['weighted', 'band', 'bodyweight', 'hold', 'cardio'];
export const TYPE_LABELS = {
  weighted: 'Weighted', band: 'Band', bodyweight: 'Bodyweight', hold: 'Timed hold', cardio: 'Cardio',
};

export const EXERCISE_DEFAULTS = {
  repRange: [8, 12],
  ladder: 'simple',
  modifierName: 'Pause',
  weightStep: 2,
  holdStep: 5,
  holdCeiling: null,
  durationStep: 3,
  durationCeiling: 40,
};

const round2 = (n) => Math.round(n * 100) / 100;
export const fmtNum = (n) => (n == null ? '' : String(round2(n)));

// ---------- sessions ----------

export function sessionSortKey(s) {
  return `${s.date || ''}|${s.startedAt || ''}`;
}

export function sortedSessions(data) {
  return [...(data.sessions || [])].sort((a, b) =>
    sessionSortKey(a) < sessionSortKey(b) ? -1 : sessionSortKey(a) > sessionSortKey(b) ? 1 : 0);
}

export function isSetLogged(set) {
  if (!set) return false;
  return set.reps != null || set.seconds != null || set.minutes != null || set.km != null;
}

/** A session "counts" once anything was logged in it (a set or a warm-up item). */
export function sessionHasContent(s) {
  if ((s.warmupDone || []).length > 0) return true;
  return (s.entries || []).some((e) => (e.sets || []).some(isSetLogged));
}

/** All logged sets of one exercise within one session (across entries). */
export function setsFor(session, exerciseId) {
  const out = [];
  for (const e of session.entries || []) {
    if (e.exerciseId !== exerciseId) continue;
    for (const s of e.sets || []) if (isSetLogged(s)) out.push(s);
  }
  return out;
}

/** Sessions strictly before `beforeSession` in chronological order (all sessions if null). */
function history(data, beforeSession) {
  const all = sortedSessions(data);
  if (!beforeSession) return all;
  const key = sessionSortKey(beforeSession);
  return all.filter((s) => s.id !== beforeSession.id && sessionSortKey(s) < key);
}

// ---------- rotation ----------

export function nextWorkout(data) {
  const workouts = data.workouts || [];
  if (workouts.length === 0) return null;
  const sessions = sortedSessions(data).filter(
    (s) => s.workoutId && sessionHasContent(s) && workouts.some((w) => w.id === s.workoutId),
  );
  if (sessions.length === 0) return workouts[0];
  const last = sessions[sessions.length - 1];
  const idx = workouts.findIndex((w) => w.id === last.workoutId);
  return workouts[(idx + 1) % workouts.length];
}

// ---------- loads ----------

function bandIndex(data, name) {
  return (data.bands || []).indexOf(name);
}

/** Comparable load value for a set: kg for weighted, band index for bands, 0 otherwise. */
function loadValue(ex, data, set) {
  if (ex.type === 'weighted') return set.weight == null ? -Infinity : Number(set.weight);
  if (ex.type === 'band') return set.band == null ? -Infinity : bandIndex(data, set.band);
  return 0;
}

export function describeLoad(ex, t) {
  if (ex.type === 'weighted') return t.weight == null ? '? kg' : `${fmtNum(t.weight)} kg`;
  if (ex.type === 'band') return t.band || '? band';
  return '';
}

// ---------- targets ----------

/**
 * Summarise the basis session for a strength exercise: heaviest load used,
 * weakest set at that load, and whether the modifier was on for all those sets.
 */
function strengthBasis(ex, data, sets) {
  let top = -Infinity;
  for (const s of sets) top = Math.max(top, loadValue(ex, data, s));
  const atTop = sets.filter((s) => loadValue(ex, data, s) === top);
  const weakest = Math.min(...atTop.map((s) => Number(s.reps)));
  const modifier = atTop.length > 0 && atTop.every((s) => !!s.modifier);
  const ref = atTop[0];
  return {
    weight: ex.type === 'weighted' ? (ref.weight == null ? null : Number(ref.weight)) : undefined,
    band: ex.type === 'band' ? ref.band : undefined,
    weakest,
    modifier,
  };
}

/** Find the last non-deload session (before `beforeSession`) that has sets for this exercise. */
export function basisSession(data, exerciseId, beforeSession) {
  const h = history(data, beforeSession);
  for (let i = h.length - 1; i >= 0; i--) {
    const s = h[i];
    if (s.deload) continue;
    const sets = setsFor(s, exerciseId);
    if (sets.length) return { session: s, sets };
  }
  return null;
}

function strengthTarget(ex, data, beforeSession) {
  const [lo, hi] = ex.repRange || EXERCISE_DEFAULTS.repRange;
  const modName = ex.modifierName || EXERCISE_DEFAULTS.modifierName;
  const basis = basisSession(data, ex.id, beforeSession);
  const needsLoad = ex.type === 'weighted' || ex.type === 'band';

  if (!basis) {
    return {
      reps: lo, modifier: false, weight: null, band: null,
      needsStart: needsLoad,
      reason: needsLoad ? `First time: set a starting ${ex.type === 'band' ? 'band' : 'weight'}, ${lo} reps` : `First time: start at ${lo} reps`,
    };
  }

  const b = strengthBasis(ex, data, basis.sets);
  const base = { weight: b.weight, band: b.band, basisId: basis.session.id };

  // Program change (rep range / ladder) after the basis session → restart at the bottom.
  if (ex.restartAt && (basis.session.startedAt || basis.session.date) < ex.restartAt) {
    return { ...base, reps: lo, modifier: false, reason: `Program changed: restart at ${lo} reps` };
  }

  const r = Number.isFinite(b.weakest) ? b.weakest : 0;
  const atTop = r >= hi;

  if (!atTop) {
    const reps = Math.max(1, r + 1);
    return { ...base, reps, modifier: b.modifier, reason: `+1 rep: weakest set was ${r}` };
  }

  // Weakest set reached the top of the range → next ladder stage.
  if (ex.ladder === 'modifier' && !b.modifier) {
    return { ...base, reps: lo, modifier: true, reason: `Top of range: ${modName} on, back to ${lo}` };
  }

  // Next stage is a load increase.
  if (ex.type === 'weighted') {
    const step = Number(ex.weightStep ?? EXERCISE_DEFAULTS.weightStep);
    const weight = round2((b.weight ?? 0) + step);
    const why = ex.ladder === 'modifier' ? `Top of range with ${modName}` : 'Top of range';
    return { ...base, weight, reps: lo, modifier: false, reason: `${why}: +${fmtNum(step)} kg, back to ${lo}` };
  }
  if (ex.type === 'band') {
    const idx = bandIndex(data, b.band);
    const bands = data.bands || [];
    if (idx >= 0 && idx < bands.length - 1) {
      return { ...base, band: bands[idx + 1], reps: lo, modifier: false, reason: `Top of range: next band (${bands[idx + 1]}), back to ${lo}` };
    }
    return { ...base, reps: r + 1, modifier: b.modifier, reason: `Heaviest band: keep adding reps (+1, weakest was ${r})` };
  }
  // Bodyweight: no load step, keep climbing past the top.
  return { ...base, reps: r + 1, modifier: b.modifier, reason: `Ladder complete: keep adding reps (+1, weakest was ${r})` };
}

function holdTarget(ex, data, beforeSession) {
  const step = Number(ex.holdStep ?? EXERCISE_DEFAULTS.holdStep);
  const ceiling = ex.holdCeiling == null || ex.holdCeiling === '' ? null : Number(ex.holdCeiling);
  const range = Array.isArray(ex.holdRange) && ex.holdRange.length === 2 ? ex.holdRange.map(Number) : null;
  const modName = ex.modifierName || EXERCISE_DEFAULTS.modifierName;
  const basis = basisSession(data, ex.id, beforeSession);
  if (!basis) {
    if (range) return { seconds: range[0], modifier: false, reason: `First time: start at ${range[0]} s` };
    return { seconds: null, modifier: false, needsStart: true, reason: 'First time: set a starting hold time' };
  }
  const base = { basisId: basis.session.id };
  if (range && ex.restartAt && (basis.session.startedAt || basis.session.date) < ex.restartAt) {
    return { ...base, seconds: range[0], modifier: false, reason: `Program changed: restart at ${range[0]} s` };
  }
  const weakest = Math.min(...basis.sets.map((s) => Number(s.seconds) || 0));
  const modifier = basis.sets.every((s) => !!s.modifier);
  if (range && weakest >= range[1] && ex.ladder === 'modifier' && !modifier) {
    return { ...base, seconds: range[0], modifier: true, reason: `Top of range: ${modName} on, back to ${range[0]} s` };
  }
  let seconds = weakest + step;
  const done = range && weakest >= range[1];
  if (ceiling != null && seconds >= ceiling) {
    seconds = ceiling;
    const reason = weakest >= ceiling ? `At ${ceiling} s ceiling: hold ${ceiling} s` : `+${step} s, capped at ${ceiling} s`;
    return { ...base, seconds, modifier, reason };
  }
  const reason = done ? `Ladder complete: keep adding time (+${step} s, weakest was ${weakest} s)` : `+${step} s: weakest hold was ${weakest} s`;
  return { ...base, seconds, modifier, reason };
}

function cardioTarget(ex, data, beforeSession) {
  const step = Number(ex.durationStep ?? EXERCISE_DEFAULTS.durationStep);
  const ceiling = ex.durationCeiling == null || ex.durationCeiling === '' ? null : Number(ex.durationCeiling);
  const basis = basisSession(data, ex.id, beforeSession);
  if (!basis) {
    const start = ex.startMinutes == null || ex.startMinutes === '' ? null : Number(ex.startMinutes);
    if (start != null) return { minutes: start, km: null, reason: `First time: start at ${fmtNum(start)} min` };
    return { minutes: null, km: null, needsStart: true, reason: 'First time: log your time and distance' };
  }
  const minutes = round2(basis.sets.reduce((a, s) => a + (Number(s.minutes) || 0), 0));
  const km = round2(basis.sets.reduce((a, s) => a + (Number(s.km) || 0), 0));
  const base = { basisId: basis.session.id, lastMinutes: minutes, lastKm: km };
  if (ceiling != null && minutes >= ceiling) {
    return { ...base, minutes: ceiling, km, beatDistance: true, reason: `At ${ceiling}-min ceiling: beat ${fmtNum(km)} km` };
  }
  let next = round2(minutes + step);
  if (ceiling != null && next >= ceiling) {
    next = ceiling;
    return { ...base, minutes: next, km: null, reason: `+${step} min, capped at ${ceiling} (${fmtNum(minutes)} → ${next} min)` };
  }
  return { ...base, minutes: next, km: null, reason: `+${step} min (${fmtNum(minutes)} → ${fmtNum(next)} min)` };
}

/**
 * Target for an exercise, computed from history strictly before `beforeSession`
 * (pass the in-progress session so today's own sets never feed today's target).
 */
export function targetFor(data, exerciseId, beforeSession = null) {
  const ex = (data.exercises || []).find((e) => e.id === exerciseId);
  if (!ex) return null;
  if (ex.type === 'cardio') return cardioTarget(ex, data, beforeSession);
  if (ex.type === 'hold') return holdTarget(ex, data, beforeSession);
  return strengthTarget(ex, data, beforeSession);
}

/** Pre-filled set values from a target. */
export function setFromTarget(ex, t) {
  if (!t) return {};
  if (ex.type === 'cardio') return { minutes: t.minutes, km: t.beatDistance ? t.km : null };
  if (ex.type === 'hold') return { seconds: t.seconds, modifier: !!t.modifier };
  const s = { reps: t.reps, modifier: !!t.modifier };
  if (ex.type === 'weighted') s.weight = t.weight;
  if (ex.type === 'band') s.band = t.band;
  return s;
}

// ---------- formatting ----------

export function formatSet(ex, s) {
  if (!s) return '';
  if (ex.type === 'cardio') {
    const parts = [];
    if (s.minutes != null) parts.push(`${fmtNum(s.minutes)} min`);
    if (s.km != null) parts.push(`${fmtNum(s.km)} km`);
    return parts.join(' · ');
  }
  if (ex.type === 'hold') return s.seconds == null ? '' : `${fmtNum(s.seconds)} s${s.modifier ? ` ${ex.modifierName || 'Pause'}` : ''}`;
  const mod = s.modifier ? ` ${ex.modifierName || 'Pause'}` : '';
  if (ex.type === 'weighted') return `${s.weight == null ? '?' : fmtNum(s.weight)}×${s.reps ?? '?'}${mod}`;
  if (ex.type === 'band') return `${s.band || '?'}×${s.reps ?? '?'}${mod}`;
  return `${s.reps ?? '?'} reps${mod}`;
}

/** Compact summary of several sets, e.g. "20 kg × 10, 10, 9 · Pause". */
export function summarizeSets(ex, sets) {
  if (!sets || !sets.length) return '';
  if (ex.type === 'cardio' || ex.type === 'hold') return sets.map((s) => formatSet(ex, s)).join(', ');
  const groups = [];
  for (const s of sets) {
    const load = ex.type === 'weighted' ? (s.weight == null ? '?' : `${fmtNum(s.weight)} kg`) : ex.type === 'band' ? (s.band || '?') : '';
    const key = `${load}|${!!s.modifier}`;
    let g = groups[groups.length - 1];
    if (!g || g.key !== key) { g = { key, load, mod: !!s.modifier, reps: [] }; groups.push(g); }
    g.reps.push(s.reps ?? '?');
  }
  return groups.map((g) => {
    const mod = g.mod ? ` · ${ex.modifierName || 'Pause'}` : '';
    return g.load ? `${g.load} × ${g.reps.join(', ')}${mod}` : `${g.reps.join(', ')} reps${mod}`;
  }).join(' / ');
}

export function formatTarget(ex, t, sets = 1) {
  if (!t) return '';
  if (ex.type === 'cardio') {
    if (t.minutes == null) return 'Time + distance';
    return t.beatDistance ? `${fmtNum(t.minutes)} min · > ${fmtNum(t.km)} km` : `${fmtNum(t.minutes)} min`;
  }
  if (ex.type === 'hold') return `${sets} × ${t.seconds == null ? '?' : t.seconds} s${t.modifier ? ` · ${ex.modifierName || 'Pause'}` : ''}`;
  const mod = t.modifier ? ` · ${ex.modifierName || 'Pause'}` : '';
  const load = describeLoad(ex, t);
  return `${sets} × ${t.reps}${load ? ` @ ${load}` : ''}${mod}`;
}

// ---------- records & charts ----------

export function personalRecord(data, exerciseId) {
  const ex = (data.exercises || []).find((e) => e.id === exerciseId);
  if (!ex) return null;
  let best = null;
  for (const s of sortedSessions(data)) {
    for (const set of setsFor(s, exerciseId)) {
      let v; let label;
      if (ex.type === 'weighted') { v = set.weight == null ? null : Number(set.weight); label = `${fmtNum(v)} kg`; }
      else if (ex.type === 'band') { v = bandIndex(data, set.band); label = set.band; if (v < 0) v = null; }
      else if (ex.type === 'bodyweight') { v = Number(set.reps); label = `${v} reps`; }
      else if (ex.type === 'hold') { v = Number(set.seconds); label = `${v} s`; }
      else { v = Number(set.km); label = `${fmtNum(v)} km`; }
      if (v == null || Number.isNaN(v)) continue;
      if (!best || v > best.value) best = { value: v, label, date: s.date };
    }
  }
  if (!best) return null;
  const kind = { weighted: 'Heaviest', band: 'Heaviest band', bodyweight: 'Most reps', hold: 'Longest hold', cardio: 'Longest distance' }[ex.type];
  return { ...best, kind };
}

/** One point per session: heaviest weight / band / most reps / longest hold / distance. */
export function chartSeries(data, exerciseId) {
  const ex = (data.exercises || []).find((e) => e.id === exerciseId);
  if (!ex) return { points: [], unit: '' };
  const points = [];
  for (const s of sortedSessions(data)) {
    const sets = setsFor(s, exerciseId);
    if (!sets.length) continue;
    let v;
    if (ex.type === 'weighted') v = Math.max(...sets.map((x) => (x.weight == null ? -Infinity : Number(x.weight))));
    else if (ex.type === 'band') v = Math.max(...sets.map((x) => bandIndex(data, x.band)));
    else if (ex.type === 'bodyweight') v = Math.max(...sets.map((x) => Number(x.reps) || 0));
    else if (ex.type === 'hold') v = Math.max(...sets.map((x) => Number(x.seconds) || 0));
    else v = round2(sets.reduce((a, x) => a + (Number(x.km) || 0), 0));
    if (!Number.isFinite(v) || v < 0) continue;
    points.push({ date: s.date, value: v, deload: !!s.deload });
  }
  const unit = { weighted: 'kg', band: 'band', bodyweight: 'reps', hold: 's', cardio: 'km' }[ex.type];
  const title = { weighted: 'Heaviest weight', band: 'Heaviest band', bodyweight: 'Most reps', hold: 'Longest hold', cardio: 'Distance' }[ex.type];
  return { points, unit, title };
}

// ---------- program changes ----------

/** Apply an exercise edit; changing rep range or ladder restarts progression. */
export function applyExerciseEdit(oldEx, newEx, nowIso) {
  const out = { ...newEx };
  if (oldEx && oldEx.type !== 'cardio') {
    const key = oldEx.type === 'hold' ? 'holdRange' : 'repRange';
    const rangeChanged = JSON.stringify(oldEx[key] ?? null) !== JSON.stringify(newEx[key] ?? null);
    const ladderChanged = oldEx.ladder !== newEx.ladder;
    if (rangeChanged || ladderChanged) out.restartAt = nowIso;
  }
  return out;
}

// ---------- validation ----------

export function emptyData() {
  return {
    version: 1,
    exercises: [],
    bands: [],
    warmup: [],
    workouts: [],
    sessions: [],
    settings: { backupReminderDays: 7, lastExport: null },
  };
}

export function validateData(d) {
  if (!d || typeof d !== 'object') throw new Error('Not a JSON object');
  if (d.version !== 1) throw new Error(`Unsupported version: ${d.version}`);
  for (const k of ['exercises', 'bands', 'warmup', 'workouts', 'sessions']) {
    if (!Array.isArray(d[k])) throw new Error(`Missing or invalid "${k}"`);
  }
  const ids = new Set(d.exercises.map((e) => e.id));
  for (const e of d.exercises) {
    if (!e.id || !e.name) throw new Error('Exercise without id or name');
    if (!TYPES.includes(e.type)) throw new Error(`Exercise "${e.name}" has unknown type "${e.type}"`);
  }
  for (const s of d.sessions) {
    if (!s.id || !s.date) throw new Error('Session without id or date');
    for (const en of s.entries || []) {
      if (!ids.has(en.exerciseId)) throw new Error(`Session ${s.date} references unknown exercise ${en.exerciseId}`);
    }
  }
  return { ...emptyData(), ...d, settings: { ...emptyData().settings, ...(d.settings || {}) } };
}
