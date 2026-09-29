import { html, render, useState, useEffect, useRef } from '../vendor/preact-htm.js';
import * as E from './engine.js';
import * as St from './store.js';

export const APP_VERSION = '1.1.0';

// ---------- small helpers ----------
const nowIso = () => new Date().toISOString();
const exById = (data, id) => data.exercises.find((e) => e.id === id);
const num = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v));
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function fmtDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const today = St.todayStr();
  if (iso === today) return 'Today';
  const opts = { weekday: 'short', day: 'numeric', month: 'short' };
  if (y !== new Date().getFullYear()) opts.year = 'numeric';
  return dt.toLocaleDateString(undefined, opts);
}
function daysBetween(a, b) {
  return Math.round((new Date(b) - new Date(a)) / 86400000);
}

/** Remove sessions that were started but never had anything logged (from earlier days). */
function cleanup(data) {
  const today = St.todayStr();
  const before = data.sessions.length;
  data.sessions = data.sessions.filter((s) => E.sessionHasContent(s) || (s.date === today && !s.finishedAt));
  if (data.sessions.length !== before) St.save(data);
  return data;
}

function activeSession(data) {
  const today = St.todayStr();
  const open = data.sessions.filter((s) => !s.finishedAt && s.date === today);
  return open.length ? E.sortedSessions({ sessions: open }).pop() : null;
}

/** Entry indexes grouped into supersets (consecutive entries linked by supersetWithNext). */
function groupEntries(entries) {
  const groups = [];
  entries.forEach((e, i) => {
    if (i > 0 && entries[i - 1].supersetWithNext) groups[groups.length - 1].push(i);
    else groups.push([i]);
  });
  return groups;
}

function canLog(ex, v) {
  if (!ex) return false;
  if (ex.type === 'cardio') return v.minutes != null;
  if (ex.type === 'hold') return v.seconds != null;
  if (v.reps == null) return false;
  if (ex.type === 'weighted') return v.weight != null;
  if (ex.type === 'band') return !!v.band;
  return true;
}

function cleanSet(ex, v) {
  if (ex.type === 'cardio') { const o = { minutes: num(v.minutes) }; if (num(v.km) != null) o.km = num(v.km); return o; }
  if (ex.type === 'hold') { const o = { seconds: num(v.seconds) }; if (v.modifier) o.modifier = true; return o; }
  const o = { reps: num(v.reps), modifier: !!v.modifier };
  if (ex.type === 'weighted') o.weight = num(v.weight);
  if (ex.type === 'band') o.band = v.band;
  return o;
}

// ---------- icons ----------
const Icon = {
  check: html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>`,
  today: html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 12h2M19 12h2M6 8v8M18 8v8M8.5 10v4M15.5 10v4M8.5 12h7"/></svg>`,
  history: html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19V5M4 19h16M8 15l3.5-4 3 2.5L20 8"/></svg>`,
  program: html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/></svg>`,
  data: html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M7 10l5 5 5-5M5 21h14"/></svg>`,
};

// ---------- app shell ----------
function App() {
  const [data, setData] = useState(() => cleanup(St.load()));
  const [route, setRoute] = useState({ tab: 'today' });

  const update = (fn) => setData((prev) => {
    const d = structuredClone(prev);
    fn(d);
    St.save(d);
    return d;
  });
  const replaceAll = (d) => { St.save(d); setData(d); };

  useEffect(() => {
    history.replaceState({ tab: 'today' }, '');
    const onPop = (e) => { setRoute(e.state || { tab: 'today' }); };
    addEventListener('popstate', onPop);
    St.requestPersistence();
    return () => removeEventListener('popstate', onPop);
  }, []);

  const nav = {
    go(r) { history.pushState(r, ''); setRoute(r); scrollTo(0, 0); },
    tab(t) {
      if (route.tab === t && !route.view) return;
      history.pushState({ tab: t }, ''); setRoute({ tab: t }); scrollTo(0, 0);
    },
    back() { history.back(); },
  };

  const props = { data, update, replaceAll, nav, route };
  let screen;
  if (route.view === 'session') screen = html`<${SessionScreen} ...${props} id=${route.id} />`;
  else if (route.tab === 'today') screen = html`<${TodayScreen} ...${props} />`;
  else if (route.tab === 'history' && route.view === 'exercise') screen = html`<${ExerciseHistory} ...${props} id=${route.id} />`;
  else if (route.tab === 'history') screen = html`<${HistoryScreen} ...${props} />`;
  else if (route.tab === 'program' && route.view === 'workout') screen = html`<${WorkoutEditor} ...${props} id=${route.id} />`;
  else if (route.tab === 'program' && route.view === 'exercise') screen = html`<${ExerciseEditor} ...${props} id=${route.id} />`;
  else if (route.tab === 'program') screen = html`<${ProgramScreen} ...${props} />`;
  else screen = html`<${DataScreen} ...${props} />`;

  const tabs = [['today', 'Today'], ['history', 'History'], ['program', 'Program'], ['data', 'Data']];
  return html`
    <div class="app">${screen}</div>
    <nav class="tabs">
      ${tabs.map(([t, label]) => html`
        <button class=${route.tab === t ? 'on' : ''} onClick=${() => nav.tab(t)}>${Icon[t]}<span>${label}</span></button>`)}
    </nav>`;
}

function TopBar({ title, nav, back, right }) {
  return html`<header class="topbar">
    ${back ? html`<button class="back" aria-label="Back" onClick=${() => nav.back()}>‹</button>` : null}
    <h1>${title}</h1>${right || null}
  </header>`;
}

// ---------- Today ----------
function startSession(update, nav, data, workout) {
  const id = St.uid();
  update((d) => {
    const entries = workout
      ? workout.items.filter((it) => exById(d, it.exerciseId)).map((it) => ({
        exerciseId: it.exerciseId, plannedSets: it.sets, supersetWithNext: !!it.supersetWithNext, sets: [],
      }))
      : [];
    d.sessions.push({
      id, date: St.todayStr(), startedAt: nowIso(), finishedAt: null,
      workoutId: workout ? workout.id : null, workoutName: workout ? workout.name : null,
      deload: false, warmupDone: [], entries,
    });
  });
  return id;
}

