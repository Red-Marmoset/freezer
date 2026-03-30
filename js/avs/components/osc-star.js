// AVS Oscilliscope Star — 5-pointed star waveform visualization
// Port of r_oscstar.cpp: draws a rotating 5-armed star where each arm
// is displaced by audio waveform data.

import * as THREE from 'https://esm.sh/three@0.171.0';
import { AvsComponent } from '../avs-component.js';

const MAX_POINTS = 5 * 64; // 5 arms × 64 segments each

export class OscStar extends AvsComponent {
  constructor(opts) {
    super(opts);
    const effect = opts.effect || 0;
    this.audioChannel = (opts.audioChannel || ((effect >> 2) & 3) === 0) ? 'LEFT' :
                        ((effect >> 2) & 3) === 1 ? 'RIGHT' : 'CENTER';
    this.size = (opts.size !== undefined ? opts.size : 8) / 32.0;
    this.rotSpeed = (opts.rot !== undefined ? opts.rot : 3) * 0.01;
    this.colors = opts.colors || ['#ffffff'];
    this._rotation = 0;
    this._colorPos = 0;
    this._scene = null;
    this._camera = null;
    this._material = null;
    this._geometry = null;
    this._posAttr = null;
    this._colorAttr = null;
  }

  init(ctx) {
    this._scene = new THREE.Scene();
    this._camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    this._geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(MAX_POINTS * 3);
    const colors = new Float32Array(MAX_POINTS * 3);
    this._posAttr = new THREE.BufferAttribute(positions, 3);
    this._colorAttr = new THREE.BufferAttribute(colors, 3);
    this._geometry.setAttribute('position', this._posAttr);
    this._geometry.setAttribute('color', this._colorAttr);
    this._geometry.setDrawRange(0, 0);

    this._material = new THREE.LineBasicMaterial({
      vertexColors: true,
      depthTest: false,
      transparent: true,
      blending: THREE.AdditiveBlending,
    });

    this._scene.add(new THREE.Line(this._geometry, this._material));
  }

  render(ctx, fb) {
    if (!this.enabled) return;

    const waveform = ctx.audioData.waveform;
    if (!waveform) return;

    // Color cycling (interpolate between colors)
    this._colorPos++;
    const numColors = this.colors.length;
    if (this._colorPos >= numColors * 64) this._colorPos = 0;
    const p = Math.floor(this._colorPos / 64) % numColors;
    const r = this._colorPos % 64;
    const c1 = parseColor(this.colors[p]);
    const c2 = parseColor(this.colors[(p + 1) % numColors]);
    const cr = (c1[0] * (63 - r) + c2[0] * r) / 64 / 255;
    const cg = (c1[1] * (63 - r) + c2[1] * r) / 64 / 255;
    const cb = (c1[2] * (63 - r) + c2[2] * r) / 64 / 255;

    const s = this.size;
    const is = Math.min(ctx.height, ctx.width) * s / ctx.width; // normalized size
    const pos = this._posAttr.array;
    const col = this._colorAttr.array;
    let vi = 0;
    let wi = 0; // waveform index

    for (let q = 0; q < 5; q++) {
      const armAngle = this._rotation + q * (Math.PI * 2 / 5);
      const sinA = Math.sin(armAngle);
      const cosA = Math.cos(armAngle);
      let p_dist = 0;
      const dp = is / 64;
      let dfactor = 1 / 1024;
      const hw = is;

      for (let t = 0; t < 64; t++) {
        const sample = ((waveform[wi] || 128) - 128) / 128; // -1..1
        wi = (wi + 1) % waveform.length;
        const ale = sample * dfactor * hw;

        const x = cosA * p_dist - sinA * ale;
        const y = sinA * p_dist + cosA * ale;

        pos[vi * 3] = x;
        pos[vi * 3 + 1] = -y; // flip Y
        pos[vi * 3 + 2] = 0;
        col[vi * 3] = cr;
        col[vi * 3 + 1] = cg;
        col[vi * 3 + 2] = cb;
        vi++;

        p_dist += dp;
        dfactor -= ((1 / 1024) - (1 / 128)) / 64;
      }
    }

    this._posAttr.needsUpdate = true;
    this._colorAttr.needsUpdate = true;
    this._geometry.setDrawRange(0, vi);

    this._rotation += this.rotSpeed;
    if (this._rotation >= Math.PI * 2) this._rotation -= Math.PI * 2;

    ctx.renderer.setRenderTarget(fb.getActiveTarget());
    ctx.renderer.render(this._scene, this._camera);
  }

  destroy() {
    if (this._geometry) this._geometry.dispose();
    if (this._material) this._material.dispose();
  }
}

function parseColor(hex) {
  const c = hex.replace('#', '');
  return [parseInt(c.slice(0, 2), 16), parseInt(c.slice(2, 4), 16), parseInt(c.slice(4, 6), 16)];
}

AvsComponent.register('OscStar', OscStar);
