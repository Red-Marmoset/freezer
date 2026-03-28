// AVS WaterBump component (code 0x1F) — height-field water with refraction
// Two integer height buffers ping-pong. On beat: drops a cosine-shaped blob.
// CalcWater: 8-neighbor average / 4 minus current, with damping.
// Rendering: displace UV sampling by height gradient (refraction).
import * as THREE from 'https://esm.sh/three@0.171.0';
import { AvsComponent } from '../avs-component.js';

const VERT_SHADER = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Pass 1: Water simulation with 8-neighbor kernel
// Heights stored in R channel as normalized float (0.5 = zero)
const CALC_WATER_FRAG = `
  uniform sampler2D tCurrent;
  uniform sampler2D tPrevious;
  uniform vec2 uTexelSize;
  uniform float uDamping;
  varying vec2 vUv;

  void main() {
    // 8-neighbor average
    float c  = texture2D(tCurrent, vUv).r;
    float n  = texture2D(tCurrent, vUv + vec2(0.0,  uTexelSize.y)).r;
    float s  = texture2D(tCurrent, vUv + vec2(0.0, -uTexelSize.y)).r;
    float e  = texture2D(tCurrent, vUv + vec2( uTexelSize.x, 0.0)).r;
    float w  = texture2D(tCurrent, vUv + vec2(-uTexelSize.x, 0.0)).r;
    float ne = texture2D(tCurrent, vUv + vec2( uTexelSize.x,  uTexelSize.y)).r;
    float nw = texture2D(tCurrent, vUv + vec2(-uTexelSize.x,  uTexelSize.y)).r;
    float se = texture2D(tCurrent, vUv + vec2( uTexelSize.x, -uTexelSize.y)).r;
    float sw = texture2D(tCurrent, vUv + vec2(-uTexelSize.x, -uTexelSize.y)).r;

    // Cardinal neighbors weighted 1, diagonals weighted 0.5, divide by 4
    // Equivalent to: (n+s+e+w + (ne+nw+se+sw)*0.5) / 4 * 2 - prev
    float avg = (n + s + e + w + (ne + nw + se + sw) * 0.5) / 6.0;
    float prev = texture2D(tPrevious, vUv).r;

    float newH = avg * 2.0 - prev;

    // Damping
    newH = 0.5 + (newH - 0.5) * uDamping;
    newH = clamp(newH, 0.0, 1.0);

    gl_FragColor = vec4(newH, newH, newH, 1.0);
  }
`;

// Pass 1b: Drop a cosine blob onto the height buffer on beat
const DROP_FRAG = `
  uniform sampler2D tHeight;
  uniform vec2 uDropCenter;
  uniform float uDropRadius;
  uniform float uDropStrength;
  varying vec2 vUv;

  void main() {
    float existing = texture2D(tHeight, vUv).r;
    float dist = length(vUv - uDropCenter);
    float drop = 0.0;
    if (dist < uDropRadius) {
      drop = uDropStrength * (cos(dist / uDropRadius * 3.14159) * 0.5 + 0.5);
    }
    float h = clamp(existing + drop, 0.0, 1.0);
    gl_FragColor = vec4(h, h, h, 1.0);
  }
`;

// Pass 2: Refraction displacement
const REFRACT_FRAG = `
  uniform sampler2D tSource;
  uniform sampler2D tHeight;
  uniform vec2 uTexelSize;
  uniform float uDensity;
  varying vec2 vUv;

  void main() {
    float left  = texture2D(tHeight, vUv + vec2(-uTexelSize.x, 0.0)).r;
    float right = texture2D(tHeight, vUv + vec2( uTexelSize.x, 0.0)).r;
    float up    = texture2D(tHeight, vUv + vec2(0.0,  uTexelSize.y)).r;
    float down  = texture2D(tHeight, vUv + vec2(0.0, -uTexelSize.y)).r;

    float dx = (right - left);
    float dy = (up - down);

    vec2 displaced = vUv + vec2(dx, dy) * uDensity;
    displaced = clamp(displaced, 0.0, 1.0);

    gl_FragColor = texture2D(tSource, displaced);
  }
`;

export class WaterBump extends AvsComponent {
  constructor(opts) {
    super(opts);
    this.density = opts.density || 4;

    this._heightA = null;
    this._heightB = null;
    this._calcScene = null;
    this._calcMaterial = null;
    this._dropScene = null;
    this._dropMaterial = null;
    this._refractScene = null;
    this._refractMaterial = null;
    this._camera = null;
    this._pingPong = 0;
  }

