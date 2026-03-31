// AVS Text — text overlay rendering
// Port of r_text.cpp: renders text strings onto the visualization.
// Uses Canvas 2D to render text into a texture, then composites onto
// the framebuffer via Three.js (equivalent to original GDI approach).
//
// Features: color, outline, shadow, blend modes, word cycling,
// beat-synced or timed word changes, position/alignment, random position.

import * as THREE from 'https://esm.sh/three@0.171.0';
import { AvsComponent } from '../avs-component.js';

const VERT = `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

const FRAG_REPLACE = `
  precision mediump float;
  uniform sampler2D tSource;
  uniform sampler2D tText;
  uniform vec3 uClipColor;
  varying vec2 vUv;
  void main() {
    vec4 src = texture2D(tSource, vUv);
    vec4 txt = texture2D(tText, vUv);
    // Skip pixels that match the clip color (transparent background)
    float diff = length(txt.rgb - uClipColor);
    if (diff < 0.02) {
      gl_FragColor = src;
    } else {
      gl_FragColor = vec4(txt.rgb, 1.0);
    }
  }
`;

const FRAG_BLEND = `
  precision mediump float;
  uniform sampler2D tSource;
  uniform sampler2D tText;
  uniform vec3 uClipColor;
  varying vec2 vUv;
  void main() {
    vec4 src = texture2D(tSource, vUv);
    vec4 txt = texture2D(tText, vUv);
    float diff = length(txt.rgb - uClipColor);
    if (diff < 0.02) {
      gl_FragColor = src;
    } else {
      gl_FragColor = vec4(min(src.rgb + txt.rgb, 1.0), 1.0);
    }
  }
`;

const FRAG_5050 = `
  precision mediump float;
  uniform sampler2D tSource;
  uniform sampler2D tText;
  uniform vec3 uClipColor;
  varying vec2 vUv;
  void main() {
    vec4 src = texture2D(tSource, vUv);
    vec4 txt = texture2D(tText, vUv);
    float diff = length(txt.rgb - uClipColor);
    if (diff < 0.02) {
      gl_FragColor = src;
    } else {
      gl_FragColor = vec4((src.rgb + txt.rgb) * 0.5, 1.0);
    }
  }
