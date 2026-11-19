// Static collision (circles + oriented boxes) in a spatial hash, plus
// walkable platforms (discs / boxes) layered over the terrain.
function segmentHits(c, x, y, z, dx, dy, dz, radius, lengthSq) {
  const px = x - c.x, pz = z - c.z;
  const box = c.type === 'box';
  let enter = 0, exit = 1;
  for (let axis = 0, axes = box ? 3 : 1; axis < axes; axis++) {
    let p, d, lo, hi;
    if (axis === 0) {
      p = y; d = dy; lo = c.h0 - radius; hi = c.h1 + radius;
    } else if (axis === 1) {
      p = px * c.cos - pz * c.sin; d = dx * c.cos - dz * c.sin; lo = -c.hw - radius; hi = c.hw + radius;
    } else {
      p = px * c.sin + pz * c.cos; d = dx * c.sin + dz * c.cos; lo = -c.hd - radius; hi = c.hd + radius;
    }
    if (Math.abs(d) < 1e-8) {
      if (p < lo || p > hi) return false;
    } else {
      const t0 = (lo - p) / d, t1 = (hi - p) / d;
      enter = Math.max(enter, Math.min(t0, t1)); exit = Math.min(exit, Math.max(t0, t1));
      if (enter > exit) return false;
    }
  }
  if (box) return true;
  const r = c.r + radius, offset = px * px + pz * pz - r * r;
  if (lengthSq < 1e-8) return offset <= 0;
  const b = px * dx + pz * dz, disc = b * b - lengthSq * offset;
  if (disc < 0) return false;
  const root = Math.sqrt(disc);
  return Math.max(enter, (-b - root) / lengthSq) <= Math.min(exit, (-b + root) / lengthSq);
}

