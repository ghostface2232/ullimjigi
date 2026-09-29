import './styles.css';
import { Game } from './game/game.js';
import { G } from './core/context.js';

G.playerName = '리안';
const game = new Game();
game.boot().catch((e) => {
  console.error(e);
  const t = document.querySelector('.load-text');
  if (t) t.textContent = '불러오는 중 문제가 생겼습니다: ' + e.message;
});
window.__G = G;
