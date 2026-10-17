import { html, render, useState, useEffect, useRef } from '../vendor/preact-htm.js';
import * as E from './engine.js';
import * as St from './store.js';
import * as I from './insights.js';

export const APP_VERSION = '2.3.0';

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


// ---------- icons (24px grid, 1.75 stroke) ----------
const svg = (d, extra = '') => html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" dangerouslySetInnerHTML=${{ __html: d + extra }}></svg>`;
const Icon = {
  check: () => svg('<path d="M5 12.5l4.5 4.5L19 7.5" stroke-width="2.5"/>'),
  today: () => svg('<path d="M6.5 7v10M17.5 7v10M3.5 9.5v5M20.5 9.5v5M6.5 12h11"/>'),
  history: () => svg('<path d="M4 20V4M4 20h16M8 15l3.5-4 3 2.5L20 7"/>'),
  program: () => svg('<path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" stroke-width="2"/>'),
  data: () => svg('<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>'),
  back: () => svg('<path d="M15 5l-7 7 7 7" stroke-width="2"/>'),
  chev: () => html`<span class="chev">${svg('<path d="M9 5l7 7-7 7"/>')}</span>`,
  down: () => svg('<path d="M6 9l6 6 6-6"/>'),
  up: () => svg('<path d="M12 19V5M6 11l6-6 6 6"/>'),
  dn: () => svg('<path d="M12 5v14M6 13l6 6 6-6"/>'),
  x: () => svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  plus: () => svg('<path d="M12 5v14M5 12h14"/>'),
  link: () => svg('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'),
};
const TAB_ICONS = { today: Icon.today, history: Icon.history, program: Icon.program, data: Icon.data };

// ---------- theme ----------
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  const meta = document.querySelector('meta[name=theme-color]');
  if (meta) meta.content = dark ? '#141516' : '#ffffff';
}

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

  const theme = (data.settings && data.settings.theme) || 'light';
  useEffect(() => { applyTheme(theme); }, [theme]);
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
    <nav class="tabs" aria-label="Sections">
      ${tabs.map(([t, label]) => html`
        <button class=${route.tab === t ? 'on' : ''} aria-current=${route.tab === t ? 'page' : null} onClick=${() => nav.tab(t)}>${TAB_ICONS[t]()}<span>${label}</span></button>`)}
    </nav>`;
}

function TopBar({ title, nav, back, right, large, children }) {
  return html`<header class=${`hdr ${large ? 'large' : ''}`}>
    <div class="hdr-row">
      ${back ? html`<button class="back" aria-label="Back" onClick=${() => nav.back()}>${Icon.back()}</button>` : null}
      <h1>${title}</h1>${right || null}
    </div>
    ${children}
  </header>`;
}

function Switch({ on, onChange, label }) {
  return html`<button class="switch" role="switch" aria-checked=${on ? 'true' : 'false'} aria-label=${label} onClick=${() => onChange(!on)}></button>`;
}

const longDate = (d = new Date()) => d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

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

  const info = E.nextWorkoutInfo(data, St.todayStr());
  const next = info && info.workout;
  const weekDay = (data.settings || {}).weekStartsOn === 1 ? 'Monday' : 'Sunday';
  const done = E.sortedSessions(data).filter((s) => E.sessionHasContent(s));
  const lastSession = done[done.length - 1];
  const settings = data.settings || {};
  const days = settings.lastExport ? daysBetween(settings.lastExport.slice(0, 10), St.todayStr()) : null;
  const needBackup = data.sessions.length > 0 && (days == null || days >= (settings.backupReminderDays || 7));
  const finishedToday = lastSession && lastSession.date === St.todayStr() && lastSession.finishedAt;
  const lastOfNext = next && [...done].reverse().find((s) => s.workoutId === next.id);
  const items = next ? next.items.filter((it) => exById(data, it.exerciseId)) : [];

  return html`
    <${TopBar} title="Today" nav=${nav} large>
      <div class="hdr-sub">${longDate()}</div>
    </${TopBar}>
    ${needBackup && html`<div class="notice"><span class="dot"></span>
      <span class="spacer">${days == null ? 'You haven’t exported a backup yet.' : `Last backup was ${days} days ago.`}</span>
      <button class="link sm" onClick=${() => nav.tab('data')}>Back up</button></div>`}
    ${finishedToday && html`<div class="notice done"><span class="dot"></span>
      <span class="spacer">You finished ${lastSession.workoutName || 'an unplanned session'} today.</span>
      <button class="link sm" onClick=${() => nav.go({ tab: 'today', view: 'session', id: lastSession.id })}>View</button></div>`}
    ${next ? html`
      <h2 class="next-name">${next.name}</h2>
      <p class="next-sub">${info.optional
        ? `Optional this week. If you skip it, ${info.fallback.name} is next on ${weekDay}.`
        : `Next in your rotation${lastOfNext ? `, last done ${fmtDate(lastOfNext.date)}` : ''}`}</p>
      <div class="plan">${items.map((it) => {
        const ex = exById(data, it.exerciseId);
        const t = E.targetFor(data, ex.id);
        return html`<div class="plan-row"><span class="n">${ex.name}</span><span class="t">${E.formatTarget(ex, t, it.sets)}</span></div>`;
      })}
      ${items.length === 0 && html`<p class="empty">This workout has no exercises yet.</p>`}</div>
      <button class="btn primary block" onClick=${() => startSession(update, nav, data, next)}>Start workout</button>
      <div class="alt-actions">
        ${data.workouts.length > 1 && html`<button class="link" aria-expanded=${pickOther} onClick=${() => setPickOther(!pickOther)}>Choose another workout</button>`}
        <button class="link" onClick=${() => startSession(update, nav, data, null)}>Log unplanned session</button>
      </div>
      ${pickOther && html`<div class="list alt-list">
        ${data.workouts.filter((w) => w.id !== next.id).map((w) => html`
          <button class="li" onClick=${() => startSession(update, nav, data, w)}>
            <span class="li-main"><span class="li-title">${w.name}</span><div class="li-sub">${w.items.length} exercises</div></span>
            <span class="link sm">Start</span></button>`)}
      </div>`}
    ` : html`
      <div class="empty">
        <p>Your program has no workouts yet. Add one to get a plan for each session.</p>
        <button class="btn primary" onClick=${() => nav.tab('program')}>Set up program</button>
        <div><button class="link" onClick=${() => startSession(update, nav, data, null)}>Log unplanned session</button></div>
      </div>`}
  `;
}

// ---------- Session (active workout or past session) ----------
function SessionScreen({ data, update, nav, id }) {
  const s = data.sessions.find((x) => x.id === id);
  if (!s) return html`<${TopBar} title="Session" nav=${nav} back /><p class="empty">This session no longer exists.</p>`;
  const today = St.todayStr();
  const mode = !s.finishedAt && s.date === today ? 'active' : 'edit';
  return html`<${SessionView} data=${data} update=${update} nav=${nav} session=${s} mode=${mode} back />`;
}

function SessionView({ data, update, nav, session, mode, back }) {
  const [open, setOpen] = useState(null); // "entryIdx:rowIdx"
  const [adding, setAdding] = useState(false);
  const [expanded, setExpanded] = useState({});
  const [warmOpen, setWarmOpen] = useState(mode === 'active' && (session.warmupDone || []).length < data.warmup.length);
  const sid = session.id;
  const mut = (fn) => update((d) => { const s = d.sessions.find((x) => x.id === sid); if (s) fn(s, d); });

  const title = session.workoutName || 'Unplanned session';
  const groups = groupEntries(session.entries);
  const totalSets = session.entries.reduce((a, e) => a + Math.max(e.plannedSets || 0, e.sets.length), 0);
  const doneSets = session.entries.reduce((a, e) => a + e.sets.length, 0);
  const firstOpen = groups.findIndex((g) => g.some((i) => session.entries[i].sets.length < (session.entries[i].plannedSets || 0)));
  const anything = E.sessionHasContent(session);
  const warmDone = (session.warmupDone || []).filter((w) => data.warmup.includes(w)).length;

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
    <section class="warm">
      <button class="warm-toggle" aria-expanded=${warmOpen ? 'true' : 'false'} onClick=${() => setWarmOpen(!warmOpen)}>
        <h2>Warm-up</h2>
        <span class="count">${warmDone === data.warmup.length ? 'Done' : `${warmDone} of ${data.warmup.length}`}</span>
        ${Icon.down()}
      </button>
      ${warmOpen && html`<div class="warm-items">${data.warmup.map((w) => {
        const on = (session.warmupDone || []).includes(w);
        return html`<button class=${`warm-item ${on ? 'on' : ''}`} role="checkbox" aria-checked=${on ? 'true' : 'false'} onClick=${() => {
          mut((s) => { s.warmupDone = on ? s.warmupDone.filter((x) => x !== w) : [...(s.warmupDone || []), w]; });
          const after = on ? (session.warmupDone || []).length - 1 : (session.warmupDone || []).length + 1;
          if (!on && after >= data.warmup.length) setWarmOpen(false);
        }}><span class="box">${on ? Icon.check() : null}</span><span>${w}</span></button>`;
      })}</div>`}
    </section>` : null;

  return html`
    <${TopBar} title=${title} nav=${nav} back=${back}
      right=${mode === 'active' ? html`<button class=${`btn sm ${totalSets > 0 && doneSets >= totalSets ? 'primary' : ''}`} onClick=${finish}>Finish</button>` : null}>
      <div class="hdr-sub">
        ${mode === 'edit'
          ? html`<input type="date" aria-label="Date" value=${session.date} style="width:auto;min-height:36px" onChange=${(e) => e.target.value && mut((s) => { s.date = e.target.value; })} />`
          : null}
        <span class="grow num">${mode === 'active' ? `${doneSets} of ${totalSets} sets` : ''}</span>
        <label class="switch-label">Deload <${Switch} label="Deload" on=${!!session.deload} onChange=${(v) => mut((s) => { s.deload = v; })} /></label>
      </div>
      ${mode === 'active' && html`<div class="progress"><div style=${`width:${totalSets ? Math.round((doneSets / totalSets) * 100) : 0}%`}></div></div>`}
    </${TopBar}>
    ${session.deload && html`<p class="sec-note warn-text" style="margin-top:12px">Deload session. It won’t change your progression.</p>`}
    ${warm}
    ${groups.map((g, gi) => html`<${EntryGroup} key=${g.join('-')} data=${data} session=${session} idxs=${g} current=${gi === firstOpen}
        collapsible=${mode === 'active' && !expanded[g.join('-')]} onExpand=${() => setExpanded({ ...expanded, [g.join('-')]: true })}
        open=${open} setOpen=${setOpen} mut=${mut} />`)}
    ${session.entries.length === 0 && html`<p class="empty">No exercises in this session yet.</p>`}
    <div class="session-actions">
      <button class="link" onClick=${() => setAdding(true)}>${Icon.plus()} Add exercise</button>
      ${mode === 'active'
        ? html`<button class="link danger" onClick=${cancel}>${anything ? 'Delete session' : 'Cancel workout'}</button>`
        : html`<button class="link danger" onClick=${cancel}>Delete session</button>`}
    </div>
    ${adding && html`<${ExercisePicker} data=${data} onClose=${() => setAdding(false)} onPick=${(exId) => {
      const ex = exById(data, exId);
      const basis = E.basisSession(data, exId, session);
      const planned = ex.type === 'cardio' ? 1 : basis ? basis.sets.length : 3;
      mut((s) => { s.entries.push({ exerciseId: exId, plannedSets: planned, supersetWithNext: false, sets: [] }); });
      setAdding(false);
    }} />`}
  `;
}

