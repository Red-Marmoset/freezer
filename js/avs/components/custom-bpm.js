// AVS Custom BPM — beat generation/filtering
// Port of r_bpm.cpp: generates or filters beats.
// Three modes: arbitrary (fixed interval), skip (every Nth beat), invert (beats become non-beats)
//
// Returns beat flags via ctx.beat manipulation:
// - SET_BEAT: force beat this frame
// - CLR_BEAT: suppress beat this frame

import { AvsComponent } from '../avs-component.js';

export class CustomBPM extends AvsComponent {
  constructor(opts) {
    super(opts);
    this.arbitrary = opts.arbitrary !== undefined ? opts.arbitrary : 1;
    this.skip = opts.skip || 0;
    this.invert = opts.invert || 0;
    this.arbVal = opts.arbVal || 500;    // ms between beats in arbitrary mode
    this.skipVal = opts.skipVal || 1;    // skip every N beats
    this.skipFirst = opts.skipFirst || 0; // skip first N beats
    this._lastBeatTime = 0;
    this._skipCount = 0;
    this._beatCount = 0;
  }

  init(ctx) {
    this._lastBeatTime = performance.now();
    this._skipCount = 0;
    this._beatCount = 0;
  }

  render(ctx, fb) {
    if (!this.enabled) return;

    const isBeat = ctx.beat;

    if (isBeat) this._beatCount++;

    // Skip first N beats
    if (this.skipFirst > 0 && this._beatCount <= this.skipFirst) {
      if (isBeat) ctx.beat = false;
      return;
    }

    // Mode: arbitrary — generate beats at fixed interval
    if (this.arbitrary) {
      const now = performance.now();
      if (now > this._lastBeatTime + this.arbVal) {
        this._lastBeatTime = now;
        ctx.beat = true;
      } else {
        ctx.beat = false;
      }
      return;
    }

    // Mode: skip — only pass every Nth beat
    if (this.skip) {
      if (isBeat) {
        this._skipCount++;
        if (this._skipCount >= this.skipVal + 1) {
          this._skipCount = 0;
          ctx.beat = true;
        } else {
          ctx.beat = false;
        }
      } else {
        ctx.beat = false;
      }
      return;
    }

    // Mode: invert — beats become non-beats and vice versa
    if (this.invert) {
      ctx.beat = !isBeat;
      return;
    }
  }

  destroy() {}
}

AvsComponent.register('CustomBPM', CustomBPM);
