// Builds program/3-day-home-plan.json (import via Data → Import JSON).
import fs from 'node:fs';
import { validateData, emptyData } from '../src/engine.js';

const W = (id, name, range, mod, extra = {}) => ({ id, name, type: 'weighted', repRange: range, ladder: 'modifier', modifierName: mod, weightStep: 2, ...extra });
const BW = (id, name, range, mod, extra = {}) => ({ id, name, type: 'bodyweight', repRange: range, ladder: 'modifier', modifierName: mod, ...extra });
const BAND = (id, name, range, mod, extra = {}) => ({ id, name, type: 'band', repRange: range, ladder: 'modifier', modifierName: mod, ...extra });
const side = { perSide: true };
const L = [8, 12]; const H = [12, 16];

const exercises = [
  // Day A
  W('bss', 'Bulgarian split squat', L, '2 s pause at bottom', side),
  BW('dpu', 'Deficit push-up', L, '2 s pause above floor'),
  W('dbrow', 'One-arm dumbbell row', L, '2 s pause at top', side),
  W('slrdl', 'Single-leg RDL', L, '2 s pause at deepest point', side),
  BAND('facepull', 'Band face pull', H, '2 s pause at contraction'),
  BAND('pallof', 'Pallof press', H, '2 s hold at press-out', side),
  { id: 'cardio-easy', name: 'Easy cardio', type: 'cardio', startMinutes: 20, durationStep: 3, durationCeiling: 40 },
  // Day B
  W('pullup', 'Pull-up', L, '2 s pause at top', { weightStep: 2 }),
  W('stepup', 'Step-up', L, '2 s pause at bottom', side),
  W('hkpress', 'Half-kneeling one-arm press', L, '2 s pause at shoulder', side),
  W('latraise', 'Leaning lateral raise', H, '3 s lowering', side),
  W('rdraise', 'Chest-supported rear-delt raise', H, '2 s pause at top'),
  { id: 'sideplank', name: 'Side plank', type: 'hold', holdRange: [30, 45], ladder: 'modifier', modifierName: 'Top leg raised', holdStep: 5, holdCeiling: null, perSide: true },
  { id: 'cardio-b', name: 'Cardio B', type: 'cardio', startMinutes: 30, durationStep: 3, durationCeiling: 40 },
  // Day C
  W('floorpress', 'One-arm dumbbell floor press', L, '2 s pause at bottom', side),
  W('slhip', 'Single-leg hip thrust', L, '2 s pause at top', side),
  BW('invrow', 'Inverted row', L, '2 s pause at top'),
  W('revlunge', 'Deficit reverse lunge', L, '2 s pause near bottom', side),
  W('curl', 'Curl', H, '3 s lowering'),
  W('ohext', 'Overhead triceps extension', H, '3 s lowering'),
  W('ytraise', 'Prone Y-T raise', H, '2 s hold at top'),
  BW('kneeraise', 'Hanging knee raise', H, '3 s lowering'),
];

const it = (exerciseId, supersetWithNext = false) => ({ exerciseId, sets: exerciseId.startsWith('cardio') ? 1 : 3, supersetWithNext });
const workouts = [
  { id: 'A', name: 'A · Legs & chest', items: [it('bss'), it('dpu'), it('dbrow'), it('slrdl'), it('facepull'), it('pallof'), it('cardio-easy')] },
  { id: 'B', name: 'B · Back & cardio', items: [it('pullup'), it('stepup'), it('hkpress'), it('latraise', true), it('rdraise'), it('sideplank'), it('cardio-b')] },
  { id: 'C', name: 'C · Full body', items: [it('floorpress'), it('slhip'), it('invrow'), it('revlunge'), it('curl', true), it('ohext'), it('ytraise', true), it('kneeraise'), it('cardio-easy')] },
];

const warmup = [
  'Brisk walk / marching · 3 min',
  'Cat-cow ×8',
  'Open-books ×8 per side',
  'Wall slides ×10',
  'Band pull-aparts ×15',
  'Hip flexor stretch · 30 s per side',
  'One light set of the first exercise',
];

const data = validateData({ ...emptyData(), exercises, workouts, warmup, bands: ['Light', 'Medium', 'Heavy'] });
fs.writeFileSync(new URL('./3-day-home-plan.json', import.meta.url), `${JSON.stringify(data, null, 2)}\n`);
console.log(`wrote ${exercises.length} exercises, ${workouts.length} workouts`);