function TodayScreen({ data, update, nav }) {
  const [pickOther, setPickOther] = useState(false);
  const active = activeSession(data);
  if (active) return html`<${SessionView} key=${active.id} data=${data} update=${update} nav=${nav} session=${active} mode="active" />`;

  const next = E.nextWorkout(data);
  const lastSession = E.sortedSessions(data).filter((s) => E.sessionHasContent(s)).pop();
  const settings = data.settings || {};
  const days = settings.lastExport ? daysBetween(settings.lastExport.slice(0, 10), St.todayStr()) : null;
  const needBackup = data.sessions.length > 0 && (days == null || days >= (settings.backupReminderDays || 7));
  const finishedToday = lastSession && lastSession.date === St.todayStr() && lastSession.finishedAt;

  return html`
    <${TopBar} title="Today" nav=${nav} />
    ${needBackup && html`<div class="banner">
      <span class="spacer">${days == null ? 'No backup exported yet.' : html`Last backup <b>${days} days</b> ago.`}</span>
      <button class="btn sm" onClick=${() => nav.tab('data')}>Export</button></div>`}
    ${finishedToday && html`<div class="card row" style="background:var(--good-soft);border-color:transparent">
      <span class="check on">✓</span><span class="spacer">Done today: <b>${lastSession.workoutName || 'Unplanned session'}</b></span>
      <button class="btn sm ghost" onClick=${() => nav.go({ tab: 'today', view: 'session', id: lastSession.id })}>View</button></div>`}
    ${next ? html`
      <div class="card hero">
        <div class="label">Next in rotation</div>
        <div class="name">${next.name}</div>
        <ul>${next.items.map((it) => {
          const ex = exById(data, it.exerciseId);
          if (!ex) return null;
          const t = E.targetFor(data, ex.id);
          return html`<li><span>${ex.name}</span><span class="muted">${E.formatTarget(ex, t, it.sets)}</span></li>`;
        })}</ul>
        <button class="btn primary block" onClick=${() => startSession(update, nav, data, next)}>Start ${next.name}</button>
      </div>
      <div class="row wrap">
        <button class="btn sm" onClick=${() => setPickOther(!pickOther)}>Different workout</button>
        <button class="btn sm" onClick=${() => startSession(update, nav, data, null)}>Unplanned session</button>
      </div>
      ${pickOther && html`<div class="row wrap" style="margin-top:10px">
        ${data.workouts.filter((w) => w.id !== next.id).map((w) => html`
          <button class="chip" onClick=${() => startSession(update, nav, data, w)}>${w.name}</button>`)}
      </div>`}
    ` : html`
      <div class="card empty">
        <p>No workouts in your program yet.</p>
        <button class="btn primary" onClick=${() => nav.tab('program')}>Set up program</button>
        <p class="small">…or <button class="btn sm ghost" onClick=${() => startSession(update, nav, data, null)}>log an unplanned session</button></p>
      </div>`}
  `;
}

// ---------- Session (active workout or past session) ----------
function SessionScreen({ data, update, nav, id }) {
  const s = data.sessions.find((x) => x.id === id);
  if (!s) return html`<${TopBar} title="Session" nav=${nav} back /><div class="empty">Session not found.</div>`;
  const today = St.todayStr();
  const mode = !s.finishedAt && s.date === today ? 'active' : 'edit';
  return html`<${SessionView} data=${data} update=${update} nav=${nav} session=${s} mode=${mode} back />`;
}

