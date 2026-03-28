// AVS ClearScreen component — clears framebuffer to a color
import { AvsComponent } from '../avs-component.js';

export class ClearScreen extends AvsComponent {
  constructor(opts) {
    super(opts);
    this.color = parseColor(opts.color || '#000000');
    this.onBeatAction = opts.onBeatAction || 0;
    this.onBeatColor = parseColor(opts.onBeatColor || '#000000');
    this.clearBeats = 0;
  }

  render(ctx, fb) {
    if (!this.enabled) return;

    let color = this.color;
    if (this.onBeatAction && ctx.beat) {
      color = this.onBeatColor;
      this.clearBeats = this.onBeatAction; // number of frames to use beat color
    }
    if (this.clearBeats > 0) {
      color = this.onBeatColor;
      this.clearBeats--;
    }

    fb.clear(color);
  }
}

function parseColor(c) {
  if (typeof c === 'number') return c;
  if (typeof c === 'string' && c[0] === '#') return parseInt(c.slice(1), 16);
  return 0x000000;
}

AvsComponent.register('ClearScreen', ClearScreen);