function EntryGroup({ data, session, idxs, current, collapsible, onExpand, open, setOpen, mut }) {
  const [info, setInfo] = useState(null);
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

  const groupDone = rows.length > 0 && entries.every((e, k) => e.sets.length >= counts[k]);
  const nextRow = rows.findIndex(([k, r]) => r >= entries[k].sets.length);
  const editingHere = open != null && idxs.includes(Number(open.split(':')[0]));
  if (groupDone && collapsible && !editingHere) {
    return html`<button class="done-group" onClick=${onExpand} aria-label=${`Show sets for ${exs.filter(Boolean).map((x) => x.name).join(' and ')}`}>
      ${entries.map((e, k) => exs[k] && html`<div class="done-row">
        <span class="check">${Icon.check()}</span><span class="name">${exs[k].name}</span>
        <span class="sum">${E.summarizeSets(exs[k], e.sets)}</span></div>`)}
    </button>`;
  }
  return html`<section class="ex">
    ${isSuper && html`<div class="ex-sup">Superset, alternate sets</div>`}
    ${entries.map((e, k) => {
      const ex = exs[k];
      if (!ex) return html`<div class="ex-head muted">Deleted exercise</div>`;
      const t = targets[k];
      const basis = E.basisSession(data, ex.id, session);
      const exDone = e.sets.length > 0 && e.sets.length >= counts[k];
      return html`<div class="ex-head"><div class="ex-head-main">
        <div class="ex-title">${isSuper && html`<span class="ex-letter">${LETTERS[k]}</span>`}<h3>${ex.name}</h3>
          ${exDone && html`<span class="done-row"><span class="check" aria-label="Done">${Icon.check()}</span></span>`}
          ${e.sets.length === 0 && html`<button class="link sm quiet" onClick=${() => {
            if (confirm(`Remove ${ex.name} from this session?`)) mut((s) => { s.entries.splice(idxs[k], 1); });
          }}>Remove</button>`}
        </div>
        ${ex.muscles && ex.muscles.length > 0 && html`<div class="muscles">${ex.muscles.join(', ')}</div>`}
        <div class="target">${E.formatTarget(ex, t, e.plannedSets || counts[k] || 1)}${ex.perSide ? html`<span class="side">per side</span>` : ''}</div>
        <${Ladder} info=${E.ladderInfo(ex, t, data)} />
        ${t && t.reason && html`<p class="why">${t.reason}</p>`}
        ${basis && html`<p class="why last">Last time, ${fmtDate(basis.session.date)}: <span class="num">${E.summarizeSets(ex, basis.sets)}</span></p>`}
        </div>
        <${Thumb} ex=${ex} size=${64} onClick=${() => setInfo(ex.id)} />
      </div>`;
    })}
    ${info && html`<${ExerciseInfo} ex=${exById(data, info)} onClose=${() => setInfo(null)} />`}
    <div class="sets">
      ${rows.map(([k, r], rowIdx) => {
        const ei = idxs[k];
        const e = entries[k];
        const ex = exs[k];
        if (!ex) return null;
        const logged = r < e.sets.length;
        const prefill = logged ? e.sets[r]
          : (e.sets.length ? { ...e.sets[e.sets.length - 1] } : E.setFromTarget(ex, targets[k]));
        const key = `${ei}:${r}`;
        const label = isSuper ? `${LETTERS[k]}${r + 1}` : `${r + 1}`;
        return html`<${SetRow} key=${key} ex=${ex} data=${data} label=${label} values=${prefill} logged=${logged} next=${current && rowIdx === nextRow}
          isOpen=${open === key} toggle=${() => setOpen(open === key ? null : key)}
          onLog=${(v) => { mut((s) => { s.entries[ei].sets.push(cleanSet(ex, v)); }); setOpen(null); }}
          onSave=${(v) => { mut((s) => { s.entries[ei].sets[r] = cleanSet(ex, v); }); setOpen(null); }}
          onDelete=${() => { mut((s) => { s.entries[ei].sets.splice(r, 1); }); setOpen(null); }}
          onDropRow=${() => { mut((s) => { const en = s.entries[ei]; en.plannedSets = Math.max(en.sets.length, (en.plannedSets || 0) - 1); }); setOpen(null); }}
        />`;
      })}
    </div>
    <div class="ex-foot">
      ${entries.map((e, k) => exs[k] && html`<button class="link sm" onClick=${() => mut((s) => {
        const en = s.entries[idxs[k]]; en.plannedSets = Math.max(en.plannedSets || 0, en.sets.length) + 1;
      })}>${Icon.plus()} Add set${isSuper ? ` ${LETTERS[k]}` : ''}</button>`)}
    </div>
  </section>`;
}

function Thumb({ ex, size = 40, onClick }) {
  if (!ex || !ex.images || !ex.images.length) return null;
  const img = html`<img src=${ex.images[0]} alt="" loading="lazy" width=${size} height=${size} />`;
  return onClick
    ? html`<button class="thumb" style=${`width:${size}px;height:${size}px`} aria-label=${`Show ${ex.name}`} onClick=${onClick}>${img}</button>`
    : html`<span class="thumb" style=${`width:${size}px;height:${size}px`}>${img}</span>`;
}