function SessionView({ data, update, nav, session, mode, back }) {
  const [open, setOpen] = useState(null); // "entryIdx:rowIdx"
  const [adding, setAdding] = useState(false);
  const [warmOpen, setWarmOpen] = useState(mode === 'active' && (session.warmupDone || []).length < data.warmup.length);
  const sid = session.id;
  const mut = (fn) => update((d) => { const s = d.sessions.find((x) => x.id === sid); if (s) fn(s, d); });

  const title = session.workoutName || 'Unplanned session';
  const groups = groupEntries(session.entries);
  const anything = E.sessionHasContent(session);

  const finish = () => {
    mut((s) => { s.finishedAt = nowIso(); });
    if (back) nav.back(); else nav.go({ tab: 'today' });
  };
  const cancel = () => {
    if (anything && !confirm('Delete this session and everything logged in it?')) return;
    update((d) => { d.sessions = d.sessions.filter((x) => x.id !== sid); });
    if (back) nav.back();
  };

  const warm = data.warmup.length ? html`
    <div class="card">
      <button class="collapse" onClick=${() => setWarmOpen(!warmOpen)}>
        <h3 class="spacer">Warm-up</h3>
        <span class="muted small">${(session.warmupDone || []).filter((w) => data.warmup.includes(w)).length}/${data.warmup.length} ${warmOpen ? '▴' : '▾'}</span>
      </button>
      ${warmOpen && html`<div style="margin-top:6px">${data.warmup.map((w) => {
        const on = (session.warmupDone || []).includes(w);
        return html`<div class="warmup-item" onClick=${() => mut((s) => {
          s.warmupDone = on ? s.warmupDone.filter((x) => x !== w) : [...(s.warmupDone || []), w];
        })}><span class=${`check ${on ? 'on' : ''}`}>${on ? '✓' : ''}</span><span>${w}</span></div>`;
      })}</div>`}
    </div>` : null;

  return html`
    <${TopBar} title=${title} nav=${nav} back=${back} />
    <div class="session-head">
      ${mode === 'edit'
        ? html`<input type="date" value=${session.date} style="width:auto" onChange=${(e) => e.target.value && mut((s) => { s.date = e.target.value; })} />`
        : html`<span class="muted">${fmtDate(session.date)}</span>`}
      <span class="spacer"></span>
      <button class=${`chip ${session.deload ? 'on' : ''}`} onClick=${() => mut((s) => { s.deload = !s.deload; })}>
        ${session.deload ? 'Deload ✓' : 'Deload'}</button>
    </div>
    ${session.deload && html`<p class="small muted" style="margin:-4px 4px 12px">Deload: this session won't affect progression.</p>`}
    ${warm}
    ${groups.map((g) => html`<${EntryGroup} key=${g.join('-')} data=${data} session=${session} idxs=${g}
        open=${open} setOpen=${setOpen} mut=${mut} />`)}
    ${session.entries.length === 0 && html`<div class="empty">No exercises yet — add one below.</div>`}
    <button class="btn block" style="margin-bottom:12px" onClick=${() => setAdding(true)}>+ Add exercise</button>
    ${mode === 'active'
      ? html`<button class="btn good block" style="margin-bottom:12px" onClick=${finish}>Finish workout</button>
             <button class="btn ghost block danger" onClick=${cancel}>${anything ? 'Delete session' : 'Cancel workout'}</button>`
      : html`<button class="btn ghost block danger" onClick=${cancel}>Delete session</button>`}
    ${adding && html`<${ExercisePicker} data=${data} onClose=${() => setAdding(false)} onPick=${(exId) => {
      const ex = exById(data, exId);
      const basis = E.basisSession(data, exId, session);
      const planned = ex.type === 'cardio' ? 1 : basis ? basis.sets.length : 3;
      mut((s) => { s.entries.push({ exerciseId: exId, plannedSets: planned, supersetWithNext: false, sets: [] }); });
      setAdding(false);
    }} />`}
  `;
}

function EntryGroup({ data, session, idxs, open, setOpen, mut }) {
  const isSuper = idxs.length > 1;
  const entries = idxs.map((i) => session.entries[i]);
  const exs = entries.map((e) => exById(data, e.exerciseId));
  const targets = exs.map((ex) => (ex ? E.targetFor(data, ex.id, session) : null));

  // Build rows: for supersets, interleave A1, B1, A2, B2 …
  const counts = entries.map((e) => Math.max(e.plannedSets || 0, e.sets.length));
  const maxRows = Math.max(0, ...counts);
  const rows = [];
  if (isSuper) {
    for (let r = 0; r < maxRows; r++) idxs.forEach((ei, k) => { if (r < counts[k]) rows.push([k, r]); });
  } else {
    for (let r = 0; r < counts[0]; r++) rows.push([0, r]);
  }

  return html`<div class="card">
    ${isSuper && html`<div class="superset-label">Superset</div>`}
    ${entries.map((e, k) => {
      const ex = exs[k];
      if (!ex) return html`<div class="ex-head muted">Deleted exercise</div>`;
      const t = targets[k];
      const basis = E.basisSession(data, ex.id, session);
      return html`<div class="ex-head">
        <div class="ex-name">${isSuper && html`<span class="ex-letter">${LETTERS[k]}</span>`}<span class="spacer">${ex.name}</span>
          ${e.sets.length === 0 && html`<button class="btn sm ghost" onClick=${() => {
            if (confirm(`Remove ${ex.name} from this session?`)) mut((s) => { s.entries.splice(idxs[k], 1); });
          }}>Remove</button>`}
        </div>
        <div class="target">${E.formatTarget(ex, t, e.plannedSets || counts[k] || 1)}${ex.perSide ? html`<span class="muted small"> per side</span>` : ''}</div>
        ${t && t.reason && html`<div class="reason">${t.reason}</div>`}
        ${basis && html`<div class="last">Last (${fmtDate(basis.session.date)}): ${E.summarizeSets(ex, basis.sets)}</div>`}
      </div>`;
    })}
    <div class="sets">
      ${rows.map(([k, r]) => {
        const ei = idxs[k];
        const e = entries[k];
        const ex = exs[k];
        if (!ex) return null;
        const logged = r < e.sets.length;
        const prefill = logged ? e.sets[r]
          : (e.sets.length ? { ...e.sets[e.sets.length - 1] } : E.setFromTarget(ex, targets[k]));
        const key = `${ei}:${r}`;
        const label = isSuper ? `${LETTERS[k]}${r + 1}` : `${r + 1}`;
        return html`<${SetRow} key=${key} ex=${ex} data=${data} label=${label} values=${prefill} logged=${logged}
          isOpen=${open === key} toggle=${() => setOpen(open === key ? null : key)}
          onLog=${(v) => { mut((s) => { s.entries[ei].sets.push(cleanSet(ex, v)); }); setOpen(null); }}
          onSave=${(v) => { mut((s) => { s.entries[ei].sets[r] = cleanSet(ex, v); }); setOpen(null); }}
          onDelete=${() => { mut((s) => { s.entries[ei].sets.splice(r, 1); }); setOpen(null); }}
          onDropRow=${() => { mut((s) => { const en = s.entries[ei]; en.plannedSets = Math.max(en.sets.length, (en.plannedSets || 0) - 1); }); setOpen(null); }}
        />`;
      })}
    </div>
    <div class="row wrap" style="margin-top:8px">
      ${entries.map((e, k) => exs[k] && html`<button class="btn sm ghost" onClick=${() => mut((s) => {
        const en = s.entries[idxs[k]]; en.plannedSets = Math.max(en.plannedSets || 0, en.sets.length) + 1;
      })}>+ Set${isSuper ? ` ${LETTERS[k]}` : ''}</button>`)}
    </div>
  </div>`;
}

function SetRow({ ex, data, label, values, logged, isOpen, toggle, onLog, onSave, onDelete, onDropRow }) {
  const ok = canLog(ex, values);
  const text = E.formatSet(ex, values) || (ex.type === 'weighted' ? `? kg × ${values.reps ?? '?'}` : 'Set values');
  return html`<div>
    <div class=${`set ${logged ? 'logged' : ''}`}>
      <span class="idx">${label}</span>
      <button class="val" onClick=${toggle}>${text.replace('×', ' × ')}</button>
      <button class="tick" aria-label=${logged ? 'Logged — edit' : 'Log set'} disabled=${!logged && !ok}
        onClick=${() => (logged ? toggle() : onLog(values))}>${Icon.check}</button>
    </div>
    ${isOpen && html`<${SetEditor} ex=${ex} data=${data} initial=${values} logged=${logged}
      onSubmit=${logged ? onSave : onLog} onDelete=${logged ? onDelete : onDropRow} onCancel=${toggle} />`}
  </div>`;
}

function Stepper({ label, value, step, onChange, decimals }) {
  const bump = (dir) => {
    const v = num(value) ?? 0;
    const n = Math.max(0, Math.round((v + dir * step) * 100) / 100);
    onChange(String(decimals ? n : Math.round(n)));
  };
  return html`<div class="stepper">
    <span class="lbl">${label}</span>
    <button onClick=${() => bump(-1)} aria-label=${`Less ${label}`}>−</button>
    <input type="number" inputmode="decimal" step="any" value=${value ?? ''} onInput=${(e) => onChange(e.target.value)} />
    <button onClick=${() => bump(1)} aria-label=${`More ${label}`}>+</button>
  </div>`;
}

function SetEditor({ ex, data, initial, logged, onSubmit, onDelete, onCancel }) {
  const [v, setV] = useState(() => {
    const o = {};
    for (const k of ['weight', 'reps', 'seconds', 'minutes', 'km']) o[k] = initial[k] == null ? '' : String(initial[k]);
    o.band = initial.band || (data.bands[0] || '');
    o.modifier = !!initial.modifier;
    return o;
  });
  const set = (k) => (val) => setV({ ...v, [k]: val });
  const parsed = { ...v, weight: num(v.weight), reps: num(v.reps), seconds: num(v.seconds), minutes: num(v.minutes), km: num(v.km) };
  const strength = ['weighted', 'band', 'bodyweight'].includes(ex.type);
  return html`<div class="editor">
    ${ex.perSide && html`<p class="small muted" style="margin:0 0 8px">Per side: log the weaker side.</p>`}
    ${ex.type === 'weighted' && html`<${Stepper} label="kg" value=${v.weight} step=${Number(ex.weightStep || 2)} decimals onChange=${set('weight')} />`}
    ${ex.type === 'band' && (data.bands.length
      ? html`<div class="band-pick">${data.bands.map((b) => html`<button class=${`chip ${v.band === b ? 'on' : ''}`} onClick=${() => set('band')(b)}>${b}</button>`)}</div>`
      : html`<p class="small muted">Add bands in Program → Bands first.</p>`)}
    ${strength && html`<${Stepper} label="Reps" value=${v.reps} step=${1} onChange=${set('reps')} />`}
    ${(strength || ex.type === 'hold') && (ex.ladder === 'modifier' || v.modifier) && html`<div class="row" style="margin-bottom:10px"><span class="lbl small muted" style="width:64px">${ex.modifierName || 'Pause'}</span>
      <div class="seg" style="flex:1"><button class=${!v.modifier ? 'on' : ''} onClick=${() => set('modifier')(false)}>Off</button>
      <button class=${v.modifier ? 'on' : ''} onClick=${() => set('modifier')(true)}>On</button></div></div>`}
    ${ex.type === 'hold' && html`<${Stepper} label="Seconds" value=${v.seconds} step=${Number(ex.holdStep || 5)} onChange=${set('seconds')} />`}
    ${ex.type === 'cardio' && html`<${Stepper} label="Minutes" value=${v.minutes} step=${1} decimals onChange=${set('minutes')} />
      <${Stepper} label="km" value=${v.km} step=${0.1} decimals onChange=${set('km')} />`}
    <div class="row">
      <button class="btn sm ghost danger" onClick=${onDelete}>${logged ? 'Delete set' : 'Drop set'}</button>
      <span class="spacer"></span>
      <button class="btn sm" onClick=${onCancel}>Cancel</button>
      <button class="btn sm primary" disabled=${!canLog(ex, parsed)} onClick=${() => onSubmit(parsed)}>${logged ? 'Save' : 'Log set'}</button>
    </div>
  </div>`;
}

function ExercisePicker({ data, onPick, onClose }) {
  const [q, setQ] = useState('');
  const list = data.exercises.filter((e) => e.name.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name));
  return html`<div class="sheet-backdrop" onClick=${(e) => e.target === e.currentTarget && onClose()}>
    <div class="sheet">
      <h2>Add exercise</h2>
      <input type="text" placeholder="Search" value=${q} onInput=${(e) => setQ(e.target.value)} style="margin-bottom:10px" />
      <div class="list">
        ${list.map((e) => html`<button class="item" onClick=${() => onPick(e.id)}>
          <span class="main"><span class="title">${e.name}</span><div class="sub">${E.TYPE_LABELS[e.type]}</div></span></button>`)}
        ${list.length === 0 && html`<div class="empty small">No exercises. Create them in Program → Exercises.</div>`}
      </div>
      <button class="btn block" onClick=${onClose}>Close</button>
    </div>
  </div>`;
}

// ---------- History ----------
function HistoryScreen({ data, nav }) {
  const [tab, setTab] = useState(() => sessionStorage.getItem('histTab') || 'exercises');
  const pick = (t) => { setTab(t); try { sessionStorage.setItem('histTab', t); } catch { /* ignore */ } };
  const sessions = E.sortedSessions(data).filter(E.sessionHasContent).reverse();
  const withHistory = data.exercises
    .map((ex) => {
      const last = sessions.find((s) => E.setsFor(s, ex.id).length);
      return last ? { ex, last, pr: E.personalRecord(data, ex.id) } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.ex.name.localeCompare(b.ex.name));

  return html`
    <${TopBar} title="History" nav=${nav} />
    <div class="seg" style="margin-bottom:12px">
      <button class=${tab === 'exercises' ? 'on' : ''} onClick=${() => pick('exercises')}>Exercises</button>
      <button class=${tab === 'sessions' ? 'on' : ''} onClick=${() => pick('sessions')}>Sessions</button>
    </div>
    ${tab === 'exercises' ? html`<div class="list">
      ${withHistory.map(({ ex, last, pr }) => html`<button class="item" onClick=${() => nav.go({ tab: 'history', view: 'exercise', id: ex.id })}>
        <span class="main"><div class="title">${ex.name}</div>
        <div class="sub">${pr ? `${pr.kind}: ${pr.label}` : ''} · last ${fmtDate(last.date)}</div></span><span class="chev">›</span></button>`)}
      ${withHistory.length === 0 && html`<div class="empty">Nothing logged yet.</div>`}
    </div>` : html`<div class="list">
      ${sessions.map((s) => {
        const n = s.entries.filter((e) => e.sets.length).length;
        return html`<button class="item" onClick=${() => nav.go({ tab: 'history', view: 'session', id: s.id })}>
          <span class="main"><div class="title">${s.workoutName || 'Unplanned'} ${s.deload && html`<span class="tag deload">Deload</span>`}</div>
          <div class="sub">${fmtDate(s.date)} · ${n} exercise${n === 1 ? '' : 's'}${s.finishedAt ? '' : ' · not finished'}</div></span><span class="chev">›</span></button>`;
      })}
      ${sessions.length === 0 && html`<div class="empty">Nothing logged yet.</div>`}
    </div>`}
  `;
}

function ExerciseHistory({ data, nav, id }) {
  const ex = exById(data, id);
  if (!ex) return html`<${TopBar} title="Exercise" nav=${nav} back /><div class="empty">Exercise not found.</div>`;
  const pr = E.personalRecord(data, id);
  const series = E.chartSeries(data, id);
  const rows = E.sortedSessions(data).filter((s) => E.setsFor(s, id).length).reverse();
  return html`
    <${TopBar} title=${ex.name} nav=${nav} back />
    ${pr && html`<div class="card"><div class="muted small">${pr.kind}</div>
      <div class="pr"><span class="big">${pr.label}</span><span class="muted">${fmtDate(pr.date)}</span></div></div>`}
    ${series.points.length > 1 && html`<div class="card"><h3 style="margin-bottom:6px">${series.title} over time</h3>
      <${LineChart} points=${series.points} unit=${series.unit} bands=${ex.type === 'band' ? data.bands : null} /></div>`}
    <div class="card">
      <h3 style="margin-bottom:6px">Log</h3>
      <table class="log"><tbody>
        ${rows.map((s) => html`<tr onClick=${() => nav.go({ tab: 'history', view: 'session', id: s.id })}>
          <td class="date">${fmtDate(s.date)}</td>
          <td>${E.summarizeSets(ex, E.setsFor(s, id))} ${s.deload && html`<span class="tag deload">Deload</span>`}</td></tr>`)}
      </tbody></table>
    </div>`;
}

function LineChart({ points, unit, bands }) {
  const [sel, setSel] = useState(null);
  const W = 340; const H = 180; const L = 40; const R = 12; const T = 16; const B = 26;
  const xs = points.map((p) => new Date(p.date).getTime());
  const x0 = Math.min(...xs); const x1 = Math.max(...xs);
  let y0 = Math.min(...points.map((p) => p.value)); let y1 = Math.max(...points.map((p) => p.value));
  let niceTicks = null;
  if (bands) { y0 = Math.max(0, y0 - 0.5); y1 += 0.5; } else {
    if (y0 === y1) { y0 -= 1; y1 += 1; }
    const raw = (y1 - y0) / 3;
    const mag = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
    y0 = Math.floor(y0 / step) * step; y1 = Math.ceil(y1 / step) * step;
    niceTicks = [];
    for (let v = y0; v <= y1 + step / 2; v += step) niceTicks.push(Math.round(v * 100) / 100);
  }
  const sx = (x) => L + (x1 === x0 ? (W - L - R) / 2 : ((x - x0) / (x1 - x0)) * (W - L - R));
  const sy = (y) => T + (1 - (y - y0) / (y1 - y0)) * (H - T - B);
  const fmtY = (v) => (bands ? (bands[Math.round(v)] || '') : `${Math.round(v * 10) / 10}`);
  const ticks = bands
    ? bands.map((_, i) => i).filter((i) => i >= y0 && i <= y1)
    : niceTicks;
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${sx(xs[i]).toFixed(1)},${sy(p.value).toFixed(1)}`).join(' ');
  const short = (iso) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  const onPointer = (e) => {
    const svg = e.currentTarget; const r = svg.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    let best = 0; let bd = Infinity;
    xs.forEach((x, i) => { const d = Math.abs(sx(x) - px); if (d < bd) { bd = d; best = i; } });
    setSel(best);
  };
  const p = sel != null ? points[sel] : null;
  return html`<svg class="chart" viewBox=${`0 0 ${W} ${H}`} role="img" aria-label=${`Chart of ${unit} over time`}
      onPointerDown=${onPointer} onPointerMove=${(e) => e.buttons && onPointer(e)}>
    ${ticks.map((t) => html`<line class="grid" x1=${L} x2=${W - R} y1=${sy(t)} y2=${sy(t)} />
      <text class="axis" x=${L - 6} y=${sy(t) + 4} text-anchor="end">${fmtY(t)}</text>`)}
    <text class="axis" x=${L} y=${H - 6}>${short(points[0].date)}</text>
    <text class="axis" x=${W - R} y=${H - 6} text-anchor="end">${short(points[points.length - 1].date)}</text>
    <path class="line" d=${path} />
    ${p && html`<line class="cross" x1=${sx(xs[sel])} x2=${sx(xs[sel])} y1=${T} y2=${H - B} />`}
    ${points.map((pt, i) => html`<circle class=${`pt ${pt.deload ? 'deload' : ''}`} cx=${sx(xs[i])} cy=${sy(pt.value)} r=${sel === i ? 6 : 4} />`)}
    ${p && html`<text class="sel" x=${Math.min(Math.max(sx(xs[sel]), L + 40), W - R - 40)} y=${T - 4} text-anchor="middle">
      ${short(p.date)}: ${bands ? bands[p.value] : `${p.value} ${unit}`}${p.deload ? ' (deload)' : ''}</text>`}
  </svg>`;
}

