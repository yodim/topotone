import { startLoop } from './render/engine';
import { drawPlaceholder } from './render/placeholder';

const canvas = document.querySelector<HTMLCanvasElement>('#stage');
if (!canvas) throw new Error('Missing #stage canvas');

startLoop(canvas, drawPlaceholder);
