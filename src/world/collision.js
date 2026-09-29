// Static collision (circles + oriented boxes) in a spatial hash, plus
// walkable platforms (discs / boxes) layered over the terrain.
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
  addCircle(x, z, r, h0 = -1e9, h1 = 1e9, tag = null) { return this._insert({ type: 'circle', x, z, r, h0, h1, tag, _s: 0 }); }
  addBox(x, z, hw, hd, rot = 0, h0 = -1e9, h1 = 1e9, tag = null) {
    return this._insert({ type: 'box', x, z, hw, hd, rot, cos: Math.cos(rot), sin: Math.sin(rot), h0, h1, tag, _s: 0 });
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
  resolve(pos, radius, height = 1.8) {
    let hit = false;
    this.query(pos.x, pos.z, radius + 1, (c) => {
      if (pos.y > c.h1 - 0.05 || pos.y + height < c.h0) return;
      if (c.type === 'circle') {
        const dx = pos.x - c.x, dz = pos.z - c.z, rr = c.r + radius;
        const d2 = dx * dx + dz * dz;
        if (d2 < rr * rr) {
          const d = Math.sqrt(d2) || 0.0001;
          pos.x = c.x + (dx / d) * rr; pos.z = c.z + (dz / d) * rr; hit = true;
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
  pointHit(x, y, z, r = 0.2) {
    let found = null;
    this.query(x, z, r + 1, (c) => {
      if (found || y > c.h1 || y < c.h0) return;
      if (c.type === 'circle') {
        if (Math.hypot(x - c.x, z - c.z) < c.r + r) found = c;
      } else {
        const dx = x - c.x, dz = z - c.z;
        const lx = dx * c.cos - dz * c.sin, lz = dx * c.sin + dz * c.cos;
        if (Math.abs(lx) < c.hw + r && Math.abs(lz) < c.hd + r) found = c;
      }
    });
    return found;
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