// ---------- Program ----------
function move(arr, i, dir) {
  const j = i + dir;
  if (j < 0 || j >= arr.length) return;
  [arr[i], arr[j]] = [arr[j], arr[i]];
}

function EditableList({ items, placeholder, onChange, hint }) {
  const [text, setText] = useState('');
  const add = () => { const t = text.trim(); if (!t || items.includes(t)) return; onChange([...items, t]); setText(''); };
  return html`<div>
    ${hint && html`<p class="small muted" style="margin:0 0 8px">${hint}</p>`}
    <div class="list">
      ${items.map((it, i) => html`<div class="item">
        <span class="main">${it}</span>
        <button class="iconbtn" disabled=${i === 0} aria-label="Move up" onClick=${() => { const a = [...items]; move(a, i, -1); onChange(a); }}>↑</button>
        <button class="iconbtn" disabled=${i === items.length - 1} aria-label="Move down" onClick=${() => { const a = [...items]; move(a, i, 1); onChange(a); }}>↓</button>
        <button class="iconbtn" aria-label="Remove" onClick=${() => onChange(items.filter((_, k) => k !== i))}>×</button>
      </div>`)}
      ${items.length === 0 && html`<div class="empty small">None yet.</div>`}
    </div>
    <div class="row"><input type="text" placeholder=${placeholder} value=${text} onInput=${(e) => setText(e.target.value)}
      onKeyDown=${(e) => e.key === 'Enter' && add()} /><button class="btn" onClick=${add}>Add</button></div>
  </div>`;
}

