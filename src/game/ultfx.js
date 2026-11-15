// Screen-space accents for an ultimate. Self-contained: its own node (between the canvas
// and the HUD, so the HUD stays on top) and its own injected style.
//   ultTitle(el, name)  the song's name with the element's sigil, in the lower-left third
//                       (clear of the aim point, the locked target and its health bar):
//                       solid type with a thin outline, shown for about a second
//   ultAccent(el)       the release beat: two slanted bars cut in from opposite edges and
//                       the frame edge takes the element's colour, about 0.6 s
// The middle of the screen is never covered, so enemy telegraphs stay readable.
// Neutral on purpose (inherits the page font; one custom property, --c, for the element
// colour) so the HUD's type and colour tokens can be applied to it from outside.
import { EL_INFO, EL_SVG } from '../core/context.js';

const CSS = `
#ult-accent { position: absolute; inset: 0; pointer-events: none; overflow: hidden; --c: #fff; contain: strict; }
#ult-accent > * { position: absolute; opacity: 0; }
#ult-accent .ua-edge { inset: 0; background: radial-gradient(ellipse 75% 70% at 50% 50%, transparent 58%, color-mix(in srgb, var(--c) 70%, transparent) 135%); }
#ult-accent .ua-bar { left: 0; right: 0; height: 12vh;
  background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--c) 42%, transparent) 22%, color-mix(in srgb, var(--c) 30%, transparent) 78%, transparent),
    repeating-linear-gradient(90deg, transparent 0 46px, color-mix(in srgb, #fff 16%, transparent) 46px 48px, transparent 48px 131px); }
#ult-accent .ua-bar::after { content: ''; position: absolute; left: 0; right: 0; height: 2px; background: linear-gradient(90deg, transparent, #fff 30%, var(--c) 70%, transparent); }
#ult-accent .ua-top { top: -7vh; }
#ult-accent .ua-top::after { bottom: 0; }
#ult-accent .ua-bot { bottom: -7vh; }
#ult-accent .ua-bot::after { top: 0; }
#ult-accent .ua-title { left: 4.5vw; bottom: 29vh; display: flex; align-items: center; gap: 1.6vh; }
#ult-accent .ua-sigil { width: 9vh; height: 9vh; color: var(--c); flex: none; }
#ult-accent .ua-sigil svg { width: 100%; height: 100%; display: block; }
#ult-accent .ua-name { font-family: inherit; font-size: 5.2vh; font-weight: 700; line-height: 1; letter-spacing: 0.02em; white-space: nowrap; color: #fff;
  -webkit-text-stroke: 0.55vh rgba(12, 14, 22, 0.9); paint-order: stroke fill; padding-bottom: 1.1vh; border-bottom: 0.35vh solid var(--c); }
#ult-accent.title .ua-title { animation: uaTitle 1.05s cubic-bezier(0.16, 0.8, 0.24, 1) both; }
#ult-accent.go .ua-edge { animation: uaEdge 0.62s ease-out both; }
#ult-accent.go .ua-top { animation: uaTop 0.62s cubic-bezier(0.16, 0.8, 0.24, 1) both; }
#ult-accent.go .ua-bot { animation: uaBot 0.62s cubic-bezier(0.16, 0.8, 0.24, 1) both; }
@keyframes uaEdge { 0% { opacity: 0; } 14% { opacity: 0.6; } 100% { opacity: 0; } }
@keyframes uaTop { 0% { opacity: 0; transform: translateX(-60%) skewY(-2.4deg); } 16% { opacity: 1; transform: translateX(0) skewY(-2.4deg); } 55% { opacity: 0.9; transform: translateX(2%) skewY(-2.4deg); } 100% { opacity: 0; transform: translateX(8%) skewY(-2.4deg); } }
@keyframes uaBot { 0% { opacity: 0; transform: translateX(60%) skewY(-2.4deg); } 16% { opacity: 1; transform: translateX(0) skewY(-2.4deg); } 55% { opacity: 0.9; transform: translateX(-2%) skewY(-2.4deg); } 100% { opacity: 0; transform: translateX(-8%) skewY(-2.4deg); } }
@keyframes uaTitle { 0% { opacity: 0; transform: translateX(-5vw); } 12% { opacity: 1; transform: translateX(0); } 78% { opacity: 1; transform: translateX(0.4vw); } 100% { opacity: 0; transform: translateX(1.2vw); } }
@media (prefers-reduced-motion: reduce) { #ult-accent.go .ua-top, #ult-accent.go .ua-bot { animation-duration: 0.01s; } }
`;

let node = null, tA = 0, tT = 0;
function ensure() {
  if (node) return node;
  if (typeof document === 'undefined') return null;
  const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
  node = document.createElement('div'); node.id = 'ult-accent'; node.setAttribute('aria-hidden', 'true');
  node.innerHTML = '<div class="ua-edge"></div><div class="ua-bar ua-top"></div><div class="ua-bar ua-bot"></div><div class="ua-title"><div class="ua-sigil"></div><div class="ua-name"></div></div>';
  const canvas = document.getElementById('game');
  if (canvas && canvas.parentNode) canvas.insertAdjacentElement('afterend', node); else document.body.appendChild(node);
  return node;
}
// restart a one-shot CSS animation class and drop it again when it has played (UI-only timing)
function fire(n, cls, ms, prev) {
  n.classList.remove(cls);
  void n.offsetWidth;
  n.classList.add(cls);
  clearTimeout(prev);
  return setTimeout(() => n.classList.remove(cls), ms);
}

export function ultTitle(el, name) {
  const n = ensure();
  if (!n) return;
  const info = EL_INFO[el];
  n.style.setProperty('--c', info ? info.css : '#fff');
  n.querySelector('.ua-sigil').innerHTML = EL_SVG[el] || '';
  n.querySelector('.ua-name').textContent = name;
  tT = fire(n, 'title', 1100, tT);
}

export function ultAccent(el) {
  const n = ensure();
  if (!n) return;
  const info = EL_INFO[el];
  n.style.setProperty('--c', info ? info.css : '#fff');
  tA = fire(n, 'go', 700, tA);
}
