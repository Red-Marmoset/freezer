import * as THREE from 'https://esm.sh/three@0.171.0';

export function createRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);

  const scene = new THREE.Scene();

  let w = canvas.clientWidth;
  let h = canvas.clientHeight;
  const camera = new THREE.OrthographicCamera(-w / 2, w / 2, h / 2, -h / 2, 0.1, 100);
  camera.position.z = 1;

  renderer.setSize(w, h);

  let activePreset = null;
  let audioEngine = null;
  let animationId = null;
  let startTime = performance.now();
  let lastTime = startTime;

  function buildCtx() {
    return {
      scene,
      camera,
      _renderer: renderer, // Exposed for AVS engine render target access
      audioData: {
        waveform: audioEngine?.waveform,
        spectrum: audioEngine?.spectrum,
        fftSize: audioEngine?.fftSize ?? 2048
      },
      time: (performance.now() - startTime) / 1000,
      dt: 0,
      width: w,
      height: h
    };
  }

  function setPreset(preset) {
    if (activePreset) {
      activePreset.destroy(buildCtx());
    }
    activePreset = preset;
    if (activePreset) {
      activePreset.init(buildCtx());
    }
  }

  function loop() {
    animationId = requestAnimationFrame(loop);

    const now = performance.now();
    const ctx = buildCtx();
    ctx.dt = (now - lastTime) / 1000;
    ctx.time = (now - startTime) / 1000;
    lastTime = now;

    if (audioEngine) {
      audioEngine.update();
      // Refresh references after update
      ctx.audioData.waveform = audioEngine.waveform;
      ctx.audioData.spectrum = audioEngine.spectrum;
    }

    if (activePreset) {
      activePreset.update(ctx);
    }

    renderer.render(scene, camera);
  }

  function start(engine) {
    audioEngine = engine;
    startTime = performance.now();
    lastTime = startTime;
    loop();
  }

  function resize() {
    w = canvas.clientWidth;
    h = canvas.clientHeight;
    renderer.setSize(w, h);
    camera.left = -w / 2;
    camera.right = w / 2;
    camera.top = h / 2;
    camera.bottom = -h / 2;
    camera.updateProjectionMatrix();
  }

  window.addEventListener('resize', resize);

  return { setPreset, start, resize, scene, camera };
}
