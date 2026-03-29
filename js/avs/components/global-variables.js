// AVS Global Variables APE (Jheriko: Global) — runs EEL code for global state
// Manages persistent global registers and megabuf. Can load .gvm files
// (EEL code that populates gmegabuf with data like 3D models).
// Has init/frame/beat code sections, no rendering output.
import { AvsComponent } from '../avs-component.js';
import { compileEEL, createState } from '../eel/nseel-compiler.js';
import { createStdlib } from '../eel/nseel-stdlib.js';

const GVM_BASE = 'assets/avs-data/'; // .gvm files stored alongside images

export class GlobalVariables extends AvsComponent {
  constructor(opts) {
    super(opts);

    const code = opts.code || {};
    this.initCode = code.init || '';
    this.frameCode = code.frame || '';
    this.beatCode = code.beat || '';
    this.file = opts.file || '';
    this.loadTime = opts.loadTime || 0; // 0=none, 1=on init, 2=on every frame

    this.initFn = compileEEL(this.initCode);
    this.frameFn = compileEEL(this.frameCode);
    this.beatFn = compileEEL(this.beatCode);

    this.state = null;
    this.firstFrame = true;
    this._fileLoaded = false;
    this._fileFn = null;
  }

  init(ctx) {
    this.state = createState(ctx.globalRegisters, ctx.globalMegabuf);

    // Load .gvm file if specified
    if (this.file) {
      this._loadGvmFile(this.file);
    }
  }

  async _loadGvmFile(filename) {
    const basename = filename.replace(/.*[/\\]/, '');
    const url = GVM_BASE + basename;
    try {
      const resp = await fetch(url);
      if (!resp.ok) return;
      const code = await resp.text();
      this._fileFn = compileEEL(code);
      // Execute the .gvm code immediately to populate gmegabuf
      if (this._fileFn && this.state) {
        const lib = createStdlib({ time: 0 });
        try { this._fileFn(this.state, lib); } catch (e) {
          console.warn('GVM file execution error:', e.message);
        }
        this._fileLoaded = true;
      }
    } catch (e) {
      console.warn('Failed to load GVM file:', basename, e);
    }
  }

  render(ctx, fb) {
    if (!this.enabled || !this.state) return;

    const s = this.state;
    const lib = createStdlib({
      waveform: ctx.audioData.waveform,
      spectrum: ctx.audioData.spectrum,
      fftSize: ctx.audioData.fftSize,
      time: ctx.time,
    });

    s.w = ctx.width;
    s.h = ctx.height;
    s.b = ctx.beat ? 1 : 0;
    s.load = 0;
    s.save = 0;

    if (this.firstFrame) {
      try { this.initFn(s, lib); } catch {}
      this.firstFrame = false;
    }

    try { this.frameFn(s, lib); } catch {}

    if (ctx.beat) {
      try { this.beatFn(s, lib); } catch {}
    }

    // No rendering output — this component only manipulates global state
  }

  destroy() {}
}

AvsComponent.register('Jheriko: Global', GlobalVariables);
