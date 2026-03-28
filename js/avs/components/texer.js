// AVS Texer APE component — renders a sprite image at EEL-computed positions
// Texer places a textured quad at each point computed by per-point EEL code.
// Since we can't load .bmp files from disk, a procedural gaussian blob is used as fallback.
import * as THREE from 'https://esm.sh/three@0.171.0';
import { AvsComponent } from '../avs-component.js';
import { compileEEL, createState } from '../eel/nseel-compiler.js';
import { createStdlib } from '../eel/nseel-stdlib.js';

const MAX_POINTS = 4096;

// Generate a 32x32 gaussian blob texture (white center, transparent edges)
function createGaussianBlobTexture() {
  const size = 32;
  const data = new Uint8Array(size * size * 4);
  const center = (size - 1) / 2;
  const sigma = size / 4.5; // tune so edges fade nicely

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - center;
      const dy = y - center;
      const d2 = dx * dx + dy * dy;
      const intensity = Math.exp(-d2 / (2 * sigma * sigma));
      const val = Math.round(intensity * 255);
      const idx = (y * size + x) * 4;
      data[idx] = val;     // R
      data[idx + 1] = val; // G
      data[idx + 2] = val; // B
      data[idx + 3] = val; // A — fade alpha with brightness for soft edges
    }
  }

  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.needsUpdate = true;
  return tex;
}

// Vertex shader — instanced quads with per-instance position, size, and color
const VERT_SHADER = `
  attribute vec2 offset;      // quad corner (-0.5..0.5)
  attribute vec3 instancePos;  // center position in NDC (-1..1)
  attribute vec2 instanceSize; // width/height in NDC units
  attribute vec3 instanceColor;

  varying vec2 vUv;
  varying vec3 vColor;

  void main() {
    vUv = offset + 0.5; // 0..1
    vColor = instanceColor;
    vec2 pos = instancePos.xy + offset * instanceSize;
    gl_Position = vec4(pos, 0.0, 1.0);
  }
`;

const FRAG_SHADER = `
  precision mediump float;
  uniform sampler2D tSprite;

  varying vec2 vUv;
  varying vec3 vColor;

  void main() {
    vec4 tex = texture2D(tSprite, vUv);
    gl_FragColor = vec4(tex.rgb * vColor, tex.a);
  }
`;

export class Texer extends AvsComponent {
  constructor(opts) {
    super(opts);

    const code = opts.code || {};
    this.initFn = compileEEL(code.init || '');
    this.perFrameFn = compileEEL(code.perFrame || '');
    this.onBeatFn = compileEEL(code.onBeat || '');
    this.perPointFn = compileEEL(code.perPoint || '');

    this.imageSrc = opts.imageSrc || '';
    this.wrap = opts.wrap !== false;
    this.resize = opts.resize !== false;

    // State
    this.state = null;
    this.firstFrame = true;

    // Three.js objects
    this._scene = null;
    this._camera = null;
    this._geometry = null;
    this._material = null;
    this._mesh = null;
    this._blobTexture = null;
  }

  init(ctx) {
    this.state = createState(ctx.globalRegisters, ctx.globalMegabuf);
    this._scene = new THREE.Scene();
    this._camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 10);
    this._camera.position.z = 1;

    // Create procedural fallback texture
    this._blobTexture = createGaussianBlobTexture();

    // Build instanced geometry: a single quad (two triangles) instanced MAX_POINTS times
    // Base quad: four vertices for a unit quad
    const quadVerts = new Float32Array([
      -0.5, -0.5,
       0.5, -0.5,
       0.5,  0.5,
      -0.5,  0.5,
    ]);
    const quadIndices = new Uint16Array([0, 1, 2, 0, 2, 3]);

    this._geometry = new THREE.InstancedBufferGeometry();
    this._geometry.setAttribute('offset', new THREE.BufferAttribute(quadVerts, 2));
    this._geometry.setIndex(new THREE.BufferAttribute(quadIndices, 1));

    // Per-instance attributes
    const instancePos = new Float32Array(MAX_POINTS * 3);
    const instanceSize = new Float32Array(MAX_POINTS * 2);
    const instanceColor = new Float32Array(MAX_POINTS * 3);

    this._instancePosAttr = new THREE.InstancedBufferAttribute(instancePos, 3);
    this._instanceSizeAttr = new THREE.InstancedBufferAttribute(instanceSize, 2);
    this._instanceColorAttr = new THREE.InstancedBufferAttribute(instanceColor, 3);

