import './style.css';
import { Game } from './game.js';
import { installDebugHooks } from './debug.js';

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('game');
const game = new Game(canvas, params);
game.newWorld();
installDebugHooks(game);
game.run();
if (params.get('autostart') === '1') game.begin();
