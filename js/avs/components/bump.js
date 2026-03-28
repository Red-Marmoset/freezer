// AVS Bump component (code 0x1D) — bump mapping with EEL-driven light position
// For each pixel: compute gradient from depth (max RGB of neighbors),
// dot product with light direction gives brightness multiplier.
import * as THREE from 'https://esm.sh/three@0.171.0';
import { AvsComponent } from '../avs-component.js';
import { compileEEL, createState } from '../eel/nseel-compiler.js';
import { createStdlib } from '../eel/nseel-stdlib.js';

const VERT_SHADER = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Fragment shader: bump-map lighting from a depth field derived from max(RGB)
const BUMP_FRAG = `
  uniform sampler2D tSource;
  uniform vec2 uTexelSize;
  uniform vec2 uLightPos;   // light position in UV space (0-1)
  uniform float uDepth;     // depth/intensity multiplier
  uniform float uAmbient;   // ambient light level
  varying vec2 vUv;

  float getDepth(vec2 uv) {
    vec3 c = texture2D(tSource, uv).rgb;
    return max(c.r, max(c.g, c.b));
  }

  void main() {
    // Compute gradient using neighboring pixels
    float left   = getDepth(vUv + vec2(-uTexelSize.x, 0.0));
    float right  = getDepth(vUv + vec2( uTexelSize.x, 0.0));
    float top    = getDepth(vUv + vec2(0.0,  uTexelSize.y));
    float bottom = getDepth(vUv + vec2(0.0, -uTexelSize.y));

    // Surface normal from height gradient
    float dx = (right - left) * uDepth;
    float dy = (top - bottom) * uDepth;
    vec3 normal = normalize(vec3(-dx, -dy, 1.0));

    // Light direction from pixel to light position
    vec2 lightDir2D = uLightPos - vUv;
    // Add a Z component for the light (assume light is slightly above the surface)
    vec3 lightDir = normalize(vec3(lightDir2D, 0.3));

    // Diffuse lighting: dot(normal, lightDir)
    float diffuse = max(dot(normal, lightDir), 0.0);

    // Final brightness: ambient + diffuse
    float brightness = uAmbient + diffuse * (1.0 - uAmbient);

    vec4 src = texture2D(tSource, vUv);
    gl_FragColor = vec4(src.rgb * brightness, 1.0);
  }
`;

export class Bump extends AvsComponent {
  constructor(opts) {
    super(opts);
    const code = opts.code || {};
    this.initFn = compileEEL(code.init || '');
    this.perFrameFn = compileEEL(code.perFrame || '');
    this.onBeatFn = compileEEL(code.onBeat || '');
    this.perPointFn = compileEEL(code.perPoint || code.perPixel || '');

    this.onBeat = opts.onBeat || false;
    this.depth = (opts.depth !== undefined ? opts.depth : 30) / 100; // normalize

    this.state = null;
    this.firstFrame = true;
    this._scene = null;
    this._camera = null;
    this._material = null;
  }

  init(ctx) {
    this.state = createState(ctx.globalRegisters, ctx.globalMegabuf);
    this._scene = new THREE.Scene();
    this._camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    this._material = new THREE.ShaderMaterial({
      uniforms: {
        tSource:    { value: null },
        uTexelSize: { value: new THREE.Vector2(1.0 / ctx.width, 1.0 / ctx.height) },
        uLightPos:  { value: new THREE.Vector2(0.5, 0.5) },
        uDepth:     { value: this.depth * 10 },
        uAmbient:   { value: 0.2 },
      },
      vertexShader: VERT_SHADER,
      fragmentShader: BUMP_FRAG,
      depthTest: false,
    });

    this._scene.add(new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      this._material
    ));

    this.firstFrame = true;
  }

  render(ctx, fb) {
    if (!this.enabled) return;

    const s = this.state;
    const lib = createStdlib({
      waveform: ctx.audioData.waveform,
      spectrum: ctx.audioData.spectrum,
      fftSize: ctx.audioData.fftSize,
      time: ctx.time,
    });

    s.w = ctx.width;
    s.h = ctx.height;
    s.b = ctx.beat ? 1 : 0;

    if (this.firstFrame) {
      try { this.initFn(s, lib); } catch {}
      this.firstFrame = false;
    }

    try { this.perFrameFn(s, lib); } catch {}

    if (ctx.beat) {
      try { this.onBeatFn(s, lib); } catch {}
    }

    // EEL code sets x, y in -1..1 range for light position
    const lightX = ((s.x || 0) + 1) / 2; // map -1..1 to 0..1
    const lightY = ((s.y || 0) + 1) / 2;

    this._material.uniforms.tSource.value = fb.getActiveTexture();
    this._material.uniforms.uLightPos.value.set(lightX, lightY);
    this._material.uniforms.uDepth.value = this.depth * 10;

    // Read from active, write to back, swap
    ctx.renderer.setRenderTarget(fb.getBackTarget());
    ctx.renderer.render(this._scene, this._camera);
    fb.swap();
  }

  destroy() {
    if (this._material) this._material.dispose();
  }
}

AvsComponent.register('Bump', Bump);
