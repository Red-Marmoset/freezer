// AVS DotFountain component (code 0x13)
// 256 generations x 30 angular positions, particles launch upward from audio,
// spread outward with radial acceleration, and fall back down under gravity.
import * as THREE from 'https://esm.sh/three@0.171.0';
import { AvsComponent } from '../avs-component.js';

const NUM_DIV = 30;    // angular divisions per ring
const NUM_HEIGHT = 256; // number of generations (rings)
const MAX_DOTS = NUM_DIV * NUM_HEIGHT;

export class DotFountain extends AvsComponent {
  constructor(opts) {
    super(opts);
    this.rotSpeed = opts.rotSpeed != null ? opts.rotSpeed : 16;
    this.angle = opts.angle != null ? opts.angle : -20;
    this.colors = opts.colors || ['#1c6b18', '#ff0a23', '#2a1d74', '#9036d9', '#6b88ff'];
    this._rotation = 0;
    this._colorMap = null;
    // Per-particle state: radius, deltaRadius, height, deltaHeight, ax, ay, color
    this._radius = null;
    this._deltaRadius = null;
    this._height = null;
    this._deltaHeight = null;
    this._ax = null;
    this._ay = null;
    this._pcolor = null; // Uint32 per particle (packed RGB)
  }

  init(ctx) {
    this._scene = new THREE.Scene();
    this._camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 10);
    this._camera.position.z = 1;

    // Build 64-entry color gradient from 5 colors
    this._colorMap = buildColorMap(this.colors);

    // Initialize particle arrays
    const n = MAX_DOTS;
    this._radius = new Float32Array(n);
    this._deltaRadius = new Float32Array(n);
    this._height = new Float32Array(n).fill(250);
    this._deltaHeight = new Float32Array(n);
    this._ax = new Float32Array(n);
    this._ay = new Float32Array(n);
    this._pcolor = new Uint32Array(n);

    // Set initial angular positions
    for (let g = 0; g < NUM_HEIGHT; g++) {
      for (let a = 0; a < NUM_DIV; a++) {
        const idx = g * NUM_DIV + a;
        const ang = a * Math.PI * 2 / NUM_DIV;
        this._ax[idx] = Math.sin(ang);
        this._ay[idx] = Math.cos(ang);
        this._radius[idx] = 1;
      }
    }