export class Colliders {
  constructor(cell = 16) {
    this.cell = cell;
    this.grid = new Map();
    this.stamp = 0;
    this.platforms = [];
  }
  _key(ix, iz) { return ix * 10007 + iz; }
  _insert(c) {
    const r = c.type === 'circle' ? c.r : Math.hypot(c.hw, c.hd);
    const S = this.cell;
    c.cells = [];
    for (let ix = Math.floor((c.x - r) / S); ix <= Math.floor((c.x + r) / S); ix++)
      for (let iz = Math.floor((c.z - r) / S); iz <= Math.floor((c.z + r) / S); iz++) {
        const k = this._key(ix, iz);
        let arr = this.grid.get(k);
        if (!arr) this.grid.set(k, (arr = []));
        arr.push(c); c.cells.push(k);
      }
    return c;
  }
  // Shapes are solid from h0 to h1. Optional fields set after creation:
  //   climb: false  → can't be climbed (trees, seals, towers)
  //   noTop: true   → the top isn't a floor (tall trunks, magic barriers)
  //   topFn(lx, lz) → local top height (e.g. a gable roof); defaults to h1
  addCircle(x, z, r, h0 = -1e9, h1 = 1e9, tag = null) { return this._insert({ type: 'circle', x, z, r, h0, h1, tag, _s: 0 }); }
  addBox(x, z, hw, hd, rot = 0, h0 = -1e9, h1 = 1e9, tag = null) {
    return this._insert({ type: 'box', x, z, hw, hd, rot, cos: Math.cos(rot), sin: Math.sin(rot), h0, h1, tag, _s: 0 });
  }
  // local frame helpers (box): world → local and back
  _local(c, x, z) { const dx = x - c.x, dz = z - c.z; return [dx * c.cos - dz * c.sin, dx * c.sin + dz * c.cos]; }
  _world(c, lx, lz) { return [c.x + lx * c.cos + lz * c.sin, c.z - lx * c.sin + lz * c.cos]; }
  topAt(c, x, z) {
    if (!c.topFn) return c.h1;
    if (c.type === 'circle') return c.topFn(x - c.x, z - c.z);
    const dx = x - c.x, dz = z - c.z;
    return c.topFn(dx * c.cos - dz * c.sin, dx * c.sin + dz * c.cos);
  }
  inside(c, x, z, pad = 0) {
    if (c.type === 'circle') return Math.hypot(x - c.x, z - c.z) < c.r + pad;
    const dx = x - c.x, dz = z - c.z;
    return Math.abs(dx * c.cos - dz * c.sin) < c.hw + pad && Math.abs(dx * c.sin + dz * c.cos) < c.hd + pad;
  }
  // Highest walkable shape top under (x, z) that is at most `step` above y
  surfaceTop(x, z, y, step = 0.7) {
    let best = -1e9;
    const S = this.cell, stamp = ++this.stamp;
    for (let ix = Math.floor((x - 0.5) / S); ix <= Math.floor((x + 0.5) / S); ix++)
      for (let iz = Math.floor((z - 0.5) / S); iz <= Math.floor((z + 0.5) / S); iz++) {
        const cell = this.grid.get(this._key(ix, iz));
        if (!cell) continue;
        for (const c of cell) {
          if (c._s === stamp) continue;
          c._s = stamp;
          if (c.noTop || c.h1 > 1e8 || !this.inside(c, x, z, -0.05)) continue;
          const t = this.topAt(c, x, z);
          if (t <= y + step && t > best) best = t;
        }
      }
    return best;
  }
  // A walking body's feet start to rise as its leading edge meets a low
  // obstacle. Use the same continuous support for route probes and motion.
  strideTop(x, z, y, floor, radius, step) {
    let best = floor;
    this.query(x, z, radius, c => {
      if (c.noTop || c.h1 <= best || c.h0 > y + step) return;
      const dx = x - c.x, dz = z - c.z;
      let gap;
      if (c.type === 'circle') gap = Math.hypot(dx, dz) - c.r;
      else {
        const ox = Math.abs(dx * c.cos - dz * c.sin) - c.hw;
        const oz = Math.abs(dx * c.sin + dz * c.cos) - c.hd;
        gap = Math.hypot(Math.max(0, ox), Math.max(0, oz));
      }
      if (gap >= radius) return;
      const top = this.topAt(c, x, z);
      if (top > Math.max(y, floor) + step) return;
      const t = 1 - Math.max(0, gap) / radius;
      best = Math.max(best, floor + (top - floor) * t * t * (3 - 2 * t));
    });
    return best;
  }
  // Nearest wall around a body at (x, y..y+height, z). By default skip walls without a grip.
  // Returns { c, px, pz, nx, nz, d, top } (contact point, outward normal, gap, top at contact) or null.
  wallNear(x, y, z, reach = 0.9, height = 1.6, includeUnclimbable = false) {
    let best = null;
    this.query(x, z, reach + 1, (c) => {
      if ((!includeUnclimbable && c.climb === false) || y + height < c.h0 || y > c.h1 - 0.1) return;
      // standing on (or above) this shape's sloped top: it's the floor, not a wall
      if (c.topFn && this.inside(c, x, z, 0.1) && y > this.topAt(c, x, z) - 0.35) return;
      let px, pz, nx, nz, d;
      if (c.type === 'circle') {
        const dx = x - c.x, dz = z - c.z, l = Math.hypot(dx, dz) || 1e-4;
        nx = dx / l; nz = dz / l; px = c.x + nx * c.r; pz = c.z + nz * c.r; d = l - c.r;
      } else {
        const [lx, lz] = this._local(c, x, z);
        const cx = Math.max(-c.hw, Math.min(c.hw, lx)), cz = Math.max(-c.hd, Math.min(c.hd, lz));
        let ox = lx - cx, oz = lz - cz, l = Math.hypot(ox, oz);
        if (l < 1e-4) { // inside: push out through the nearest face
          const fx = c.hw - Math.abs(lx), fz = c.hd - Math.abs(lz);
          if (fx < fz) { ox = Math.sign(lx || 1); oz = 0; } else { ox = 0; oz = Math.sign(lz || 1); }
          l = 1; d = -Math.min(fx, fz);
        } else d = l;
        const lnx = ox / l, lnz = oz / l;
        [px, pz] = this._world(c, cx, cz);
        nx = lnx * c.cos + lnz * c.sin; nz = -lnx * c.sin + lnz * c.cos;
      }
      if (d > reach) return;
      if (!best || d < best.d) best = { c, px, pz, nx, nz, d };
    });
    if (best) best.top = best.c.noTop ? best.c.h1 : this.topAt(best.c, best.px - best.nx * 0.3, best.pz - best.nz * 0.3);
    return best;
  }
  remove(c) {
    if (!c || !c.cells) return;
    for (const k of c.cells) { const arr = this.grid.get(k); if (arr) { const i = arr.indexOf(c); if (i >= 0) arr.splice(i, 1); } }
    c.cells = null;
  }
  query(x, z, r, cb) {
    const S = this.cell; const st = ++this.stamp;
    for (let ix = Math.floor((x - r) / S); ix <= Math.floor((x + r) / S); ix++)
      for (let iz = Math.floor((z - r) / S); iz <= Math.floor((z + r) / S); iz++) {
        const arr = this.grid.get(this._key(ix, iz));
        if (!arr) continue;
        for (const c of arr) { if (c._s === st) continue; c._s = st; cb(c); }
      }
  }
  // Push a character (pos.x/pos.z mutated) out of static shapes
  resolve(pos, radius, height = 1.8, step = 0.45) {
    let hit = false;
    this.query(pos.x, pos.z, radius + 1, (c) => {
      if (pos.y > c.h1 - 0.05 || pos.y + height < c.h0) return;
      // within a step of a walkable top (stairs, sloped roofs): let the ground snap lift us instead
      if (!c.noTop && pos.y > (c.topFn ? this.topAt(c, pos.x, pos.z) : c.h1) - step) return;
      if (c.type === 'circle') {
        const dx = pos.x - c.x, dz = pos.z - c.z, rr = c.r + radius;
        const d2 = dx * dx + dz * dz;
        if (d2 < rr * rr) {
          const d = Math.sqrt(d2);
          pos.x = c.x + (d > 0 ? dx / d : 1) * rr;
          pos.z = c.z + (d > 0 ? dz / d : 0) * rr; hit = true;
        }
      } else {
        const dx = pos.x - c.x, dz = pos.z - c.z;
        const lx = dx * c.cos - dz * c.sin, lz = dx * c.sin + dz * c.cos;
        const cx = Math.max(-c.hw, Math.min(c.hw, lx)), cz = Math.max(-c.hd, Math.min(c.hd, lz));
        let ox = lx - cx, oz = lz - cz;
        const d = Math.hypot(ox, oz);
        let nlx, nlz;
        if (d > 0.0001) {
          if (d >= radius) return;
          nlx = cx + (ox / d) * radius; nlz = cz + (oz / d) * radius;
        } else {
          const px = c.hw - Math.abs(lx), pz = c.hd - Math.abs(lz);
          if (px < pz) { nlx = Math.sign(lx || 1) * (c.hw + radius); nlz = lz; }
          else { nlx = lx; nlz = Math.sign(lz || 1) * (c.hd + radius); }
        }
        pos.x = c.x + nlx * c.cos + nlz * c.sin;
        pos.z = c.z - nlx * c.sin + nlz * c.cos;
        hit = true;
      }
    });
    return hit;
  }
  // Does a sphere at (x,y,z) overlap any static shape?
  pointHit(x, y, z, r = 0.2, camera = false) {
    const S = this.cell, pad = r + 1, stamp = ++this.stamp;
    for (let ix = Math.floor((x - pad) / S); ix <= Math.floor((x + pad) / S); ix++)
      for (let iz = Math.floor((z - pad) / S); iz <= Math.floor((z + pad) / S); iz++) {
        const cell = this.grid.get(this._key(ix, iz));
        if (!cell) continue;
        for (const c of cell) {
          if (c._s === stamp) continue;
          c._s = stamp;
          if (y > c.h1 || y < c.h0) continue;
          if (camera && c.type === 'circle' && c.climb === false && c.noTop && c.r <= 0.65) continue;
          if (this.inside(c, x, z, r)) return c;
        }
      }
    return null;
  }