/** Bottom sheet: the exercise's start/end photos (alternating) and the muscles it works. */
function ExerciseInfo({ ex, onClose }) {
  const [frame, setFrame] = useState(0);
  const imgs = (ex && ex.images) || [];
  useEffect(() => {
    if (imgs.length < 2 || matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;
    const t = setInterval(() => setFrame((f) => (f + 1) % imgs.length), 1100);
    return () => clearInterval(t);
  }, [imgs.length]);
  if (!ex) return null;
  return html`<div class="sheet-backdrop" onClick=${(e) => e.target === e.currentTarget && onClose()}>
    <div class="sheet" role="dialog" aria-label=${ex.name}>
      <div class="grab"></div>
      <div class="sheet-head"><h2>${ex.name}</h2><button class="link sm" onClick=${onClose}>Close</button></div>
      ${imgs.length > 0 && html`<button class="info-photo" aria-label="Next photo" onClick=${() => setFrame((frame + 1) % imgs.length)}>
        <img src=${imgs[frame]} alt=${`${ex.name}, ${frame === 0 ? 'start' : 'end'} position`} /></button>
        ${imgs.length > 1 && html`<div class="info-frames" aria-hidden="true">${imgs.map((_, i) => html`<span class=${i === frame ? 'on' : ''}>${i === 0 ? 'Start' : 'End'}</span>`)}</div>`}`}
      ${ex.muscles && ex.muscles.length > 0 && html`<div class="info-row"><span class="k">Muscles</span><span>${ex.muscles.join(', ')}</span></div>`}
      ${ex.imageSource && html`<p class="meta" style="margin-top:12px">Photo shows a similar exercise: ${ex.imageSource}.</p>`}
      ${imgs.length > 0 && html`<p class="meta" style="margin-top:4px">Photos: Free Exercise DB, public domain.</p>`}
    </div>
  </div>`;
}

function Ladder({ info }) {
  if (!info) return null;
  return html`<div class="ladder" title=${info.stages.map((x) => x.label).join(' → ')}>
    <div class="ladder-bar" aria-hidden="true">${info.stages.map((st) => html`<span><i style=${`width:${Math.round(st.fill * 100)}%`}></i></span>`)}</div>
    <span class="ladder-text">${info.text}</span>
  </div>`;
}

function setText(ex, v) {
  const n = (x) => (x == null || x === '' ? '—' : E.fmtNum(Number(x)));
  if (ex.type === 'cardio') return `${n(v.minutes)} min${v.km != null && v.km !== '' ? `  ${n(v.km)} km` : ''}`;
  if (ex.type === 'hold') return `${n(v.seconds)} s`;
  if (ex.type === 'weighted') return `${n(v.weight)} kg × ${n(v.reps)}`;
  if (ex.type === 'band') return `${v.band || '—'} × ${n(v.reps)}`;
  return `${n(v.reps)} reps`;
}

function SetRow({ ex, data, label, values, logged, next, isOpen, toggle, onLog, onSave, onDelete, onDropRow }) {
  const ok = canLog(ex, values);
  return html`<div>
    <div class=${`set ${logged ? 'logged' : ''} ${next ? 'next' : ''}`}>
      <span class="idx">${label}</span>
      <button class="val" aria-expanded=${isOpen ? 'true' : 'false'} onClick=${toggle}>${setText(ex, values)}${values.modifier ? html`<span class="mod">${ex.modifierName || 'Pause'}</span>` : null}</button>
      <button class="tick" aria-label=${logged ? 'Logged, edit set' : 'Log set'} disabled=${!logged && !ok}
        onClick=${() => (logged ? toggle() : onLog(values))}>${Icon.check()}</button>
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
    <button onClick=${() => bump(-1)} aria-label=${`Less ${label}`}>−</button>
    <input type="number" inputmode="decimal" step="any" aria-label=${label} value=${value ?? ''} onInput=${(e) => onChange(e.target.value)} />
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
  const row = (lbl, body) => html`<div class="ed-row"><span class="lbl">${lbl}</span>${body}</div>`;
  return html`<div class="editor">
    ${ex.perSide && html`<p class="note">Log the weaker side.</p>`}
    ${ex.type === 'weighted' && row('Weight, kg', html`<${Stepper} label="Weight" value=${v.weight} step=${Number(ex.weightStep || 2)} decimals onChange=${set('weight')} />`)}
    ${ex.type === 'band' && row('Band', data.bands.length
      ? html`<div class="bands">${data.bands.map((b) => html`<button class=${v.band === b ? 'on' : ''} aria-pressed=${v.band === b} onClick=${() => set('band')(b)}>${b}</button>`)}</div>`
      : html`<span class="small muted">Add your bands under Program first.</span>`)}
    ${strength && row('Reps', html`<${Stepper} label="Reps" value=${v.reps} step=${1} onChange=${set('reps')} />`)}
    ${ex.type === 'hold' && row('Seconds', html`<${Stepper} label="Seconds" value=${v.seconds} step=${Number(ex.holdStep || 5)} onChange=${set('seconds')} />`)}
    ${ex.type === 'cardio' && row('Minutes', html`<${Stepper} label="Minutes" value=${v.minutes} step=${1} decimals onChange=${set('minutes')} />`)}
    ${ex.type === 'cardio' && row('km', html`<${Stepper} label="Distance" value=${v.km} step=${0.1} decimals onChange=${set('km')} />`)}
    ${(strength || ex.type === 'hold') && (ex.ladder === 'modifier' || v.modifier) && html`<div class="ed-row">
      <span class="spacer small" style="color:var(--ink-2)">${ex.modifierName || 'Pause'}</span>
      <${Switch} label=${ex.modifierName || 'Pause'} on=${v.modifier} onChange=${set('modifier')} /></div>`}
    <div class="actions">
      <button class="link sm danger" onClick=${onDelete}>${logged ? 'Delete set' : 'Remove set'}</button>
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
    <div class="sheet" role="dialog" aria-label="Add exercise">
      <div class="grab"></div>
      <div class="sheet-head"><h2>Add exercise</h2><button class="link sm" onClick=${onClose}>Close</button></div>
      <input type="text" placeholder="Search exercises" aria-label="Search exercises" value=${q} onInput=${(e) => setQ(e.target.value)} />
      <div class="list" style="margin-top:8px">
        ${list.map((e) => html`<button class="li" onClick=${() => onPick(e.id)}>
          <span class="li-main"><span class="li-title">${e.name}</span><div class="li-sub">${E.TYPE_LABELS[e.type]}</div></span></button>`)}
      </div>
      ${list.length === 0 && html`<p class="empty">${data.exercises.length ? `No exercise matches “${q}”.` : 'You have no exercises yet. Create them under Program.'}</p>`}
    </div>
  </div>`;
}

// ---------- History ----------
const monthLabel = (iso) => { const [y, m] = iso.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }); };

function HistoryScreen({ data, nav }) {
  const [tab, setTab] = useState(() => { try { return sessionStorage.getItem('histTab') || 'exercises'; } catch { return 'exercises'; } });
  const pick = (t) => { setTab(t); try { sessionStorage.setItem('histTab', t); } catch { /* ignore */ } };
  const today = St.todayStr();
  const tabs = [['exercises', 'Exercises'], ['sessions', 'Sessions'], ['muscles', 'Muscles']];
  return html`
    <${TopBar} title="History" nav=${nav} large />
    <div class="tabs-inline" role="tablist">
      ${tabs.map(([k, l]) => html`<button role="tab" aria-selected=${tab === k} class=${tab === k ? 'on' : ''} onClick=${() => pick(k)}>${l}</button>`)}
    </div>
    ${tab === 'exercises' && html`<${ProgressList} data=${data} nav=${nav} today=${today} />`}
    ${tab === 'sessions' && html`<${SessionsTab} data=${data} nav=${nav} today=${today} />`}
    ${tab === 'muscles' && html`<${MusclesTab} data=${data} today=${today} />`}
  `;
}

/** Exercises with history: trend line, where each one stands, change over 4 weeks, stalls first. */
function ProgressList({ data, nav, today }) {
  const rows = I.progressOverview(data, today);
  if (!rows.length) return html`<p class="empty">Exercises appear here after you log your first set.</p>`;
  const stalled = rows.filter((r) => r.stalled).length;
  return html`
    <p class="sec-note" style="margin-top:12px">${stalled
      ? `${stalled} exercise${stalled === 1 ? ' hasn’t' : 's haven’t'} progressed in the last three sessions. Change shown over the last 4 weeks.`
      : 'Change shown over the last 4 weeks. One step is one rep, or one move up the ladder.'}</p>
    <div class="list">
      ${rows.map((r) => html`<button class="li prog" onClick=${() => nav.go({ tab: 'history', view: 'exercise', id: r.ex.id })}>
        <span class="li-main"><div class="li-title">${r.ex.name}</div><div class="li-sub num">${r.now}</div></span>
        <span class="prog-aside">
          <${Sparkline} values=${r.spark} />
          <span class=${`prog-delta ${r.stalled ? 'warn-text' : r.delta > 0 ? 'up' : ''}`}>${r.stalled ? 'Stalled' : r.deltaText || 'New'}</span>
        </span>
        ${Icon.chev()}</button>`)}
    </div>`;
}

function Sparkline({ values, w = 72, h = 24 }) {
  if (!values || values.length < 2) return html`<span style=${`width:${w}px;display:inline-block`}></span>`;
  const lo = Math.min(...values); const hi = Math.max(...values);
  const sy = (v) => (hi === lo ? h / 2 : 3 + (1 - (v - lo) / (hi - lo)) * (h - 6));
  const sx = (i) => 2 + (i / (values.length - 1)) * (w - 4);
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${sx(i).toFixed(1)},${sy(v).toFixed(1)}`).join(' ');
  const last = values.length - 1;
  return html`<svg class="spark" width=${w} height=${h} viewBox=${`0 0 ${w} ${h}`} aria-hidden="true">
    <path d=${d} /><circle cx=${sx(last)} cy=${sy(values[last])} r="2.5" /></svg>`;
}

