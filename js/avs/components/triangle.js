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

    const positions = this._geometry.attributes.position.array;
    const colorsBuf = this._geometry.attributes.color.array;
    let triCount = 0;

    for (let t = 0; t < n; t++) {
      // Reset per-triangle defaults
      s.i = n > 1 ? t / (n - 1) : 0;
      s.x1 = 0; s.y1 = 0;
      s.x2 = 0; s.y2 = 0;
      s.x3 = 0; s.y3 = 0;
      s.red1 = 1; s.green1 = 1; s.blue1 = 1;
      s.red2 = 1; s.green2 = 1; s.blue2 = 1;
      s.red3 = 1; s.green3 = 1; s.blue3 = 1;
      s.skip = 0;
      s.z1 = 0;

      try { this.perPointFn(s, lib); } catch {}

      if (s.skip >= 0.00001) continue;

      const base = triCount * 9; // 3 verts * 3 components

      // Vertex 1
      positions[base]     = s.x1;
      positions[base + 1] = -(s.y1); // Y inverted
      positions[base + 2] = 0;
      // Vertex 2
      positions[base + 3] = s.x2;
      positions[base + 4] = -(s.y2);
      positions[base + 5] = 0;
      // Vertex 3
      positions[base + 6] = s.x3;
      positions[base + 7] = -(s.y3);
      positions[base + 8] = 0;

      // Colors — original APE uses flat shading from red1/green1/blue1
      // but we support per-vertex colors if set
      const r1 = Math.max(0, Math.min(1, s.red1));
      const g1 = Math.max(0, Math.min(1, s.green1));
      const b1 = Math.max(0, Math.min(1, s.blue1));
      const r2 = Math.max(0, Math.min(1, s.red2));
      const g2 = Math.max(0, Math.min(1, s.green2));
      const b2 = Math.max(0, Math.min(1, s.blue2));
      const r3 = Math.max(0, Math.min(1, s.red3));
      const g3 = Math.max(0, Math.min(1, s.green3));
      const b3 = Math.max(0, Math.min(1, s.blue3));

      colorsBuf[base]     = r1; colorsBuf[base + 1] = g1; colorsBuf[base + 2] = b1;
      colorsBuf[base + 3] = r2; colorsBuf[base + 4] = g2; colorsBuf[base + 5] = b2;
      colorsBuf[base + 6] = r3; colorsBuf[base + 7] = g3; colorsBuf[base + 8] = b3;

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
