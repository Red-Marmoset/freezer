// AVS Engine — loads AVS preset JSON and wraps as a standard preset
// Conforms to the { name, init(ctx), update(ctx), destroy(ctx) } interface
// so it plugs directly into the existing renderer.

import * as THREE from 'https://esm.sh/three@0.171.0';
import { Framebuffer } from './framebuffer.js';
import { AvsComponent } from './avs-component.js';
import { BeatDetector } from './beat-detect.js';

// Import components to register them
import './components/clear-screen.js';
import './components/super-scope.js';
import './components/simple.js';
import './components/fade-out.js';
import './components/effect-list.js';
import './components/movement.js';
import './components/dynamic-movement.js';
import './components/color-map.js';
import './components/blur.js';
import './components/invert.js';
import './components/mosaic.js';
import './components/on-beat-clear.js';
import './components/brightness.js';
import './components/mirror.js';

/**
 * Load an AVS preset from JSON and return a preset object
 * compatible with the existing renderer.
 */
export function loadAvsPreset(json) {
  return new AvsPreset(json);
}

class AvsPreset {
  constructor(json) {
    this.json = json;
    this.name = json.name || 'AVS Preset';
    this.clearFrame = json.clearFrame !== false;
    this.components = [];
    this.framebuffer = null;
    this.beatDetector = new BeatDetector();
    this.globalRegisters = new Float64Array(100);
    this.globalMegabuf = {};
    this._outputQuad = null;
    this._outputMaterial = null;
    this._renderer = null;
  }

  init(ctx) {
    const { scene, width, height } = ctx;
    const renderer = ctx._renderer;
    this._renderer = renderer;

    // Create framebuffer
    this.framebuffer = new Framebuffer(renderer, width, height);
    this.framebuffer.clear(0x000000);

    // Parse and instantiate components
    this.components = AvsComponent.createComponents(this.json.components || []);

    // Init all components
    const avsCtx = this._buildAvsCtx(ctx, renderer);
    for (const comp of this.components) {
      comp.init(avsCtx);
    }

    // Create output quad — displays the framebuffer in the main scene
    this._outputMaterial = new THREE.MeshBasicMaterial({
      map: this.framebuffer.getActiveTexture(),
      depthTest: false,
    });
    this._outputQuad = new THREE.Mesh(
      new THREE.PlaneGeometry(width, height),
      this._outputMaterial
    );
    this._outputQuad.position.z = 0;
    scene.add(this._outputQuad);
    scene.background = null;
  }

  update(ctx) {
    const renderer = this._renderer;
    if (!renderer || !this.framebuffer) return;

    const beat = this.beatDetector.update(ctx.audioData.spectrum);
    const avsCtx = this._buildAvsCtx(ctx, renderer);
    avsCtx.beat = beat;

    // Disable autoClear — components manage clearing themselves
    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = false;

    // Clear frame if configured
    if (this.clearFrame) {
      this.framebuffer.clear(0x000000);
    }

    // Render all components onto the active framebuffer
    for (const comp of this.components) {
      if (comp.enabled) {
        comp.render(avsCtx, this.framebuffer);
      }
    }

    // Restore autoClear
    renderer.autoClear = prevAutoClear;

    // Update output quad to show the active framebuffer texture
    this._outputMaterial.map = this.framebuffer.getActiveTexture();
    this._outputMaterial.needsUpdate = true;

    // Reset render target to screen
    renderer.setRenderTarget(null);
  }

  destroy(ctx) {
    if (this._outputQuad && ctx.scene) {
      ctx.scene.remove(this._outputQuad);
    }
    if (this._outputMaterial) this._outputMaterial.dispose();
    for (const comp of this.components) {
      comp.destroy();
    }
    if (this.framebuffer) this.framebuffer.dispose();
    this.components = [];
    this.framebuffer = null;
  }

  _buildAvsCtx(ctx, renderer) {
    return {
      renderer,
      audioData: ctx.audioData,
      time: ctx.time,
      dt: ctx.dt,
      width: ctx.width,
      height: ctx.height,
      beat: false,
      globalRegisters: this.globalRegisters,
      globalMegabuf: this.globalMegabuf,
    };
  }
}
