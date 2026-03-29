import * as THREE from 'https://esm.sh/three@0.171.0';

export function createRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  // AVS operates in linear color space — no sRGB gamma correction.
  // Without this, effects like Invert produce wrong colors (white→pink instead of black).
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

  const scene = new THREE.Scene();

  let w = canvas.clientWidth;
  let h = canvas.clientHeight;
  const camera = new THREE.OrthographicCamera(-w / 2, w / 2, h / 2, -h / 2, 0.1, 100);
  camera.position.z = 1;

  renderer.setSize(w, h, false);

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
        spectrumBytes: audioEngine?.spectrumBytes,
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

  const TARGET_FPS = 60;
  const FRAME_INTERVAL = 1000 / TARGET_FPS;

  function loop() {
    animationId = requestAnimationFrame(loop);

    const now = performance.now();
    const elapsed = now - lastTime;
    if (elapsed < FRAME_INTERVAL) return; // cap at 60fps

    const ctx = buildCtx();
    ctx.dt = elapsed / 1000;
    ctx.time = (now - startTime) / 1000;
    lastTime = now - (elapsed % FRAME_INTERVAL); // maintain cadence

    if (audioEngine) {
      audioEngine.update();
      // Refresh references after update
      ctx.audioData.waveform = audioEngine.waveform;
      ctx.audioData.spectrum = audioEngine.spectrum;
      ctx.audioData.spectrumBytes = audioEngine.spectrumBytes;
    }

    if (activePreset) {
      activePreset.update(ctx);
      // AVS presets handle their own screen output via blit
      // Only render main scene for non-AVS presets (default oscilloscope)
      if (!activePreset._blitScene) {
        renderer.render(scene, camera);
      }
    } else {
      renderer.render(scene, camera);
    }
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
    // false = don't set CSS style (we use 100vw/100vh in CSS)
    renderer.setSize(w, h, false);
    camera.left = -w / 2;
    camera.right = w / 2;
    camera.top = h / 2;
    camera.bottom = -h / 2;
    camera.updateProjectionMatrix();
  }

  window.addEventListener('resize', resize);
  // Also observe the canvas element directly for more reliable resize detection
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(resize).observe(canvas);
  }

  return { setPreset, start, resize, scene, camera };
}
