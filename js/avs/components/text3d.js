// Text3D — 3D text with per-character EEL code
//
// Renders text as individual characters in 3D space. Each character's
// position, rotation, scale, and color can be controlled by EEL code.
//
// Code sections:
//   init:    runs once (set n, text vars)
//   perFrame: runs once per frame (animate global state)
//   onBeat:  runs on beat detection
//   perChar: runs for each character, receives:
//     i     - character index (0 to n-1, normalized 0..1)
//     n     - total character count
//     ch    - character code (ASCII)
//     v     - audio value at this character's position
//     x,y,z - output 3D position (-1..1 NDC, z=depth)
//     rx,ry,rz - rotation in radians
//     sx,sy - scale (1.0 = normal)
//     red,green,blue - color (0..1)
//     alpha - opacity (0..1)
//     skip  - set nonzero to hide this character

import * as THREE from 'https://esm.sh/three@0.171.0';
import { AvsComponent } from '../avs-component.js';
import { compileEEL, createState } from '../eel/nseel-compiler.js';
import { createStdlib } from '../eel/nseel-stdlib.js';

const MAX_CHARS = 256;

const VERT = `
  attribute float aAlpha;
  attribute vec3 aColor;
  varying vec2 vUv;
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vUv = uv;
    vAlpha = aAlpha;
    vColor = aColor;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAG = `
  precision mediump float;
  uniform sampler2D tGlyphs;
  uniform float uGlyphCols;
  uniform float uGlyphRows;
  varying vec2 vUv;
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vec4 glyph = texture2D(tGlyphs, vUv);
    float a = glyph.a * vAlpha;
    if (a < 0.01) discard;
    gl_FragColor = vec4(vColor * glyph.rgb, a);
  }
