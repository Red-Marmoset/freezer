// AVS SuperScope component — per-point code rendering (dots/lines)
// The core visualization component of AVS.
import * as THREE from 'https://esm.sh/three@0.171.0';
import { Line2 } from 'https://esm.sh/three@0.171.0/addons/lines/Line2.js';
import { LineMaterial } from 'https://esm.sh/three@0.171.0/addons/lines/LineMaterial.js';
import { LineGeometry } from 'https://esm.sh/three@0.171.0/addons/lines/LineGeometry.js';
import { AvsComponent } from '../avs-component.js';
import { compileEEL, createState } from '../eel/nseel-compiler.js';
import { createStdlib } from '../eel/nseel-stdlib.js';

const MAX_POINTS = 4096;

export class SuperScope extends AvsComponent {
  constructor(opts) {
    super(opts);

    const code = opts.code || {};
    this.initFn = compileEEL(code.init || '');
    this.perFrameFn = compileEEL(code.perFrame || '');
    this.onBeatFn = compileEEL(code.onBeat || '');
    this.perPointFn = compileEEL(code.perPoint || '');

    this.audioSource = (opts.audioSource || 'WAVEFORM').toUpperCase();
    this.audioChannel = (opts.audioChannel || 'CENTER').toUpperCase();
    this.drawMode = (opts.drawMode || 'LINES').toUpperCase();
    this.thickness = opts.thickness || 1;

    // Color cycling
    this.colors = (opts.colors || ['#ffffff']).map(parseHexColor);
    this.cycleSpeed = opts.cycleSpeed || 0.01;
    this.colorPos = 0;

    // State
    this.state = null;
    this.firstFrame = true;

    // Three.js objects
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

    // Allocate geometry with max points
    this._geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(MAX_POINTS * 3);
    const colors = new Float32Array(MAX_POINTS * 3);
    this._geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this._geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this._geometry.setDrawRange(0, 0);

    this._updateDrawMode();
    this.firstFrame = true;
  }

  _updateDrawMode() {
    // Clean up old mesh
    if (this._mesh) {
      this._scene.remove(this._mesh);
      if (this._material) this._material.dispose();
    }
    if (this._lineGeometry) {
      this._lineGeometry.dispose();
      this._lineGeometry = null;
    }

    this._useLine2 = false;

    if (this.drawMode === 'DOTS') {
      this._material = new THREE.PointsMaterial({
        size: Math.max(2, this.thickness * 2),
        vertexColors: true,
        sizeAttenuation: false,
      });
      this._mesh = new THREE.Points(this._geometry, this._material);
    } else if (this.thickness > 1) {
      // Use Line2 for thick lines (WebGL ignores linewidth on LineBasicMaterial)
      this._lineGeometry = new LineGeometry();
      this._material = new LineMaterial({
        color: 0xffffff,
        linewidth: this.thickness,
        vertexColors: true,
        resolution: new THREE.Vector2(800, 600),
        dashed: false,
      });
      this._mesh = new Line2(this._lineGeometry, this._material);
      this._useLine2 = true;
    } else {
      this._material = new THREE.LineBasicMaterial({
        vertexColors: true,
      });
      this._mesh = new THREE.Line(this._geometry, this._material);
    }

    this._material.depthTest = false;
    this._scene.add(this._mesh);
  }

  render(ctx, fb) {
    if (!this.enabled || !this.state) return;

    const s = this.state;
    const audioData = ctx.audioData;
    const waveform = audioData.waveform;
    const spectrum = audioData.spectrum;
    const fftSize = audioData.fftSize || 2048;
    const sampleCount = fftSize / 2;

    // Build stdlib with current audio data
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

    // Get current color from cycling palette
    const color = this._getCurrentColor();

    // Choose audio source
    const source = this.audioSource === 'SPECTRUM' ? spectrum : waveform;

    // Get geometry buffers
    const positions = this._geometry.attributes.position.array;
    const colorsBuf = this._geometry.attributes.color.array;

    let drawCount = 0;

    for (let i = 0; i < n; i++) {
      // Set per-point variables
      s.i = n > 1 ? i / (n - 1) : 0;

      // Sample audio — bucket the data into n samples
      const sampleIdx = Math.floor(s.i * (sampleCount - 1));
      if (this.audioSource === 'SPECTRUM') {
        s.v = spectrum ? Math.max(0, (spectrum[sampleIdx] + 100) / 100) : 0;
      } else {
        s.v = waveform ? (waveform[sampleIdx] - 128) / 128 : 0;
      }

      // Set initial color from palette (can be overridden by perPoint code)
      s.red = color[0];
      s.green = color[1];
      s.blue = color[2];
      s.skip = 0;
      s.linesize = this.thickness;

      // Run perPoint code
      try { this.perPointFn(s, lib); } catch {}

      // Check skip
      if (s.skip >= 0.00001) continue;

      // Collect vertex — don't clamp, let points go off-screen like real AVS
      const x = s.x || 0;
      const y = -(s.y || 0); // Y inverted (AVS convention)

      positions[drawCount * 3] = x;
      positions[drawCount * 3 + 1] = y;
      positions[drawCount * 3 + 2] = 0;

      colorsBuf[drawCount * 3] = Math.max(0, Math.min(1, s.red || 0));
      colorsBuf[drawCount * 3 + 1] = Math.max(0, Math.min(1, s.green || 0));
      colorsBuf[drawCount * 3 + 2] = Math.max(0, Math.min(1, s.blue || 0));

      drawCount++;
    }

    // Check if drawmode was changed by code
    const newMode = (s.drawmode !== undefined && s.drawmode > 0) ? 'LINES' :
                    (s.drawmode !== undefined && s.drawmode === 0) ? 'DOTS' : this.drawMode;
    if (newMode !== this.drawMode) {
      this.drawMode = newMode;
      this._updateDrawMode();
    }

    // Update thickness from EEL linesize variable
    const ls = s.linesize || this.thickness;
    if (this.drawMode === 'DOTS' && this._material.size !== undefined) {
      this._material.size = Math.max(2, ls * 2);
    }

    if (this._useLine2 && drawCount >= 2) {
      // Line2 needs flat arrays of positions and colors
      const posArr = new Float32Array(drawCount * 3);
      const colArr = new Float32Array(drawCount * 3);
      for (let i = 0; i < drawCount * 3; i++) {
        posArr[i] = positions[i];
        colArr[i] = colorsBuf[i];
      }
      this._lineGeometry.setPositions(posArr);
      this._lineGeometry.setColors(colArr);
      this._material.linewidth = ls;
      this._material.resolution.set(ctx.width, ctx.height);
    } else {
      // Standard geometry update
      this._geometry.attributes.position.needsUpdate = true;
      this._geometry.attributes.color.needsUpdate = true;
      this._geometry.setDrawRange(0, drawCount);
    }

    // Render onto the active framebuffer (autoClear disabled by engine)
    ctx.renderer.setRenderTarget(fb.getActiveTarget());
    ctx.renderer.render(this._scene, this._camera);
  }

  _getCurrentColor() {
    if (this.colors.length === 0) return [1, 1, 1];
    if (this.colors.length === 1) return this.colors[0];

    // Cycle through colors
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
    this._scene = null;
    this._camera = null;
  }
}

function parseHexColor(hex) {
  if (typeof hex === 'string' && hex[0] === '#') hex = hex.slice(1);
  const n = parseInt(hex, 16);
  return [(n >> 16 & 0xff) / 255, (n >> 8 & 0xff) / 255, (n & 0xff) / 255];
}

AvsComponent.register('SuperScope', SuperScope);