    this._geometry.setAttribute('instancePos', this._instancePosAttr);
    this._geometry.setAttribute('instanceSize', this._instanceSizeAttr);
    this._geometry.setAttribute('instanceColor', this._instanceColorAttr);

    this._geometry.instanceCount = 0;

    // Shader material with additive blending
    this._material = new THREE.RawShaderMaterial({
      vertexShader: VERT_SHADER,
      fragmentShader: FRAG_SHADER,
      uniforms: {
        tSprite: { value: this._blobTexture },
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
    });

    this._mesh = new THREE.Mesh(this._geometry, this._material);
    this._mesh.frustumCulled = false;
    this._scene.add(this._mesh);

    this.firstFrame = true;
  }

  render(ctx, fb) {
    if (!this.enabled || !this.state) return;

    const s = this.state;
    const audioData = ctx.audioData;
    const waveform = audioData.waveform;
    const spectrum = audioData.spectrum;
    const fftSize = audioData.fftSize || 2048;
    const sampleCount = fftSize / 2;

    const lib = createStdlib({
      waveform,
      spectrum,
      fftSize,
      time: ctx.time,
    });

    // Set built-in variables
    s.w = ctx.width;
    s.h = ctx.height;
    s.b = ctx.beat ? 1 : 0;

    // Run init on first frame
    if (this.firstFrame) {
      try { this.initFn(s, lib); } catch {}
      this.firstFrame = false;
    }

    // Run perFrame
    try { this.perFrameFn(s, lib); } catch {}

    // Run onBeat
    if (ctx.beat) {
      try { this.onBeatFn(s, lib); } catch {}
    }

    // Get point count
    const n = Math.max(1, Math.min(MAX_POINTS, Math.floor(s.n || 100)));

    // Default sprite size in NDC (roughly 32px / screenWidth)
    const defaultSizeX = 32 / ctx.width * 2;
    const defaultSizeY = 32 / ctx.height * 2;

    // Get instance attribute arrays
    const posArr = this._instancePosAttr.array;
    const sizeArr = this._instanceSizeAttr.array;
    const colorArr = this._instanceColorAttr.array;

    let count = 0;

    for (let i = 0; i < n; i++) {
      // Set per-point variables
      s.i = n > 1 ? i / (n - 1) : 0;

      // Sample audio
      const sampleIdx = Math.floor(s.i * (sampleCount - 1));
      s.v = waveform ? (waveform[sampleIdx] - 128) / 128 : 0;

      // Defaults
      s.x = 0;
      s.y = 0;
      s.sizex = 1;
      s.sizey = 1;
      s.skip = 0;
      s.red = 1;
      s.green = 1;
      s.blue = 1;

      // Run perPoint code
      try { this.perPointFn(s, lib); } catch {}

      // Skip if requested
      if (s.skip >= 0.00001) continue;

      const x = s.x || 0;
      const y = -(s.y || 0); // Y inverted (AVS convention)
      const sx = (s.sizex || 1) * defaultSizeX;
      const sy = (s.sizey || 1) * defaultSizeY;

      posArr[count * 3] = x;
      posArr[count * 3 + 1] = y;
      posArr[count * 3 + 2] = 0;

      sizeArr[count * 2] = sx;
      sizeArr[count * 2 + 1] = sy;

      colorArr[count * 3] = Math.max(0, Math.min(1, s.red || 0));
      colorArr[count * 3 + 1] = Math.max(0, Math.min(1, s.green || 0));
      colorArr[count * 3 + 2] = Math.max(0, Math.min(1, s.blue || 0));

      count++;
    }

    // Update instance attributes
    this._instancePosAttr.needsUpdate = true;
    this._instanceSizeAttr.needsUpdate = true;
    this._instanceColorAttr.needsUpdate = true;
    this._geometry.instanceCount = count;

    // Render onto the active framebuffer
    ctx.renderer.setRenderTarget(fb.getActiveTarget());
    ctx.renderer.render(this._scene, this._camera);
  }

  destroy() {
    if (this._geometry) this._geometry.dispose();
    if (this._material) this._material.dispose();
    if (this._blobTexture) this._blobTexture.dispose();
    this._scene = null;
    this._camera = null;
  }
}

AvsComponent.register('Texer', Texer);
