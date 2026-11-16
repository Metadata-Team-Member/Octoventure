import './style.css';
import { Game } from './game.js';
import { installDebugHooks } from './debug.js';
import { loadSave } from './systems/save.js';

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('game');
const game = new Game(canvas, params);
const save = game.saveEnabled ? loadSave() : null;       // a save in this browser: Play simply continues it
game.newWorld(save?.seed, save);
installDebugHooks(game);
game.run();
if (params.get('autostart') === '1') game.begin();
