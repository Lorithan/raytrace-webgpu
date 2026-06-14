import { Renderer } from './renderer';
import { Camera, Vec3 } from './scene';

async function main() {
  const canvas = document.getElementById('canvas') as HTMLCanvasElement;

  if (!navigator.gpu) {
    throw new Error('WebGPU not supported in this browser.');
  }

  const renderer = new Renderer(canvas);
  await renderer.init();

  let azimuth = 0;
  let elevation = 0.2;
  let radius = 2.0;
  let focalPoint = new Vec3(0, 0, -1);
  let isDragging = false;
  let lastX = 0;
  let lastY = 0;
  let dirty = false;

  canvas.addEventListener('mousedown', (e) => { isDragging = true; lastX = e.clientX; lastY = e.clientY; });
  canvas.addEventListener('mouseup', () => { isDragging = false; lastX = 0.0; lastY = 0.0; });
  canvas.addEventListener('mousemove', (e) => {
    if (isDragging) {
      azimuth += (e.clientX - lastX) * 0.005;
      elevation += (e.clientY - lastY) * 0.005;
      elevation = Math.min(80 * (Math.PI / 180), Math.max(-80 * (Math.PI / 180), elevation));

      lastX = e.clientX;
      lastY = e.clientY;
      dirty = true;
    }
  });
  canvas.addEventListener('wheel', (e) => {
    radius += e.deltaY * 0.01;
    radius = Math.min(10, Math.max(1, radius));
    dirty = true;
  });
  window.addEventListener('keydown', (e) => {
    const forward = new Vec3(
      -Math.cos(elevation) * Math.sin(azimuth),
      -Math.sin(elevation),
      -Math.cos(elevation) * Math.cos(azimuth)
    );

    const right = new Vec3(
      Math.cos(azimuth),
      0,
      -Math.sin(azimuth)
    );

    const speed = 0.1;
    if (e.key === 'w') { focalPoint = focalPoint.add(forward.scale(speed)); dirty = true; }
    if (e.key === 's') { focalPoint = focalPoint.sub(forward.scale(speed)); dirty = true; }
    if (e.key === 'a') { focalPoint = focalPoint.sub(right.scale(speed)); dirty = true; }
    if (e.key === 'd') { focalPoint = focalPoint.add(right.scale(speed)); dirty = true; }
    if (e.key === 'e') { focalPoint = focalPoint.add(new Vec3(0, 1, 0).scale(speed)); dirty = true; }
    if (e.key === 'q') { focalPoint = focalPoint.sub(new Vec3(0, 1, 0).scale(speed)); dirty = true; }
  });

  function loop() {
    if (dirty) {
      const newCamera = buildCamera(azimuth, elevation, radius, focalPoint);
      renderer.updateCamera(newCamera);
      dirty = false;
    }

    renderer.render();
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
}

function buildCamera(azimuth: number, elevation: number, radius: number, focal: Vec3): Camera {
  const x = radius * Math.cos(elevation) * Math.sin(azimuth);
  const y = radius * Math.sin(elevation);
  const z = radius * Math.cos(elevation) * Math.cos(azimuth);
  const origin = focal.add(new Vec3(x, y, z));
  return new Camera(origin, focal, 60, 800 / 600);
}

main().catch(console.error);