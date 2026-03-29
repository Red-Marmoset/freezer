// AVS Comment component (code 0x15) — no-op, just stores text
import { AvsComponent } from '../avs-component.js';

export class Comment extends AvsComponent {
  constructor(opts) {
    super(opts);
    this.text = opts.text || '';
  }
  init() {}
  render() {}
  destroy() {}
}

AvsComponent.register('Comment', Comment);