function SessionsTab({ data, nav, today }) {
  const sessions = E.sortedSessions(data).filter(E.sessionHasContent).reverse();
  let month = null;
  return html`
    ${sessions.length > 0 && html`<${ConsistencyStrip} data=${data} today=${today} />`}
    <div>
      ${sessions.map((s) => {
        const n = s.entries.filter((e) => e.sets.length).length;
        const m = monthLabel(s.date);
        const head = m !== month ? html`<div class="group-label">${m}</div>` : null;
        month = m;
        const [y, mo, d] = s.date.split('-').map(Number);
        const wd = new Date(y, mo - 1, d).toLocaleDateString(undefined, { weekday: 'short' });
        return html`${head}<button class="li" style=${head ? 'border-top:1px solid var(--line)' : ''} onClick=${() => nav.go({ tab: 'history', view: 'session', id: s.id })}>
          <span class="date-cell"><span class="d">${d}</span><span class="w">${wd}</span></span>
          <span class="li-main"><div class="li-title">${s.workoutName || 'Unplanned session'}</div>
          <div class="li-sub">${n} exercise${n === 1 ? '' : 's'}${s.deload ? html`, <span class="tag-deload">deload</span>` : ''}${s.finishedAt ? '' : html`, <span class="warn-text">not finished</span>`}</div></span>
          ${Icon.chev()}</button>`;
      })}
      ${sessions.length === 0 && html`<p class="empty">Finished workouts appear here.</p>`}
    </div>`;
}

/** Last 12 weeks, newest on top: one box per workout in the rotation. */
function ConsistencyStrip({ data, today }) {
  const c = I.weeklyConsistency(data, today, 12);
  if (!c.workouts.length) return null;
  const total = c.weeks.reduce((a, w) => a + w.sessions, 0);
  const first = c.weeks.reduce((i, w, k) => (w.sessions ? k : i), -1); // oldest week with anything
  const span = first + 1;
  const avg = span ? Math.round((total / span) * 10) / 10 : 0;
  const short = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }); };
  return html`<section class="sec" style="margin-top:16px">
    <div class="sec-head"><h2>Weekly</h2><span class="meta num">${total} workouts, ${E.fmtNum(avg)} a week</span></div>
    <div class="weeks" role="table" aria-label="Workouts per week, last 12 weeks">
      <div class="wk wk-head" role="row"><span class="wk-label"></span>
        ${c.workouts.map((w) => html`<span class=${`wk-cell head ${w.optional ? 'opt' : ''}`} title=${w.name}>${w.code}</span>`)}<span class="wk-extra"></span></div>
      ${c.weeks.map((w, i) => html`<div class="wk" role="row">
        <span class="wk-label">${i === 0 ? 'This week' : short(w.start)}</span>
        ${c.workouts.map((wo) => {
          const st = w.slots[wo.id];
          return html`<span class=${`wk-cell ${st || ''} ${wo.optional ? 'opt' : ''}`} role="cell"
            aria-label=${`${wo.name}: ${st === 'done' ? 'done' : st === 'deload' ? 'deload' : 'not done'}`}></span>`;
        })}
        <span class="wk-extra meta num">${w.unplanned ? `+${w.unplanned}` : ''}</span>
      </div>`)}
    </div>
    <div class="legend meta"><span><i class="wk-cell done"></i> Done</span><span><i class="wk-cell deload"></i> Deload</span>
      ${c.workouts.some((w) => w.optional) && html`<span><i class="wk-cell opt"></i> Optional</span>`}<span>+1 unplanned</span></div>
  </section>`;
}

/** Sets per muscle: bar = this week, tick = average of the previous 4 weeks. */
function MusclesTab({ data, today }) {
  const m = I.setsPerMuscle(data, today);
  if (!m.anyMuscles && !m.rows.length) {
    return html`<p class="empty">Add muscles to your exercises (Program → exercise → Muscles) to see sets per muscle.</p>`;
  }
  const rows = [...m.rows].sort((a, b) => (b.average - a.average) || (b.thisWeek - a.thisWeek) || a.muscle.localeCompare(b.muscle));
  const max = Math.max(1, ...rows.map((r) => Math.max(r.thisWeek, r.average)));
  return html`<section class="sec" style="margin-top:16px">
    <div class="sec-head"><h2>Sets per muscle</h2><span class="meta">this week</span></div>
    <p class="sec-note">Each set counts for every muscle listed on its exercise. The mark shows your average over the previous 4 weeks.</p>
    <div class="mbars">
      ${rows.map((r) => html`<div class="mbar" aria-label=${`${r.muscle}: ${r.thisWeek} sets this week, ${r.average} on average`}>
        <span class="mbar-name">${r.muscle}</span>
        <span class="mbar-track">
          <span class="mbar-fill" style=${`width:${(r.thisWeek / max) * 100}%`}></span>
          ${r.average > 0 && html`<span class="mbar-avg" style=${`left:${(r.average / max) * 100}%`}></span>`}
        </span>
        <span class="mbar-val num">${r.thisWeek}<span class="muted"> / ${E.fmtNum(r.average)}</span></span>
      </div>`)}
    </div>
    <div class="legend meta"><span><i class="lg-bar"></i> This week</span><span><i class="lg-tick"></i> 4-week average</span></div>
  </section>`;
}

