// AVS SetRenderMode component (code 0x28) — sets global line/blend state
// Affects rendering style of line-drawing components (SuperScope, Simple, Ring).
import { AvsComponent } from '../avs-component.js';
import { parseBlendMode } from '../blend.js';

export class SetRenderMode extends AvsComponent {
  constructor(opts) {
    super(opts);
    this.blend = parseBlendMode(opts.blend || opts.blendMode || 0);
    this.lineSize = opts.lineSize || opts.linewidth || 1;
  }

  init(ctx) {
    // Store render mode on the engine context so other components can read it
    if (!ctx.renderMode) {
      ctx.renderMode = { blend: 0, lineSize: 1, enabled: false };
    }
  }

  render(ctx, fb) {
    if (!ctx.renderMode) {
      ctx.renderMode = { blend: 0, lineSize: 1, enabled: false };
    }
    if (this.enabled) {
      ctx.renderMode.blend = this.blend;
      ctx.renderMode.lineSize = this.lineSize;
      ctx.renderMode.enabled = true;
    } else {
      ctx.renderMode.enabled = false;
    }
  }

  destroy() {}
}

AvsComponent.register('SetRenderMode', SetRenderMode);