    // Geometry
    this._geometry = new THREE.BufferGeometry();
    this._geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_DOTS * 3), 3));
    this._geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(MAX_DOTS * 3), 3));
    this._geometry.setDrawRange(0, 0);

    this._material = new THREE.PointsMaterial({ size: 2, vertexColors: true, sizeAttenuation: false, depthTest: false });
    this._points = new THREE.Points(this._geometry, this._material);
    this._scene.add(this._points);
  }

  render(ctx, fb) {
    if (!this.enabled || !this._radius) return;
    const spectrum = ctx.audioData.spectrum;
    const isBeat = ctx.beat;

    // Step 1: Shift generations (oldest = NUM_HEIGHT-1, newest = 0)
    for (let g = NUM_HEIGHT - 2; g >= 0; g--) {
      const accelR = 1.3 / (g + 100);
      for (let a = 0; a < NUM_DIV; a++) {
        const dst = (g + 1) * NUM_DIV + a;
        const src = g * NUM_DIV + a;
        this._radius[dst] = this._radius[src] + this._deltaRadius[src];
        this._deltaRadius[dst] = this._deltaRadius[src] + accelR;
        this._deltaHeight[dst] = this._deltaHeight[src] + 0.05; // gravity
        this._height[dst] = this._height[src] + this._deltaHeight[dst];
        this._ax[dst] = this._ax[src];
        this._ay[dst] = this._ay[src];
        this._pcolor[dst] = this._pcolor[src];
      }
    }

    // Step 2: Inject new ring at generation 0 from spectrum data
    for (let a = 0; a < NUM_DIV; a++) {
      let audio = 0;
      if (spectrum) {
        const raw = Math.max(0, (spectrum[a] + 100) / 100) * 255; // dB to 0-255
        audio = Math.min(255, raw * 5 / 4 - 64 + (isBeat ? 128 : 0));
      }
      audio = Math.max(0, audio);

      const dr = Math.abs(audio) / 200 + 1;
      const ang = a * Math.PI * 2 / NUM_DIV;
      const idx = a; // generation 0

      this._radius[idx] = 1;
      this._deltaRadius[idx] = 0;
      this._height[idx] = 250;
      this._deltaHeight[idx] = -dr * 2.8;
      this._ax[idx] = Math.sin(ang);
      this._ay[idx] = Math.cos(ang);

      const colorIdx = Math.min(63, Math.max(0, Math.floor(audio / 4)));
      this._pcolor[idx] = this._colorMap[colorIdx];
    }

    // Step 3: Build transform matrix
    const rotRad = this._rotation * Math.PI / 180;
    const angRad = this.angle * Math.PI / 180;
    const cosR = Math.cos(rotRad), sinR = Math.sin(rotRad);
    const cosA = Math.cos(angRad), sinA = Math.sin(angRad);

    const zoom = Math.min(ctx.width * 440 / 640, ctx.height * 440 / 480);
    const hw = ctx.width / 2, hh = ctx.height / 2;

    const positions = this._geometry.attributes.position.array;
    const colorsBuf = this._geometry.attributes.color.array;
    let drawCount = 0;

    for (let i = 0; i < MAX_DOTS && drawCount < MAX_DOTS; i++) {
      const wx = this._ax[i] * this._radius[i];
      const wy = this._height[i];
      const wz = this._ay[i] * this._radius[i];

      // Rotate Y (rotation), then Rotate X (angle), then translate
      let x = wx * cosR - wz * sinR;
      let z = wx * sinR + wz * cosR;
      let y = wy;
      const y2 = y * cosA - z * sinA;
      const z2 = y * sinA + z * cosA;
      y = y2 - 20;
      const zf = z2 + 400;

      if (zf <= 1) continue;
      const persp = zoom / zf;
      const sx = (x * persp + hw) / ctx.width * 2 - 1;
      const sy = -((y * persp + hh) / ctx.height * 2 - 1);

      if (sx < -1.5 || sx > 1.5 || sy < -1.5 || sy > 1.5) continue;

      const c = this._pcolor[i];
      positions[drawCount * 3] = sx;
      positions[drawCount * 3 + 1] = sy;
      positions[drawCount * 3 + 2] = 0;
      colorsBuf[drawCount * 3] = ((c >> 16) & 0xff) / 255;
      colorsBuf[drawCount * 3 + 1] = ((c >> 8) & 0xff) / 255;
      colorsBuf[drawCount * 3 + 2] = (c & 0xff) / 255;
      drawCount++;
    }

    this._geometry.attributes.position.needsUpdate = true;
    this._geometry.attributes.color.needsUpdate = true;
    this._geometry.setDrawRange(0, drawCount);

    ctx.renderer.setRenderTarget(fb.getActiveTarget());
    ctx.renderer.render(this._scene, this._camera);

    // Update rotation
    this._rotation = (this._rotation + this.rotSpeed / 5) % 360;
  }

  destroy() {
    if (this._geometry) this._geometry.dispose();
    if (this._material) this._material.dispose();
  }
}

// DotPlane uses the same color map builder
export function buildColorMap(hexColors) {
  const colors = hexColors.map(h => {
    if (typeof h === 'string' && h[0] === '#') h = h.slice(1);
    const n = parseInt(h, 16) || 0;
    return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
  });
  while (colors.length < 5) colors.push([255, 255, 255]);
  const map = new Uint32Array(64);
  for (let interval = 0; interval < 4; interval++) {
    const c1 = colors[interval], c2 = colors[interval + 1];
    for (let step = 0; step < 16; step++) {
      const t = step / 16;
      const r = Math.round(c1[0] + (c2[0] - c1[0]) * t);
      const g = Math.round(c1[1] + (c2[1] - c1[1]) * t);
      const b = Math.round(c1[2] + (c2[2] - c1[2]) * t);
      map[interval * 16 + step] = (r << 16) | (g << 8) | b;
    }
  }
  return map;
}

AvsComponent.register('DotFountain', DotFountain);