function ExerciseHistory({ data, nav, id }) {
  const [info, setInfo] = useState(false);
  const ex = exById(data, id);
  if (!ex) return html`<${TopBar} title="Exercise" nav=${nav} back /><p class="empty">This exercise no longer exists.</p>`;
  const pr = E.personalRecord(data, id);
  const series = E.chartSeries(data, id);
  const ladder = I.ladderSeries(data, id);
  const rows = E.sortedSessions(data).filter((s) => E.setsFor(s, id).length).reverse();
  return html`
    <${TopBar} title=${ex.name} nav=${nav} back />
    ${(ex.images?.length || ex.muscles?.length) ? html`<div class="ex-intro">
      <${Thumb} ex=${ex} size=${56} onClick=${() => setInfo(true)} />
      <div><div class="meta">Muscles</div><div>${ex.muscles?.length ? ex.muscles.join(', ') : 'Not set'}</div></div>
    </div>` : null}
    ${info && html`<${ExerciseInfo} ex=${ex} onClose=${() => setInfo(false)} />`}
    <div class="stats">
      ${pr && html`<div class="stat"><div class="k">${pr.kind}</div><div class="v">${pr.label}</div><div class="s">${fmtDate(pr.date)}</div></div>`}
      <div class="stat"><div class="k">Sessions</div><div class="v">${rows.length}</div><div class="s">${rows.length ? `since ${fmtDate(rows[rows.length - 1].date)}` : ''}</div></div>
    </div>
    ${ladder && ladder.points.length > 1 ? html`<section class="sec">
      <div class="sec-head"><h2>Progress</h2><span class="meta">${ladder.unit === 's' ? 'shortest hold' : 'weakest set'} per session</span></div>
      <${LadderChart} series=${ladder} />
    </section>` : series.points.length > 1 && html`<section class="sec">
      <div class="sec-head"><h2>${series.title}</h2><span class="meta">per session</span></div>
      <${LineChart} points=${series.points} unit=${series.unit} bands=${ex.type === 'band' ? data.bands : null} />
    </section>`}
    <section class="sec">
      <div class="sec-head"><h2>Log</h2></div>
      <table class="log"><tbody>
        ${rows.map((s) => html`<tr onClick=${() => nav.go({ tab: 'history', view: 'session', id: s.id })}>
          <td class="date">${fmtDate(s.date)}</td>
          <td class="sets">${E.summarizeSets(ex, E.setsFor(s, id))}${s.deload ? html` <span class="tag-deload">deload</span>` : ''}</td></tr>`)}
      </tbody></table>
    </section>`;
}

/**
 * Weakest set per session. Shaded columns = sessions with the modifier; dashed rules = load changes.
 * Lines connect sessions on the same stage, so each climb reads as its own segment.
 */
function LadderChart({ series }) {
  const { ex, points, markers, range, unit } = series;
  const [sel, setSel] = useState(points.length - 1);
  const W = 343; const H = 188; const L = 28; const R = 10; const T = 24; const B = 22;
  const n = points.length;
  const vals = points.map((p) => p.value);
  let y0; let y1;
  if (range) { y0 = Math.min(range[0], ...vals) - (unit === 's' ? 5 : 1); y1 = Math.max(range[1], ...vals) + (unit === 's' ? 5 : 1); }
  else { y0 = Math.min(...vals) - 5; y1 = Math.max(...vals) + 5; }
  const step = n > 1 ? (W - L - R) / (n - 1) : 0;
  const sx = (i) => (n > 1 ? L + i * step : (L + W - R) / 2);
  const sy = (v) => T + (1 - (v - y0) / (y1 - y0)) * (H - T - B);
  const half = n > 1 ? step / 2 : 12;
  const ticks = range ? [range[0], range[1]] : [Math.round(y0 + 5), Math.round(y1 - 5)];
  // segments: consecutive regular sessions with the same load and modifier
  const segs = []; let cur = [];
  points.forEach((p, i) => {
    if (p.deload) return;
    const prev = cur.length ? points[cur[cur.length - 1]] : null;
    if (prev && (prev.load !== p.load || prev.modifier !== p.modifier)) { segs.push(cur); cur = []; }
    cur.push(i);
  });
  if (cur.length) segs.push(cur);
  const short = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }); };
  const onPointer = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    setSel(Math.max(0, Math.min(n - 1, Math.round(n > 1 ? (px - L) / step : 0))));
  };
  const p = points[sel];
  const mod = ex.modifierName || 'Pause';
  return html`<div>
    <svg class="chart ladder-chart" viewBox=${`0 0 ${W} ${H}`} role="img"
      aria-label=${`${ex.name}: ${unit === 's' ? 'shortest hold' : 'weakest set'} over ${n} sessions`}
      onPointerDown=${onPointer} onPointerMove=${(e) => e.buttons && onPointer(e)}>
      ${points.map((pt, i) => pt.modifier && !pt.deload && html`<rect class="band" x=${sx(i) - half} y=${T} width=${half * 2} height=${H - T - B} />`)}
      ${ticks.map((t) => html`<line class="grid" x1=${L} x2=${W - R} y1=${sy(t)} y2=${sy(t)} />
        <text class="axis" x=${L - 6} y=${sy(t) + 4} text-anchor="end">${t}</text>`)}
      ${markers.map((m) => html`<line class="marker" x1=${sx(m.index) - half} x2=${sx(m.index) - half} y1=${T - 2} y2=${H - B} />
        <text class="marker-label" x=${Math.min(Math.max(sx(m.index) - half, L + 16), W - R - 16)} y=${T - 8} text-anchor="middle">${m.label}</text>`)}
      ${segs.map((sg) => sg.length > 1 && html`<path class="line" d=${sg.map((i, k) => `${k ? 'L' : 'M'}${sx(i).toFixed(1)},${sy(points[i].value).toFixed(1)}`).join(' ')} />`)}
      <line class="cross" x1=${sx(sel)} x2=${sx(sel)} y1=${T} y2=${H - B} />
      ${points.map((pt, i) => html`<circle class=${`pt ${pt.deload ? 'deload' : ''}`} cx=${sx(i)} cy=${sy(pt.value)} r=${sel === i ? 5.5 : 4} />`)}
      <text class="axis" x=${L} y=${H - 4}>${short(points[0].date)}</text>
      <text class="axis" x=${W - R} y=${H - 4} text-anchor="end">${short(points[n - 1].date)}</text>
    </svg>
    <p class="chart-readout"><span class="num">${fmtDate(p.date)}</span>: <span class="num">${E.summarizeSets(ex, p.sets)}</span>${p.deload ? ' (deload)' : ''}</p>
    <div class="legend meta">
      ${ex.ladder === 'modifier' && html`<span><i class="lg-band"></i> ${mod}</span>`}
      ${(ex.type === 'weighted' || ex.type === 'band') && html`<span><i class="lg-marker"></i> ${ex.type === 'band' ? 'Band change' : 'Weight change'}</span>`}
      <span><i class="lg-hollow"></i> Deload</span>
    </div>
  </div>`;
}

function LineChart({ points, unit, bands }) {
  const [sel, setSel] = useState(null);
  const W = 343; const H = 176; const L = 34; const R = 8; const T = 18; const B = 24;
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
    const svgEl = e.currentTarget; const r = svgEl.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    let best = 0; let bd = Infinity;
    xs.forEach((x, i) => { const d = Math.abs(sx(x) - px); if (d < bd) { bd = d; best = i; } });
    setSel(best);
  };
  const p = sel != null ? points[sel] : null;
  return html`<svg class="chart" viewBox=${`0 0 ${W} ${H}`} role="img" aria-label=${`${unit} per session, ${points.length} sessions`}
      onPointerDown=${onPointer} onPointerMove=${(e) => e.buttons && onPointer(e)}>
    ${ticks.map((t) => html`<line class="grid" x1=${L} x2=${W - R} y1=${sy(t)} y2=${sy(t)} />
      <text class="axis" x=${L - 8} y=${sy(t) + 4} text-anchor="end">${fmtY(t)}</text>`)}
    <text class="axis" x=${L} y=${H - 4}>${short(points[0].date)}</text>
    <text class="axis" x=${W - R} y=${H - 4} text-anchor="end">${short(points[points.length - 1].date)}</text>
    <path class="line" d=${path} />
    ${p && html`<line class="cross" x1=${sx(xs[sel])} x2=${sx(xs[sel])} y1=${T} y2=${H - B} />`}
    ${points.map((pt, i) => html`<circle class=${`pt ${pt.deload ? 'deload' : ''}`} cx=${sx(xs[i])} cy=${sy(pt.value)} r=${sel === i ? 5.5 : 4} />`)}
    ${p && html`<text class="sel" x=${Math.min(Math.max(sx(xs[sel]), L + 50), W - R - 50)} y=${T - 6} text-anchor="middle">
      ${short(p.date)}: ${bands ? bands[p.value] : `${p.value} ${unit}`}${p.deload ? ' (deload)' : ''}</text>`}
  </svg>`;
}

// ---------- Program ----------
function move(arr, i, dir) {
  const j = i + dir;
  if (j < 0 || j >= arr.length) return;
  [arr[i], arr[j]] = [arr[j], arr[i]];
}

function EditToggle({ editing, onToggle }) {
  return html`<button class="link sm" onClick=${onToggle}>${editing ? 'Done' : 'Edit'}</button>`;
}