  // Read-only body clearance for navigation. Match resolve's step/top rules without
  // moving a probe or treating a roof above the body as an obstacle.
  navBlocked(x, y, z, radius, height = 1.8, step = 0.45) {
    const S = this.cell, pad = radius + 0.05, stamp = ++this.stamp;
    for (let ix = Math.floor((x - pad) / S); ix <= Math.floor((x + pad) / S); ix++)
      for (let iz = Math.floor((z - pad) / S); iz <= Math.floor((z + pad) / S); iz++) {
        const cell = this.grid.get(this._key(ix, iz));
        if (!cell) continue;
        for (const c of cell) {
          if (c._s === stamp) continue;
          c._s = stamp;
          if (y > c.h1 - 0.05 || y + height < c.h0 || (!c.noTop && y > this.topAt(c, x, z) - step)) continue;
          const dx = x - c.x, dz = z - c.z;
          if (c.type === 'circle') {
            const r = c.r + radius;
            if (dx * dx + dz * dz < r * r) return true;
          } else {
            const lx = dx * c.cos - dz * c.sin, lz = dx * c.sin + dz * c.cos;
            const ox = Math.max(0, Math.abs(lx) - c.hw), oz = Math.max(0, Math.abs(lz) - c.hd);
            if (ox * ox + oz * oz < radius * radius) return true;
          }
        }
      }
    return false;
  }

