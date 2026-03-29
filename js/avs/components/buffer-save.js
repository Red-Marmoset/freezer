// AVS BufferSave component (code 0x12) — save/restore framebuffer to numbered slots
// 8 save buffers. Actions: 0=save, 1=restore, 2=alternating save/restore, 3=alternating restore/save
import * as THREE from 'https://esm.sh/three@0.171.0';
import { AvsComponent } from '../avs-component.js';
import { blendTexture, BLEND, parseBlendMode } from '../blend.js';

const NUM_BUFFERS = 8;

// BufferSave uses its own blend mode numbering (different from EffectList!)
const BUFSAVE_BLEND_MAP = {
  0: BLEND.REPLACE,
  1: BLEND.FIFTY_FIFTY,
  2: BLEND.ADDITIVE,
  3: BLEND.EVERY_OTHER_PIXEL,
  4: BLEND.SUB_DEST_SRC,
  5: BLEND.EVERY_OTHER_LINE,
  6: BLEND.XOR,
  7: BLEND.MAXIMUM,
  8: BLEND.MINIMUM,
  9: BLEND.SUB_SRC_DEST,
  10: BLEND.MULTIPLY,
  11: BLEND.ADJUSTABLE,
};

export class BufferSave extends AvsComponent {
  constructor(opts) {
    super(opts);
    // 0=save, 1=restore, 2=alternating save/restore, 3=alternating restore/save
    this.action = opts.action || 0;
    this.bufferIndex = opts.buffer || 0; // 0-7 (already converted from 1-8 by parser)

    // Map raw blend mode integer to our BLEND enum
    const rawBlend = opts.blendMode;
    if (typeof rawBlend === 'number' && BUFSAVE_BLEND_MAP[rawBlend] !== undefined) {
      this.blendMode = BUFSAVE_BLEND_MAP[rawBlend];
    } else {
      this.blendMode = parseBlendMode(rawBlend || 'REPLACE');
    }
    this.adjustBlend = (opts.adjustBlend || 128) / 255;

    // Frame toggle for alternating actions (2 and 3)
    this._toggle = false;

    this._copyScene = null;
    this._copyCamera = null;
    this._copyMaterial = null;
  }

  init(ctx) {
    if (!ctx.saveBuffers) {
      ctx.saveBuffers = new Array(NUM_BUFFERS).fill(null);
    }

    this._copyScene = new THREE.Scene();
    this._copyCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this._copyMaterial = new THREE.MeshBasicMaterial({ map: null, depthTest: false });
    this._copyScene.add(new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      this._copyMaterial
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
    } else if (ctx.saveBuffers[index].width !== ctx.width || ctx.saveBuffers[index].height !== ctx.height) {
      ctx.saveBuffers[index].setSize(ctx.width, ctx.height);
    }
    return ctx.saveBuffers[index];
  }

  _doSave(ctx, fb, idx) {
    const buf = this._ensureBuffer(ctx, idx);
    this._copyMaterial.map = fb.getActiveTexture();
    ctx.renderer.setRenderTarget(buf);
    ctx.renderer.render(this._copyScene, this._copyCamera);
    this._copyMaterial.map = null;
    ctx.renderer.setRenderTarget(null);
  }

  _doRestore(ctx, fb, idx) {
    const buf = this._ensureBuffer(ctx, idx);
    if (!buf || !buf.texture) return;
    const mode = this.blendMode || BLEND.REPLACE;
    blendTexture(ctx.renderer, buf.texture, fb.getActiveTarget(), mode, this.adjustBlend);
  }

  render(ctx, fb) {
    if (!this.enabled) return;

    const idx = Math.max(0, Math.min(NUM_BUFFERS - 1, this.bufferIndex));

    if (this.action === 0) {
      // SAVE
      this._doSave(ctx, fb, idx);
    } else if (this.action === 1) {
      // RESTORE
      this._doRestore(ctx, fb, idx);
    } else if (this.action === 2) {
      // ALTERNATING: save on even frames, restore on odd frames
      if (!this._toggle) {
        this._doSave(ctx, fb, idx);
      } else {
        this._doRestore(ctx, fb, idx);
      }
      this._toggle = !this._toggle;
    } else if (this.action === 3) {
      // ALTERNATING (reverse): restore on even frames, save on odd frames
      if (!this._toggle) {
        this._doRestore(ctx, fb, idx);
      } else {
        this._doSave(ctx, fb, idx);
      }
      this._toggle = !this._toggle;
    }
  }

  destroy() {
    if (this._copyMaterial) this._copyMaterial.dispose();
  }
}

AvsComponent.register('BufferSave', BufferSave);