function ProgramScreen({ data, update, nav }) {
  const addWorkout = () => {
    const id = St.uid();
    const name = `Workout ${LETTERS[data.workouts.length] || data.workouts.length + 1}`;
    update((d) => { d.workouts.push({ id, name, items: [] }); });
    nav.go({ tab: 'program', view: 'workout', id });
  };
  const bandsInUse = new Set();
  data.sessions.forEach((s) => s.entries.forEach((e) => e.sets.forEach((x) => x.band && bandsInUse.add(x.band))));
  return html`
    <${TopBar} title="Program" nav=${nav} />
    <div class="section-title">Rotation</div>
    <div class="list">
      ${data.workouts.map((w, i) => html`<div class="item">
        <button class="main" style="border:0;background:none;text-align:left;padding:0" onClick=${() => nav.go({ tab: 'program', view: 'workout', id: w.id })}>
          <div class="title">${i + 1}. ${w.name}</div>
          <div class="sub">${w.items.map((it) => exById(data, it.exerciseId)?.name).filter(Boolean).join(', ') || 'No exercises'}</div></button>
        <button class="iconbtn" disabled=${i === 0} aria-label="Move up" onClick=${() => update((d) => move(d.workouts, i, -1))}>↑</button>
        <button class="iconbtn" disabled=${i === data.workouts.length - 1} aria-label="Move down" onClick=${() => update((d) => move(d.workouts, i, 1))}>↓</button>
      </div>`)}
      ${data.workouts.length === 0 && html`<div class="empty small">No workouts yet.</div>`}
    </div>
    <button class="btn block" onClick=${addWorkout}>+ Add workout</button>

    <div class="section-title">Warm-up (all workouts)</div>
    <${EditableList} items=${data.warmup} placeholder="e.g. Arm circles" onChange=${(a) => update((d) => { d.warmup = a; })} />

    <div class="section-title">Exercises</div>
    <div class="list">
      ${[...data.exercises].sort((a, b) => a.name.localeCompare(b.name)).map((ex) => html`
        <button class="item" onClick=${() => nav.go({ tab: 'program', view: 'exercise', id: ex.id })}>
          <span class="main"><div class="title">${ex.name}</div><div class="sub">${exerciseSummary(ex)}</div></span><span class="chev">›</span></button>`)}
      ${data.exercises.length === 0 && html`<div class="empty small">No exercises yet.</div>`}
    </div>
    <button class="btn block" onClick=${() => nav.go({ tab: 'program', view: 'exercise', id: 'new' })}>+ New exercise</button>

    <div class="section-title">Bands (light → heavy)</div>
    <${EditableList} items=${data.bands} placeholder="e.g. Red"
      hint=${bandsInUse.size ? 'Bands already used in history keep their name in past sessions; order sets what "next band" means.' : 'Order sets what "next band" means.'}
      onChange=${(a) => update((d) => { d.bands = a; })} />
  `;
}

