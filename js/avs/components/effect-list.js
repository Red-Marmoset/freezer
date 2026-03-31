// AVS EffectList component — container with blend modes and nested components
// Ported from r_list.cpp. EEL code can control alphain, alphaout, enabled, clear.
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

    // Adjustable blend values from parser
    this.inAdjust = (opts.inAdjust || 128) / 255;
    this.outAdjust = (opts.outAdjust || 128) / 255;

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

    this.childFb = new Framebuffer(ctx.renderer, ctx.width, ctx.height);
    this.childFb.clear(0x000000);

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
    const lib = createStdlib({
      waveform: ctx.audioData.waveform,
      spectrum: ctx.audioData.spectrum,
      fftSize: ctx.audioData.fftSize,
      time: ctx.time,
    });

    // Set EEL variables (matching r_list.cpp)
    s.w = ctx.width;
    s.h = ctx.height;
    s.b = ctx.beat ? 1 : 0;
    s.enabled = 1;
    s.clear = this.clearFrame ? 1 : 0;
    s.alphain = this.inAdjust;
    s.alphaout = this.outAdjust;

    // Run init on first frame
    if (this.firstFrame) {
      try { this.initFn(s, lib); } catch {}
      this.firstFrame = false;
    }

    // Run perFrame code — can modify enabled, clear, alphain, alphaout, beat
    try { this.perFrameFn(s, lib); } catch {}

    // Read back EEL-controlled values
    const frameEnabled = s.enabled !== 0;
    const frameClear = s.clear !== 0;
    const alphaIn = Math.max(0, Math.min(1, s.alphain));
    const alphaOut = Math.max(0, Math.min(1, s.alphaout));
    const beat = s.b !== 0;

    // Update beat in context for children (EEL code can suppress/trigger beat)
    const childCtx = { ...ctx, beat };

    if (!frameEnabled) return;

    // Resize child FB if needed
    if (this.childFb && (ctx.width !== this.childFb.width || ctx.height !== this.childFb.height)) {
      this.childFb.resize(ctx.width, ctx.height);
    }

    // Determine rendering target:
    // vis_avs optimization: if both input=IGNORE and output=REPLACE, render
    // children directly onto parent FB (skipping the child FB copy).
    // Note: output=IGNORE means "discard child result" — must use child FB.
    const renderToParent = (this.input === BLEND.IGNORE && this.output === BLEND.REPLACE && parentFb);
    const targetFb = renderToParent ? parentFb : this.childFb;

    if (!renderToParent) {
      // Clear child framebuffer — but skip when input is REPLACE (matching original:
      // "if (use_clear && (isroot || blendin() != 1))" where mode 1 = COPY/REPLACE)
      if (frameClear && this.input !== BLEND.REPLACE) {
        this.childFb.clear(0x000000);
      }

      // Input blend: copy parent content into child framebuffer
      if (this.input !== BLEND.IGNORE && parentFb) {
        blendTexture(ctx.renderer, parentFb.getActiveTexture(), this.childFb.getActiveTarget(), this.input, alphaIn);
      }
    }

    // Render children onto target framebuffer
    for (const child of this.children) {
      if (child.enabled) {
        child.render(childCtx, targetFb);
      }
    }

    // Output blend: composite child result back onto parent framebuffer
    if (!renderToParent && this.output !== BLEND.IGNORE && parentFb) {
      blendTexture(ctx.renderer, this.childFb.getActiveTexture(), parentFb.getActiveTarget(), this.output, alphaOut);
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
