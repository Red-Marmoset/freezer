// AVS Convolution Filter APE (Holden03: Convolution Filter)
// 7x7 kernel convolution as a full-screen post-processing pass.
// Ported from Tom Holden's original AVS APE plugin (2002).
import * as THREE from 'https://esm.sh/three@0.171.0';
import { AvsComponent } from '../avs-component.js';

const KERNEL_DIM = 7;
const KERNEL_SIZE = KERNEL_DIM * KERNEL_DIM; // 49

// Build the fragment shader with the kernel loop fully unrolled
// to avoid non-constant array indexing issues in WebGL1 GLSL ES.
function buildFragShader(kernel, scale, bias, wrap, absolute, twoPass) {
  // Build the convolution sum as explicit lines
  const lines = [];
  for (let ky = 0; ky < 7; ky++) {
    for (let kx = 0; kx < 7; kx++) {
      const idx = ky * 7 + kx;
      const w = kernel[idx] || 0;
      if (w === 0) continue;
      const ox = kx - 3;
      const oy = ky - 3;
      lines.push(`sum += texture2D(tSource, vUv + vec2(${ox}.0, ${oy}.0) * texel).rgb * ${w.toFixed(1)};`);
    }
  }

  // If two-pass, build rotated version (swap x/y offsets)
  const rotLines = [];
  if (twoPass) {
    for (let ky = 0; ky < 7; ky++) {
      for (let kx = 0; kx < 7; kx++) {
        const idx = ky * 7 + kx;
        const w = kernel[idx] || 0;
        if (w === 0) continue;
        // Rotated 90: swap and mirror
        const ox = ky - 3;  // was ky for y-offset, now x
        const oy = kx - 3;  // was kx for x-offset, now y
        rotLines.push(`rot += texture2D(tSource, vUv + vec2(${ox}.0, ${oy}.0) * texel).rgb * ${w.toFixed(1)};`);
      }
    }
  }

  const safeScale = scale !== 0 ? scale : 1;

  return `
    precision highp float;
    uniform sampler2D tSource;
    uniform vec2 uResolution;
    varying vec2 vUv;

    void main() {
      vec2 texel = 1.0 / uResolution;

      // Convolution in 0-255 space
      vec3 sum = vec3(0.0);
      ${lines.map(l => '      ' + l).join('\n')}
      sum *= 255.0;

${twoPass ? `
      vec3 rot = vec3(0.0);
      ${rotLines.map(l => '      ' + l).join('\n')}
      rot *= 255.0;
      sum = min(sum + rot, vec3(65025.0));
` : ''}

      // Bias and scale
      vec3 result = (sum + ${bias.toFixed(1)}) / ${safeScale.toFixed(1)};

${absolute ? '      result = abs(result);' : wrap ? '      result = mod(result, 256.0);' : ''}

      result = clamp(result / 255.0, 0.0, 1.0);
      gl_FragColor = vec4(result, 1.0);
    }
  `;
}

const CONV_VERT = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export class ConvolutionFilter extends AvsComponent {
  constructor(opts) {
    super(opts);

    // 7x7 kernel (49 values), default = identity (center = 1)
    this.kernel = opts.kernel || new Array(KERNEL_SIZE).fill(0);
    if (!opts.kernel) this.kernel[24] = 1; // center element

    this.scale = opts.scale || 1;
    this.bias = opts.bias || 0;
    this.wrap = opts.wrap || false;
    this.absolute = opts.absolute || false;
    this.twoPass = opts.twoPass || false;

    this._scene = null;
    this._camera = null;
    this._material = null;
    this._mesh = null;
  }

  init(ctx) {
    this._scene = new THREE.Scene();
    this._camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 10);
    this._camera.position.z = 1;

    this._buildMaterial(ctx.width, ctx.height);

    const quad = new THREE.PlaneGeometry(2, 2);
    this._mesh = new THREE.Mesh(quad, this._material);
    this._scene.add(this._mesh);
  }

  _buildMaterial(width, height) {
    if (this._material) this._material.dispose();

    const frag = buildFragShader(
      this.kernel, this.scale, this.bias,
      this.wrap, this.absolute, this.twoPass
    );

    this._material = new THREE.ShaderMaterial({
      vertexShader: CONV_VERT,
      fragmentShader: frag,
      uniforms: {
        tSource: { value: null },
        uResolution: { value: new THREE.Vector2(width, height) },
      },
      depthTest: false,
    });
  }

  render(ctx, fb) {
    if (!this.enabled || !this._material) return;

    // Update resolution
    this._material.uniforms.uResolution.value.set(ctx.width, ctx.height);

    // Read from active, write to back, swap
    this._material.uniforms.tSource.value = fb.getActiveTexture();
    ctx.renderer.setRenderTarget(fb.getBackTarget());
    ctx.renderer.render(this._scene, this._camera);
    this._material.uniforms.tSource.value = null;
    fb.swap();
  }

  destroy() {
    if (this._material) this._material.dispose();
    this._scene = null;
    this._camera = null;
  }
}

AvsComponent.register('Holden03: Convolution Filter', ConvolutionFilter);
