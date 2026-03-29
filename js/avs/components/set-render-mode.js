// AVS SetRenderMode component (code 0x28) — sets global line/blend state
// Affects rendering style of line-drawing components (SuperScope, Simple, Ring).
// Stored as a single packed uint32 (g_line_blend_mode):
//   bits 0-7: blend mode, bits 8-15: alpha, bits 16-23: linesize, bit 31: enabled
import { AvsComponent } from '../avs-component.js';

export class SetRenderMode extends AvsComponent {
  constructor(opts) {
    super(opts);
    this.blend = opts.blend || 0;
    this.alpha = opts.alpha || 128;
    this.lineSize = opts.lineSize || 1;
  }

  init(ctx) {
    if (!ctx.renderMode) {
      ctx.renderMode = { blend: 0, alpha: 128, lineSize: 1, enabled: false };
    }
  }

  render(ctx, fb) {
    if (!ctx.renderMode) {
      ctx.renderMode = { blend: 0, alpha: 128, lineSize: 1, enabled: false };
    }
    if (this.enabled) {
      ctx.renderMode.blend = this.blend;
      ctx.renderMode.alpha = this.alpha;
      ctx.renderMode.lineSize = this.lineSize;
      ctx.renderMode.enabled = true;
    } else {
      ctx.renderMode.enabled = false;
    }
  }

  destroy() {}
}

AvsComponent.register('SetRenderMode', SetRenderMode);
