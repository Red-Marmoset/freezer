// AVS ColorMap APE — maps pixel brightness/channel to a color gradient LUT
// Supports 8 maps with beat-triggered cycling and crossfade transitions.
import * as THREE from 'https://esm.sh/three@0.171.0';
import { AvsComponent } from '../avs-component.js';

const VERT_SHADER = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Fragment shader with key extraction and blend mode
function buildFragShader(blendMode) {
  // Blend operations in GLSL
  const BLEND_OPS = {
    REPLACE:    'out_color = map_color;',
    ADDITIVE:   'out_color = min(src.rgb + map_color, 1.0);',
    MAXIMUM:    'out_color = max(src.rgb, map_color);',
    MINIMUM:    'out_color = min(src.rgb, map_color);',
    '5050':     'out_color = (src.rgb + map_color) * 0.5;',
    SUB1:       'out_color = max(src.rgb - map_color, 0.0);',
    SUB2:       'out_color = max(map_color - src.rgb, 0.0);',
    MULTIPLY:   'out_color = src.rgb * map_color;',
    XOR:        // XOR requires integer math — approximate with abs difference
                'out_color = abs(src.rgb - map_color);',
    ADJUSTABLE: 'out_color = mix(src.rgb, map_color, uAlpha);',
  };

  const blendOp = BLEND_OPS[blendMode] || BLEND_OPS.REPLACE;

  return `
    precision mediump float;
    uniform sampler2D tSource;
    uniform sampler2D tGradient;
    uniform int uKey;
    uniform float uAlpha;
    varying vec2 vUv;

    void main() {
      vec4 src = texture2D(tSource, vUv);
      float key;

      if (uKey == 0) {
        key = src.r;
      } else if (uKey == 1) {
        key = src.g;
      } else if (uKey == 2) {
        key = src.b;
      } else if (uKey == 3) {
        key = min((src.r + src.g + src.b) * 0.5, 1.0);
      } else if (uKey == 4) {
        key = max(src.r, max(src.g, src.b));
      } else {
        key = (src.r + src.g + src.b) / 3.0;
      }

      vec3 map_color = texture2D(tGradient, vec2(key, 0.5)).rgb;
      vec3 out_color;
      ${blendOp}
      gl_FragColor = vec4(out_color, 1.0);
    }
  `;
}

const KEY_MAP = {
  'RED': 0, 'GREEN': 1, 'BLUE': 2,
  '(R+G+B)/2': 3, 'CHANNEL_SUM_HALF': 3,
  'MAX': 4, 'MAXIMUM': 4,
  '(R+G+B)/3': 5, 'CHANNEL_AVERAGE': 5,
};

export class ColorMap extends AvsComponent {
  constructor(opts) {
    super(opts);
    this.key = KEY_MAP[(opts.key || 'RED').toUpperCase()] || 0;
    this.blendMode = (opts.blendMode || 'REPLACE').toUpperCase();
    this.maps = opts.maps || [{ enabled: true, colors: [
      { color: '#000000', position: 0 },
      { color: '#ffffff', position: 255 },
    ]}];
    this.currentMap = opts.currentMap || 0;
    this.mapCycleMode = (opts.mapCycleMode || 'NONE').toUpperCase();
    this.mapCycleSpeed = opts.mapCycleSpeed || 8;
    this.adjustableAlpha = opts.adjustableAlpha || 128;
    this.dontSkipFastBeats = opts.dontSkipFastBeats || false;

    // Animation state
    this._nextMap = this.currentMap;
    this._animStep = 256; // 256 = no transition
    this._currentGradient = null;
    this._nextGradient = null;

    this._scene = null;
    this._camera = null;
    this._material = null;
    this._gradientTexture = null;
  }

