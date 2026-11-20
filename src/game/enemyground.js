import { Vector3 } from 'three';
import { regionAt } from '../world/layout.js';

const normal = new Vector3();
const directions = Array.from({ length: 24 }, (_, i) => {
  const a = i * Math.PI * 2 / 24;
  return { x: Math.cos(a), z: Math.sin(a) };
});

export function fightGround(W, x, z, radius, height, minNormal = 0.8) {
  const T = W.terrain, y = T.height(x, z);
  return T.inWorld(x, z) && y >= W.water.level + 0.5
    && T.sampleGrid(T.cw, x, z) === 0 && T.normal(x, z, normal).y >= minNormal
    && !W.col.navBlocked(x, W.ground(x, z), z, radius, height, 0);
}

export function fightRoute(W, x, z, tx, tz, radius, height, minNormal = 0.8) {
  const steps = Math.max(1, Math.ceil(Math.hypot(tx - x, tz - z) / 0.5));
  let y = W.ground(x, z);
  for (let i = 1; i <= steps; i++) {
    const px = x + (tx - x) * i / steps, pz = z + (tz - z) * i / steps;
    const floor = W.ground(px, pz);
    if (Math.abs(floor - y) > 0.45 || !fightGround(W, px, pz, radius, height, minNormal)) return false;
    y = floor;
  }
  return true;
}

// Adjacent clear rays leave room beside the exit as well as along it.
function openSide(W, x, z, radius, height, distance, wide) {
  const open = directions.map(d => fightRoute(W, x, z, x + d.x * distance, z + d.z * distance, radius, height, wide ? 0.8 : 0.64));
  const i = open.findIndex((clear, i) => clear && (!wide || (open[(i + 23) % 24] && open[(i + 1) % 24])));
  return i < 0 ? null : directions[i];
}

export function nearbyGround(x, z, limit, accepts) {
  if (accepts(x, z)) return { x, z };
  for (let ring = 1; ring <= limit * 2; ring++) {
    const distance = ring * 0.5, samples = Math.ceil(distance * Math.PI * 2);
    for (let i = 0; i < samples; i++) {
      const a = i * Math.PI * 2 / samples;
      const px = x + Math.cos(a) * distance, pz = z + Math.sin(a) * distance;
      if (accepts(px, pz)) return { x: px, z: pz };
    }
  }
  return null;
}

export function campMember(c, i, x = c.x, z = c.z) {
  const a = i * Math.PI * 2 / c.units.length + (c.formationAngle ?? 0);
  const r = c.formationRadius ?? 3;
  return { x: x + Math.cos(a) * r, z: z + Math.sin(a) * r };
}

export function resolveCamp(W, c, radius, height) {
  const region = regionAt(c.x, c.z).id;
  let side, formation = c;
  const fitsRing = (c, x, z) => c.units.every((_, i) => {
    const p = campMember(c, i, x, z);
    return fightRoute(W, x, z, p.x, p.z, radius, height);
  });
  const viable = (x, z) => regionAt(x, z).id === region && fightGround(W, x, z, radius, height);
  const accepts = (x, z) => {
    if (!viable(x, z) || !fitsRing(c, x, z)) return false;
    side = openSide(W, x, z, radius, height, 13, true);
    return side !== null;
  };
  const roadDistance = W.terrain.pathInfo(c.x, c.z).d;
  const roadside = roadDistance <= 14 && nearbyGround(c.x, c.z, 25, (x, z) => {
    if (W.terrain.pathInfo(x, z).d > roadDistance + 3) return false;
    if (accepts(x, z)) return true;
    if (c.units.length < 2 || !viable(x, z)) return false;
    // Roads can have parallel walking lanes without room for a wide fan.
    const formationRadius = Math.max(1.7, (radius + 0.15) / Math.sin(Math.PI / c.units.length));
    for (const d of directions) {
      const ring = { units: c.units, formationRadius, formationAngle: Math.atan2(d.z, d.x) };
      if (!fitsRing(ring, x, z) || ![-0.7, 0, 0.7].every(offset => {
        const px = x - d.z * offset, pz = z + d.x * offset;
        return fightGround(W, px, pz, radius, height)
          && fightRoute(W, px, pz, px + d.x * 13, pz + d.z * 13, radius, height);
      })) continue;
      formation = ring;
      side = d;
      return true;
    }
    return false;
  });
  const site = roadside || nearbyGround(c.x, c.z, 64, accepts);
  return site && { ...site, side, formationRadius: formation.formationRadius, formationAngle: formation.formationAngle };
}

export function resolveEncounter(W, x, z, radius, height, available) {
  return nearbyGround(x, z, 18, (px, pz) => available(px, pz)
    && fightGround(W, px, pz, radius, height)
    && openSide(W, px, pz, radius, height, 10, false));
}
