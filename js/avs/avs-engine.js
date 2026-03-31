// AVS Engine — loads AVS preset JSON and wraps as a standard preset
// Conforms to the { name, init(ctx), update(ctx), destroy(ctx) } interface
// so it plugs directly into the existing renderer.

import * as THREE from 'https://esm.sh/three@0.171.0';
import { Framebuffer } from './framebuffer.js';
import { AvsComponent } from './avs-component.js';
import { BeatDetector } from './beat-detect.js';
import { setEelPrefix } from './eel/nseel-compiler.js';

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
import './components/color-modifier.js';
import './components/channel-shift.js';
import './components/color-clip.js';
import './components/grain.js';
import './components/interleave.js';
import './components/color-fade.js';
import './components/unique-tone.js';
import './components/scatter.js';
import './components/blitter-feedback.js';
import './components/roto-blitter.js';
import './components/ring.js';
import './components/starfield.js';
import './components/dot-grid.js';
import './components/dot-plane.js';
import './components/dot-fountain.js';
import './components/bass-spin.js';
import './components/rotating-stars.js';
import './components/timescope.js';
import './components/buffer-save.js';
import './components/set-render-mode.js';
import './components/water.js';
import './components/water-bump.js';
import './components/bump.js';
import './components/interferences.js';
import './components/dynamic-shift.js';
import './components/dynamic-distance-modifier.js';
import './components/texer.js';
import './components/texer2.js';
import './components/picture.js';
import './components/triangle.js';
import './components/vertex-triangles.js';
import './components/moving-particle.js';
import './components/convolution-filter.js';
import './components/comment.js';
import './components/multiplier.js';
import './components/eeltrans.js';
import './components/global-variables.js';
import './components/milkdrop-motion.js';
import './components/custom-shader.js';
import './components/darken-center.js';
import './components/echo.js';
import './components/osc-star.js';
import './components/fast-brightness.js';
import './components/color-reduction.js';
import './components/video-delay.js';
import './components/multi-delay.js';
import './components/custom-bpm.js';
import './components/text.js';
import './components/text3d.js';
import './components/multi-filter.js';

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
    this.saveBuffers = new Array(8).fill(null);
    this.renderMode = { blend: 0, lineSize: 1, enabled: false };
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

    // Collect EelTrans #define prefixes before compiling any EEL code
    const eelTransCode = this._collectEelTransCode(this.json.components || []);
    setEelPrefix(eelTransCode);

    // Parse and instantiate components (EEL code will use the prefix)
    this.components = AvsComponent.createComponents(this.json.components || []);

    // Check if any top-level component is a FadeOut (suppresses clearFrame)
    this._hasFadeOut = this._checkForFadeOut(this.json.components || []);

    // Init all components
    const avsCtx = this._buildAvsCtx(ctx, renderer);
    this._lastAvsCtx = avsCtx;
    for (const comp of this.components) {
      comp.init(avsCtx);
    }

    // Create a dedicated blit scene to copy framebuffer to screen.
    // We DON'T add this to the main scene — we render it separately
    // after the AVS update to avoid feedback loops between the
    // framebuffer texture and any render target bindings.
    this._blitScene = new THREE.Scene();
    this._blitCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    // Final blit with sRGB gamma encoding.
    // AVS pixel values are raw 0-255 integers designed for sRGB displays.
    // The intermediate rendering stays in linear space (correct math for
    // blend, invert, etc), but the final output needs sRGB encoding so
    // brightness levels look correct on modern displays.
    this._outputMaterial = new THREE.ShaderMaterial({
      uniforms: { tSource: { value: null } },
      vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `
        precision mediump float;
        uniform sampler2D tSource;
        varying vec2 vUv;
        void main() {
          vec3 c = texture2D(tSource, vUv).rgb;
          // Linear → sRGB: matches CRT gamma curve that AVS was designed for
          vec3 lo = c * 12.92;
          vec3 hi = 1.055 * pow(c, vec3(1.0/2.4)) - 0.055;
          gl_FragColor = vec4(mix(lo, hi, step(0.0031308, c)), 1.0);
        }
      `,
      depthTest: false,
    });
    this._blitScene.add(new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      this._outputMaterial
    ));
    scene.background = new THREE.Color(0x000000);
  }

  update(ctx) {
    const renderer = this._renderer;
    if (!renderer || !this.framebuffer) return;

    // Resize framebuffer if viewport changed
    if (ctx.width !== this.framebuffer.width || ctx.height !== this.framebuffer.height) {
      this.framebuffer.resize(ctx.width, ctx.height);
    }

    const beat = this.beatDetector.update(ctx.audioData.spectrum);
    const avsCtx = this._buildAvsCtx(ctx, renderer);
    avsCtx.beat = beat;
    this._lastAvsCtx = avsCtx;

    // Disable autoClear — components manage clearing themselves
    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = false;

    // Clear frame if configured — but skip if there's a FadeOut component
    // (FadeOut replaces clearFrame as the "clearing" mechanism, fading
    // instead of instantly clearing to black each frame)
    if (this.clearFrame && !this._hasFadeOut) {
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

    // Blit framebuffer to screen
    renderer.setRenderTarget(null);

    // Now safely bind the framebuffer texture and render to screen
    this._outputMaterial.uniforms.tSource.value = this.framebuffer.getActiveTexture();
    renderer.render(this._blitScene, this._blitCamera);
    this._outputMaterial.uniforms.tSource.value = null;
  }

  /**
   * Hot-reload a single component without rebuilding the entire preset.
   * Preserves the framebuffer and all other components' state.
   * @param {number[]} path - Index path to the component (e.g. [2] for top-level, [0, 1] for nested in EffectList)
   * @param {object} json - Updated component JSON
   */
  hotReload(path, json) {
    if (!this._lastAvsCtx || !path.length) return;

    // Navigate to the correct component array and index
    let components = this.components;
    for (let i = 0; i < path.length - 1; i++) {
      const idx = path[i];
      // EffectList stores children in .children
      if (components[idx] && components[idx].children) {
        components = components[idx].children;
      } else {
        return; // Can't navigate further
      }
    }

    const idx = path[path.length - 1];
    if (idx < 0 || idx >= components.length) return;

    // Destroy the old component
    if (components[idx]) {
      components[idx].destroy();
    }

    // Create and init the new one
    const newComp = AvsComponent.fromJSON(json);
    if (newComp) {
      newComp.init(this._lastAvsCtx);
      components[idx] = newComp;
    }

    // Re-check for FadeOut (in case that changed)
    this._hasFadeOut = this._checkForFadeOut(this.json.components || []);
  }

  destroy(ctx) {
    if (this._outputMaterial) this._outputMaterial.dispose();
    for (const comp of this.components) {
      comp.destroy();
    }
    if (this.framebuffer) this.framebuffer.dispose();
    // Dispose save buffers
    for (let i = 0; i < this.saveBuffers.length; i++) {
      if (this.saveBuffers[i]) {
        this.saveBuffers[i].dispose();
        this.saveBuffers[i] = null;
      }
    }
    this.components = [];
    this.framebuffer = null;
  }

  _collectEelTransCode(comps) {
    const parts = [];
    for (const c of comps) {
      if (c.type === 'EelTrans' && c.enabled !== false && c.code) {
        parts.push(c.code);
      }
      if (c.components) {
        const nested = this._collectEelTransCode(c.components);
        if (nested) parts.push(nested);
      }
    }
    return parts.join('\n');
  }

  _checkForFadeOut(comps) {
    for (const c of comps) {
      if (c.type === 'FadeOut' && c.enabled !== false) return true;
    }
    return false;
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
      saveBuffers: this.saveBuffers,
      renderMode: this.renderMode,
    };
  }
}
