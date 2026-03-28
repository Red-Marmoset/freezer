// AVS OnBeatClear component — clears framebuffer on beat
import { AvsComponent } from '../avs-component.js';

export class OnBeatClear extends AvsComponent {
  constructor(opts) {
    super(opts);
    this.color = parseColor(opts.color || '#000000');
    this.clearBeats = opts.clearBeats || 1;
    this._remaining = 0;
  }

  render(ctx, fb) {
    if (!this.enabled) return;
    if (ctx.beat) this._remaining = this.clearBeats;
    if (this._remaining > 0) {
      fb.clear(this.color);
      this._remaining--;
    }
  }
}

function parseColor(c) {
  if (typeof c === 'number') return c;
  if (typeof c === 'string' && c[0] === '#') return parseInt(c.slice(1), 16);
  return 0x000000;
}

AvsComponent.register('OnBeatClear', OnBeatClear);