`;

export class TextComponent extends AvsComponent {
  constructor(opts) {
    super(opts);
    this.text = opts.text !== undefined ? opts.text : 'AVS';
    this.color = opts.color || '#ffffff';
    this.outlineColor = opts.outlineColor || '#000000';
    this.outline = opts.outline || false;
    this.shadow = opts.shadow || false;
    this.outlineSize = opts.outlineSize || 2;
    this.blend = opts.blend || 0; // 0=replace, 1=additive, 2=50/50
    this.onBeat = opts.onBeat || opts.onbeat || false;
    this.normSpeed = opts.normSpeed || 15;  // frames between word changes
    this.onBeatSpeed = opts.onBeatSpeed || opts.onbeatSpeed || 15;
    // halign/valign: parser gives numeric (0=left/top, 1=center, 2=right/bottom)
    const HA = ['left', 'center', 'right'];
    const VA = ['top', 'center', 'bottom'];
    this.halign = typeof opts.halign === 'number' ? (HA[opts.halign] || 'center') : (opts.halign || 'center');
    this.valign = typeof opts.valign === 'number' ? (VA[opts.valign] || 'center') : (opts.valign || 'center');
    this.xShift = opts.xShift ?? opts.xshift ?? 0; // 0-100 percent
    this.yShift = opts.yShift ?? opts.yshift ?? 0;
    this.randomPos = opts.randomPos || false;
    this.randomWord = opts.randomWord || false;
    this.insertBlank = opts.insertBlank || false;
    this.fontSize = opts.fontSize || opts.fontHeight || 24;
    this.fontName = opts.fontName || 'Arial';
    this.bold = opts.bold !== undefined ? opts.bold : true;
    this.italic = opts.italic || false;

    this._canvas = null;
    this._ctx2d = null;
    this._texture = null;
    this._scene = null;
    this._camera = null;
    this._material = null;
    this._curWord = 0;
    this._frameCount = 0;
    this._nb = 0;
    this._oddEven = 0;
    this._needsRedraw = true;
    this._lastW = 0;
    this._lastH = 0;
    this._xShift = this.xShift;
    this._yShift = this.yShift;
  }

  init(ctx) {
    this._canvas = document.createElement('canvas');
    this._canvas.width = ctx.width;
    this._canvas.height = ctx.height;
    this._ctx2d = this._canvas.getContext('2d');

    this._texture = new THREE.CanvasTexture(this._canvas);
    this._texture.minFilter = THREE.LinearFilter;
    this._texture.magFilter = THREE.LinearFilter;

    this._scene = new THREE.Scene();
    this._camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    const frag = this.blend === 1 ? FRAG_BLEND : this.blend === 2 ? FRAG_5050 : FRAG_REPLACE;

    this._material = new THREE.ShaderMaterial({
      uniforms: {
        tSource: { value: null },
        tText: { value: this._texture },
        uClipColor: { value: new THREE.Vector3(0, 0, 0) },
      },
      vertexShader: VERT,
      fragmentShader: frag,
      depthTest: false,
    });
    this._scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this._material));
    this._needsRedraw = true;
    this._curWord = 0;
    this._frameCount = 0;
  }

  render(ctx, fb) {
    if (!this.enabled || !this._ctx2d) return;

    const w = ctx.width;
    const h = ctx.height;
    const isBeat = ctx.beat;

    // Resize canvas if needed
    if (w !== this._lastW || h !== this._lastH) {
      this._canvas.width = w;
      this._canvas.height = h;
      this._lastW = w;
      this._lastH = h;
      this._needsRedraw = true;
    }

    this._frameCount++;

    // Word cycling
    const words = this._getWords();
    if (words.length > 0) {
      const shouldAdvance = (!this.onBeat && this._frameCount >= this.normSpeed) ||
                            (this.onBeat && isBeat && !this._nb);

      if (shouldAdvance) {
        this._frameCount = 0;
        if (this.randomWord) {
          this._curWord = Math.floor(Math.random() * words.length);
        } else {
          this._curWord = (this._curWord + 1) % words.length;
        }
        this._oddEven = (this._oddEven + 1) % 2;

        if (this.randomPos) {
          this._xShift = Math.floor(Math.random() * 80);
          this._yShift = Math.floor(Math.random() * 80);
        }

        this._needsRedraw = true;
      }

      if (this.onBeat && isBeat && !this._nb) {
        this._nb = this.onBeatSpeed;
      }
    }

    if (this._nb > 0) this._nb--;

    // Get current word
    let displayText = '';
    if (words.length > 0) {
      if (this.insertBlank && this._oddEven === 0) {
        displayText = '';
      } else {
        displayText = words[this._curWord % words.length] || '';
      }
    } else {
      displayText = this.text;
    }

    // Skip rendering entirely when there's nothing to display
    if (!displayText) return;

    // Redraw text buffer if needed
    if (this._needsRedraw) {
      this._drawText(displayText, w, h);
      this._texture.needsUpdate = true;
      this._needsRedraw = false;
    }

    // Composite text over framebuffer
    this._material.uniforms.tSource.value = fb.getActiveTexture();
    this._material.uniforms.tText.value = this._texture;
    ctx.renderer.setRenderTarget(fb.getBackTarget());
    ctx.renderer.render(this._scene, this._camera);
    this._material.uniforms.tSource.value = null;
    fb.swap();
  }

  _getWords() {
    if (!this.text) return [];
    return this.text.split(';').map(s => s.trim()).filter(s => s.length > 0);
  }

  _drawText(text, w, h) {
    const c = this._ctx2d;

    // Clear with clip color (black)
    c.fillStyle = '#000000';
    c.fillRect(0, 0, w, h);

    if (!text) return;

    // Set font
    const style = (this.italic ? 'italic ' : '') + (this.bold ? 'bold ' : '');
    const size = Math.max(8, Math.round(this.fontSize * (h / 480))); // scale with height
    c.font = `${style}${size}px "${this.fontName}", Arial, sans-serif`;

    // Compute position
    c.textBaseline = 'top';
    const metrics = c.measureText(text);
    const textW = metrics.width;
    const textH = size * 1.2;

    let x, y;
    // Horizontal
    if (this.halign === 'left') x = 0;
    else if (this.halign === 'right') x = w - textW;
    else x = (w - textW) / 2;

    // Vertical
    if (this.valign === 'top') y = 0;
    else if (this.valign === 'bottom') y = h - textH;
    else y = (h - textH) / 2;

    // Apply shift
    x += (this._xShift / 100) * w;
    y += (this._yShift / 100) * h;

    // Draw outline (8 directions like original)
    if (this.outline) {
      c.fillStyle = this.outlineColor;
      const os = this.outlineSize;
      for (const [dx, dy] of [[-os, -os], [0, -os], [os, -os], [-os, 0], [os, 0], [-os, os], [0, os], [os, os]]) {
        c.fillText(text, x + dx, y + dy);
      }
    }

    // Draw shadow
    if (this.shadow && !this.outline) {
      c.fillStyle = this.outlineColor;
      c.fillText(text, x + this.outlineSize, y + this.outlineSize);
    }

    // Draw main text
    c.fillStyle = this.color;
    c.fillText(text, x, y);
  }

  destroy() {
    if (this._texture) this._texture.dispose();
    if (this._material) this._material.dispose();
  }
}

AvsComponent.register('Text', TextComponent);
