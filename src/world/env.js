// Environment dispatcher (G.env): the single place where magic meets the world.
// Spells report impacts with G.env.onSpell({ el, pos, r, kind, source }) and the
// world systems (wildfire, weather, water) answer according to simple rules:
//   fire  → dry grass catches (not in heavy rain)
//   storm → a strike can start a grass fire; in water it spreads (handled by combat)
//   water / frost → fires go out, leaving steam
//   wind  → fires nearby leap downwind
// It also answers movement queries such as updraft lift for gliders.
import { G } from '../core/context.js';

const IGNITE_R = { bolt: 1.2, heavy: 3.2, weave: 4, ult: 7, field: 2.2 };
// How far a fire started by each kind of magic may travel (see Wildfire vigor):
// a basic shot or a lingering patch singes the spot it hits, big magic sets a real blaze.
const VIGOR = { bolt: 0.4, field: 0.4, heavy: 0.7, weave: 0.8, ult: 1 };

export class Env {
  constructor(world) {
    this.W = world;
  }

  onSpell({ el, pos, r = 2, kind = 'bolt', source = 'player' } = {}) {
    const fire = this.W.fire;
    if (!pos || !fire) return;
    // only ground-level impacts touch the grass
    const gy = this.W.h(pos.x, pos.z);
    if (pos.y - gy > 3.5) return;
    switch (el) {
      case 'fire':
        fire.ignite(pos.x, pos.z, Math.min(r, IGNITE_R[kind] ?? 2), VIGOR[kind] ?? 0.5);
        break;
      case 'storm':
        if (kind !== 'bolt' || Math.random() < 0.25) fire.ignite(pos.x, pos.z, Math.min(r, 1.5), Math.min(0.6, VIGOR[kind] ?? 0.5));
        break;
      case 'water':
      case 'frost':
        fire.extinguish(pos.x, pos.z, r + 1.5);
        break;
      case 'wind': {
        const P = G.player;
        const dx = pos.x - P.pos.x, dz = pos.z - P.pos.z, l = Math.hypot(dx, dz) || 1;
        fire.fan(pos.x, pos.z, dx / l, dz / l, r + 3);
        break;
      }
    }
    void source;
  }

  // Upward wind at a point (0..1 strength) from fires and other heat sources.
  liftAt(x, y, z) {
    return this.W.fire ? this.W.fire.liftAt(x, y, z) : 0;
  }
}
