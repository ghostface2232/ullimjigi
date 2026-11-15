// Procedural characters: sculpted skinned meshes, real bone rigs and
// procedural animation (locomotion with planted feet, IK, layered states,
// secondary motion on cloth/hair/tails, painted expressive faces).
//
// ---------------------------------------------------------------------------
// RIG CONTRACT (all factories)
//   rig.root                Object3D the caller adds to the scene and moves/rotates
//   rig.update(dt, state)   state: speed, grounded, vy, cast, aimPitch, glide, swim, talk,
//                           sit, wave, kneel, spread, lookYaw, charge, squash, dive, down,
//                           stagger, shock, panic, dead, guard, bash, broken, aim, draw,
//                           emerge, grip, strike, headYaw, headPitch, headK, stomp, twist,
//                           climb, climbPhase, climbMove, mantle
//   rig.mats / glowMats     per-instance toon materials (hit flash, dissolve) / tier glow
//   rig.hurt()              hit flinch
//   Casting (people with a staff; no-ops elsewhere):
//     rig.windup(kind, dur, el)   anticipation of 'heavy' | 'weave' | 'ult': the pose reaches its
//                                 contact after dur seconds and holds there until flick()
//     rig.flick(kind, el)         the release frame ('bolt' | 'charged' | 'heavy' | 'weave' | 'ult');
//                                 the head of the staff (p.tip) is in front of the body at this frame
//     state.charge 0..1           the charged shot being drawn; rig.gust(dirWorld, strength) pushes
//                                 cape and skirt (blast recoil)
//   rig.lookYaw/lookPitch   head look (radians, relative to the body)
//   rig.p.{hips, torso, head, legL/R, shinL/R, armL/R, foreL/R, handL/R, staff, gem, tip}
//     p.torso is a carry anchor that follows the chest, oriented like the root at rest and
//     offset so y = 1.62 is shoulder height for any build (the cat rides at (0.22, 1.62, -0.05):
//     the left shoulder, since a character's left is +X). p.head is centered in the head.
//   Enemy extras: p.swordEdge (knight), armor[] (brute rocks), eyeTip (watcher), p.foreR.
//
// MODULES: charkit.js (sculpt/skin/IK/verlet toolkit), humanoid.js + humanrig.js (people),
//   creatures.js (fox, cat, CreatureRig), enemybodies.js / enemycreatures.js (enemies).
//   Geometry is built once per type and shared; bones, materials and springs are per instance.
//   People: `skin` (painted face, charkit faceMat) + `main` (everything else, vertex coloured,
//   charkit clothMat: the per-vertex `surf` kind picks cloth weave / leather / metal / hair
//   highlight ring / gem). Outlines are a tinted hull pushed back along the view ray, so lines
//   appear across depth gaps only. Garments and proportions come from the CHAR entry
//   (humanrig.js: collar, cuff, tunicTrim, sash, suspenders, bootH, shorts, ...).
//   Secondary motion and foot IK run only near the camera (rig.lod).
//   People made by makeHumanoid (`rig.person`) move with the second-generation motion in
//   humanrig.js: three gaits from a speed table (walk, run with flight, sprint), feet planted in
//   the world with a heel-to-toe roll, idle weight shifts and fidgets, action poses (jump arc,
//   blink, glide hanging from the staff, collapse on `dead`), staff casting clips solved with arm
//   IK, and a sprung face. Rigs constructed directly (the humanoid enemies) keep the first
//   motion set, which their pose hooks were written against. Per-build manner of moving:
//   personStyle() (age, kid, bodyW, fem), overridden by the `style` option.
//   Modelled people (public/models/ch_<key>.glb, built in Blender from a base mesh by
//   ref/blender/c2_*.py): `skin` (softly lit, charkit skinMat), `eye` (eyeballs on the bones
//   eyeL / eyeR, charkit eyeMat) and `main`. Each of skin and main has its own atlas of baked
//   maps (albedo, normal map read in the uv-derivative frame so no tangents are stored; main
//   also ORM), handed to skinMat / clothMat as `tex`; the vertex colours only tint the outline.
//   Hair strips are never turned in the atlas: v runs along the strands (the highlight's
//   direction). The model adds bones to the skeleton:
//   fingers (f1a..f4c, tha..thc: driven from the pose channels fingL/R and thumbL/R), eyes, and
//   verlet chains named c_<kind><n>_<k> (cape, skirt). Expressions drive shape keys (blinkH, blink,
//   wide, lidLow, happy, lidTilt, cheek, mOpen, smileL, smileR, frown, round, wideM, pout, sneer,
//   browUpL, browUpR, browDown, browTilt, browAngry, browFurrow). Without the file the code-built
//   body below is used.
//
// EXPRESSIONS & GESTURES (humanoids; safe no-ops on other rigs)
//   rig.setExpression(name, holdSec?)   blend (~0.25 s) to a facial expression and keep it
//       (or return to the previous one after holdSec). Names: 'neutral', 'smile', 'sad',
//       'surprised', 'angry', 'worried', 'tender', 'laugh', 'hurt', 'sleepy', 'determined';
//       on the modelled people also 'grin', 'smirk', 'pout', 'excited', 'scared', 'thinking',
//       'shy', 'disgust' (unknown names fall back to neutral). There the channels are sprung
//       (lids lead, brows, mouth, cheeks follow), part of the last expression lingers for a
//       couple of seconds, blinks come with changes of gaze and expression, and the cheeks flush.
//   rig.gesture(name, opts?)            one-shot body gesture layered over any state:
//       'nod', 'shake', 'bow', 'point', 'laugh', 'sigh', 'shrug', 'handToChest', 'wave',
//       'think', 'beckon', 'lookAround', 'crossArms' (crossArms holds until cleared by
//       gesture(null)). opts: { speed, amp }. Returns duration in seconds.
//   rig.lookAt(worldPos | null)         eyes + head track a world point (dialogue partner, camera);
//       null returns to state.lookYaw / rig.lookYaw.
//   rig.expression / rig.gestureName    current values
//   While `talk` is true and the dialogue box is typing, the mouth shapes the syllable being
//   typed (Hangul vowels: open / round / wide, lips meeting on m, b, p) and small beat gestures
//   play automatically. A gesture that wants a hand that is holding something (staff, cane,
//   spear in the right; a book in the left) is mirrored to the free hand. Idle people fidget
//   now and then ('fid*' gestures); these give way to any other gesture, talk or movement.
// ---------------------------------------------------------------------------
export { CHAR, Rig, HumanRig, makeHumanoid, makeGhost } from './humanrig.js';
export { makeFox, makeCat } from './creatures.js';
export { makeAshling, makeBrute, makeKnight, makeShieldBearer, makeArcher } from './enemybodies.js';
export { makeWailer, makeOoze, makeMoth, makeRootHand, makeWatcher } from './enemycreatures.js';
