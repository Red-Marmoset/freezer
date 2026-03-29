// AVS Triangle component — renders filled triangles from EEL-computed vertices
// Similar to SuperScope but draws filled triangles instead of dots/lines.
// Every 3 consecutive points form a triangle. Uses dynamic vertex buffer.
import * as THREE from 'https://esm.sh/three@0.171.0';
import { AvsComponent } from '../avs-component.js';
import { compileEEL, createState } from '../eel/nseel-compiler.js';
import { createStdlib } from '../eel/nseel-stdlib.js';

const MAX_VERTS = 4096;

export class VertexTriangles extends AvsComponent {
  constructor(opts) {
    super(opts);

    const code = opts.code || {};
    this.initFn = compileEEL(code.init || '');
    this.perFrameFn = compileEEL(code.perFrame || '');
    this.onBeatFn = compileEEL(code.onBeat || '');
    this.perPointFn = compileEEL(code.perPoint || '');

    this.audioSource = (opts.audioSource || 'WAVEFORM').toUpperCase();
    this.audioChannel = (opts.audioChannel || 'CENTER').toUpperCase();

    this.colors = (opts.colors || ['#ffffff']).map(parseHexColor);
    this.cycleSpeed = opts.cycleSpeed || 0.01;
    this.colorPos = 0;

    this.state = null;
    this.firstFrame = true;

    this._scene = null;
    this._camera = null;
    this._geometry = null;
    this._material = null;
    this._mesh = null;
  }

  init(ctx) {
    this.state = createState(ctx.globalRegisters, ctx.globalMegabuf);
    this._scene = new THREE.Scene();
    this._camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 10);
    this._camera.position.z = 1;

    // Dynamic triangle buffer
    this._geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(MAX_VERTS * 3);
    const colors = new Float32Array(MAX_VERTS * 3);
    this._geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this._geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this._geometry.setDrawRange(0, 0);

    this._material = new THREE.MeshBasicMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
      depthTest: false,
    });

    this._mesh = new THREE.Mesh(this._geometry, this._material);
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
      waveform, spectrum, fftSize,
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

    const n = Math.max(0, Math.min(MAX_VERTS, Math.floor(s.n !== undefined ? s.n : 0)));
    if (n === 0) return;

    const color = this._getCurrentColor();
    const positions = this._geometry.attributes.position.array;
    const colorsBuf = this._geometry.attributes.color.array;
    let vertCount = 0;

    for (let i = 0; i < n; i++) {
      s.i = n > 1 ? i / (n - 1) : 0;

      const sampleIdx = Math.floor(s.i * (sampleCount - 1));
      if (this.audioSource === 'SPECTRUM') {
        s.v = spectrum ? Math.max(0, (spectrum[sampleIdx] + 100) / 100) : 0;
      } else {
        s.v = waveform ? (waveform[sampleIdx] - 128) / 128 : 0;
      }

      s.red = color[0];
      s.green = color[1];
      s.blue = color[2];
      s.skip = 0;

      try { this.perPointFn(s, lib); } catch {}

      if (s.skip >= 0.00001) continue;

      const x = s.x || 0;
      const y = -(s.y || 0);

      positions[vertCount * 3] = x;
      positions[vertCount * 3 + 1] = y;
      positions[vertCount * 3 + 2] = 0;

      colorsBuf[vertCount * 3] = Math.max(0, Math.min(1, s.red || 0));
      colorsBuf[vertCount * 3 + 1] = Math.max(0, Math.min(1, s.green || 0));
      colorsBuf[vertCount * 3 + 2] = Math.max(0, Math.min(1, s.blue || 0));

      vertCount++;
    }

    // Round down to multiple of 3 (each triangle needs 3 verts)
    const triVerts = Math.floor(vertCount / 3) * 3;

    this._geometry.attributes.position.needsUpdate = true;
    this._geometry.attributes.color.needsUpdate = true;
    this._geometry.setDrawRange(0, triVerts);

    if (triVerts > 0) {
      ctx.renderer.setRenderTarget(fb.getActiveTarget());
      ctx.renderer.render(this._scene, this._camera);
    }
  }

  _getCurrentColor() {
    if (this.colors.length === 0) return [1, 1, 1];
    if (this.colors.length === 1) return this.colors[0];
    this.colorPos = (this.colorPos + this.cycleSpeed) % this.colors.length;
    const idx = Math.floor(this.colorPos);
    const frac = this.colorPos - idx;
    const c1 = this.colors[idx];
    const c2 = this.colors[(idx + 1) % this.colors.length];
    return [
      c1[0] + (c2[0] - c1[0]) * frac,
      c1[1] + (c2[1] - c1[1]) * frac,
      c1[2] + (c2[2] - c1[2]) * frac,
    ];
  }

  destroy() {
    if (this._geometry) this._geometry.dispose();
    if (this._material) this._material.dispose();
  }
}

function parseHexColor(hex) {
  if (typeof hex === 'string' && hex[0] === '#') hex = hex.slice(1);
  const n = parseInt(hex, 16);
  return [(n >> 16 & 0xff) / 255, (n >> 8 & 0xff) / 255, (n & 0xff) / 255];
}

AvsComponent.register('VertexTriangles', VertexTriangles);
