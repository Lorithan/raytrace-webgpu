import { Renderer } from './renderer';

async function main() {
  const canvas = document.getElementById('canvas') as HTMLCanvasElement;

  if (!navigator.gpu) {
    throw new Error('WebGPU not supported in this browser.');
  }

  const renderer = new Renderer(canvas);
  await renderer.init();
  renderer.render();
}

main().catch(console.error);