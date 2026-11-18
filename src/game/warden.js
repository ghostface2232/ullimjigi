// Frost shrine guardian. The six loose ice plates are authored in brute rest space.
import * as THREE from 'three';
import { G } from '../core/context.js';
import { clamp, damp } from '../core/util.js';
import { extendMat } from './creatures.js';

const amber = new THREE.Color(1, 0.68, 0.36);
const meltwater = new THREE.Color(0.27, 0.63, 0.84);

export class WardenShell {
  constructor(rig, plates) {
    this.doors = [plates.sealL, plates.sealR];
    // Seat the two shutters in front of the rounded cabochon, with a thin central sightline.
    for (const door of this.doors) {
      door.position.z += 0.045;
      door.scale.set(1.18, 1.16, 1.10);
    }
    this.doorRest = this.doors.map((plate) => plate.position.clone());
    this.plates = [plates.gauntletL, plates.mantleR, plates.gauntletR, plates.mantleL];
    this.core = rig.M.glow;
    this.core.map = rig.T.built.tex.map;
    this.ice = rig.M.ice;
    this.growth = 1;
    this.open = 0;
    this.dripTime = 0;
    this.spread = 0;
    this.fan = 0;
    this.core.color.copy(amber);
    // Thin, face-on ice transmits the underlying stone. Only grazing edges catch HDR light.
    this.ice.transparent = true;
    this.ice.depthWrite = false;
    extendMat(this.ice, 'wardenIce', {}, (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `
        float edge = 1.0 - clamp(dot(normalize(vViewPosition), normal), 0.0, 1.0);
        diffuseColor.a = opacity * mix(0.47, 0.92, smoothstep(0.12, 0.9, edge));
        outgoingLight = min(outgoingLight, vec3(0.95, 1.13, 1.25));
        outgoingLight += vec3(0.32, 0.64, 0.80) * smoothstep(0.92, 0.995, edge);
        #include <opaque_fragment>`);
    });
  }

  shed(plate, enemy) {
    // Carry the actual plate and its current pose out into world space.
    plate.updateWorldMatrix(true, false);
    const shard = new THREE.Mesh(plate.geometry, this.ice);
    plate.matrixWorld.decompose(shard.position, shard.quaternion, shard.scale);
    G.scene.add(shard);
    const dir = shard.position.clone().sub(enemy.pos);
    dir.y = 0;
    dir.normalize().multiplyScalar(2.2);
    dir.y = 1.25;
    G.vfx.burst(shard.position, 'steam', 3, { size: 0.40 });
    let life = 0;
    G.vfx.fx.push({ update(dt) {
      life += dt;
      dir.y -= 12 * dt;
      shard.position.addScaledVector(dir, dt);
      shard.rotateX(dt * 2.6);
      shard.rotateZ(dt * 1.7);
      const p = shard.position;
      if (life < 1.25 && enemy.alive && p.y > G.world.ground(p.x, p.z, p.y + 0.35) + 0.09) return true;
      if (enemy.alive) G.vfx.chunks(p, 'ice', 4, { speed: 2.4, size: 0.08 });
      shard.removeFromParent();
      return false;
    } });
  }

  spreadFrost(enemy, dt) {
    // Two outward-growing rows are rooted where the seal opened. They retreat when the fight ends.
    this.origin ??= enemy.pos.clone();
    this.spread += dt;
    while (this.fan < 15 && this.spread >= this.fan * 0.105) {
      const i = this.fan++, outer = i >= 6;
      const angle = (outer ? (i - 6) / 9 + 0.08 : i / 6) * Math.PI * 2;
      const r = (outer ? 3.5 : 1.7) + 0.30 * Math.sin(i * 2.1);
      const p = this.origin.clone();
      p.x += Math.cos(angle) * r; p.z += Math.sin(angle) * r;
      p.y = G.world.ground(p.x, p.z, this.origin.y + 1);
      G.vfx.crystal(p, (outer ? 0.54 : 0.34) + 0.15 * Math.cos(i * 0.9), {
        width: outer ? 0.40 : 0.28, tiltX: Math.sin(angle) * 0.65, tiltZ: -Math.cos(angle) * 0.65,
        quiet: true, life: Infinity, active: () => enemy.alive && enemy.phase === 3,
      });
    }
  }

  update(enemy, dt) {
    const phase = enemy.phase, burning = enemy.st.burn > 0;
    if (burning && !this.wasBurning) this.burnStart = this.growth;
    this.wasBurning = burning;
    this.growth = clamp(this.growth + (burning ? -1.65 : 1 / 6) * dt, 0, 1);
    const coverage = phase === 1 ? 1 : phase === 2 ? 0.87 : 0.65;
    this.open = damp(this.open, phase === 3 ? 1 : phase === 2 ? 0.25 + 0.23 * (1 - this.growth) : 0, 5, dt);
    this.doors.forEach((plate, i) => {
      const side = i ? -1 : 1;
      plate.position.x = this.doorRest[i].x + side * this.open * 0.045;
      plate.position.y = this.doorRest[i].y + this.open * 0.018;
      plate.rotation.y = side * this.open * 1.08;
      plate.rotation.z = -side * this.open * 0.37;
    });
    this.core.color.copy(amber).multiplyScalar(phase === 1 ? 3.1 : phase === 2 ? 4.8 : 6.8);
    this.plates.forEach((plate, i) => {
      const threshold = 0.52 - i * 0.095;
      // New ice starts at the stump. A reheated growing plate can break again.
      if (burning && plate.visible && this.growth <= threshold) {
        this.shed(plate, enemy);
        plate.visible = false;
      }
      if (!burning && this.growth > 0) plate.visible = true;
      const bulk = burning ? 0.58 * this.burnStart + 0.42 * this.growth : this.growth;
      const size = Math.max(0.002, bulk) * coverage;
      plate.scale.set(size, size * (burning ? 0.80 + 0.20 * this.growth : 1), size * (burning ? 0.55 + 0.45 * this.growth : 1));
    });
    if (burning) {
      this.dripTime += dt;
      if (this.dripTime >= 0.11) {
        this.dripTime = 0;
        const p = this.plates[Math.floor(G.time * 9) % 4].getWorldPosition(new THREE.Vector3());
        G.vfx.norm.emit({ p: [p.x, p.y - 0.16, p.z], v: [0, -0.65, 0], life: 0.42, size: 0.068, size1: 0.025,
          color: meltwater, color1: meltwater, alpha: 0.9, alpha1: 0.25, grav: 9, shape: 9 });
      }
    }
    if (phase === 3) this.spreadFrost(enemy, dt);
  }
}
