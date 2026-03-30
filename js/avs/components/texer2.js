// AVS Texer II APE component (Acko.net: Texer II)
// Advanced version of Texer with per-point color, sizing, and color filtering.
// Renders a sprite image at EEL-computed positions with per-instance color tinting.
import * as THREE from 'https://esm.sh/three@0.171.0';
import { AvsComponent } from '../avs-component.js';
import { compileEEL, createState } from '../eel/nseel-compiler.js';
import { createStdlib } from '../eel/nseel-stdlib.js';
import { loadAvsImage, getFallbackTexture } from '../image-loader.js';
import { applyLineBlend, restoreLineBlend } from '../line-blend.js';

const MAX_POINTS = 4096;

// Generate a 32x32 gaussian blob texture (white center, transparent edges)
function createGaussianBlobTexture() {
  const size = 32;
  const data = new Uint8Array(size * size * 4);
  const center = (size - 1) / 2;
  const sigma = size / 4.5;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - center;
      const dy = y - center;
      const d2 = dx * dx + dy * dy;
      const intensity = Math.exp(-d2 / (2 * sigma * sigma));
      const val = Math.round(intensity * 255);
      const idx = (y * size + x) * 4;
      data[idx] = val;
      data[idx + 1] = val;
      data[idx + 2] = val;
      data[idx + 3] = val;
    }
  }

  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.needsUpdate = true;
  return tex;
}

// Vertex shader — instanced quads with per-instance position, size, and color
const VERT_SHADER = `
  attribute vec2 offset;       // quad corner (-0.5..0.5)
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
  uniform int uColorize; // 0=off (draw texture as-is), 1=on (multiply by color)

  varying vec2 vUv;
  varying vec3 vColor;

  void main() {
    vec4 tex = texture2D(tSprite, vUv);
    vec3 color;
    if (uColorize == 1) {
      color = tex.rgb * vColor;
    } else {
      color = tex.rgb;
    }
    // Skip black pixels — original AVS skips 0x000000 pixels in the inner loop.
    // BMP sprites have no alpha, so black background acts as transparent.
    if (dot(color, color) < 0.001) discard;
    gl_FragColor = vec4(color, 1.0);
  }
`;

export class Texer2 extends AvsComponent {
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
    // colorFilter: original is boolean (0=off, nonzero=on, always multiply)
    // We accept old 4-mode values for backwards compat but treat >0 as "colorize on"
    this.colorFilter = opts.colorFilter || 0;
    this._imageWidth = 32;
    this._imageHeight = 32;

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

    // Start with fallback, load real image async
    this._blobTexture = getFallbackTexture();
    if (this.imageSrc) {
      loadAvsImage(this.imageSrc).then(tex => {
        this._blobTexture = tex;
        this._imageWidth = tex.image ? tex.image.width : 32;
        this._imageHeight = tex.image ? tex.image.height : 32;
        if (this._material) this._material.uniforms.tSprite.value = tex;
      });
    }

    // Build instanced geometry
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

