// Travel mode: the whole interface fades away, enemies ignore the player and nothing can hurt
// them, the story holds still, and the hour of the day is in the player's hands.
//   G / Esc        leave
//   wheel          step the hour (±15 min per notch, eased)
//   Z / X (hold)   wind the day back / forward (Shift: faster)
//   C              stop / restart the clock
// A small hour readout appears only while the time is being changed.
import { G } from '../core/context.js';

const STEP = 0.25;     // hours per wheel notch
const WIND = 2.5;      // hours per second while Z/X is held
const WIND_FAST = 8;

function clock(h) {
  const m = Math.floor((((h % 24) + 24) % 24) * 60 + 0.5) % 1440;
  const hh = Math.floor(m / 60), mm = m % 60;
  const part = hh < 5 ? '새벽' : hh < 12 ? '오전' : hh < 18 ? '오후' : hh < 21 ? '저녁' : '밤';
  return `${part} ${(hh % 12) || 12}:${String(mm).padStart(2, '0')}`;
}

export class Travel {
  constructor() {
    this.on = false;
    this.frozen = false;   // clock stopped (read by World.update)
    this.pending = 0;      // wheel steps not yet eased in
    this.showT = 0;        // seconds the readout stays up
    const el = document.createElement('div');
    el.id = 'travel-clock';
    el.innerHTML = '<div class="tc-time"></div><div class="tc-note"></div>';
    document.body.appendChild(el);
    this.el = el; this.timeEl = el.firstChild; this.noteEl = el.lastChild;
  }

  canEnter() {
    return G.state === 'play' && G.mode === 'free' && !G.player.dead && !G.game.menu && !G.game.busy;
  }

  enter() {
    if (this.on || !this.canEnter()) return;
    this.on = true; this.pending = 0;
    this.saved = { god: G.dev.god, unseen: G.dev.unseen };
    G.dev.god = true; G.dev.unseen = true;
    G.player.lockTarget = null;
    document.body.classList.add('travel');
    G.audio.play('ui_open');
    this.flash('휠 · Z / X 시간   C 시계 멈춤   G 돌아가기', 4.5);
  }

  exit() {
    if (!this.on) return;
    this.on = false; this.pending = 0;
    G.dev.god = this.saved.god; G.dev.unseen = this.saved.unseen;
    document.body.classList.remove('travel');
    this.el.classList.remove('show');
    this.showT = 0;
    G.audio.play('ui_close');
  }

  toggle() { this.on ? this.exit() : this.enter(); }

  flash(note, sec = 1.6) {
    this.timeEl.textContent = clock(G.world.sky.hour) + (this.frozen ? '  ·  멈춤' : '');
    if (note !== undefined) this.noteEl.textContent = note;
    this.showT = Math.max(this.showT, sec);
    this.el.classList.add('show');
  }

  // raw = real seconds this frame (time control keeps working while the game is slowed)
  update(raw) {
    if (!this.on) return;
    if (G.mode !== 'free' || G.player.dead) { this.exit(); return; }
    const I = G.input, sky = G.world.sky;
    let moved = false;
    if (I.mouse.wheel) { this.pending -= I.mouse.wheel * STEP; moved = true; }
    const fast = I.down('ShiftLeft') || I.down('ShiftRight');
    const dir = (I.down('KeyX') ? 1 : 0) - (I.down('KeyZ') ? 1 : 0);
    if (dir) { sky.setHour(sky.hour + dir * (fast ? WIND_FAST : WIND) * raw); moved = true; }
    if (Math.abs(this.pending) > 1e-4) {
      const s = this.pending * Math.min(1, raw * 7);
      sky.setHour(sky.hour + s); this.pending -= s; moved = true;
    } else this.pending = 0;
    if (I.hit('KeyC')) { this.frozen = !this.frozen; G.audio.play(this.frozen ? 'ui_close' : 'ui_open'); this.flash(this.frozen ? '시계가 멈췄습니다' : '시간이 다시 흐릅니다', 2); }
    if (moved) this.flash(this.showT > 1.6 ? undefined : '');
    if (this.showT > 0) {
      this.showT -= raw;
      if (this.showT <= 0) this.el.classList.remove('show');
    }
  }
}