function exerciseSummary(ex) {
  const t = E.TYPE_LABELS[ex.type];
  if (ex.type === 'cardio') return `${t} · +${ex.durationStep ?? 3} min${ex.durationCeiling ? ` to ${ex.durationCeiling}` : ''}`;
  const side = ex.perSide ? ' · per side' : '';
  if (ex.type === 'hold') {
    const r = ex.holdRange ? ` · ${ex.holdRange[0]}–${ex.holdRange[1]} s${ex.ladder === 'modifier' ? ` → ${ex.modifierName || 'Pause'}` : ''}` : '';
    return `${t}${r} · +${ex.holdStep ?? 5} s${ex.holdCeiling ? ` to ${ex.holdCeiling}` : ''}${side}`;
  }
  const lad = ex.ladder === 'modifier' ? `reps → ${ex.modifierName || 'Pause'} → load` : 'reps → load';
  const step = ex.type === 'weighted' ? ` · +${ex.weightStep ?? 2} kg` : '';
  return `${t} · ${ex.repRange[0]}–${ex.repRange[1]} · ${lad}${step}${side}`;
}

function WorkoutEditor({ data, update, nav, id }) {
  const w = data.workouts.find((x) => x.id === id);
  const [adding, setAdding] = useState(false);
  if (!w) return html`<${TopBar} title="Workout" nav=${nav} back /><div class="empty">Workout not found.</div>`;
  const mutW = (fn) => update((d) => { const x = d.workouts.find((y) => y.id === id); if (x) fn(x, d); });
  const del = () => {
    if (!confirm(`Delete ${w.name}? Past sessions are kept.`)) return;
    update((d) => { d.workouts = d.workouts.filter((x) => x.id !== id); });
    nav.back();
  };
  return html`
    <${TopBar} title=${w.name} nav=${nav} back />
    <label class="field"><span>Name</span>
      <input type="text" value=${w.name} onChange=${(e) => e.target.value.trim() && mutW((x) => { x.name = e.target.value.trim(); })} /></label>
    <div class="section-title">Exercises (in order)</div>
    <div class="list">
      ${w.items.map((it, i) => {
        const ex = exById(data, it.exerciseId);
        const linkedAbove = i > 0 && w.items[i - 1].supersetWithNext;
        return html`<div class="item" style="flex-wrap:wrap">
          <span class="main"><div class="title">${ex ? ex.name : 'Deleted exercise'}</div>
            ${(linkedAbove || it.supersetWithNext) && html`<div class="sub">Superset</div>`}</span>
          <button class="iconbtn" disabled=${i === 0} aria-label="Move up" onClick=${() => mutW((x) => move(x.items, i, -1))}>↑</button>
          <button class="iconbtn" disabled=${i === w.items.length - 1} aria-label="Move down" onClick=${() => mutW((x) => move(x.items, i, 1))}>↓</button>
          <button class="iconbtn" aria-label="Remove" onClick=${() => mutW((x) => { x.items.splice(i, 1); if (i > 0 && i >= x.items.length) x.items[i - 1].supersetWithNext = false; })}>×</button>
          <div class="row" style="width:100%;margin-top:8px">
            <span class="small muted">Sets</span>
            <button class="iconbtn" onClick=${() => mutW((x) => { x.items[i].sets = Math.max(1, (x.items[i].sets || 1) - 1); })}>−</button>
            <b style="min-width:20px;text-align:center">${it.sets}</b>
            <button class="iconbtn" onClick=${() => mutW((x) => { x.items[i].sets = (x.items[i].sets || 0) + 1; })}>+</button>
            <span class="spacer"></span>
            ${i < w.items.length - 1 && html`<button class=${`chip ${it.supersetWithNext ? 'on' : ''}`}
              onClick=${() => mutW((x) => { x.items[i].supersetWithNext = !x.items[i].supersetWithNext; })}>Superset with next</button>`}
          </div>
        </div>`;
      })}
      ${w.items.length === 0 && html`<div class="empty small">No exercises yet.</div>`}
    </div>
    <button class="btn block" style="margin-bottom:12px" onClick=${() => setAdding(true)}>+ Add exercise</button>
    <button class="btn ghost block danger" onClick=${del}>Delete workout</button>
    ${adding && html`<${ExercisePicker} data=${data} onClose=${() => setAdding(false)} onPick=${(exId) => {
      const ex = exById(data, exId);
      mutW((x) => { x.items.push({ exerciseId: exId, sets: ex.type === 'cardio' ? 1 : 3, supersetWithNext: false }); });
      setAdding(false);
    }} />`}
  `;
}

