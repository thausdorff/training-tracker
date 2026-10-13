// Local storage of the single JSON document + import/export.
import { emptyData, validateData } from './engine.js';

const KEY = 'training-tracker:data';
const BACKUP_KEY = 'training-tracker:previous';

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function todayStr(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyData();
    return validateData(JSON.parse(raw));
  } catch (e) {
    console.error('Could not load data', e);
    // Keep the unreadable copy aside instead of overwriting it.
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) localStorage.setItem(`${KEY}:unreadable:${Date.now()}`, raw);
    } catch { /* ignore */ }
    return emptyData();
  }
}

let lastSaved = null;
export function save(data) {
  const json = JSON.stringify(data);
  if (json === lastSaved) return;
  const prev = localStorage.getItem(KEY);
  localStorage.setItem(KEY, json);
  if (prev && prev !== json) {
    try { localStorage.setItem(BACKUP_KEY, prev); } catch { /* quota: fine */ }
  }
  lastSaved = json;
}

export async function requestPersistence() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      if (await navigator.storage.persisted()) return true;
      return await navigator.storage.persist();
    }
  } catch { /* ignore */ }
  return false;
}

export async function isPersisted() {
  try { return !!(navigator.storage && (await navigator.storage.persisted())); } catch { return false; }
}

export function exportFileName() {
  return `training-${todayStr()}.json`;
}

export function exportBlob(data) {
  return new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
}

export function downloadExport(data) {
  const url = URL.createObjectURL(exportBlob(data));
  const a = document.createElement('a');
  a.href = url;
  a.download = exportFileName();
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function canShareFile() {
  try {
    const f = new File(['{}'], 'x.json', { type: 'application/json' });
    return !!(navigator.canShare && navigator.canShare({ files: [f] }));
  } catch { return false; }
}

export async function shareExport(data) {
  const file = new File([exportBlob(data)], exportFileName(), { type: 'application/json' });
  await navigator.share({ files: [file], title: 'Training backup' });
}

export async function readImportFile(file) {
  const text = await file.text();
  const json = JSON.parse(text);
  if (json && json.kind === 'ladder-exercise-details') {
    if (!Array.isArray(json.exercises)) throw new Error('No exercises in this details file');
    return { kind: 'details', exercises: json.exercises };
  }
  return { kind: 'full', data: validateData(json) };
}

/** Merge muscles and pictures into existing exercises (matched by id, then name). History is untouched. */
export function mergeExerciseDetails(data, items) {
  let n = 0;
  for (const it of items) {
    const ex = data.exercises.find((e) => e.id === it.id)
      || data.exercises.find((e) => e.name.toLowerCase() === String(it.name || '').toLowerCase());
    if (!ex) continue;
    if (Array.isArray(it.muscles)) ex.muscles = it.muscles;
    if (Array.isArray(it.images)) { ex.images = it.images; ex.imageSource = it.imageSource || null; }
    n += 1;
  }
  return n;
}

// ---------- exercise picture library (Free Exercise DB, public domain) ----------
const LIB = 'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main';
let libCache = null;
export async function loadLibrary() {
  if (!libCache) {
    libCache = fetch(`${LIB}/dist/exercises.json`).then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    }).catch((e) => { libCache = null; throw e; });
  }
  return libCache;
}
export const libImageUrl = (path) => `${LIB}/exercises/${path.split('/').map(encodeURIComponent).join('/')}`;

const MUSCLE_NAMES = { quadriceps: 'Quads', 'middle back': 'Upper Back', 'lower back': 'Lower Back', abdominals: 'Abs', lats: 'Lats', traps: 'Traps' };
export const muscleLabel = (m) => MUSCLE_NAMES[m] || m.replace(/\b\w/g, (c) => c.toUpperCase());

/** Download a library image and shrink it to a small JPEG data URL so it lives with your data. */
export async function fetchImageAsDataUrl(url, width = 360) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const bmp = await createImageBitmap(await r.blob());
  const scale = Math.min(1, width / bmp.width);
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.72);
}
