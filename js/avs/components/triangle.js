// AVS Triangle APE — per-triangle filled rendering from EEL code
// Port of the original Triangle APE by TomYam/Cockos.
// Each iteration of perPoint code defines ONE complete triangle with 3 vertices:
//   x1,y1  x2,y2  x3,y3  — vertex positions (-1 to 1)
//   red1,green1,blue1     — triangle color (0 to 1) [flat shaded]
// Variable n sets how many triangles to draw.
import * as THREE from 'https://esm.sh/three@0.171.0';
import { AvsComponent } from '../avs-component.js';
import { compileEEL, createState } from '../eel/nseel-compiler.js';
import { createStdlib } from '../eel/nseel-stdlib.js';

const MAX_TRIS = 2048;

export class Triangle extends AvsComponent {
  constructor(opts) {
    super(opts);

    const code = opts.code || {};
    this.initFn = compileEEL(code.init || '');
    this.perFrameFn = compileEEL(code.perFrame || '');
    this.onBeatFn = compileEEL(code.onBeat || '');
    this.perPointFn = compileEEL(code.perPoint || '');

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

    // Dynamic triangle buffer: 3 verts per tri, max MAX_TRIS triangles
    this._geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(MAX_TRIS * 3 * 3);
    const colors = new Float32Array(MAX_TRIS * 3 * 3);
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

    const n = Math.max(0, Math.min(MAX_TRIS, Math.floor(s.n !== undefined ? s.n : 0)));
    if (n === 0) return;

    // Collect triangles first, then sort by z1 if zbuf is enabled
    const tris = [];

    // Set i step matching original: i = 0, step = 1/(n-1), incremented after perPoint
    let iVal = 0;
    const iStep = n > 1 ? 1 / (n - 1) : 0;

    for (let t = 0; t < n; t++) {
      // Only reset skip per triangle — all other variables persist (matching original)
      s.skip = 0;
      s._dirty.clear();

      s.i = iVal;
      try { this.perPointFn(s, lib); } catch {}
      iVal += iStep;

      if (s.skip !== 0) continue;

      const hasV2Color = s._dirty.has('red2') || s._dirty.has('green2') || s._dirty.has('blue2');
      const hasV3Color = s._dirty.has('red3') || s._dirty.has('green3') || s._dirty.has('blue3');
      const r1 = Math.max(0, Math.min(1, s.red1));
      const g1 = Math.max(0, Math.min(1, s.green1));
      const b1 = Math.max(0, Math.min(1, s.blue1));

      tris.push({
        x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2, x3: s.x3, y3: s.y3,
        z1: s.z1,
        r1, g1, b1,
        r2: hasV2Color ? Math.max(0, Math.min(1, s.red2)) : r1,
        g2: hasV2Color ? Math.max(0, Math.min(1, s.green2)) : g1,
        b2: hasV2Color ? Math.max(0, Math.min(1, s.blue2)) : b1,
        r3: hasV3Color ? Math.max(0, Math.min(1, s.red3)) : r1,
        g3: hasV3Color ? Math.max(0, Math.min(1, s.green3)) : g1,
        b3: hasV3Color ? Math.max(0, Math.min(1, s.blue3)) : b1,
      });
    }

    // Sort by z1 ascending (painter's algorithm — far triangles first)
    if (s.zbuf) {
      tris.sort((a, b) => a.z1 - b.z1);
    }

    // Write sorted triangles to geometry buffers
    const positions = this._geometry.attributes.position.array;
    const colorsBuf = this._geometry.attributes.color.array;
    let triCount = 0;

    for (const tri of tris) {
      const base = triCount * 9;

      positions[base]     = tri.x1;
      positions[base + 1] = -(tri.y1);
      positions[base + 2] = 0;
      positions[base + 3] = tri.x2;
      positions[base + 4] = -(tri.y2);
      positions[base + 5] = 0;
      positions[base + 6] = tri.x3;
      positions[base + 7] = -(tri.y3);
      positions[base + 8] = 0;

      colorsBuf[base]     = tri.r1; colorsBuf[base + 1] = tri.g1; colorsBuf[base + 2] = tri.b1;
      colorsBuf[base + 3] = tri.r2; colorsBuf[base + 4] = tri.g2; colorsBuf[base + 5] = tri.b2;
      colorsBuf[base + 6] = tri.r3; colorsBuf[base + 7] = tri.g3; colorsBuf[base + 8] = tri.b3;

      triCount++;
    }

    this._geometry.attributes.position.needsUpdate = true;
    this._geometry.attributes.color.needsUpdate = true;
    this._geometry.setDrawRange(0, triCount * 3);

    if (triCount > 0) {
      ctx.renderer.setRenderTarget(fb.getActiveTarget());
      ctx.renderer.render(this._scene, this._camera);
    }
  }

  destroy() {
    if (this._geometry) this._geometry.dispose();
    if (this._material) this._material.dispose();
  }
}

AvsComponent.register('Triangle', Triangle);
// Also register as APE name
AvsComponent.register('Render: Triangle', Triangle);
