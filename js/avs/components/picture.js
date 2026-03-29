// AVS Picture component (code 0x22) — composites an image onto the framebuffer
// Simply draws the loaded image over the active framebuffer using the selected
// blend mode. On beat, can switch to a different blend mode.
import * as THREE from 'https://esm.sh/three@0.171.0';
import { AvsComponent } from '../avs-component.js';
import { loadAvsImage, getFallbackTexture } from '../image-loader.js';
import { blendTexture, parseBlendMode, BLEND } from '../blend.js';

export class Picture extends AvsComponent {
  constructor(opts) {
    super(opts);
    this.imageSrc = opts.imageSrc || opts.image || '';
    this.blendMode = parseBlendMode(opts.blendMode || 'REPLACE');
    this.onBeatBlendMode = parseBlendMode(opts.onBeatBlendMode || opts.blendMode || 'REPLACE');
    this.onBeatDuration = opts.onBeatDuration || 1;
    this.keepAspect = opts.keepAspect || false;

    this._imageTexture = null;
    this._imageTarget = null; // render target holding the image at screen resolution
    this._onBeatFrames = 0;

    // Blit scene for rendering image texture to a render target
    this._blitScene = null;
    this._blitCamera = null;
    this._blitMaterial = null;
  }

  init(ctx) {
    this._imageTexture = getFallbackTexture();

    // Create a render target to hold the image at screen resolution
    this._imageTarget = new THREE.WebGLRenderTarget(ctx.width, ctx.height, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    });

    // Blit scene: renders the image texture to the image target
    this._blitScene = new THREE.Scene();
    this._blitCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this._blitMaterial = new THREE.MeshBasicMaterial({ map: this._imageTexture, depthTest: false });
    this._blitScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this._blitMaterial));

    if (this.imageSrc) {
      loadAvsImage(this.imageSrc).then(tex => {
        this._imageTexture = tex;
        this._blitMaterial.map = tex;
        this._needsReblit = true;
      });
    }

    this._needsReblit = true;
  }

  render(ctx, fb) {
    if (!this.enabled) return;

    // Resize image target if viewport changed
    if (this._imageTarget.width !== ctx.width || this._imageTarget.height !== ctx.height) {
      this._imageTarget.setSize(ctx.width, ctx.height);
      this._needsReblit = true;
    }

    // Render the image to the image target (once, or when image changes)
    if (this._needsReblit) {
      this._blitMaterial.map = this._imageTexture;
      ctx.renderer.setRenderTarget(this._imageTarget);
      ctx.renderer.render(this._blitScene, this._blitCamera);
      ctx.renderer.setRenderTarget(null);
      this._needsReblit = false;
    }

    // Handle on-beat blend mode switching
    if (ctx.beat && this.onBeatDuration > 0) {
      this._onBeatFrames = this.onBeatDuration;
    }
    const mode = this._onBeatFrames > 0 ? this.onBeatBlendMode : this.blendMode;
    if (this._onBeatFrames > 0) this._onBeatFrames--;

    // Composite image onto active framebuffer using selected blend mode
    blendTexture(ctx.renderer, this._imageTarget.texture, fb.getActiveTarget(), mode);
  }

  destroy() {
    if (this._blitMaterial) this._blitMaterial.dispose();
    if (this._imageTarget) this._imageTarget.dispose();
  }
}

AvsComponent.register('Picture', Picture);
