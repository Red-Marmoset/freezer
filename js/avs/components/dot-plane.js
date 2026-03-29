// AVS DotPlane component (code 0x01)
// 64x64 grid of dots, audio data scrolls across as height displacement.
// New audio injected at one edge, propagates across with damped spring physics.
import * as THREE from 'https://esm.sh/three@0.171.0';
import { AvsComponent } from '../avs-component.js';
import { buildColorMap } from './dot-fountain.js';

const GRID = 64;
const MAX_DOTS = GRID * GRID;

export class DotPlane extends AvsComponent {
  constructor(opts) {
    super(opts);
    this.rotSpeed = opts.rotSpeed != null ? opts.rotSpeed : 16;
    this.angle = opts.angle != null ? opts.angle : -20;
    // Default colors from AVS (stored as 0xBBGGRR, converted to #RRGGBB)
    this.colors = opts.colors || ['#186b1c', '#230aff', '#741d2a', '#d93690', '#ff886b'];
    this._rotation = 0;
    this._colorMap = null;
    this._gridHeight = null;
    this._gridDelta = null;
    this._gridColor = null;
  }

  init(ctx) {
    this._scene = new THREE.Scene();
    this._camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 10);
    this._camera.position.z = 1;

    this._colorMap = buildColorMap(this.colors);
    this._gridHeight = new Float32Array(MAX_DOTS);
    this._gridDelta = new Float32Array(MAX_DOTS);
    this._gridColor = new Uint32Array(MAX_DOTS);

    this._geometry = new THREE.BufferGeometry();
    this._geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_DOTS * 3), 3));
    this._geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(MAX_DOTS * 3), 3));
    this._geometry.setDrawRange(0, 0);

    this._material = new THREE.PointsMaterial({ size: 2, vertexColors: true, sizeAttenuation: false, depthTest: false });
    this._points = new THREE.Points(this._geometry, this._material);
    this._scene.add(this._points);
  }

  render(ctx, fb) {
    if (!this.enabled || !this._gridHeight) return;
    const waveform = ctx.audioData.waveform;

    // Save first row for delta calculation
    const tmpLine = new Float32Array(GRID);
    for (let x = 0; x < GRID; x++) tmpLine[x] = this._gridHeight[x];

    // Shift rows: propagate existing data, inject new audio at last iteration
    for (let yPos = 0; yPos < GRID; yPos++) {
      const line = (GRID - 2 - yPos) * GRID;
      if (line < 0) continue;

      if (yPos < GRID - 1) {
        // Propagate existing row
        const nextLine = line + GRID;
        for (let x = 0; x < GRID; x++) {
          let h = this._gridHeight[line + x] + this._gridDelta[line + x];
          if (h < 0) h = 0;
          this._gridHeight[nextLine + x] = h;
          this._gridDelta[nextLine + x] = this._gridDelta[line + x] - 0.15 * (h / 255);
          this._gridColor[nextLine + x] = this._gridColor[line + x];
        }
      } else {
        // Inject new audio data at row 0
        for (let x = 0; x < GRID; x++) {
          let audio = 0;
          if (waveform) {
            const i0 = Math.min(waveform.length - 1, x * 3);
            const i1 = Math.min(waveform.length - 1, x * 3 + 1);
            const i2 = Math.min(waveform.length - 1, x * 3 + 2);
            audio = Math.max(waveform[i0], waveform[i1], waveform[i2]);
          }
          this._gridHeight[x] = audio;
          this._gridColor[x] = this._colorMap[Math.min(63, Math.floor(audio / 4))];
          this._gridDelta[x] = (audio - tmpLine[x]) / 90;
        }
      }
    }

    // 3D transform
    const rotRad = this._rotation * Math.PI / 180;
    const angRad = this.angle * Math.PI / 180;
    const cosR = Math.cos(rotRad), sinR = Math.sin(rotRad);
    const cosA = Math.cos(angRad), sinA = Math.sin(angRad);
    const zoom = Math.min(ctx.width * 440 / 640, ctx.height * 440 / 480);
    const hw = ctx.width / 2, hh = ctx.height / 2;
    const gridStep = 350 / GRID;

    const positions = this._geometry.attributes.position.array;
    const colorsBuf = this._geometry.attributes.color.array;
    let drawCount = 0;

    for (let yPos = 0; yPos < GRID; yPos++) {
      const gridStartPos = (this._rotation < 90 || this._rotation > 270) ? GRID - yPos - 1 : yPos;
      const curX = (gridStartPos - 32) * gridStep;

      for (let xPos = 0; xPos < GRID; xPos++) {
        const gx = this._rotation < 180 ? GRID - 1 - xPos : xPos;
        const idx = yPos * GRID + gx;
        const curY = (gx - 32) * gridStep;
        const h = this._gridHeight[idx];

        const wx = curY, wy = 64 - h, wz = curX;

        let x = wx * cosR - wz * sinR;
        let z = wx * sinR + wz * cosR;
        const y2 = wy * cosA - z * sinA;
        const z2 = wy * sinA + z * cosA;
        const y = y2 - 20;
        const zf = z2 + 400;

        if (zf <= 1) continue;
        const persp = zoom / zf;
        const sx = (x * persp + hw) / ctx.width * 2 - 1;
        const sy = -((y * persp + hh) / ctx.height * 2 - 1);

        if (sx < -1.5 || sx > 1.5 || sy < -1.5 || sy > 1.5) continue;

        const c = this._gridColor[idx];
        positions[drawCount * 3] = sx;
        positions[drawCount * 3 + 1] = sy;
        positions[drawCount * 3 + 2] = 0;
        colorsBuf[drawCount * 3] = ((c >> 16) & 0xff) / 255;
        colorsBuf[drawCount * 3 + 1] = ((c >> 8) & 0xff) / 255;
        colorsBuf[drawCount * 3 + 2] = (c & 0xff) / 255;
        drawCount++;
      }
    }

    this._geometry.attributes.position.needsUpdate = true;
    this._geometry.attributes.color.needsUpdate = true;
    this._geometry.setDrawRange(0, drawCount);

    ctx.renderer.setRenderTarget(fb.getActiveTarget());
    ctx.renderer.render(this._scene, this._camera);

    this._rotation = (this._rotation + this.rotSpeed / 5) % 360;
    if (this._rotation < 0) this._rotation += 360;
  }

  destroy() {
    if (this._geometry) this._geometry.dispose();
    if (this._material) this._material.dispose();
  }
}

AvsComponent.register('DotPlane', DotPlane);
