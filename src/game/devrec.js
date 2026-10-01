// Dev-only input/state recorder (`?dev=…&rec`): logs raw input events, player state every
// frame and who called the movement/cast functions, and keeps the last ~2 minutes in
// localStorage (`ullimjigi_rec`) so a reload doesn't lose it. Read back with `__rec.dump()`.
import { G } from '../core/context.js';

const KEY = 'ullimjigi_rec';

export function startRecorder() {
  const P = G.player;
  const t0 = Date.now();
  // keep the previous page's recording (a reload starts a new one)
  try { const prev = localStorage.getItem(KEY); if (prev) localStorage.setItem(KEY + '_prev', prev); } catch (_) { /* ignore */ }
  const R = (window.__rec = { session: t0, frames: [], events: [], calls: [] });
  const now = () => Date.now() - t0;
  const ev = (e) => R.events.push([now(), e.type, e.code || 'btn' + e.button, (e.shiftKey ? 'S' : '') + (e.ctrlKey ? 'C' : '') + (e.altKey ? 'A' : '') + (e.metaKey ? 'M' : ''), document.pointerLockElement ? 'L' : '-']);
  for (const t of ['keydown', 'keyup', 'mousedown', 'mouseup', 'contextmenu', 'blur', 'focus']) window.addEventListener(t, ev, true);
  document.addEventListener('pointerlockchange', () => R.events.push([now(), 'lock', document.pointerLockElement ? 'on' : 'off']));
  const wrap = (obj, name, label) => {
    const f = obj[name];
    obj[name] = function (...a) {
      const st = (new Error().stack || '').split('\n').slice(2, 5).map((s) => s.trim().replace(/^at /, '').replace(/https?:\/\/[^/]+\/src\//, '').replace(/\?t=\d+/, '')).join(' < ');
      R.calls.push([now(), label, st]);
      return f.apply(this, a);
    };
  };
  for (const n of ['tryBlink', 'castBolt', 'castHeavy', 'beginCharge', 'castCharged', 'castWeave', 'castUlt', 'teleport', 'startMantle', 'tryGrab', 'letGo']) if (typeof P[n] === 'function') wrap(P, n, n);
  if (G.cameraRig.kick) wrap(G.cameraRig, 'kick', 'camKick');
  setInterval(() => {
    const I = G.input;
    R.frames.push([now(), +P.pos.x.toFixed(2), +P.pos.y.toFixed(2), +P.pos.z.toFixed(2), +P.vel.x.toFixed(2), +P.vel.z.toFixed(2), +P.yaw.toFixed(2), +G.cameraRig.yaw.toFixed(2),
      +P.blinkT.toFixed(2), +P.castHold.toFixed(2), P.grounded ? 1 : 0, P.climbing ? 1 : 0, P.gliding ? 1 : 0, [...I.keys].join('+'), [...I.mouse.buttons].join('+'), G.mode, G.game.menu || '']);
    if (R.frames.length > 5000) R.frames.splice(0, 600);
    if (R.events.length > 4000) R.events.splice(0, 1000);
    if (R.calls.length > 3000) R.calls.splice(0, 1000);
  }, 16);
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ session: R.session, frames: R.frames.slice(-4000), events: R.events.slice(-3000), calls: R.calls.slice(-2000) })); } catch (_) { /* full */ } };
  setInterval(save, 4000);
  window.addEventListener('beforeunload', save);
  R.dump = (prev) => { try { return JSON.parse(localStorage.getItem(prev ? KEY + '_prev' : KEY)); } catch (_) { return null; } };
  R.FRAME = 'ms,x,y,z,vx,vz,yaw,camYaw,blinkT,castHold,grounded,climbing,gliding,keys,mouse,mode,menu';
}