function ExerciseEditor({ data, update, nav, id }) {
  const isNew = id === 'new';
  const orig = isNew ? null : exById(data, id);
  const [f, setF] = useState(() => (orig ? structuredClone(orig) : { id: St.uid(), name: '', type: 'weighted', ...structuredClone(E.EXERCISE_DEFAULTS) }));
  const [err, setErr] = useState('');
  if (!isNew && !orig) return html`<${TopBar} title="Exercise" nav=${nav} back /><div class="empty">Exercise not found.</div>`;
  const hasHistory = !isNew && data.sessions.some((s) => E.setsFor(s, id).length);
  const set = (k, v) => setF({ ...f, [k]: v });
  const strength = ['weighted', 'band', 'bodyweight'].includes(f.type);

  const saveEx = () => {
    const name = (f.name || '').trim();
    if (!name) return setErr('Name is required.');
    if (data.exercises.some((e) => e.id !== f.id && e.name.toLowerCase() === name.toLowerCase())) return setErr('Another exercise already has this name.');
    const clean = { ...f, name };
    for (const k of ['weightStep', 'holdStep', 'durationStep']) if (clean[k] !== undefined) clean[k] = num(clean[k]) ?? E.EXERCISE_DEFAULTS[k];
    for (const k of ['holdCeiling', 'durationCeiling', 'startMinutes']) clean[k] = num(clean[k]);
    const next = E.applyExerciseEdit(orig, clean, nowIso());
    if (orig && next.restartAt && next.restartAt !== orig.restartAt && hasHistory
      && !confirm('Changing the rep range or ladder restarts this exercise at the bottom of the new range (at your current weight). Continue?')) return;
    update((d) => {
      const i = d.exercises.findIndex((e) => e.id === next.id);
      if (i >= 0) d.exercises[i] = next; else d.exercises.push(next);
    });
    nav.back();
  };
  const del = () => {
    if (hasHistory) { alert('This exercise has logged history, so it can’t be deleted. You can rename it or remove it from workouts.'); return; }
    if (!confirm(`Delete ${orig.name}?`)) return;
    update((d) => {
      d.exercises = d.exercises.filter((e) => e.id !== id);
      d.workouts.forEach((w) => { w.items = w.items.filter((it) => it.exerciseId !== id); });
    });
    nav.back();
  };

  return html`
    <${TopBar} title=${isNew ? 'New exercise' : orig.name} nav=${nav} back />
    <div class="card">
      <label class="field"><span>Name</span><input type="text" value=${f.name} onInput=${(e) => set('name', e.target.value)} /></label>
      <label class="field"><span>Type${hasHistory ? ' (locked: has history)' : ''}</span>
        <select value=${f.type} disabled=${hasHistory} onChange=${(e) => set('type', e.target.value)}>
          ${E.TYPES.map((t) => html`<option value=${t}>${E.TYPE_LABELS[t]}</option>`)}
        </select></label>
      ${strength && html`
        <div class="field"><span>Rep range</span><div class="seg">
          ${[[8, 12], [12, 16]].map((r) => html`<button class=${f.repRange[0] === r[0] ? 'on' : ''} onClick=${() => set('repRange', r)}>${r[0]}–${r[1]}</button>`)}
        </div></div>
        <div class="field"><span>Progression ladder</span><div class="seg">
          <button class=${f.ladder === 'simple' ? 'on' : ''} onClick=${() => set('ladder', 'simple')}>Reps → load</button>
          <button class=${f.ladder === 'modifier' ? 'on' : ''} onClick=${() => set('ladder', 'modifier')}>Reps → modifier → load</button>
        </div></div>
        ${f.ladder === 'modifier' && html`<label class="field"><span>Modifier name</span>
          <input type="text" value=${f.modifierName} onInput=${(e) => set('modifierName', e.target.value)} /></label>`}
        ${f.type === 'weighted' && html`<label class="field"><span>Weight step (kg)</span>
          <input type="number" inputmode="decimal" step="any" value=${f.weightStep} onInput=${(e) => set('weightStep', e.target.value)} /></label>`}
        ${f.type === 'band' && html`<p class="small muted">Load step = next band in Program → Bands.</p>`}
        ${f.type === 'bodyweight' && html`<p class="small muted">No load step: after the ladder, reps keep climbing.</p>`}
      `}
      ${f.type === 'hold' && html`
        <div class="field"><span>Range in seconds (optional)</span><div class="row">
          <input type="number" inputmode="numeric" placeholder="from" value=${f.holdRange ? f.holdRange[0] : ''}
            onInput=${(e) => set('holdRange', e.target.value === '' ? null : [num(e.target.value), f.holdRange ? f.holdRange[1] : num(e.target.value)])} />
          <span>–</span>
          <input type="number" inputmode="numeric" placeholder="to" value=${f.holdRange ? f.holdRange[1] : ''}
            onInput=${(e) => set('holdRange', e.target.value === '' ? null : [f.holdRange ? f.holdRange[0] : num(e.target.value), num(e.target.value)])} />
        </div></div>
        ${f.holdRange && html`<div class="field"><span>At top of range</span><div class="seg">
          <button class=${f.ladder !== 'modifier' ? 'on' : ''} onClick=${() => set('ladder', 'simple')}>Keep adding time</button>
          <button class=${f.ladder === 'modifier' ? 'on' : ''} onClick=${() => set('ladder', 'modifier')}>Modifier, then time</button>
        </div></div>`}
        ${f.holdRange && f.ladder === 'modifier' && html`<label class="field"><span>Modifier name</span>
          <input type="text" value=${f.modifierName} onInput=${(e) => set('modifierName', e.target.value)} /></label>`}
        <label class="field"><span>Step (seconds)</span><input type="number" inputmode="numeric" value=${f.holdStep} onInput=${(e) => set('holdStep', e.target.value)} /></label>
        <label class="field"><span>Ceiling (seconds, optional)</span><input type="number" inputmode="numeric" value=${f.holdCeiling ?? ''} onInput=${(e) => set('holdCeiling', e.target.value)} /></label>`}
      ${f.type === 'cardio' && html`
        <label class="field"><span>Starting minutes (optional, first session)</span><input type="number" inputmode="decimal" value=${f.startMinutes ?? ''} onInput=${(e) => set('startMinutes', e.target.value)} /></label>
        <label class="field"><span>Step (minutes)</span><input type="number" inputmode="decimal" step="any" value=${f.durationStep} onInput=${(e) => set('durationStep', e.target.value)} /></label>
        <label class="field"><span>Ceiling (minutes, optional) — after it, beat the distance</span><input type="number" inputmode="decimal" value=${f.durationCeiling ?? ''} onInput=${(e) => set('durationCeiling', e.target.value)} /></label>`}
      ${f.type !== 'cardio' && html`<label class="row" style="margin-bottom:12px;min-height:44px">
        <input type="checkbox" style="width:22px;height:22px" checked=${!!f.perSide} onChange=${(e) => set('perSide', e.target.checked)} />
        <span>Per side (log the weaker side)</span></label>`}
      ${err && html`<p style="color:var(--danger)">${err}</p>`}
      <button class="btn primary block" onClick=${saveEx}>Save</button>
    </div>
    ${!isNew && html`<button class="btn ghost block danger" onClick=${del}>Delete exercise</button>`}
  `;
}

