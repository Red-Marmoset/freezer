// AVS DotFountain component (code 0x13) — ported from r_dotfnt.cpp
// 256 generations x 30 angular positions. Particles spawn from spectrum data,
// launch upward, spread radially, and fall under gravity.
import * as THREE from 'https://esm.sh/three@0.171.0';
import { AvsComponent } from '../avs-component.js';

const NUM_DIV = 30;
const NUM_HEIGHT = 256;
const MAX_DOTS = NUM_DIV * NUM_HEIGHT;

export class DotFountain extends AvsComponent {
  constructor(opts) {
    super(opts);
    this.rotSpeed = opts.rotSpeed != null ? opts.rotSpeed : 16;
    this.angle = opts.angle != null ? opts.angle : -20;
    // Default colors: RGB(24,107,28), RGB(35,10,255), RGB(116,29,42), RGB(217,54,144), RGB(255,136,107)
    this.colors = opts.colors || ['#186b1c', '#230aff', '#741d2a', '#d93690', '#ff886b'];
    this._rotation = opts.rotation || 0;
    this._colorMap = null;
    // Per-particle: r, dr, h, dh, ax, ay, color
    this._pr = null; this._pdr = null;
    this._ph = null; this._pdh = null;
    this._pax = null; this._pay = null;
    this._pc = null;
  }

  init(ctx) {
    this._scene = new THREE.Scene();
    this._camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 10);
    this._camera.position.z = 1;

    this._colorMap = buildColorMap(this.colors);

    // All particles start at 0 (memset 0 in original)
    const n = MAX_DOTS;
    this._pr = new Float32Array(n);
    this._pdr = new Float32Array(n);
    this._ph = new Float32Array(n);
    this._pdh = new Float32Array(n);
    this._pax = new Float32Array(n);
    this._pay = new Float32Array(n);
    this._pc = new Uint32Array(n);

    this._geometry = new THREE.BufferGeometry();
    this._geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_DOTS * 3), 3));
    this._geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(MAX_DOTS * 3), 3));
    this._geometry.setDrawRange(0, 0);
    this._material = new THREE.PointsMaterial({ size: 2, vertexColors: true, sizeAttenuation: false, depthTest: false });
    this._scene.add(new THREE.Points(this._geometry, this._material));
  }

  render(ctx, fb) {
    if (!this.enabled || !this._pr) return;

    const spectrum = ctx.audioData.spectrum;
    const isBeat = ctx.beat;

    // Save generation 0 for smoothing
    const prevDh = new Float32Array(NUM_DIV);
    for (let a = 0; a < NUM_DIV; a++) prevDh[a] = this._pdh[a];

    // Shift generations (fo counts from NUM_HEIGHT-2 down to 0)
    for (let fo = NUM_HEIGHT - 2; fo >= 0; fo--) {
      const booga = 1.3 / (fo + 100);
      for (let p = 0; p < NUM_DIV; p++) {
        const src = fo * NUM_DIV + p;
        const dst = (fo + 1) * NUM_DIV + p;
        this._pr[dst] = this._pr[src] + this._pdr[src];
        this._pdr[dst] = this._pdr[src] + booga;
        this._pdh[dst] = this._pdh[src] + 0.05;
        this._ph[dst] = this._ph[src] + this._pdh[dst];
        this._pax[dst] = this._pax[src];
        this._pay[dst] = this._pay[src];
        this._pc[dst] = this._pc[src];
      }
    }

    // Inject new ring at generation 0
    for (let p = 0; p < NUM_DIV; p++) {
      let t = 0;
      if (spectrum) {
        // visdata[1][0] = spectrum, XOR 128 to get unsigned
        const raw = Math.max(0, (spectrum[p] + 100) / 100) * 255;
        t = Math.round(raw) ^ 128;
      }
      t = t * 5 / 4 - 64;
      if (isBeat) t += 128;
      if (t > 255) t = 255;

      const dr = Math.abs(t) / 200 + 1;
      const a = p * Math.PI * 2 / NUM_DIV;

      this._pr[p] = 1;
      this._ph[p] = 250;
      // Smoothing: use difference between old and new deltaHeight
      this._pdh[p] = -dr * (100 + (this._pdh[p] - prevDh[p])) / 100 * 2.8;
      this._pdr[p] = 0;
      this._pax[p] = Math.sin(a);
      this._pay[p] = Math.cos(a);

      let ci = Math.floor(t / 4);
      if (ci > 63) ci = 63;
      if (ci < 0) ci = 0;
      this._pc[p] = this._colorMap[ci];
    }

    // 3D transform matrix (rotation Y, then rotation X, then translate)
    const rotRad = this._rotation * Math.PI / 180;
    const angRad = this.angle * Math.PI / 180;
    const cr = Math.cos(rotRad), sr = Math.sin(rotRad);
    const ca = Math.cos(angRad), sa = Math.sin(angRad);

    // Perspective scale
    const adj = Math.min(ctx.width * 440 / 640, ctx.height * 440 / 480);
    const hw = ctx.width / 2, hh = ctx.height / 2;

    const positions = this._geometry.attributes.position.array;
    const colorsBuf = this._geometry.attributes.color.array;
    let drawCount = 0;

    for (let i = 0; i < MAX_DOTS; i++) {
      // World position
      const wx = this._pax[i] * this._pr[i];
      const wy = this._ph[i];
      const wz = this._pay[i] * this._pr[i];

      // Rotate Y, then Rotate X, then Translate(0, -20, 400)
      const rx = wx * cr - wz * sr;
      const rz1 = wx * sr + wz * cr;
      const ry = wy * ca - rz1 * sa;
      const rz = wy * sa + rz1 * ca;
      const ty = ry - 20;
      const tz = rz + 400;

      // Perspective
      const pz = adj / tz;
      if (pz <= 0.0000001) continue;

      const ix = Math.round(rx * pz) + hw;
      const iy = Math.round(ty * pz) + hh;
      if (ix < 0 || ix >= ctx.width || iy < 0 || iy >= ctx.height) continue;

      // Convert to NDC
      const sx = ix / ctx.width * 2 - 1;
      const sy = -(iy / ctx.height * 2 - 1);

      const c = this._pc[i];
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

    this._rotation += this.rotSpeed / 5;
    if (this._rotation >= 360) this._rotation -= 360;
    if (this._rotation < 0) this._rotation += 360;
  }

  destroy() {
    if (this._geometry) this._geometry.dispose();
    if (this._material) this._material.dispose();
  }
}

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