  // Segment visibility through static cover, including oriented boxes. Callers
  // also test terrain; this is shared by ranged AI and target selection.
  navSight(from, to, radius = 0.1) {
    const { x, y, z } = from, dx = to.x - x, dy = to.y - y, dz = to.z - z;
    const lengthSq = dx * dx + dz * dz, pad = Math.sqrt(lengthSq) * 0.5 + radius;
    const cx = x + dx * 0.5, cz = z + dz * 0.5, S = this.cell, stamp = ++this.stamp;
    for (let ix = Math.floor((cx - pad) / S); ix <= Math.floor((cx + pad) / S); ix++)
      for (let iz = Math.floor((cz - pad) / S); iz <= Math.floor((cz + pad) / S); iz++) {
        const cell = this.grid.get(this._key(ix, iz));
        if (!cell) continue;
        for (const c of cell) {
          if (c._s === stamp) continue;
          c._s = stamp;
          if (segmentHits(c, x, y, z, dx, dy, dz, radius, lengthSq)) return false;
        }
      }
    return true;
  }

  // ---- walkable platforms ----
  addPlatform(p) { this.platforms.push(p); return p; }
  removePlatform(p) { const i = this.platforms.indexOf(p); if (i >= 0) this.platforms.splice(i, 1); }
  platformTop(x, z, y, step = 0.7) {
    let best = -1e9;
    for (const p of this.platforms) {
      if (p.top > y + step) continue;
      let inside = false;
      if (p.type === 'disc') inside = Math.hypot(x - p.x, z - p.z) < p.r;
      else {
        const dx = x - p.x, dz = z - p.z;
        const c = Math.cos(p.rot || 0), s = Math.sin(p.rot || 0);
        const lx = dx * c - dz * s, lz = dx * s + dz * c;
        inside = Math.abs(lx) < p.hw && Math.abs(lz) < p.hd;
      }
      if (inside && p.top > best) best = p.top;
    }
    return best;
  }
}