  init(ctx) {
    this._camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const texelSize = new THREE.Vector2(1.0 / ctx.width, 1.0 / ctx.height);

    const opts = {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
    };
    this._heightA = new THREE.WebGLRenderTarget(ctx.width, ctx.height, opts);
    this._heightB = new THREE.WebGLRenderTarget(ctx.width, ctx.height, opts);

    // Clear to neutral (0.5)
    const prevClear = ctx.renderer.getClearColor(new THREE.Color());
    const prevAlpha = ctx.renderer.getClearAlpha();
    ctx.renderer.setClearColor(0x808080, 1);
    ctx.renderer.setRenderTarget(this._heightA);
    ctx.renderer.clear();
    ctx.renderer.setRenderTarget(this._heightB);
    ctx.renderer.clear();
    ctx.renderer.setClearColor(prevClear, prevAlpha);

    // CalcWater pass
    this._calcScene = new THREE.Scene();
    this._calcMaterial = new THREE.ShaderMaterial({
      uniforms: {
        tCurrent:  { value: null },
        tPrevious: { value: null },
        uTexelSize: { value: texelSize },
        uDamping: { value: 0.97 },
      },
      vertexShader: VERT_SHADER,
      fragmentShader: CALC_WATER_FRAG,
      depthTest: false,
    });
    this._calcScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this._calcMaterial));

    // Drop pass (on beat)
    this._dropScene = new THREE.Scene();
    this._dropMaterial = new THREE.ShaderMaterial({
      uniforms: {
        tHeight: { value: null },
        uDropCenter: { value: new THREE.Vector2(0.5, 0.5) },
        uDropRadius: { value: 0.1 },
        uDropStrength: { value: 0.15 },
      },
      vertexShader: VERT_SHADER,
      fragmentShader: DROP_FRAG,
      depthTest: false,
    });
    this._dropScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this._dropMaterial));

    // Refraction pass
    this._refractScene = new THREE.Scene();
    this._refractMaterial = new THREE.ShaderMaterial({
      uniforms: {
        tSource: { value: null },
        tHeight: { value: null },
        uTexelSize: { value: texelSize },
        uDensity: { value: this.density },
      },
      vertexShader: VERT_SHADER,
      fragmentShader: REFRACT_FRAG,
      depthTest: false,
    });
    this._refractScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this._refractMaterial));

    this._pingPong = 0;
  }

  render(ctx, fb) {
    if (!this.enabled) return;

    const current = this._pingPong === 0 ? this._heightA : this._heightB;
    const previous = this._pingPong === 0 ? this._heightB : this._heightA;

    // On beat: drop a cosine blob at a random position
    if (ctx.beat) {
      this._dropMaterial.uniforms.tHeight.value = current.texture;
      this._dropMaterial.uniforms.uDropCenter.value.set(
        0.2 + Math.random() * 0.6,
        0.2 + Math.random() * 0.6
      );
      this._dropMaterial.uniforms.uDropRadius.value = 0.05 + Math.random() * 0.1;

      // Render drop pass back into current (need a temp copy)
      // We can use previous as temp since we're about to overwrite it anyway
      ctx.renderer.setRenderTarget(previous);
      ctx.renderer.render(this._dropScene, this._camera);

      // Copy back to current
      // Actually, just swap the role: previous now has the drop, treat it as current
      this._pingPong = 1 - this._pingPong;
      // Re-get references after swap
      const c2 = this._pingPong === 0 ? this._heightA : this._heightB;
      const p2 = this._pingPong === 0 ? this._heightB : this._heightA;

      // CalcWater: read c2 (with drop), write to p2
      this._calcMaterial.uniforms.tCurrent.value = c2.texture;
      this._calcMaterial.uniforms.tPrevious.value = p2.texture;
      ctx.renderer.setRenderTarget(p2);
      ctx.renderer.render(this._calcScene, this._camera);
      this._pingPong = 1 - this._pingPong;
    } else {
      // CalcWater pass: simulate, write to previous
      this._calcMaterial.uniforms.tCurrent.value = current.texture;
      this._calcMaterial.uniforms.tPrevious.value = previous.texture;
      ctx.renderer.setRenderTarget(previous);
      ctx.renderer.render(this._calcScene, this._camera);
      this._pingPong = 1 - this._pingPong;
    }

    // New current after swap
    const newCurrent = this._pingPong === 0 ? this._heightA : this._heightB;

    // Refraction pass: displace source by height gradient
    this._refractMaterial.uniforms.tSource.value = fb.getActiveTexture();
    this._refractMaterial.uniforms.tHeight.value = newCurrent.texture;
    this._refractMaterial.uniforms.uDensity.value = this.density;

    ctx.renderer.setRenderTarget(fb.getBackTarget());
    ctx.renderer.render(this._refractScene, this._camera);
    fb.swap();
  }

  destroy() {
    if (this._heightA) this._heightA.dispose();
    if (this._heightB) this._heightB.dispose();
    if (this._calcMaterial) this._calcMaterial.dispose();
    if (this._dropMaterial) this._dropMaterial.dispose();
    if (this._refractMaterial) this._refractMaterial.dispose();
  }
}

AvsComponent.register('WaterBump', WaterBump);
