// AVS DotPlane component (code 0x01) — ported from r_dotpln.cpp
// 64x64 grid of dots. Audio scrolls across as height, damped spring physics.
import * as THREE from 'https://esm.sh/three@0.171.0';
import { AvsComponent } from '../avs-component.js';
import { buildColorMap } from './dot-fountain.js';

const N = 64;
const MAX_DOTS = N * N;

export class DotPlane extends AvsComponent {
  constructor(opts) {
    super(opts);
    this.rotSpeed = opts.rotSpeed != null ? opts.rotSpeed : 16;
    this.angle = opts.angle != null ? opts.angle : -20;
    this.colors = opts.colors || ['#186b1c', '#230aff', '#741d2a', '#d93690', '#ff886b'];
    this._rotation = opts.rotation || 0;
    this._colorMap = null;
    this._at = null; // atable: heights
    this._vt = null; // vtable: velocities
    this._ct = null; // ctable: colors (packed RGB)
  }

  init(ctx) {
    this._scene = new THREE.Scene();
    this._camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 10);
    this._camera.position.z = 1;

    this._colorMap = buildColorMap(this.colors);
    this._at = new Float32Array(MAX_DOTS);
    this._vt = new Float32Array(MAX_DOTS);
    this._ct = new Uint32Array(MAX_DOTS);

    this._geometry = new THREE.BufferGeometry();
    this._geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_DOTS * 3), 3));
    this._geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(MAX_DOTS * 3), 3));
    this._geometry.setDrawRange(0, 0);
    this._material = new THREE.PointsMaterial({ size: 2, vertexColors: true, sizeAttenuation: false, depthTest: false });
    this._scene.add(new THREE.Points(this._geometry, this._material));
  }

  render(ctx, fb) {
    if (!this.enabled || !this._at) return;
    const waveform = ctx.audioData.waveform;

    // Save row 0 for delta calculation (btable in original)
    const saved = new Float32Array(N);
    for (let x = 0; x < N; x++) saved[x] = this._at[x];

    // Grid update — matching original r_dotpln.cpp exactly
    for (let fo = 0; fo < N; fo++) {
      const t = (N - (fo + 2)) * N; // source row offset
      const tOut = t + N;           // destination row offset (one row later)

      if (fo === N - 1) {
        // Last iteration: inject new audio data into row 0
        // t = -N, tOut = 0 → writes to atable[0..N-1]
        for (let p = 0; p < N; p++) {
          let val = 0;
          if (waveform) {
            const i0 = Math.min(waveform.length - 1, p * 3);
            const i1 = Math.min(waveform.length - 1, p * 3 + 1);
            const i2 = Math.min(waveform.length - 1, p * 3 + 2);
            val = Math.max(waveform[i0], waveform[i1], waveform[i2]);
          }
          this._at[p] = val;
          let ci = val >> 2;
          if (ci > 63) ci = 63;
          this._ct[p] = this._colorMap[ci];
          this._vt[p] = (val - saved[p]) / 90;
        }
      } else {
        // Propagate: shift row t → row t+N with spring physics
        for (let p = 0; p < N; p++) {
          let h = this._at[t + p] + this._vt[t + p];
          if (h < 0) h = 0;
          this._at[tOut + p] = h;
          this._vt[tOut + p] = this._vt[t + p] - 0.15 * (h / 255);
          this._ct[tOut + p] = this._ct[t + p];
        }
      }
    }

    // 3D transform + projection
    const rotRad = this._rotation * Math.PI / 180;
    const angRad = this.angle * Math.PI / 180;
    const cr = Math.cos(rotRad), sr = Math.sin(rotRad);
    const ca = Math.cos(angRad), sa = Math.sin(angRad);
    const adj = Math.min(ctx.width * 440 / 640, ctx.height * 440 / 480);
    const hw = ctx.width / 2, hh = ctx.height / 2;
    const dw = 350 / N;

    const positions = this._geometry.attributes.position.array;
    const colorsBuf = this._geometry.attributes.color.array;
    let drawCount = 0;

    for (let fo = 0; fo < N; fo++) {
      const f = (this._rotation < 90 || this._rotation > 270) ? N - fo - 1 : fo;
      const q = (f - N * 0.5) * dw;
      let w = -(N * 0.5) * dw;
      let step = dw;
      let rowStart = f * N;
      let da = 1;

      if (this._rotation < 180) {
        da = -1;
        step = -dw;
        w = -w + step;
        rowStart += N - 1;
      }

      for (let p = 0; p < N; p++) {
        const idx = rowStart + p * da;
        const h = this._at[idx];

        // matrixApply(matrix, w, 64-h, q, &x, &y, &z)
        const wx = w, wy = 64 - h, wz = q;
        let x = wx * cr - wz * sr;
        const rz1 = wx * sr + wz * cr;
        const ry = wy * ca - rz1 * sa;
        const rz = wy * sa + rz1 * ca;
        const y = ry - 20;
        const z = rz + 400;

        const pz = adj / z;
        if (pz > 0.0000001) {
          const ix = Math.round(x * pz) + hw;
          const iy = Math.round(y * pz) + hh;
          if (ix >= 0 && ix < ctx.width && iy >= 0 && iy < ctx.height) {
            const sx = ix / ctx.width * 2 - 1;
            const sy = -(iy / ctx.height * 2 - 1);
            const c = this._ct[idx];
            positions[drawCount * 3] = sx;
            positions[drawCount * 3 + 1] = sy;
            positions[drawCount * 3 + 2] = 0;
            colorsBuf[drawCount * 3] = ((c >> 16) & 0xff) / 255;
            colorsBuf[drawCount * 3 + 1] = ((c >> 8) & 0xff) / 255;
            colorsBuf[drawCount * 3 + 2] = (c & 0xff) / 255;
            drawCount++;
          }
        }
        w += step;
      }
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

AvsComponent.register('DotPlane', DotPlane);
