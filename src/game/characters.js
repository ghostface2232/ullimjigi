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
//                           emerge, grip, strike, headYaw, headPitch, headK, stomp, twist
//   rig.mats / glowMats     per-instance toon materials (hit flash, dissolve) / tier glow
//   rig.hurt(), rig.flick(kind)  hit flinch; cast release ('bolt'|'heavy'|'weave'|'ult')
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
//   Secondary motion and foot IK run only near the camera (rig.lod).
//
// EXPRESSIONS & GESTURES (humanoids; safe no-ops on other rigs)
//   rig.setExpression(name, holdSec?)   blend (~0.25 s) to a facial expression and keep it
//       (or return to the previous one after holdSec). Names: 'neutral', 'smile', 'sad',
//       'surprised', 'angry', 'worried', 'tender', 'laugh', 'hurt', 'sleepy', 'determined'.
//   rig.gesture(name, opts?)            one-shot body gesture layered over any state:
//       'nod', 'shake', 'bow', 'point', 'laugh', 'sigh', 'shrug', 'handToChest', 'wave',
//       'think', 'beckon', 'lookAround', 'crossArms' (crossArms holds until cleared by
//       gesture(null)). opts: { speed, amp }. Returns duration in seconds.
//   rig.lookAt(worldPos | null)         eyes + head track a world point (dialogue partner, camera);
//       null returns to state.lookYaw / rig.lookYaw.
//   rig.expression / rig.gestureName    current values
//   While `talk` is true and the dialogue box is typing, the mouth flaps and small beat
//   gestures play automatically.
// ---------------------------------------------------------------------------
export { CHAR, Rig, HumanRig, makeHumanoid, makeGhost } from './humanrig.js';
export { makeFox, makeCat } from './creatures.js';
export { makeAshling, makeBrute, makeKnight, makeShieldBearer, makeArcher } from './enemybodies.js';
export { makeWailer, makeOoze, makeMoth, makeRootHand, makeWatcher } from './enemycreatures.js';
