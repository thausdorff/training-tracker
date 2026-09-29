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
  W('bss', 'Bulgarian Split Squat', L, '2 s pause at bottom', side),
  BW('dpu', 'Deficit Push-Up', L, '2 s pause above floor'),
  W('dbrow', 'One-Arm Dumbbell Row', L, '2 s pause at top', side),
  W('slrdl', 'Single-Leg RDL', L, '2 s pause at deepest point', side),
  BAND('facepull', 'Band Face Pull', H, '2 s pause at contraction'),
  BAND('pallof', 'Pallof Press', H, '2 s hold at press-out', side),
  { id: 'cardio-easy', name: 'Easy Cardio', type: 'cardio', startMinutes: 20, durationStep: 3, durationCeiling: 40 },
  // Day B
  W('pullup', 'Pull-Up', L, '2 s pause at top', { weightStep: 2 }),
  W('stepup', 'Step-Up', L, '2 s pause at bottom', side),
  W('hkpress', 'Half-Kneeling One-Arm Press', L, '2 s pause at shoulder', side),
  W('latraise', 'Leaning Lateral Raise', H, '3 s lowering', side),
  W('rdraise', 'Chest-Supported Rear-Delt Raise', H, '2 s pause at top'),
  { id: 'sideplank', name: 'Side Plank', type: 'hold', holdRange: [30, 45], ladder: 'modifier', modifierName: 'Top leg raised', holdStep: 5, holdCeiling: null, perSide: true },
  { id: 'cardio-b', name: 'Cardio B', type: 'cardio', startMinutes: 30, durationStep: 3, durationCeiling: 40 },
  // Day C
  W('floorpress', 'One-Arm Dumbbell Floor Press', L, '2 s pause at bottom', side),
  W('slhip', 'Single-Leg Hip Thrust', L, '2 s pause at top', side),
  BW('invrow', 'Inverted Row', L, '2 s pause at top'),
  W('revlunge', 'Deficit Reverse Lunge', L, '2 s pause near bottom', side),
  W('curl', 'Curl', H, '3 s lowering'),
  W('ohext', 'Overhead Triceps Extension', H, '3 s lowering'),
  W('ytraise', 'Prone Y-T Raise', H, '2 s hold at top'),
  BW('kneeraise', 'Hanging Knee Raise', H, '3 s lowering'),
];

const it = (exerciseId, supersetWithNext = false) => ({ exerciseId, sets: exerciseId.startsWith('cardio') ? 1 : 3, supersetWithNext });
const workouts = [
  { id: 'A', name: 'A · Legs & Chest', items: [it('bss'), it('dpu'), it('dbrow'), it('slrdl'), it('facepull'), it('pallof'), it('cardio-easy')] },
  { id: 'B', name: 'B · Back & Cardio', items: [it('pullup'), it('stepup'), it('hkpress'), it('latraise', true), it('rdraise'), it('sideplank'), it('cardio-b')] },
  { id: 'C', name: 'C · Full Body', items: [it('floorpress'), it('slhip'), it('invrow'), it('revlunge'), it('curl', true), it('ohext'), it('ytraise', true), it('kneeraise'), it('cardio-easy')] },
];

const warmup = [
  'Brisk Walk / Marching · 3 min',
  'Cat-Cow ×8',
  'Open-Books ×8 per side',
  'Wall Slides ×10',
  'Band Pull-Aparts ×15',
  'Hip Flexor Stretch · 30 s per side',
  'One light set of the first exercise',
];

const data = validateData({ ...emptyData(), exercises, workouts, warmup, bands: ['Light', 'Medium', 'Heavy'] });
fs.writeFileSync(new URL('./3-day-home-plan.json', import.meta.url), `${JSON.stringify(data, null, 2)}\n`);
console.log(`wrote ${exercises.length} exercises, ${workouts.length} workouts`);
