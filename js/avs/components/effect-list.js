// AVS EffectList component — container with blend modes and nested components
import * as THREE from 'https://esm.sh/three@0.171.0';
import { AvsComponent } from '../avs-component.js';
import { Framebuffer } from '../framebuffer.js';
import { parseBlendMode, blendTexture, BLEND } from '../blend.js';
import { compileEEL, createState } from '../eel/nseel-compiler.js';
import { createStdlib } from '../eel/nseel-stdlib.js';

export class EffectList extends AvsComponent {
  constructor(opts) {
    super(opts);
    this.input = parseBlendMode(opts.input || 'IGNORE');
    this.output = parseBlendMode(opts.output || 'REPLACE');
    this.clearFrame = opts.clearFrame !== false;
    this.enableOnBeat = opts.enableOnBeat || false;
    this.enableOnBeatFor = opts.enableOnBeatFor || 1;

    const code = opts.code || {};
    this.initFn = compileEEL(code.init || '');
    this.perFrameFn = compileEEL(code.perFrame || '');

    this.children = [];
    this.childFb = null;
    this.state = null;
    this.firstFrame = true;
    this._onBeatFrames = 0;
  }

  init(ctx) {
    this.state = createState(ctx.globalRegisters, ctx.globalMegabuf);

    // Create child framebuffer
    this.childFb = new Framebuffer(ctx.renderer, ctx.width, ctx.height);
    this.childFb.clear(0x000000);

    // Recursively instantiate child components
    this.children = AvsComponent.createComponents(this.opts.components || []);
    for (const child of this.children) {
      child.init(ctx);
    }

    this.firstFrame = true;
  }

  render(ctx, parentFb) {
    if (!this.enabled) return;

    // Handle enableOnBeat
    if (this.enableOnBeat) {
      if (ctx.beat) {
        this._onBeatFrames = this.enableOnBeatFor;
      }
      if (this._onBeatFrames <= 0) return;
      this._onBeatFrames--;
    }

    const s = this.state;
    const lib = createStdlib({ time: ctx.time });

    // Run init on first frame
    if (this.firstFrame) {
      this.initFn(s, lib);
      this.firstFrame = false;
    }

    // Run perFrame code
    s.w = ctx.width;
    s.h = ctx.height;
    s.b = ctx.beat ? 1 : 0;
    this.perFrameFn(s, lib);

    // Resize child FB if needed
    if (this.childFb && (ctx.width !== this.childFb.width || ctx.height !== this.childFb.height)) {
      this.childFb.resize(ctx.width, ctx.height);
    }

    // Determine rendering target:
    // If both input and output are IGNORE, render directly onto parent FB
    // (the EffectList IS the framebuffer, not a separate layer)
    const renderToParent = (this.input === BLEND.IGNORE && this.output === BLEND.IGNORE && parentFb);
    const targetFb = renderToParent ? parentFb : this.childFb;

    if (!renderToParent) {
      // Clear child framebuffer FIRST (before input blend overwrites it)
      if (this.clearFrame) {
        this.childFb.clear(0x000000);
      }

      // Input blend: copy parent content into child framebuffer
      if (this.input !== BLEND.IGNORE && parentFb) {
        blendTexture(ctx.renderer, parentFb.getActiveTexture(), this.childFb.getActiveTarget(), this.input);
      }
    }

    // Render children onto target framebuffer
    const gl = ctx.renderer.getContext();
    for (const child of this.children) {
      if (child.enabled) {
        child.render(ctx, targetFb);
        ctx.renderer.setRenderTarget(null);
        for (let i = 0; i < 8; i++) {
          gl.activeTexture(gl.TEXTURE0 + i);
          gl.bindTexture(gl.TEXTURE_2D, null);
        }
        ctx.renderer.resetState();
      }
    }

    // Output blend: composite child result back onto parent framebuffer
    if (!renderToParent && this.output !== BLEND.IGNORE && parentFb) {
      blendTexture(ctx.renderer, this.childFb.getActiveTexture(), parentFb.getActiveTarget(), this.output);
    }
  }

  destroy() {
    for (const child of this.children) {
      child.destroy();
    }
    if (this.childFb) this.childFb.dispose();
    this.children = [];
  }
}

AvsComponent.register('EffectList', EffectList);