`;

export class Text3D extends AvsComponent {
  constructor(opts) {
    super(opts);
    this.text = opts.text || 'FREEZER';
    this.fontName = opts.fontName || 'Orbitron';
    this.fontSize = opts.fontSize || 48;
    this.bold = opts.bold !== undefined ? opts.bold : true;

    const code = opts.code || {};
    this.initFn = compileEEL(code.init || '');
    this.perFrameFn = compileEEL(code.perFrame || '');
    this.onBeatFn = compileEEL(code.onBeat || '');
    this.perCharFn = compileEEL(code.perChar || '');

    this.state = null;
    this.firstFrame = true;
    this._scene = null;
    this._camera = null;
    this._glyphCanvas = null;
    this._glyphTexture = null;
    this._charMeshes = [];
    this._glyphCols = 16;
    this._glyphRows = 8;
    this._charW = 0;
    this._charH = 0;
  }

  init(ctx) {
    this.state = createState(ctx.globalRegisters, ctx.globalMegabuf);
    this._scene = new THREE.Scene();
    this._camera = new THREE.PerspectiveCamera(45, ctx.width / ctx.height, 0.1, 100);
    this._camera.position.z = 3;

    // Build glyph atlas: 16x8 grid of ASCII chars 32-159
    this._buildGlyphAtlas();

    // Pre-create character meshes (reused each frame)
    const geo = new THREE.PlaneGeometry(1, 1);
    for (let i = 0; i < MAX_CHARS; i++) {
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          tGlyphs: { value: this._glyphTexture },
          uGlyphCols: { value: this._glyphCols },
          uGlyphRows: { value: this._glyphRows },
        },
        vertexShader: VERT,
        fragmentShader: FRAG,
        depthTest: false,
        transparent: true,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geo.clone(), mat);
      mesh.visible = false;

      // Per-vertex attributes for color and alpha
      const alphaAttr = new THREE.BufferAttribute(new Float32Array(4).fill(1), 1);
      const colorAttr = new THREE.BufferAttribute(new Float32Array(12).fill(1), 3);
      mesh.geometry.setAttribute('aAlpha', alphaAttr);
      mesh.geometry.setAttribute('aColor', colorAttr);

      this._charMeshes.push(mesh);
      this._scene.add(mesh);
    }

    this.firstFrame = true;
  }

  _buildGlyphAtlas() {
    const cols = this._glyphCols;
    const rows = this._glyphRows;
    const cellW = 64;
    const cellH = 64;
    const canvas = document.createElement('canvas');
    canvas.width = cols * cellW;
    canvas.height = rows * cellH;
    const c = canvas.getContext('2d');

    c.fillStyle = '#000000';
    c.fillRect(0, 0, canvas.width, canvas.height);

    const style = (this.bold ? 'bold ' : '');
    c.font = `${style}${this.fontSize}px "${this.fontName}", Orbitron, Arial, sans-serif`;
    c.textBaseline = 'middle';
    c.textAlign = 'center';
    c.fillStyle = '#ffffff';

    for (let i = 0; i < cols * rows; i++) {
      const ch = String.fromCharCode(32 + i);
      const col = i % cols;
      const row = Math.floor(i / cols);
      c.fillText(ch, col * cellW + cellW / 2, row * cellH + cellH / 2);
    }

    this._charW = cellW;
    this._charH = cellH;
    this._glyphCanvas = canvas;
    this._glyphTexture = new THREE.CanvasTexture(canvas);
    this._glyphTexture.minFilter = THREE.LinearFilter;
    this._glyphTexture.magFilter = THREE.LinearFilter;
  }

  render(ctx, fb) {
    if (!this.enabled) return;

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
    s.time = ctx.time;

    if (this.firstFrame) {
      try { this.initFn(s, lib); } catch {}
      this.firstFrame = false;
    }

    try { this.perFrameFn(s, lib); } catch {}
    if (ctx.beat) { try { this.onBeatFn(s, lib); } catch {} }

    // Update camera aspect
    this._camera.aspect = ctx.width / ctx.height;
    this._camera.updateProjectionMatrix();

    const text = this.text;
    const n = Math.min(text.length, MAX_CHARS);
    const cols = this._glyphCols;
    const rows = this._glyphRows;

    // Run perChar for each character
    for (let i = 0; i < MAX_CHARS; i++) {
      const mesh = this._charMeshes[i];
      if (i >= n) {
        mesh.visible = false;
        continue;
      }

      const charCode = text.charCodeAt(i);
      const ni = n > 1 ? i / (n - 1) : 0;

      // Set per-char variables
      s.i = ni;
      s.n = n;
      s.ch = charCode;
      // Audio value at this character's position
      const waveform = ctx.audioData.waveform;
      const wi = waveform ? Math.floor(ni * (waveform.length - 1)) : 0;
      s.v = waveform ? (waveform[wi] - 128) / 128 : 0;

      // Default outputs
      s.x = (ni * 2 - 1) * 0.8; // spread across screen
      s.y = 0;
      s.z = 0;
      s.rx = 0;
      s.ry = 0;
      s.rz = 0;
      s.sx = 1;
      s.sy = 1;
      s.red = 1;
      s.green = 1;
      s.blue = 1;
      s.alpha = 1;
      s.skip = 0;

      try { this.perCharFn(s, lib); } catch {}

      if (s.skip > 0.00001) {
        mesh.visible = false;
        continue;
      }

      mesh.visible = true;

      // Position
      mesh.position.set(s.x, -s.y, s.z);

      // Rotation
      mesh.rotation.set(s.rx, s.ry, s.rz);

      // Scale — character aspect ratio
      const aspect = 0.6; // approximate character width/height ratio
      mesh.scale.set(s.sx * aspect * 0.15, s.sy * 0.15, 1);

      // UV mapping for this character's glyph in the atlas
      const glyphIdx = Math.max(0, charCode - 32);
      const col = glyphIdx % cols;
      const row = Math.floor(glyphIdx / cols);
      if (row < rows) {
        const u0 = col / cols;
        const v0 = 1 - (row + 1) / rows;
        const u1 = (col + 1) / cols;
        const v1 = 1 - row / rows;
        const uvAttr = mesh.geometry.attributes.uv;
        uvAttr.setXY(0, u0, v1); // top-left
        uvAttr.setXY(1, u1, v1); // top-right
        uvAttr.setXY(2, u0, v0); // bottom-left
        uvAttr.setXY(3, u1, v0); // bottom-right
        uvAttr.needsUpdate = true;
      }

      // Color + alpha
      const alphaAttr = mesh.geometry.attributes.aAlpha;
      const colorAttr = mesh.geometry.attributes.aColor;
      for (let v = 0; v < 4; v++) {
        alphaAttr.setX(v, Math.max(0, Math.min(1, s.alpha)));
        colorAttr.setXYZ(v, s.red, s.green, s.blue);
      }
      alphaAttr.needsUpdate = true;
      colorAttr.needsUpdate = true;
    }

    // Render to framebuffer
    ctx.renderer.setRenderTarget(fb.getActiveTarget());
    ctx.renderer.render(this._scene, this._camera);
  }

  destroy() {
    for (const mesh of this._charMeshes) {
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    if (this._glyphTexture) this._glyphTexture.dispose();
  }
}

AvsComponent.register('Text3D', Text3D);
