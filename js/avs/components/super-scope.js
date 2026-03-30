// AVS SuperScope component — per-point code rendering (dots/lines)
// The core visualization component of AVS.
import * as THREE from 'https://esm.sh/three@0.171.0';
import { AvsComponent } from '../avs-component.js';
import { compileEEL, createState } from '../eel/nseel-compiler.js';
import { createStdlib } from '../eel/nseel-stdlib.js';

const MAX_POINTS = 4096;

// Map AVS line blend mode index to GL blend config
// These match the SetRenderMode blend indices from r_linemode.cpp
function getLineBlendGL(gl, blendIdx) {
  switch (blendIdx) {
    case 0: return null; // Replace — no blending
    case 1: return { eq: gl.FUNC_ADD, src: gl.ONE, dst: gl.ONE }; // Additive
    case 2: if (!gl.MAX) console.warn('gl.MAX not available — Maximum blend unsupported'); return gl.MAX ? { eq: gl.MAX, src: gl.ONE, dst: gl.ONE } : null; // Maximum
    case 3: return { eq: gl.FUNC_ADD, src: gl.CONSTANT_COLOR, dst: gl.CONSTANT_COLOR, color: [0.5, 0.5, 0.5, 0.5] }; // 50/50
    case 4: return { eq: gl.FUNC_REVERSE_SUBTRACT, src: gl.ONE, dst: gl.ONE }; // Sub (dst-src)
    case 5: return { eq: gl.FUNC_SUBTRACT, src: gl.ONE, dst: gl.ONE }; // Sub (src-dst)
    case 6: return { eq: gl.FUNC_ADD, src: gl.DST_COLOR, dst: gl.ZERO }; // Multiply
    // 7 = Adjustable (needs alpha from renderMode)
    // 8 = XOR (not possible with GL blend)
    case 9: if (!gl.MIN) console.warn('gl.MIN not available — Minimum blend unsupported'); return gl.MIN ? { eq: gl.MIN, src: gl.ONE, dst: gl.ONE } : null; // Minimum
    default: return null;
  }
}

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

    // Thick line objects (separate from thin line/dots)
    this._thickGeo = null;
    this._thickMat = null;
    this._thickMesh = null;
  }

  init(ctx) {
    this.state = createState(ctx.globalRegisters, ctx.globalMegabuf);
    this._scene = new THREE.Scene();
    this._camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 10);
    this._camera.position.z = 1;

    // Allocate geometry with max points (for dots and thin lines)
    this._geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(MAX_POINTS * 3);
    const colors = new Float32Array(MAX_POINTS * 3);
    this._geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this._geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this._geometry.setDrawRange(0, 0);

    // Thick line geometry: triangle strip approach
    // Each line of N points produces (N-1) segments, each a quad = 4 verts, 6 indices
    // With shared edges at joins, we need 2*N verts and 6*(N-1) indices max
    const maxThickVerts = MAX_POINTS * 2;
    const maxThickIndices = (MAX_POINTS - 1) * 6;
    this._thickGeo = new THREE.BufferGeometry();
    const thickPos = new Float32Array(maxThickVerts * 3);
    const thickCol = new Float32Array(maxThickVerts * 3);
    const thickIdx = new Uint32Array(maxThickIndices);
    this._thickGeo.setAttribute('position', new THREE.BufferAttribute(thickPos, 3));
    this._thickGeo.setAttribute('color', new THREE.BufferAttribute(thickCol, 3));
    this._thickGeo.setIndex(new THREE.BufferAttribute(thickIdx, 1));
    this._thickGeo.setDrawRange(0, 0);

    this._thickMat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
      depthTest: false,
    });
    this._thickMesh = new THREE.Mesh(this._thickGeo, this._thickMat);
    // Don't add to scene yet — _updateDrawMode will decide

    this._updateDrawMode();
    this.firstFrame = true;
  }

  _updateDrawMode() {
    // Clean up old mesh from scene
    if (this._mesh) this._scene.remove(this._mesh);
    if (this._thickMesh) this._scene.remove(this._thickMesh);

    if (this.drawMode === 'DOTS') {
      this._material = new THREE.PointsMaterial({
        size: 1,
        vertexColors: true,
        sizeAttenuation: false,
      });
      this._mesh = new THREE.Points(this._geometry, this._material);
      this._material.depthTest = false;
      this._scene.add(this._mesh);
      this._useThickLines = false;
    } else if (this.thickness > 1) {
      // Thick lines: use triangle mesh
      this._scene.add(this._thickMesh);
      this._useThickLines = true;
    } else {
      // Thin lines (1px): use standard THREE.Line
      this._material = new THREE.LineBasicMaterial({
        vertexColors: true,
      });
      this._mesh = new THREE.Line(this._geometry, this._material);
      this._material.depthTest = false;
      this._scene.add(this._mesh);
      this._useThickLines = false;
    }
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

    // Initialize linesize from global render mode (SetRenderMode component)
    // This is set ONCE per frame before any code runs (matching original AVS)
    if (ctx.renderMode && ctx.renderMode.enabled && ctx.renderMode.lineSize > 0) {
      s.linesize = ctx.renderMode.lineSize;
    } else {
      s.linesize = this.thickness;
    }

    // Run init on first frame
    if (this.firstFrame) {
      try { this.initFn(s, lib); } catch {}
      this.firstFrame = false;
    }

    // Run perFrame (can modify linesize, drawmode, n, etc.)
    try { this.perFrameFn(s, lib); } catch {}

    // Run onBeat
    if (ctx.beat) {
      try { this.onBeatFn(s, lib); } catch {}
    }

    // Read back linesize/drawmode AFTER frame code runs but BEFORE point loop
    // (these are frame-level settings, not per-point)
    const frameLinesize = Math.max(1, Math.round(s.linesize || 1));
    if (frameLinesize !== this.thickness) {
      this.thickness = frameLinesize;
      this._updateDrawMode();
    }

    // drawmode: < 0.00001 = dots, >= 0.00001 = lines (matching original AVS)
    const newDrawMode = (s.drawmode || 0) < 0.00001 ? 'DOTS' : 'LINES';
    if (s._dirty.has('drawmode') && newDrawMode !== this.drawMode) {
      this.drawMode = newDrawMode;
      this._updateDrawMode();
    }

    // Get point count — n=0 is valid (camera-only SuperScope, sets registers only)
    const n = Math.max(0, Math.min(MAX_POINTS, Math.floor(s.n !== undefined ? s.n : 100)));

    // If n=0, this is a camera/register-only SuperScope — no rendering needed
    if (n === 0) return;

    // Get current color from cycling palette
    const color = this._getCurrentColor();

    // Choose audio source
    const source = this.audioSource === 'SPECTRUM' ? spectrum : waveform;

    // Collect all points first into temp arrays
    const pointsX = [];
    const pointsY = [];
    const pointsR = [];
    const pointsG = [];
    const pointsB = [];

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

      // Run perPoint code
      try { this.perPointFn(s, lib); } catch {}

      // Check skip
      if (s.skip >= 0.00001) continue;

      // Collect vertex — don't clamp, let points go off-screen like real AVS
      pointsX.push(s.x || 0);
      pointsY.push(-(s.y || 0)); // Y inverted (AVS convention)
      pointsR.push(Math.max(0, Math.min(1, s.red || 0)));
      pointsG.push(Math.max(0, Math.min(1, s.green || 0)));
      pointsB.push(Math.max(0, Math.min(1, s.blue || 0)));
    }

    const drawCount = pointsX.length;

    // Render based on mode
    if (this._useThickLines && drawCount >= 2) {
      this._renderThickLines(ctx, fb, pointsX, pointsY, pointsR, pointsG, pointsB, drawCount);
    } else {
      // Standard geometry update for dots or thin lines
      const positions = this._geometry.attributes.position.array;
      const colorsBuf = this._geometry.attributes.color.array;
      for (let i = 0; i < drawCount; i++) {
        positions[i * 3] = pointsX[i];
        positions[i * 3 + 1] = pointsY[i];
        positions[i * 3 + 2] = 0;
        colorsBuf[i * 3] = pointsR[i];
        colorsBuf[i * 3 + 1] = pointsG[i];
        colorsBuf[i * 3 + 2] = pointsB[i];
      }
      this._geometry.attributes.position.needsUpdate = true;
      this._geometry.attributes.color.needsUpdate = true;
      this._geometry.setDrawRange(0, drawCount);

      // Render onto the active framebuffer with line blend mode
      ctx.renderer.setRenderTarget(fb.getActiveTarget());
      this._applyLineBlend(ctx);
      ctx.renderer.render(this._scene, this._camera);
      this._restoreBlend(ctx);
    }
  }

  _applyLineBlend(ctx) {
    if (!ctx.renderMode || !ctx.renderMode.enabled) return;
    const gl = ctx.renderer.getContext();
    const cfg = getLineBlendGL(gl, ctx.renderMode.blend);
    if (!cfg) return;
    gl.enable(gl.BLEND);
    gl.blendEquation(cfg.eq);
    gl.blendFunc(cfg.src, cfg.dst);
    if (cfg.color) gl.blendColor(...cfg.color);
    this._blendActive = true;
  }

  _restoreBlend(ctx) {
    if (!this._blendActive) return;
    const gl = ctx.renderer.getContext();
    gl.disable(gl.BLEND);
    ctx.renderer.resetState();
    this._blendActive = false;
  }

  /**
   * Build thick line geometry as a triangle strip with miter joins.
   * For N points, generates 2*N vertices (left/right offsets) and
   * 6*(N-1) indices (two triangles per segment).
   * At each interior vertex, the offset direction is the average of the
   * two adjacent segment normals (miter join), giving clean corners.
   */
  _renderThickLines(ctx, fb, px, py, pr, pg, pb, n) {
    const positions = this._thickGeo.attributes.position.array;
    const colors = this._thickGeo.attributes.color.array;
    const indices = this._thickGeo.index.array;

    // Half thickness in NDC
    const halfW = this.thickness / Math.min(ctx.width, ctx.height);

    let vi = 0; // vertex index
    let ii = 0; // index index

    for (let i = 0; i < n; i++) {
      // Compute the perpendicular offset direction at this point
      let nx = 0, ny = 0;

      if (n === 1) {
        // Single point — can't form a line
        nx = 0; ny = 1;
      } else if (i === 0) {
        // First point: use direction of first segment
        const dx = px[1] - px[0];
        const dy = py[1] - py[0];
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        nx = -dy / len;
        ny = dx / len;
      } else if (i === n - 1) {
        // Last point: use direction of last segment
        const dx = px[i] - px[i - 1];
        const dy = py[i] - py[i - 1];
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        nx = -dy / len;
        ny = dx / len;
      } else {
        // Interior point: miter join — average the normals of adjacent segments
        const dx1 = px[i] - px[i - 1];
        const dy1 = py[i] - py[i - 1];
        const len1 = Math.sqrt(dx1 * dx1 + dy1 * dy1) || 1;
        const nx1 = -dy1 / len1;
        const ny1 = dx1 / len1;

        const dx2 = px[i + 1] - px[i];
        const dy2 = py[i + 1] - py[i];
        const len2 = Math.sqrt(dx2 * dx2 + dy2 * dy2) || 1;
        const nx2 = -dy2 / len2;
        const ny2 = dx2 / len2;

        // Average normal for miter
        nx = (nx1 + nx2) * 0.5;
        ny = (ny1 + ny2) * 0.5;
        const miterLen = Math.sqrt(nx * nx + ny * ny) || 1;
        nx /= miterLen;
        ny /= miterLen;

        // Scale to maintain consistent width at the join (miter length correction)
        // dot = cos(angle between normals), miter scale = 1/dot
        const dot = nx1 * nx + ny1 * ny;
        if (dot > 0.1) {
          const miterScale = Math.min(1 / dot, 3); // cap to avoid spiky miters
          nx *= miterScale;
          ny *= miterScale;
        }
      }

      // Left vertex (vi*2) and right vertex (vi*2+1)
      const baseV = i * 2;
      const lx = px[i] + nx * halfW;
      const ly = py[i] + ny * halfW;
      const rx = px[i] - nx * halfW;
      const ry = py[i] - ny * halfW;

      positions[baseV * 3] = lx;
      positions[baseV * 3 + 1] = ly;
      positions[baseV * 3 + 2] = 0;

      positions[(baseV + 1) * 3] = rx;
      positions[(baseV + 1) * 3 + 1] = ry;
      positions[(baseV + 1) * 3 + 2] = 0;

      // Colors
      colors[baseV * 3] = pr[i];
      colors[baseV * 3 + 1] = pg[i];
      colors[baseV * 3 + 2] = pb[i];
      colors[(baseV + 1) * 3] = pr[i];
      colors[(baseV + 1) * 3 + 1] = pg[i];
      colors[(baseV + 1) * 3 + 2] = pb[i];

      // Add two triangles for the segment connecting point i-1 to point i
      if (i > 0) {
        const prev = (i - 1) * 2;
        const curr = i * 2;
        // Triangle 1: prev-left, prev-right, curr-left
        indices[ii++] = prev;
        indices[ii++] = prev + 1;
        indices[ii++] = curr;
        // Triangle 2: prev-right, curr-right, curr-left
        indices[ii++] = prev + 1;
        indices[ii++] = curr + 1;
        indices[ii++] = curr;
      }
    }

    this._thickGeo.attributes.position.needsUpdate = true;
    this._thickGeo.attributes.color.needsUpdate = true;
    this._thickGeo.index.needsUpdate = true;
    this._thickGeo.setDrawRange(0, ii);

    ctx.renderer.setRenderTarget(fb.getActiveTarget());
    this._applyLineBlend(ctx);
    ctx.renderer.render(this._scene, this._camera);
    this._restoreBlend(ctx);
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
    if (this._thickGeo) this._thickGeo.dispose();
    if (this._thickMat) this._thickMat.dispose();
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