    // Shader material — blending is managed manually via GL state
    // to honor SetRenderMode (g_line_blend_mode)
    this._material = new THREE.RawShaderMaterial({
      vertexShader: VERT_SHADER,
      fragmentShader: FRAG_SHADER,
      uniforms: {
        tSprite: { value: this._blobTexture },
        uColorize: { value: this.colorFilter ? 1 : 0 },
      },
      transparent: false,
      blending: THREE.NoBlending,
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
    s.iw = this._imageWidth;
    s.ih = this._imageHeight;

    // Run init on first frame
    if (this.firstFrame) {
      try { this.initFn(s, lib); } catch {}
      this.firstFrame = false;
    }

    // Per-frame defaults for per-point vars (set ONCE per frame, not per point)
    s.x = 0;
    s.y = 0;
    s.sizex = 1;
    s.sizey = 1;
    s.red = 1;
    s.green = 1;
    s.blue = 1;
    s.skip = 0;

    // Run perFrame
    try { this.perFrameFn(s, lib); } catch {}

    // Run onBeat
    if (ctx.beat) {
      try { this.onBeatFn(s, lib); } catch {}
    }

    // Get point count (default 0 — EEL init/perFrame must set n)
    const n = Math.max(0, Math.min(MAX_POINTS, Math.floor(s.n || 0)));
    if (n === 0) return;

    // Default sprite size in NDC
    const defaultSizeX = this._imageWidth / ctx.width * 2;
    const defaultSizeY = this._imageHeight / ctx.height * 2;

    // Get instance attribute arrays
    const posArr = this._instancePosAttr.array;
    const sizeArr = this._instanceSizeAttr.array;
    const colorArr = this._instanceColorAttr.array;

    let count = 0;

    for (let i = 0; i < n; i++) {
      // Per-point variables: i, v, skip are set each iteration
      // x, y, sizex, sizey, red, green, blue PERSIST between points
      s.i = n > 1 ? i / (n - 1) : 0;
      s.skip = 0;

      // Sample audio
      const sampleIdx = Math.floor(s.i * (sampleCount - 1));
      s.v = waveform ? (waveform[sampleIdx] - 128) / 128 : 0;

      // Run perPoint code
      try { this.perPointFn(s, lib); } catch {}

      // Skip if requested (any nonzero value)
      if (s.skip !== 0) continue;

      // Skip tiny particles
      if (Math.abs(s.sizex) <= 0.01 || Math.abs(s.sizey) <= 0.01) continue;

      const x = s.x || 0;
      const y = -(s.y || 0); // Y inverted (AVS convention)
      // When resize=true, sizex/sizey scale the image. When false, native pixel size.
      const sx = this.resize ? Math.abs(s.sizex || 1) * defaultSizeX : defaultSizeX;
      const sy = this.resize ? Math.abs(s.sizey || 1) * defaultSizeY : defaultSizeY;

      const r = Math.max(0, Math.min(1, s.red || 0));
      const g = Math.max(0, Math.min(1, s.green || 0));
      const b = Math.max(0, Math.min(1, s.blue || 0));

      // Add the particle (and wrapped copies if wrap is on)
      const positions = this.wrap ? [[x, y]] : [[x, y]];
      if (this.wrap) {
        // If particle overlaps edges, add wrapped copies
        const halfSx = sx / 2;
        const halfSy = sy / 2;
        if (x - halfSx < -1) positions.push([x + 2, y]);
        if (x + halfSx > 1) positions.push([x - 2, y]);
        if (y - halfSy < -1) positions.push([x, y + 2]);
        if (y + halfSy > 1) positions.push([x, y - 2]);
      }

      for (const [px, py] of positions) {
        if (count >= MAX_POINTS) break;
        posArr[count * 3] = px;
        posArr[count * 3 + 1] = py;
        posArr[count * 3 + 2] = 0;

        sizeArr[count * 2] = sx;
        sizeArr[count * 2 + 1] = sy;

        colorArr[count * 3] = r;
        colorArr[count * 3 + 1] = g;
        colorArr[count * 3 + 2] = b;

        count++;
      }
    }

    // Update instance attributes
    this._instancePosAttr.needsUpdate = true;
    this._instanceSizeAttr.needsUpdate = true;
    this._instanceColorAttr.needsUpdate = true;
    this._geometry.instanceCount = count;

    // Apply blend mode from SetRenderMode (or default to additive)
    const blended = applyLineBlend(ctx.renderer, ctx);
    if (!blended) {
      // Default: additive blending (original AVS default for Texer II)
      const gl = ctx.renderer.getContext();
      gl.enable(gl.BLEND);
      gl.blendEquation(gl.FUNC_ADD);
      gl.blendFunc(gl.ONE, gl.ONE);
    }

    // Render onto the active framebuffer
    ctx.renderer.setRenderTarget(fb.getActiveTarget());
    ctx.renderer.render(this._scene, this._camera);

    // Restore GL state
    restoreLineBlend(ctx.renderer);
  }

  destroy() {
    if (this._geometry) this._geometry.dispose();
    if (this._material) this._material.dispose();
    if (this._blobTexture) this._blobTexture.dispose();
    this._scene = null;
    this._camera = null;
  }
}

AvsComponent.register('Acko.net: Texer II', Texer2);
