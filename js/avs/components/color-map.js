// AVS ColorMap component — maps pixel brightness to a color gradient
import * as THREE from 'https://esm.sh/three@0.171.0';
import { AvsComponent } from '../avs-component.js';
import { parseBlendMode, BLEND } from '../blend.js';

const VERT_SHADER = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAG_SHADER = `
  uniform sampler2D tSource;
  uniform sampler2D tGradient;
  uniform int uKey;
  varying vec2 vUv;

  void main() {
    vec4 src = texture2D(tSource, vUv);
    float key;

    if (uKey == 0) {
      key = src.r;                          // RED
    } else if (uKey == 1) {
      key = src.g;                          // GREEN
    } else if (uKey == 2) {
      key = src.b;                          // BLUE
    } else if (uKey == 3) {
      key = (src.r + src.g + src.b) / 2.0;  // CHANNEL_SUM_HALF (clamped by texture)
    } else if (uKey == 4) {
      key = max(src.r, max(src.g, src.b));  // MAX
    } else {
      key = (src.r + src.g + src.b) / 3.0;  // CHANNEL_AVERAGE
    }

    gl_FragColor = texture2D(tGradient, vec2(key, 0.5));
  }
`;

const KEY_MAP = {
  'RED': 0, 'GREEN': 1, 'BLUE': 2,
  'CHANNEL_SUM_HALF': 3, '(R+G+B)/2': 3,
  'MAX': 4, 'MAXIMUM': 4,
  'CHANNEL_AVERAGE': 5, '(R+G+B)/3': 5,
};

export class ColorMap extends AvsComponent {
  constructor(opts) {
    super(opts);
    this.key = KEY_MAP[(opts.key || 'RED').toUpperCase()] || 0;
    this.blendMode = parseBlendMode(opts.blendMode || 'REPLACE');
    this.maps = opts.maps || [{ colors: [
      { color: '#000000', position: 0 },
      { color: '#ffffff', position: 255 },
    ]}];
    this.mapIndex = opts.mapIndex || 0;

    this._scene = null;
    this._camera = null;
    this._material = null;
    this._gradientTexture = null;
  }

  init(ctx) {
    this._scene = new THREE.Scene();
    this._camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    this._gradientTexture = this._buildGradient();

    this._material = new THREE.ShaderMaterial({
      uniforms: {
        tSource: { value: null },
        tGradient: { value: this._gradientTexture },
        uKey: { value: this.key },
      },
      vertexShader: VERT_SHADER,
      fragmentShader: FRAG_SHADER,
      depthTest: false,
    });

    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      this._material
    );
    this._scene.add(mesh);
  }

  _buildGradient() {
    const map = this.maps[this.mapIndex] || this.maps[0];
    if (!map || !map.colors || map.colors.length === 0) {
      // Default: black to white
      const data = new Uint8Array(256 * 4);
      for (let i = 0; i < 256; i++) {
        data[i * 4] = i;
        data[i * 4 + 1] = i;
        data[i * 4 + 2] = i;
        data[i * 4 + 3] = 255;
      }
      return new THREE.DataTexture(data, 256, 1, THREE.RGBAFormat);
    }

    // Sort color stops by position
    const stops = map.colors
      .map(s => ({ pos: s.position, color: parseHex(s.color) }))
      .sort((a, b) => a.pos - b.pos);

    // Interpolate 256 pixels
    const data = new Uint8Array(256 * 4);
    for (let i = 0; i < 256; i++) {
      // Find surrounding stops
      let lo = stops[0], hi = stops[stops.length - 1];
      for (let j = 0; j < stops.length - 1; j++) {
        if (i >= stops[j].pos && i <= stops[j + 1].pos) {
          lo = stops[j];
          hi = stops[j + 1];
          break;
        }
      }
      const range = hi.pos - lo.pos;
      const t = range > 0 ? (i - lo.pos) / range : 0;

      data[i * 4]     = Math.round(lo.color[0] + (hi.color[0] - lo.color[0]) * t);
      data[i * 4 + 1] = Math.round(lo.color[1] + (hi.color[1] - lo.color[1]) * t);
      data[i * 4 + 2] = Math.round(lo.color[2] + (hi.color[2] - lo.color[2]) * t);
      data[i * 4 + 3] = 255;
    }

    const tex = new THREE.DataTexture(data, 256, 1, THREE.RGBAFormat);
    tex.needsUpdate = true;
    return tex;
  }

  render(ctx, fb) {
    if (!this.enabled) return;

    this._material.uniforms.tSource.value = fb.getActiveTexture();

    // Read from active, write to back, swap
    ctx.renderer.setRenderTarget(fb.getBackTarget());
    const prevAutoClear = ctx.renderer.autoClear;
    ctx.renderer.autoClear = true;
    ctx.renderer.render(this._scene, this._camera);
    ctx.renderer.autoClear = prevAutoClear;
    fb.swap();
    this._material.uniforms.tSource.value = null;
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
