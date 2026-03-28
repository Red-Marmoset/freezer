// AVS BufferSave component (code 0x12) — save/restore framebuffer to numbered slots
// 8 save buffers. Actions: 0=save, 1=restore, 2=restore alternating lines.
import * as THREE from 'https://esm.sh/three@0.171.0';
import { AvsComponent } from '../avs-component.js';
import { blendTexture, BLEND, parseBlendMode } from '../blend.js';

const NUM_BUFFERS = 8;

const VERT_SHADER = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Fragment shader for alternating-line restore (action == 2):
// Even lines come from the saved buffer, odd lines from the active framebuffer.
const ALTERNATING_FRAG = `
  uniform sampler2D tBuffer;
  uniform sampler2D tActive;
  uniform float uHeight;
  varying vec2 vUv;

  void main() {
    float line = floor(vUv.y * uHeight);
    bool even = mod(line, 2.0) < 1.0;
    if (even) {
      gl_FragColor = texture2D(tBuffer, vUv);
    } else {
      gl_FragColor = texture2D(tActive, vUv);
    }
  }
`;

export class BufferSave extends AvsComponent {
  constructor(opts) {
    super(opts);
    this.action = opts.action || 0;           // 0=save, 1=restore, 2=restore alternating
    this.bufferIndex = opts.buffer || 0;       // 0-7
    this.blendMode = parseBlendMode(opts.blendMode || 0);
    this.adjustBlend = (opts.adjustBlend || 128) / 255; // normalize 0-255 to 0-1

    this._altScene = null;
    this._altCamera = null;
    this._altMaterial = null;

    // Copy helper (for save action)
    this._copyScene = null;
    this._copyCamera = null;
    this._copyMaterial = null;
  }

  init(ctx) {
    // Ensure save buffers exist on the engine context (lazy init)
    if (!ctx.saveBuffers) {
      ctx.saveBuffers = new Array(NUM_BUFFERS).fill(null);
    }

    // Copy helper for save operations
    this._copyScene = new THREE.Scene();
    this._copyCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this._copyMaterial = new THREE.MeshBasicMaterial({ map: null, depthTest: false });
    this._copyScene.add(new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      this._copyMaterial
    ));

    // Alternating lines helper
    this._altScene = new THREE.Scene();
    this._altCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this._altMaterial = new THREE.ShaderMaterial({
      uniforms: {
        tBuffer: { value: null },
        tActive: { value: null },
        uHeight: { value: ctx.height },
      },
      vertexShader: VERT_SHADER,
      fragmentShader: ALTERNATING_FRAG,
      depthTest: false,
    });
    this._altScene.add(new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      this._altMaterial
    ));
  }

  _ensureBuffer(ctx, index) {
    if (!ctx.saveBuffers) {
      ctx.saveBuffers = new Array(NUM_BUFFERS).fill(null);
    }
    if (!ctx.saveBuffers[index]) {
      ctx.saveBuffers[index] = new THREE.WebGLRenderTarget(ctx.width, ctx.height, {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        format: THREE.RGBAFormat,
        type: THREE.UnsignedByteType,
      });
    }
    return ctx.saveBuffers[index];
  }

  render(ctx, fb) {
    if (!this.enabled) return;

    const idx = Math.max(0, Math.min(NUM_BUFFERS - 1, this.bufferIndex));

    if (this.action === 0) {
      // SAVE: copy active FB texture to buffer[index]
      const buf = this._ensureBuffer(ctx, idx);
      this._copyMaterial.map = fb.getActiveTexture();
      ctx.renderer.setRenderTarget(buf);
      ctx.renderer.render(this._copyScene, this._copyCamera);
    } else if (this.action === 1) {
      // RESTORE: blend buffer[index] onto active FB
      const buf = this._ensureBuffer(ctx, idx);
      if (!buf) return;
      const mode = this.blendMode || BLEND.REPLACE;
      blendTexture(ctx.renderer, buf.texture, fb.getActiveTarget(), mode, this.adjustBlend);
    } else if (this.action === 2) {
      // RESTORE ALTERNATING: even lines from buffer, odd lines from active
      const buf = this._ensureBuffer(ctx, idx);
      if (!buf) return;

      this._altMaterial.uniforms.tBuffer.value = buf.texture;
      this._altMaterial.uniforms.tActive.value = fb.getActiveTexture();
      this._altMaterial.uniforms.uHeight.value = ctx.height;

      // Write to back, then swap
      ctx.renderer.setRenderTarget(fb.getBackTarget());
      ctx.renderer.render(this._altScene, this._altCamera);
      fb.swap();
    }
  }

  destroy() {
    if (this._copyMaterial) this._copyMaterial.dispose();
    if (this._altMaterial) this._altMaterial.dispose();
    // Note: save buffers are owned by the engine context, not disposed here
  }
}

AvsComponent.register('BufferSave', BufferSave);
