// Pose offsets in the humanoid rig's local axes. Blade angles are measured
// from the knight's low guard and consumed by his world-space wrist aim.
import { sstep } from './charkit.js';

function layer(q, pose, weight) {
  if (weight <= 0) return;
  for (const joint in pose) q[joint] += pose[joint] * weight;
}

const quarryLift = {
  hipsPY: -.095, hipsPZ: -.09, hipsy: -.12, spinex: -.31, chestx: -.24,
  armRx: -2.71, armLx: -2.50, armRz: -.32, armLz: .23, foreRx: -.78, foreLx: -.63,
  fingR: .86, fingL: .65, headx: .28,
};
const quarryImpact = {
  hipsPY: -.20, hipsPZ: .17, spinex: .54, chestx: .25, headx: -.59,
  armRx: -1.09, armLx: -1.04, armRy: -.13, armLy: .12, fingR: .93, fingL: .82,
};
const quarryFollow = { hipsPY: -.07, chestx: .22, headx: .21, foreRx: .16, foreLx: .12 };
const gatherIce = { hipsPY: -.18, spinex: .28, headx: .25, armLx: -1.07, armRx: -1.07,
  foreLx: -.85, foreRx: -.85, armLy: .55, armRy: -.55, fingL: .82, fingR: .82 };
const scatterIce = { hipsPY: -.07, chestx: -.35, headx: -.22, armLz: 1.38, armRz: -1.38,
  armLx: -.52, armRx: -.52, handLz: .31, handRz: -.31, fingR: -.6, fingL: -.6 };
const shoulder = { hipsPY: -.13, hipsPZ: .07, chesty: .40, spinex: .58, headx: -.41,
  armRx: -.67, foreRx: -.91, armLx: .52, armLz: .27, fingL: .72, fingR: .96 };

const drawCut = { hipsPY: -.09, hipsy: -.26, chesty: -.52, heady: .36, armRx: -1.8,
  armRz: -.46, foreRx: -.78, armLx: -.62, armLz: .26, bladeYaw: .61, bladePitch: 1.83 };
const sweepCut = { hipsPY: -.16, hipsPZ: .11, hipsy: .34, chesty: .78, heady: -.57,
  spinex: .33, armRx: -1.2, armRy: .71, foreRx: .13, armLx: .49, armLz: .51,
  bladeYaw: 2.54, bladePitch: .61 };
const drawBackhand = { hipsPY: -.09, hipsy: .29, chesty: .68, heady: -.47, armRx: -1.18,
  armRy: .91, foreRx: -.64, armLx: .26, bladeYaw: 3.85, bladePitch: .82 };
const backhand = { hipsPY: -.12, hipsPZ: .10, hipsy: -.25, chesty: -.62, heady: .42,
  armRx: -1.37, armRz: -.52, armLx: -.43, armLz: .38, bladeYaw: 1.94, bladePitch: .75 };
const liftSword = { hipsPY: -.09, spinex: -.17, chestx: -.19, armRx: -2.73, foreRx: -.62,
  armLx: -1.74, foreLx: -.79, headx: .16, bladeYaw: 2.3, bladePitch: 2.65 };
const cleave = { hipsPY: -.085, hipsPZ: .10, spinex: .24, chestx: -.09, headx: -.23,
  armRx: -1.08, foreRx: .24, armLx: -.97, foreLx: -.18, bladeYaw: 2.43, bladePitch: -.14 };
const setLunge = { hipsPY: -.17, hipsPZ: -.13, chesty: -.73, heady: .52, foreRx: -.99,
  armRx: -.35, armLx: -.93, bladeYaw: 2.29, bladePitch: .58 };
const thrust = { hipsPY: -.15, hipsPZ: .14, spinex: .42, chesty: .34, headx: -.28,
  armRx: -1.64, foreRx: .2, armLx: .63, bladeYaw: 2.25, bladePitch: .55 };
const callBolts = { armLx: -2.58, foreLx: -.26, handLz: .26, fingL: -.42,
  chesty: -.32, headx: -.29, armRx: -.56, bladeYaw: .68, bladePitch: 1.80 };
const groundBolts = { armLx: -1.23, foreLx: .12, fingL: 1.03, spinex: .27, hipsPY: -.13,
  armRx: -.42, bladeYaw: .95, bladePitch: 1.03 };

// A sustained readable silhouette, then accelerate into contact over the
// last fraction of the real warning. Recovery begins at the very same pose.
function attack(q, s, wind, impact, tail, release, recovery) {
  if (s.action === 'recover' || s.action === 'slash' || s.action === 'dash' || s.action === 'charge') {
    const fade = 1 - sstep(.07, recovery, s.actionTime);
    layer(q, impact, fade);
    if (tail) layer(q, tail, fade * sstep(0, .09, s.actionTime));
  } else {
    const p = s.windProgress;
    const swing = sstep(release, 1, p);
    layer(q, wind, sstep(0, .47, p) * (1 - swing));
    layer(q, impact, swing);
  }
}