function ReorderButtons({ i, n, onMove, onRemove }) {
  return html`
    <button class="iconbtn" disabled=${i === 0} aria-label="Move up" onClick=${() => onMove(i, -1)}>${Icon.up()}</button>
    <button class="iconbtn" disabled=${i === n - 1} aria-label="Move down" onClick=${() => onMove(i, 1)}>${Icon.dn()}</button>
    ${onRemove && html`<button class="iconbtn danger" aria-label="Remove" onClick=${() => onRemove(i)}>${Icon.x()}</button>`}`;
}

function EditableList({ items, placeholder, onChange, editing }) {
  const [text, setText] = useState('');
  const add = () => { const t = text.trim(); if (!t || items.includes(t)) return; onChange([...items, t]); setText(''); };
  return html`<div>
    <div class="list">
      ${items.map((it, i) => html`<div class="li" style="min-height:48px">
        <span class="li-main">${it}</span>
        ${editing && html`<${ReorderButtons} i=${i} n=${items.length}
          onMove=${(k, dir) => { const a = [...items]; move(a, k, dir); onChange(a); }}
          onRemove=${(k) => onChange(items.filter((_, x) => x !== k))} />`}
      </div>`)}
    </div>
    <div class="add-row"><input type="text" placeholder=${placeholder} aria-label=${placeholder} value=${text} onInput=${(e) => setText(e.target.value)}
      onKeyDown=${(e) => e.key === 'Enter' && add()} /><button class="btn" disabled=${!text.trim()} onClick=${add}>Add</button></div>
  </div>`;
}

function ProgramScreen({ data, update, nav }) {
  const [editing, setEditing] = useState(null);
  const toggle = (k) => setEditing(editing === k ? null : k);
  const addWorkout = () => {
    const id = St.uid();
    const name = `Workout ${LETTERS[data.workouts.length] || data.workouts.length + 1}`;
    update((d) => { d.workouts.push({ id, name, items: [] }); });
    nav.go({ tab: 'program', view: 'workout', id });
  };
  const bandsInUse = new Set();
  data.sessions.forEach((s) => s.entries.forEach((e) => e.sets.forEach((x) => x.band && bandsInUse.add(x.band))));
  return html`
    <${TopBar} title="Program" nav=${nav} large />

    <section class="sec">
      <div class="sec-head"><h2>Rotation</h2>${data.workouts.length > 1 && html`<${EditToggle} editing=${editing === 'rotation'} onToggle=${() => toggle('rotation')} />`}</div>
      <p class="sec-note">Workouts run in this order, whichever day you train.</p>
      <div class="list">
        ${data.workouts.map((w, i) => {
          const n = w.items.filter((it) => exById(data, it.exerciseId)).length;
          const body = html`<span class="li-lead num" style="font-size:18px;font-weight:600">${i + 1}</span>
            <span class="li-main"><div class="li-title">${w.name}</div><div class="li-sub">${n} exercise${n === 1 ? '' : 's'}${w.optional ? ', optional' : ''}</div></span>`;
          return editing === 'rotation'
            ? html`<div class="li">${body}<${ReorderButtons} i=${i} n=${data.workouts.length} onMove=${(k, dir) => update((d) => move(d.workouts, k, dir))} /></div>`
            : html`<button class="li" onClick=${() => nav.go({ tab: 'program', view: 'workout', id: w.id })}>${body}${Icon.chev()}</button>`;
        })}
        <button class="li li-add" onClick=${addWorkout}>${Icon.plus()} Add workout</button>
      </div>
    </section>

    <section class="sec">
      <div class="sec-head"><h2>Exercises</h2><span class="meta num">${data.exercises.length}</span></div>
      <div class="list">
        ${[...data.exercises].sort((a, b) => a.name.localeCompare(b.name)).map((ex) => html`
          <button class="li" onClick=${() => nav.go({ tab: 'program', view: 'exercise', id: ex.id })}>
            <${Thumb} ex=${ex} size=${44} />
            <span class="li-main"><div class="li-title">${ex.name}</div><div class="li-sub">${exerciseSummary(ex)}</div></span>${Icon.chev()}</button>`)}
        <button class="li li-add" onClick=${() => nav.go({ tab: 'program', view: 'exercise', id: 'new' })}>${Icon.plus()} New exercise</button>
      </div>
    </section>

    <section class="sec">
      <div class="sec-head"><h2>Warm-up</h2>${data.warmup.length > 0 && html`<${EditToggle} editing=${editing === 'warmup'} onToggle=${() => toggle('warmup')} />`}</div>
      <p class="sec-note">A checklist at the start of every workout.</p>
      <${EditableList} items=${data.warmup} editing=${editing === 'warmup'} placeholder="Add warm-up item" onChange=${(a) => update((d) => { d.warmup = a; })} />
    </section>

    <section class="sec">
      <div class="sec-head"><h2>Bands</h2>${data.bands.length > 0 && html`<${EditToggle} editing=${editing === 'bands'} onToggle=${() => toggle('bands')} />`}</div>
      <p class="sec-note">Lightest first. When a band exercise tops out, the next band in this list comes next.${bandsInUse.size ? ' Past sessions keep the band name they were logged with.' : ''}</p>
      <${EditableList} items=${data.bands} editing=${editing === 'bands'} placeholder="Add band" onChange=${(a) => update((d) => { d.bands = a; })} />
    </section>
  `;
}

function exerciseSummary(ex) {
  const t = E.TYPE_LABELS[ex.type];
  if (ex.type === 'cardio') return `${t}, +${ex.durationStep ?? 3} min${ex.durationCeiling ? ` up to ${ex.durationCeiling}` : ''}`;
  const side = ex.perSide ? ', per side' : '';
  if (ex.type === 'hold') {
    const r = ex.holdRange ? `, ${ex.holdRange[0]}–${ex.holdRange[1]} s` : '';
    return `${t}${r}, +${ex.holdStep ?? 5} s${ex.holdCeiling ? ` up to ${ex.holdCeiling}` : ''}${side}`;
  }
  const step = ex.type === 'weighted' ? `, +${ex.weightStep ?? 2} kg` : '';
  return `${t}, ${ex.repRange[0]}–${ex.repRange[1]} reps${ex.ladder === 'modifier' ? ', with modifier' : ''}${step}${side}`;
}

