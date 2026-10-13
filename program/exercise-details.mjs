// Muscles (from the plan's "Targets") and pictures (Free Exercise DB, public domain).
// `pictureOf` names the library exercise shown when it is a close match rather than the exact one.
export const DETAILS = {
  bss: { muscles: ['Quads', 'Glutes'], source: 'Split Squat with Dumbbells' },
  dpu: { muscles: ['Chest', 'Triceps'], source: 'Pushups', pictureOf: 'Push-Up' },
  dbrow: { muscles: ['Lats', 'Upper Back'], source: 'One-Arm Dumbbell Row' },
  slrdl: { muscles: ['Hamstrings', 'Glutes'], source: 'Stiff-Legged Dumbbell Deadlift', pictureOf: 'Stiff-Legged Dumbbell Deadlift' },
  facepull: { muscles: ['Rear Delts', 'Upper Back'], source: 'Face Pull', pictureOf: 'Cable Face Pull' },
  pallof: { muscles: ['Core', 'Obliques'], source: 'Pallof Press' },
  pullup: { muscles: ['Lats', 'Upper Back'], source: 'Pullups' },
  stepup: { muscles: ['Quads', 'Glutes'], source: 'Dumbbell Step Ups' },
  hkpress: { muscles: ['Shoulders', 'Triceps'], source: 'Dumbbell One-Arm Shoulder Press', pictureOf: 'Standing One-Arm Press' },
  latraise: { muscles: ['Side Delts'], source: 'One-Arm Side Laterals' },
  rdraise: { muscles: ['Rear Delts', 'Upper Back'], source: 'Lying Rear Delt Raise' },
  sideplank: { muscles: ['Obliques'], source: 'Side Bridge' },
  floorpress: { muscles: ['Chest', 'Triceps', 'Core'], source: 'Dumbbell Floor Press', pictureOf: 'Two-Arm Dumbbell Floor Press' },
  slhip: { muscles: ['Glutes'], source: 'Single Leg Glute Bridge', pictureOf: 'Single-Leg Glute Bridge' },
  invrow: { muscles: ['Upper Back', 'Lats'], source: 'Inverted Row' },
  revlunge: { muscles: ['Quads', 'Glutes'], source: 'Dumbbell Rear Lunge' },
  curl: { muscles: ['Biceps'], source: 'Dumbbell Bicep Curl' },
  ohext: { muscles: ['Triceps'], source: 'Dumbbell One-Arm Triceps Extension' },
  ytraise: { muscles: ['Lower Traps', 'Upper Back'] },
  kneeraise: { muscles: ['Abs'], source: 'Hanging Leg Raise', pictureOf: 'Hanging Leg Raise' },
};

export function detailsFor(id) {
  const d = DETAILS[id];
  if (!d) return {};
  const out = { muscles: d.muscles };
  if (d.source) {
    out.images = [`media/exercises/${id}-0.jpg`, `media/exercises/${id}-1.jpg`];
    out.imageSource = d.pictureOf || null;
  }
  return out;
}