function buckle(q, s, knight) {
  const end = s.deathProgress;
  const weight = end !== undefined ? sstep(0, .73, end)
    : sstep(0, .33, s.actionTime) * sstep(0, .63, s.breakLeft);
  const fold = weight * weight;
  q.hipsPY -= (knight ? .07 : .12) * weight;
  q.hipsPZ += .12 * fold;
  q.spinex += (knight ? .32 : .62) * weight;
  q.chestx += .26 * fold; q.headx += .33 * fold;
  q.chestz += (knight ? -.16 : .23) * weight;
  q.armLx -= .78 * weight; q.foreLx += .42 * fold;
  q.armRx -= (knight ? .58 : .9) * weight;
  if (knight) { q.bladeYaw += 1.64 * weight; q.bladePitch += .33 * weight; }
  if (end !== undefined) {
    const slack = sstep(.52, 1, end);
    q.headz += .41 * slack; q.chestz += .24 * slack;
    q.armLz += .34 * slack; q.fingR -= .59 * slack; q.fingL -= .38 * slack;
  }
}

export function wardenMotion(q, s, r) {
  const step = Math.cos(r.phase * Math.PI * 2) * r.w.gait;
  q.spinez += .10 * step; q.headz -= .09 * step;
  q.armLx -= .17; q.armRx -= .21; q.foreLx -= .20; q.foreRx -= .17;
  q.spinex += .15; q.headx -= .18;
  q.clavRz -= .065 * Math.sin(r.t * 1.39); q.heady += .044 * Math.sin(r.t * .76);
  if (s.breakLeft > 0 || s.deathProgress !== undefined) return buckle(q, s, false);
  const move = s.action === 'recover' ? s.fromAction : s.action;
  if (move === 'slamWind') attack(q, s, quarryLift, quarryImpact, quarryFollow, .79, .99);
  if (move === 'novaWind') attack(q, s, gatherIce, scatterIce, null, .86, .9);
  if (move === 'chargeWind' || move === 'charge') {
    const w = s.action === 'chargeWind' ? sstep(0, .65, s.windProgress)
      : s.action === 'recover' ? 1 - sstep(0, .62, s.actionTime) : 1;
    layer(q, shoulder, w);
  }
  q.headz += .18 * r.w.hurt; q.chesty -= .22 * r.w.hurt;
}

export function knightMotion(q, s, r) {
  q.bladeYaw = 0; q.bladePitch = 0; q.lunge = 0; q.twoHands = 0; q.groundStrike = 0;
  const guard = 1 - r.w.kneel;
  q.armRx -= .23 * guard; q.foreRx -= .39 * guard;
  q.chesty += .23 * guard; q.heady -= .17 * guard;
  q.fingR = 1.3; q.thumbR = 1.1; q.armLz += .10;
  q.handLx += Math.sin(r.t * 1.8) * .056; q.chestz -= .20 * r.w.hurt;
  if (s.breakLeft > 0 || s.deathProgress !== undefined) return buckle(q, s, true);
  if (s.action === 'recover' && s.fromAction === 'slash') {
    const fade = 1 - sstep(.22, .39, .22 + s.actionTime);
    layer(q, cleave, .27 * fade);
    q.twoHands = .17 * fade;
    return;
  }
  const move = s.action === 'recover' ? s.fromAction : s.action;
  if (move === 'slashWind' || move === 'slash') {
    const finisher = s.cut >= (s.phase >= 3 ? 3 : 2);
    const reverse = s.cut % 2 === 1;
    const wind = finisher ? liftSword : reverse ? drawBackhand : drawCut;
    const contact = finisher ? cleave : reverse ? backhand : sweepCut;
    if (finisher) {
      q.lunge = s.action === 'slash' ? 1 - sstep(.09, .25, s.actionTime) : sstep(.58, 1, s.windProgress);
      q.twoHands = s.action === 'slash' ? 1 - sstep(.13, .27, s.actionTime) : sstep(.12, .5, s.windProgress);
      q.groundStrike = s.action === 'slash' ? 1 - sstep(.065, .20, s.actionTime) : sstep(.81, 1, s.windProgress);
    }
    attack(q, s, wind, contact, null, finisher ? .77 : .72, finisher ? .32 : .22);
  } else if (move === 'dashWind' || move === 'dash') {
    if (s.action === 'dash') layer(q, thrust, 1);
    else attack(q, s, setLunge, thrust, null, .84, .42);
  } else if (move === 'waveWind' || move === 'boltsWind') {
    const wave = move === 'waveWind';
    attack(q, s, wave ? liftSword : callBolts, wave ? cleave : groundBolts, null, .83, .44);
  }
}