function WorkoutEditor({ data, update, nav, id }) {
  const w = data.workouts.find((x) => x.id === id);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(false);
  if (!w) return html`<${TopBar} title="Workout" nav=${nav} back /><p class="empty">This workout no longer exists.</p>`;
  const mutW = (fn) => update((d) => { const x = d.workouts.find((y) => y.id === id); if (x) fn(x, d); });
  const del = () => {
    if (!confirm(`Delete ${w.name}? Past sessions are kept.`)) return;
    update((d) => { d.workouts = d.workouts.filter((x) => x.id !== id); });
    nav.back();
  };
  return html`
    <${TopBar} title=${w.name} nav=${nav} back />
    <label class="field" style="padding-top:16px"><span class="lbl">Name</span>
      <input type="text" value=${w.name} onChange=${(e) => e.target.value.trim() && mutW((x) => { x.name = e.target.value.trim(); })} /></label>
    <div class="field inline"><span class="lbl">Optional<small>Offered only in the same week as the workout before it. When a new week starts, it’s skipped.</small></span>
      <${Switch} label="Optional" on=${!!w.optional} onChange=${(v) => mutW((x) => { x.optional = v; })} /></div>
    <section class="sec">
      <div class="sec-head"><h2>Exercises</h2>${w.items.length > 0 && html`<${EditToggle} editing=${editing} onToggle=${() => setEditing(!editing)} />`}</div>
      <p class="sec-note">In the order you do them. Link an exercise to the next one to alternate their sets.</p>
      <div class="list">
        ${w.items.map((it, i) => {
          const ex = exById(data, it.exerciseId);
          const linkedAbove = i > 0 && w.items[i - 1].supersetWithNext;
          return html`<div class="li" style=${it.supersetWithNext && i < w.items.length - 1 ? 'border-bottom-color:transparent' : ''}>
            <span class="li-main"><div class="li-title">${ex ? ex.name : 'Deleted exercise'}</div>
              ${i < w.items.length - 1 && !editing && html`<button class=${`sup-toggle ${it.supersetWithNext ? 'on' : ''}`} aria-pressed=${!!it.supersetWithNext}
                onClick=${() => mutW((x) => { x.items[i].supersetWithNext = !x.items[i].supersetWithNext; })}>${Icon.link()} ${it.supersetWithNext ? 'Superset with next' : 'Link to next'}</button>`}
              ${editing && linkedAbove && html`<div class="li-sub">Superset with previous</div>`}</span>
            ${editing
              ? html`<${ReorderButtons} i=${i} n=${w.items.length} onMove=${(k, dir) => mutW((x) => move(x.items, k, dir))}
                  onRemove=${(k) => mutW((x) => { x.items.splice(k, 1); if (k > 0 && k >= x.items.length) x.items[k - 1].supersetWithNext = false; })} />`
              : html`<div class="li-aside row" style="gap:10px"><span class="meta">Sets</span><div class="stepper compact">
                  <button aria-label="Fewer sets" onClick=${() => mutW((x) => { x.items[i].sets = Math.max(1, (x.items[i].sets || 1) - 1); })}>−</button>
                  <span class="val">${it.sets}</span>
                  <button aria-label="More sets" onClick=${() => mutW((x) => { x.items[i].sets = (x.items[i].sets || 0) + 1; })}>+</button></div></div>`}
          </div>`;
        })}
        <button class="li li-add" onClick=${() => setAdding(true)}>${Icon.plus()} Add exercise</button>
      </div>
    </section>
    <div class="danger-zone"><button class="link danger" onClick=${del}>Delete workout</button></div>
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
  const [musclesText, setMusclesText] = useState(() => ((orig && orig.muscles) || []).join(', '));
  const [picking, setPicking] = useState(false);
  if (!isNew && !orig) return html`<${TopBar} title="Exercise" nav=${nav} back /><p class="empty">This exercise no longer exists.</p>`;
  const hasHistory = !isNew && data.sessions.some((s) => E.setsFor(s, id).length);
  const set = (k, v) => setF({ ...f, [k]: v });
  const strength = ['weighted', 'band', 'bodyweight'].includes(f.type);

  const saveEx = () => {
    const name = (f.name || '').trim();
    if (!name) return setErr('Enter a name for this exercise.');
    if (data.exercises.some((e) => e.id !== f.id && e.name.toLowerCase() === name.toLowerCase())) return setErr('Another exercise already has this name. Choose a different one.');
    const clean = { ...f, name };
    clean.muscles = musclesText.split(',').map((m) => m.trim()).filter(Boolean);
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
    if (hasHistory) { alert('This exercise has logged sets, so it can’t be deleted. You can rename it or remove it from your workouts.'); return; }
    if (!confirm(`Delete ${orig.name}?`)) return;
    update((d) => {
      d.exercises = d.exercises.filter((e) => e.id !== id);
      d.workouts.forEach((w) => { w.items = w.items.filter((it) => it.exerciseId !== id); });
    });
    nav.back();
  };
  const numField = (label, key, hint, mode = 'decimal') => html`<label class="field"><span class="lbl">${label}</span>
    <input type="number" inputmode=${mode} step="any" value=${f[key] ?? ''} onInput=${(e) => set(key, e.target.value)} />
    ${hint && html`<span class="hint">${hint}</span>`}</label>`;

  return html`
    <${TopBar} title=${isNew ? 'New exercise' : orig.name} nav=${nav} back />
    <div style="padding-top:4px">
      <label class="field"><span class="lbl">Name</span><input type="text" value=${f.name} onInput=${(e) => set('name', e.target.value)} /></label>
      <label class="field"><span class="lbl">Muscles</span><input type="text" placeholder="For example Quads, Glutes" value=${musclesText} onInput=${(e) => setMusclesText(e.target.value)} />
        <span class="hint">Separate with commas.</span></label>
      <div class="field"><span class="lbl">Picture</span>
        <div class="row" style="gap:16px">
          <${Thumb} ex=${f} size=${64} />
          <div class="row wrap" style="gap:4px 20px">
            <button class="link sm" onClick=${() => setPicking(true)}>${f.images && f.images.length ? 'Change picture' : 'Choose from library'}</button>
            ${f.images && f.images.length > 0 && html`<button class="link sm quiet" onClick=${() => setF({ ...f, images: [], imageSource: null })}>Remove</button>`}
          </div>
        </div>
        ${f.imageSource && html`<span class="hint">Shows a similar exercise: ${f.imageSource}.</span>`}
      </div>
      <label class="field"><span class="lbl">Type</span>
        <select value=${f.type} disabled=${hasHistory} onChange=${(e) => set('type', e.target.value)}>
          ${E.TYPES.map((t) => html`<option value=${t}>${E.TYPE_LABELS[t]}</option>`)}
        </select>
        ${hasHistory && html`<span class="hint">Locked because this exercise has logged sets.</span>`}</label>
      ${strength && html`
        <div class="field"><span class="lbl">Rep range</span><div class="seg">
          ${[[8, 12], [12, 16]].map((r) => html`<button class=${f.repRange[0] === r[0] ? 'on' : ''} onClick=${() => set('repRange', r)}>${r[0]}–${r[1]}</button>`)}
        </div></div>
        <div class="field"><span class="lbl">At the top of the range</span><div class="seg">
          <button class=${f.ladder === 'simple' ? 'on' : ''} onClick=${() => set('ladder', 'simple')}>Add load</button>
          <button class=${f.ladder === 'modifier' ? 'on' : ''} onClick=${() => set('ladder', 'modifier')}>Modifier, then load</button>
        </div>
        <span class="hint">${f.type === 'band' ? 'Load means the next band in your band list.' : f.type === 'bodyweight' ? 'Bodyweight has no load step, so reps keep climbing after the ladder.' : 'Reps reset to the bottom of the range at each step.'}</span></div>
        ${f.ladder === 'modifier' && html`<label class="field"><span class="lbl">Modifier</span>
          <input type="text" value=${f.modifierName} onInput=${(e) => set('modifierName', e.target.value)} />
          <span class="hint">For example “2 s pause at bottom” or “3 s lowering”.</span></label>`}
        ${f.type === 'weighted' && numField('Weight step, kg', 'weightStep')}
      `}
      ${f.type === 'hold' && html`
        <div class="field"><span class="lbl">Range in seconds (optional)</span><div class="row">
          <input type="number" inputmode="numeric" placeholder="From" aria-label="Range from" value=${f.holdRange ? f.holdRange[0] : ''}
            onInput=${(e) => set('holdRange', e.target.value === '' ? null : [num(e.target.value), f.holdRange ? f.holdRange[1] : num(e.target.value)])} />
          <span class="muted">to</span>
          <input type="number" inputmode="numeric" placeholder="To" aria-label="Range to" value=${f.holdRange ? f.holdRange[1] : ''}
            onInput=${(e) => set('holdRange', e.target.value === '' ? null : [f.holdRange ? f.holdRange[0] : num(e.target.value), num(e.target.value)])} />
        </div></div>
        ${f.holdRange && html`<div class="field"><span class="lbl">At the top of the range</span><div class="seg">
          <button class=${f.ladder !== 'modifier' ? 'on' : ''} onClick=${() => set('ladder', 'simple')}>Keep adding time</button>
          <button class=${f.ladder === 'modifier' ? 'on' : ''} onClick=${() => set('ladder', 'modifier')}>Modifier, then time</button>
        </div></div>`}
        ${f.holdRange && f.ladder === 'modifier' && html`<label class="field"><span class="lbl">Modifier</span>
          <input type="text" value=${f.modifierName} onInput=${(e) => set('modifierName', e.target.value)} /></label>`}
        ${numField('Step, seconds', 'holdStep', null, 'numeric')}
        ${numField('Ceiling, seconds (optional)', 'holdCeiling', 'The target stops growing here.', 'numeric')}`}
      ${f.type === 'cardio' && html`
        ${numField('First session, minutes (optional)', 'startMinutes', 'Used only until you log this exercise once.')}
        ${numField('Step, minutes', 'durationStep')}
        ${numField('Ceiling, minutes (optional)', 'durationCeiling', 'After this, the target is to cover more distance in the same time.')}`}
      ${f.type !== 'cardio' && html`<div class="field inline"><span class="lbl">Per side<small>Log the weaker side’s reps</small></span>
        <${Switch} label="Per side" on=${!!f.perSide} onChange=${(v) => set('perSide', v)} /></div>`}
    </div>
    ${err && html`<p class="error" role="alert">${err}</p>`}
    <button class="btn primary block" style="margin-top:20px" onClick=${saveEx}>${isNew ? 'Create exercise' : 'Save changes'}</button>
    ${!isNew && html`<div class="danger-zone"><button class="link danger" onClick=${del}>Delete exercise</button></div>`}
    ${picking && html`<${LibraryPicker} query=${f.name} onClose=${() => setPicking(false)} onPick=${(pick) => {
      setF({ ...f, images: pick.images, imageSource: pick.name.toLowerCase() === (f.name || '').trim().toLowerCase() ? null : pick.name });
      if (!musclesText.trim()) setMusclesText(pick.muscles.join(', '));
      setPicking(false);
    }} />`}
  `;
}

/** Search Free Exercise DB (online) and copy the chosen exercise's photos into your data. */
function LibraryPicker({ query, onPick, onClose }) {
  const [lib, setLib] = useState(null);
  const [q, setQ] = useState(query || '');
  const [state, setState] = useState({ loading: true, error: null, busy: null });
  useEffect(() => {
    St.loadLibrary().then((l) => { setLib(l); setState({ loading: false, error: null, busy: null }); })
      .catch(() => setState({ loading: false, error: 'Couldn’t load the exercise library. Check your connection and try again.', busy: null }));
  }, []);
  const words = q.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
  const results = !lib ? [] : lib
    .map((e) => ({ e, score: words.filter((w) => e.name.toLowerCase().includes(w)).length }))
    .filter((x) => (words.length ? x.score > 0 : true))
    .sort((a, b) => b.score - a.score || a.e.name.localeCompare(b.e.name))
    .slice(0, 40).map((x) => x.e);
  const choose = async (e) => {
    setState({ ...state, busy: e.id, error: null });
    try {
      const images = await Promise.all(e.images.slice(0, 2).map((p) => St.fetchImageAsDataUrl(St.libImageUrl(p))));
      onPick({ name: e.name, images, muscles: e.primaryMuscles.concat(e.secondaryMuscles).slice(0, 3).map(St.muscleLabel) });
    } catch { setState({ ...state, busy: null, error: 'Couldn’t download that picture. Try again.' }); }
  };
  return html`<div class="sheet-backdrop" onClick=${(e) => e.target === e.currentTarget && onClose()}>
    <div class="sheet" role="dialog" aria-label="Choose a picture">
      <div class="grab"></div>
      <div class="sheet-head"><h2>Choose a picture</h2><button class="link sm" onClick=${onClose}>Close</button></div>
      <input type="text" placeholder="Search 800+ exercises" aria-label="Search exercise library" value=${q} onInput=${(e) => setQ(e.target.value)} />
      ${state.loading && html`<p class="empty">Loading the exercise library…</p>`}
      ${state.error && html`<p class="error" role="alert">${state.error}</p>`}
      <div class="list" style="margin-top:8px">
        ${results.map((e) => html`<button class="li" disabled=${!!state.busy} onClick=${() => choose(e)}>
          <span class="thumb" style="width:44px;height:44px"><img src=${St.libImageUrl(e.images[0])} alt="" loading="lazy" width="44" height="44" /></span>
          <span class="li-main"><div class="li-title">${e.name}</div><div class="li-sub">${e.primaryMuscles.map(St.muscleLabel).join(', ')}, ${e.equipment || 'body only'}</div></span>
          ${state.busy === e.id && html`<span class="meta">Adding…</span>`}</button>`)}
      </div>
      ${lib && results.length === 0 && html`<p class="empty">No exercise matches “${q}”. Try a shorter search.</p>`}
      <p class="meta" style="margin-top:12px">From Free Exercise DB, public domain. The photos are saved with your data.</p>
    </div>
  </div>`;
}

// ---------- Data ----------
function DataScreen({ data, update, replaceAll, nav }) {
  const [persisted, setPersisted] = useState(null);
  const [msg, setMsg] = useState(null);
  const fileRef = useRef(null);
  useEffect(() => { St.isPersisted().then(setPersisted); }, []);
  const markExported = () => update((d) => { d.settings.lastExport = nowIso(); });
  const doExport = () => { St.downloadExport(data); markExported(); setMsg({ text: 'Backup saved to your downloads.' }); };
  const doShare = async () => {
    try { await St.shareExport(data); markExported(); setMsg({ text: 'Backup shared.' }); } catch (e) { if (e.name !== 'AbortError') setMsg({ text: `Couldn’t share the backup: ${e.message}`, error: true }); }
  };
  const doImport = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const res = await St.readImportFile(file);
      if (res.kind === 'details') {
        if (!confirm(`Add muscles and pictures from this file to your matching exercises? Your history and settings stay as they are.`)) return;
        const n = St.mergeExerciseDetails(structuredClone(data), res.exercises);
        update((d) => { St.mergeExerciseDetails(d, res.exercises); });
        setMsg({ text: n ? `Added muscles and pictures to ${n} exercise${n === 1 ? '' : 's'}.` : 'No exercises in this file match yours.' });
        return;
      }
      const d = res.data;
      const n = d.sessions.length;
      if (!confirm(`Replace ALL current data with this file (${d.exercises.length} exercises, ${n} sessions)?`)) return;
      replaceAll(d);
      setMsg({ text: 'Backup imported.' });
    } catch (err) { setMsg({ text: `Import failed: ${err.message}. Choose a backup file exported from Ladder.`, error: true }); }
  };
  const last = data.settings.lastExport;
  return html`
    <${TopBar} title="Data" nav=${nav} large />
    <section class="sec">
      <div class="sec-head"><h2>Backup</h2><span class="meta">${last ? `Last exported ${fmtDate(last.slice(0, 10))}` : 'Never exported'}</span></div>
      <p class="sec-note">Your data is stored only on this phone. Export a JSON file to keep a copy or move to a new phone.</p>
      <button class="btn primary block" style="margin-top:12px" onClick=${doExport}>Export backup</button>
      <div class="alt-actions">
        ${St.canShareFile() && html`<button class="link" onClick=${doShare}>Share backup</button>`}
        <button class="link" onClick=${() => fileRef.current.click()}>Import backup</button>
      </div>
      <input ref=${fileRef} type="file" accept="application/json,.json" style="display:none" onChange=${doImport} />
      ${msg && html`<p class=${msg.error ? 'error' : 'sec-note'} role="status" style="margin-top:4px">${msg.text}</p>`}
    </section>
    <section class="sec">
      <div class="sec-head"><h2>Settings</h2></div>
      <div class="form">
        <div class="field"><span class="lbl">Appearance</span><div class="seg">
          ${[['light', 'Light'], ['dark', 'Dark'], ['system', 'Match phone']].map(([k, l]) => html`
            <button class=${(data.settings.theme || 'light') === k ? 'on' : ''} onClick=${() => update((d) => { d.settings.theme = k; })}>${l}</button>`)}
        </div></div>
        <div class="field"><span class="lbl">Week starts on</span><div class="seg">
          ${[[0, 'Sunday'], [1, 'Monday']].map(([k, l]) => html`
            <button class=${((data.settings.weekStartsOn || 0) === k) ? 'on' : ''} onClick=${() => update((d) => { d.settings.weekStartsOn = k; })}>${l}</button>`)}
        </div><span class="hint">Used to drop optional workouts when a new week begins.</span></div>
        <label class="field inline"><span class="lbl">Backup reminder<small>Days without a backup before Today reminds you</small></span>
          <input type="number" inputmode="numeric" style="width:72px;text-align:center" value=${data.settings.backupReminderDays}
            onChange=${(e) => update((d) => { d.settings.backupReminderDays = Math.max(1, num(e.target.value) || 7); })} /></label>
        <div class="field inline"><span class="lbl">Storage<small>${persisted == null ? 'Checking…' : persisted ? 'Protected from automatic clean-up' : 'Not protected yet. Install Ladder to your home screen.'}</small></span></div>
      </div>
    </section>
    <p class="footer-meta">Ladder ${APP_VERSION}, ${data.exercises.length} exercises, ${data.sessions.length} sessions</p>
  `;
}

render(html`<${App} />`, document.getElementById('app'));

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('SW registration failed', e));
}
