// AVS Water component (code 0x14) — 2D wave equation simulation
// Two ping-pong height buffers. Each frame the wave equation is evaluated:
//   new_height = average_of_4_neighbors / 2 - old_height
// The resulting height field is used to displace UV sampling of the source framebuffer.
import * as THREE from 'https://esm.sh/three@0.171.0';
import { AvsComponent } from '../avs-component.js';

const VERT_SHADER = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Pass 1: Wave equation simulation
// Reads current height buffer (tCurrent) and previous height buffer (tPrevious),
// writes new height into output (stored in red channel as signed value mapped to 0-1).
const WAVE_FRAG = `
  uniform sampler2D tCurrent;
  uniform sampler2D tPrevious;
  uniform vec2 uTexelSize;
  varying vec2 vUv;

  void main() {
    // Sample 4 neighbors from current height buffer
    float left  = texture2D(tCurrent, vUv + vec2(-uTexelSize.x, 0.0)).r;
    float right = texture2D(tCurrent, vUv + vec2( uTexelSize.x, 0.0)).r;
    float up    = texture2D(tCurrent, vUv + vec2(0.0,  uTexelSize.y)).r;
    float down  = texture2D(tCurrent, vUv + vec2(0.0, -uTexelSize.y)).r;

    float prev = texture2D(tPrevious, vUv).r;

    // Wave equation: new = avg(neighbors) - prev
    // Heights are stored as 0.5 = zero, range [0, 1] maps to [-0.5, 0.5]
    float avg = (left + right + up + down) / 2.0;
    float newHeight = avg - prev;

    // Damping
    newHeight = newHeight * 0.98;

    // Clamp to valid range
    newHeight = clamp(newHeight, 0.0, 1.0);

    gl_FragColor = vec4(newHeight, newHeight, newHeight, 1.0);
  }
`;

// Pass 2: Displacement rendering
// Uses the height buffer gradient to displace UV sampling of the source image.
const DISPLACE_FRAG = `
  uniform sampler2D tSource;
  uniform sampler2D tHeight;
  uniform vec2 uTexelSize;
  varying vec2 vUv;

  void main() {
    // Compute gradient of the height field
    float left  = texture2D(tHeight, vUv + vec2(-uTexelSize.x, 0.0)).r;
    float right = texture2D(tHeight, vUv + vec2( uTexelSize.x, 0.0)).r;
    float up    = texture2D(tHeight, vUv + vec2(0.0,  uTexelSize.y)).r;
    float down  = texture2D(tHeight, vUv + vec2(0.0, -uTexelSize.y)).r;

    float dx = right - left;
    float dy = up - down;

    // Displace UV by gradient (scale factor controls refraction strength)
    vec2 displaced = vUv + vec2(dx, dy) * 8.0;
    displaced = clamp(displaced, 0.0, 1.0);

    gl_FragColor = texture2D(tSource, displaced);
  }
`;

export class Water extends AvsComponent {
  constructor(opts) {
    super(opts);
    this._heightA = null;
    this._heightB = null;
    this._waveScene = null;
    this._waveCamera = null;
    this._waveMaterial = null;
    this._displaceScene = null;
    this._displaceCamera = null;
    this._displaceMaterial = null;
    this._pingPong = 0;
  }

  init(ctx) {
    const opts = {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
    };

    this._heightA = new THREE.WebGLRenderTarget(ctx.width, ctx.height, opts);
    this._heightB = new THREE.WebGLRenderTarget(ctx.width, ctx.height, opts);

    // Clear both height buffers to 0.5 (neutral height)
    const prevClear = ctx.renderer.getClearColor(new THREE.Color());
    const prevAlpha = ctx.renderer.getClearAlpha();
    ctx.renderer.setClearColor(0x808080, 1);
    ctx.renderer.setRenderTarget(this._heightA);
    ctx.renderer.clear();
    ctx.renderer.setRenderTarget(this._heightB);
    ctx.renderer.clear();
    ctx.renderer.setClearColor(prevClear, prevAlpha);

    const texelSize = new THREE.Vector2(1.0 / ctx.width, 1.0 / ctx.height);

    // Wave simulation pass
    this._waveScene = new THREE.Scene();
    this._waveCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this._waveMaterial = new THREE.ShaderMaterial({
      uniforms: {
        tCurrent:  { value: null },
        tPrevious: { value: null },
        uTexelSize: { value: texelSize },
      },
      vertexShader: VERT_SHADER,
      fragmentShader: WAVE_FRAG,
      depthTest: false,
    });
    this._waveScene.add(new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      this._waveMaterial
    ));

    // Displacement rendering pass
    this._displaceScene = new THREE.Scene();
    this._displaceCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this._displaceMaterial = new THREE.ShaderMaterial({
      uniforms: {
        tSource: { value: null },
        tHeight: { value: null },
        uTexelSize: { value: texelSize },
      },
      vertexShader: VERT_SHADER,
      fragmentShader: DISPLACE_FRAG,
      depthTest: false,
    });
    this._displaceScene.add(new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      this._displaceMaterial
    ));

    this._pingPong = 0;
  }

  render(ctx, fb) {
    if (!this.enabled) return;

    const current = this._pingPong === 0 ? this._heightA : this._heightB;
    const previous = this._pingPong === 0 ? this._heightB : this._heightA;

    // Pass 1: compute new wave heights, write to 'previous' (it becomes the new current)
    this._waveMaterial.uniforms.tCurrent.value = current.texture;
    this._waveMaterial.uniforms.tPrevious.value = previous.texture;

    ctx.renderer.setRenderTarget(previous);
    ctx.renderer.render(this._waveScene, this._waveCamera);

    // Swap: previous is now the new current
    this._pingPong = 1 - this._pingPong;

    // The new current height buffer is what we just wrote to
    const newCurrent = previous;

    // Pass 2: displace source image by height gradient
    this._displaceMaterial.uniforms.tSource.value = fb.getActiveTexture();
    this._displaceMaterial.uniforms.tHeight.value = newCurrent.texture;

    ctx.renderer.setRenderTarget(fb.getBackTarget());
    ctx.renderer.render(this._displaceScene, this._displaceCamera);
    fb.swap();
  }

  destroy() {
    if (this._heightA) this._heightA.dispose();
    if (this._heightB) this._heightB.dispose();
    if (this._waveMaterial) this._waveMaterial.dispose();
    if (this._displaceMaterial) this._displaceMaterial.dispose();
  }
}

AvsComponent.register('Water', Water);