// ---------- Data ----------
function DataScreen({ data, update, replaceAll, nav }) {
  const [persisted, setPersisted] = useState(null);
  const [msg, setMsg] = useState('');
  const fileRef = useRef(null);
  useEffect(() => { St.isPersisted().then(setPersisted); }, []);
  const markExported = () => update((d) => { d.settings.lastExport = nowIso(); });
  const doExport = () => { St.downloadExport(data); markExported(); setMsg('Backup downloaded.'); };
  const doShare = async () => {
    try { await St.shareExport(data); markExported(); setMsg('Backup shared.'); } catch (e) { if (e.name !== 'AbortError') setMsg(`Share failed: ${e.message}`); }
  };
  const doImport = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const d = await St.readImportFile(file);
      const n = d.sessions.length;
      if (!confirm(`Replace ALL current data with this file (${d.exercises.length} exercises, ${n} sessions)?`)) return;
      replaceAll(d);
      setMsg('Import complete.');
    } catch (err) { setMsg(`Import failed: ${err.message}`); }
  };
  const last = data.settings.lastExport;
  return html`
    <${TopBar} title="Data" nav=${nav} />
    <div class="card stack">
      <h2>Backup</h2>
      <p class="small muted" style="margin:0">Your data lives only on this phone. Export a JSON file to keep a copy, move to a new phone, or use it elsewhere.</p>
      <p class="small" style="margin:0">Last export: <b>${last ? `${fmtDate(last.slice(0, 10))}` : 'never'}</b></p>
      <button class="btn primary block" onClick=${doExport}>Export JSON</button>
      ${St.canShareFile() && html`<button class="btn block" onClick=${doShare}>Share JSON…</button>`}
      <button class="btn block" onClick=${() => fileRef.current.click()}>Import JSON…</button>
      <input ref=${fileRef} type="file" accept="application/json,.json" style="display:none" onChange=${doImport} />
      ${msg && html`<p class="small" style="margin:0">${msg}</p>`}
    </div>
    <div class="card">
      <h2>Settings</h2>
      <label class="field"><span>Backup reminder after (days)</span>
        <input type="number" inputmode="numeric" value=${data.settings.backupReminderDays}
          onChange=${(e) => update((d) => { d.settings.backupReminderDays = Math.max(1, num(e.target.value) || 7); })} /></label>
      <p class="small muted" style="margin:0">Storage: ${persisted == null ? '…' : persisted ? 'protected from automatic clean-up' : 'not yet protected — install the app to your home screen'}</p>
    </div>
    <p class="small muted" style="text-align:center">Training Tracker v${APP_VERSION} · ${data.exercises.length} exercises · ${data.sessions.length} sessions</p>
  `;
}

render(html`<${App} />`, document.getElementById('app'));

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('SW registration failed', e));
}
