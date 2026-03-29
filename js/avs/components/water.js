// AVS Water component (code 0x14) — 2D wave distortion
// Port of r_water.cpp: uses the framebuffer as a height map to create
// a rippling water refraction effect. The previous frame's content
// is averaged with neighbors and fed back to create wave propagation.
import * as THREE from 'https://esm.sh/three@0.171.0';
import { AvsComponent } from '../avs-component.js';

const FRAG = `
  uniform sampler2D tSource;
  uniform sampler2D tPrev;
  uniform vec2 uTexelSize;
  varying vec2 vUv;

  void main() {
    // Sample 4 neighbors from previous frame
    vec3 left  = texture2D(tPrev, vUv + vec2(-uTexelSize.x, 0.0)).rgb;
    vec3 right = texture2D(tPrev, vUv + vec2( uTexelSize.x, 0.0)).rgb;
    vec3 up    = texture2D(tPrev, vUv + vec2(0.0,  uTexelSize.y)).rgb;
    vec3 down  = texture2D(tPrev, vUv + vec2(0.0, -uTexelSize.y)).rgb;

    // Average neighbors (water equation: spreads energy)
    vec3 avg = (left + right + up + down) / 2.0;

    // Current pixel from previous frame
    vec3 prev = texture2D(tPrev, vUv).rgb;

    // Use the difference as displacement for refraction
    float dx = (right.r + right.g + right.b) - (left.r + left.g + left.b);
    float dy = (up.r + up.g + up.b) - (down.r + down.g + down.b);

    // Displace UV sampling of source image
    vec2 displaced = vUv + vec2(dx, dy) * 0.02;
    displaced = clamp(displaced, 0.0, 1.0);

    // Mix: mostly source with displaced UVs, slight blend of averaged neighbors for persistence
    vec3 src = texture2D(tSource, displaced).rgb;
    gl_FragColor = vec4(mix(src, avg * 0.95, 0.1), 1.0);
  }
`;

export class Water extends AvsComponent {
  constructor(opts) {
    super(opts);
    this._prevFrame = null;
    this._scene = null;
    this._camera = null;
    this._material = null;
  }

  init(ctx) {
    this._prevFrame = new THREE.WebGLRenderTarget(ctx.width, ctx.height, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    });

    this._scene = new THREE.Scene();
    this._camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this._material = new THREE.ShaderMaterial({
      uniforms: {
        tSource: { value: null },
        tPrev: { value: null },
        uTexelSize: { value: new THREE.Vector2(1 / ctx.width, 1 / ctx.height) },
      },
      vertexShader: `varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
      fragmentShader: FRAG,
      depthTest: false,
    });
    this._scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this._material));

    // Copy scene for saving previous frame
    this._copyScene = new THREE.Scene();
    this._copyCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this._copyMaterial = new THREE.MeshBasicMaterial({ map: null, depthTest: false });
    this._copyScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this._copyMaterial));
  }

  render(ctx, fb) {
    if (!this.enabled) return;

    // Set uniforms
    this._material.uniforms.tSource.value = fb.getActiveTexture();
    this._material.uniforms.tPrev.value = this._prevFrame.texture;

    // Render water effect to back target
    ctx.renderer.setRenderTarget(fb.getBackTarget());
    ctx.renderer.render(this._scene, this._camera);

    // Save current result as previous frame for next iteration
    this._copyMaterial.map = fb.getBackTarget().texture;
    ctx.renderer.setRenderTarget(this._prevFrame);
    ctx.renderer.render(this._copyScene, this._copyCamera);

    fb.swap();

    // Null refs
    this._material.uniforms.tSource.value = null;
    this._material.uniforms.tPrev.value = null;
    this._copyMaterial.map = null;
  }

  destroy() {
    if (this._prevFrame) this._prevFrame.dispose();
    if (this._material) this._material.dispose();
    if (this._copyMaterial) this._copyMaterial.dispose();
  }
}

AvsComponent.register('Water', Water);