  init(ctx) {
    this._scene = new THREE.Scene();
    this._camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    this._gradientTexture = this._buildGradient(this.currentMap);

    this._material = new THREE.ShaderMaterial({
      uniforms: {
        tSource: { value: null },
        tGradient: { value: this._gradientTexture },
        uKey: { value: this.key },
        uAlpha: { value: this.adjustableAlpha / 255 },
      },
      vertexShader: VERT_SHADER,
      fragmentShader: buildFragShader(this.blendMode),
      depthTest: false,
    });

    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      this._material
    );
    this._scene.add(mesh);
  }

  _buildGradient(mapIndex) {
    const map = this.maps[mapIndex] || this.maps[0];
    if (!map || !map.colors || map.colors.length === 0) {
      const data = new Uint8Array(256 * 4);
      for (let i = 0; i < 256; i++) {
        data[i * 4] = i;
        data[i * 4 + 1] = i;
        data[i * 4 + 2] = i;
        data[i * 4 + 3] = 255;
      }
      const tex = new THREE.DataTexture(data, 256, 1, THREE.RGBAFormat);
      tex.needsUpdate = true;
      return tex;
    }

    // Sort color stops by position
    const stops = map.colors
      .map(s => ({ pos: s.position, color: parseHex(s.color) }))
      .sort((a, b) => a.pos - b.pos);

    // Bake 256-entry LUT (matching AVS bake_full_map)
    const data = new Uint8Array(256 * 4);
    for (let i = 0; i < 256; i++) {
      let r, g, b;

      if (stops.length === 0) {
        r = g = b = i;
      } else if (stops.length === 1) {
        r = stops[0].color[0];
        g = stops[0].color[1];
        b = stops[0].color[2];
      } else if (i <= stops[0].pos) {
        // Before first stop: flat extend
        r = stops[0].color[0];
        g = stops[0].color[1];
        b = stops[0].color[2];
      } else if (i >= stops[stops.length - 1].pos) {
        // After last stop: flat extend
        const last = stops[stops.length - 1].color;
        r = last[0]; g = last[1]; b = last[2];
      } else {
        // Between stops: linear interpolation
        let lo = stops[0], hi = stops[stops.length - 1];
        for (let j = 0; j < stops.length - 1; j++) {
          if (i >= stops[j].pos && i <= stops[j + 1].pos) {
            lo = stops[j]; hi = stops[j + 1]; break;
          }
        }
        const range = hi.pos - lo.pos;
        const t = range > 0 ? (i - lo.pos) / range : 0;
        r = Math.round(lo.color[0] + (hi.color[0] - lo.color[0]) * t);
        g = Math.round(lo.color[1] + (hi.color[1] - lo.color[1]) * t);
        b = Math.round(lo.color[2] + (hi.color[2] - lo.color[2]) * t);
      }

      data[i * 4] = r;
      data[i * 4 + 1] = g;
      data[i * 4 + 2] = b;
      data[i * 4 + 3] = 255;
    }

    const tex = new THREE.DataTexture(data, 256, 1, THREE.RGBAFormat);
    tex.needsUpdate = true;
    return tex;
  }

  _blendGradients(mapA, mapB, alpha) {
    const texA = this._buildGradient(mapA);
    const texB = this._buildGradient(mapB);
    const dataA = texA.image.data;
    const dataB = texB.image.data;
    const data = new Uint8Array(256 * 4);
    const a = alpha / 256;
    for (let i = 0; i < 256 * 4; i++) {
      data[i] = Math.round(dataA[i] * (1 - a) + dataB[i] * a);
    }
    texA.dispose();
    texB.dispose();
    const tex = new THREE.DataTexture(data, 256, 1, THREE.RGBAFormat);
    tex.needsUpdate = true;
    return tex;
  }

  render(ctx, fb) {
    if (!this.enabled || !this._material) return;

    // Map cycling on beat
    if (ctx.beat && this.mapCycleMode !== 'NONE') {
      const canChange = this._animStep >= 256 || !this.dontSkipFastBeats;
      if (canChange) {
        const enabledMaps = this.maps
          .map((m, i) => ({ idx: i, enabled: m.enabled !== false }))
          .filter(m => m.enabled);

        if (enabledMaps.length > 1) {
          if (this.mapCycleMode === 'BEAT_RANDOM') {
            let pick;
            do { pick = enabledMaps[Math.random() * enabledMaps.length | 0].idx; }
            while (pick === this.currentMap && enabledMaps.length > 1);
            this._nextMap = pick;
          } else {
            // Sequential
            let found = false;
            for (let i = 1; i <= 8; i++) {
              const idx = (this.currentMap + i) % 8;
              if (this.maps[idx] && this.maps[idx].enabled !== false) {
                this._nextMap = idx;
                found = true;
                break;
              }
            }
          }
          this._animStep = 0;
        }
      }
    }

    // Animate transition
    if (this._animStep < 256) {
      this._animStep += this.mapCycleSpeed;
      if (this._animStep >= 256) {
        this._animStep = 256;
        this.currentMap = this._nextMap;
        // Use final map gradient
        if (this._gradientTexture) this._gradientTexture.dispose();
        this._gradientTexture = this._buildGradient(this.currentMap);
      } else {
        // Crossfade between maps
        if (this._gradientTexture) this._gradientTexture.dispose();
        this._gradientTexture = this._blendGradients(
          this.currentMap, this._nextMap, this._animStep
        );
      }
      this._material.uniforms.tGradient.value = this._gradientTexture;
    }

    this._material.uniforms.tSource.value = fb.getActiveTexture();

    // Read from active, write to back, swap
    ctx.renderer.setRenderTarget(fb.getBackTarget());
    ctx.renderer.render(this._scene, this._camera);
    this._material.uniforms.tSource.value = null;
    fb.swap();
  }

  destroy() {
    if (this._material) this._material.dispose();
    if (this._gradientTexture) this._gradientTexture.dispose();
  }
}

function parseHex(c) {
  if (typeof c === 'string' && c[0] === '#') c = c.slice(1);
  const n = parseInt(c, 16) || 0;
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

AvsComponent.register('ColorMap', ColorMap);
AvsComponent.register('Color Map', ColorMap);
