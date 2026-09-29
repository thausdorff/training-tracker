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
  return validateData(JSON.parse(text));
}
