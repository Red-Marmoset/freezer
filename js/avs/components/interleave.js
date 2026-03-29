// AVS Interleave component (code 0x17) — stripe/checkerboard overlay
import * as THREE from 'https://esm.sh/three@0.171.0';
import { AvsComponent } from '../avs-component.js';

const FRAG = `
  uniform sampler2D tSource;
  uniform float uSizeX;
  uniform float uSizeY;
  uniform vec3 uColor;
  uniform int uBlendMode;
  varying vec2 vUv;

  void main() {
    vec4 src = texture2D(tSource, vUv);

    // Determine if this pixel is in an "on" stripe
    bool onX = (uSizeX > 0.0) ? (mod(floor(gl_FragCoord.x / uSizeX), 2.0) < 1.0) : true;
    bool onY = (uSizeY > 0.0) ? (mod(floor(gl_FragCoord.y / uSizeY), 2.0) < 1.0) : true;
    bool on = onX && onY;

    if (!on) {
      gl_FragColor = src;
      return;
    }

    vec3 result;
    if (uBlendMode == 0) {
      // Replace
      result = uColor;
    } else if (uBlendMode == 1) {
      // Additive
      result = src.rgb + uColor;
    } else if (uBlendMode == 2) {
      // 50/50
      result = mix(src.rgb, uColor, 0.5);
    } else if (uBlendMode == 3) {
      // Sub (dest - src)
      result = src.rgb - uColor;
    } else if (uBlendMode == 4) {
      // Sub (src - dest)
      result = uColor - src.rgb;
    } else if (uBlendMode == 5) {
      // Multiply
      result = src.rgb * uColor;
    } else if (uBlendMode == 6) {
      // XOR — approximate with difference
      result = abs(src.rgb - uColor);
    } else if (uBlendMode == 7) {
      // Maximum
      result = max(src.rgb, uColor);
    } else if (uBlendMode == 8) {
      // Minimum
      result = min(src.rgb, uColor);
    } else {
      result = uColor;
    }

    gl_FragColor = vec4(clamp(result, 0.0, 1.0), src.a);
  }
`;

export class Interleave extends AvsComponent {
  constructor(opts) {
    super(opts);
    this.x = opts.x || 0;
    this.y = opts.y || 0;
    this.color = parseColor(opts.color || '#000000');
    this.blendMode = opts.blendMode || 0;
    this.onBeatX = opts.onBeatX || 0;
    this.onBeatY = opts.onBeatY || 0;
    this.onBeatDuration = opts.onBeatDuration || 1;

    this._beatFrames = 0;
    this._curX = this.x;
    this._curY = this.y;
    this._scene = null;
    this._camera = null;
    this._material = null;
  }

  init(ctx) {
    this._scene = new THREE.Scene();
    this._camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this._material = new THREE.ShaderMaterial({
      uniforms: {
        tSource: { value: null },
        uSizeX: { value: this.x > 0 ? this.x : 0.0 },
        uSizeY: { value: this.y > 0 ? this.y : 0.0 },
        uColor: { value: new THREE.Vector3(this.color[0], this.color[1], this.color[2]) },
        uBlendMode: { value: this.blendMode },
      },
      vertexShader: `varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
      fragmentShader: FRAG,
      depthTest: false,
    });
    this._scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this._material));
  }

  render(ctx, fb) {
    if (!this.enabled) return;

    if (ctx.beat && (this.onBeatX || this.onBeatY)) {
      this._beatFrames = this.onBeatDuration;
      this._curX = this.onBeatX || this.x;
      this._curY = this.onBeatY || this.y;
    }

    let sx = this._curX;
    let sy = this._curY;
    if (this._beatFrames > 0) {
      this._beatFrames--;
      if (this._beatFrames <= 0) {
        this._curX = this.x;
        this._curY = this.y;
      }
    } else {
      sx = this.x;
      sy = this.y;
    }

    this._material.uniforms.tSource.value = fb.getActiveTexture();
    this._material.uniforms.uSizeX.value = sx > 0 ? sx : 0.0;
    this._material.uniforms.uSizeY.value = sy > 0 ? sy : 0.0;

    ctx.renderer.setRenderTarget(fb.getBackTarget());
    const prev = ctx.renderer.autoClear;
    ctx.renderer.autoClear = true;
    ctx.renderer.render(this._scene, this._camera);
    ctx.renderer.autoClear = prev;
    fb.swap();
    this._material.uniforms.tSource.value = null;
  }

  destroy() { if (this._material) this._material.dispose(); }
}

function parseColor(c) {
  if (typeof c === 'string' && c[0] === '#') c = c.slice(1);
  const n = parseInt(c, 16) || 0;
  return [(n >> 16 & 0xff) / 255, (n >> 8 & 0xff) / 255, (n & 0xff) / 255];
}

AvsComponent.register('Interleave', Interleave);
