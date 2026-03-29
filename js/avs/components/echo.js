// Echo — multi-layer feedback echo (MilkDrop echo_zoom/echo_alpha/echo_orient)
//
// Maintains a secondary framebuffer that accumulates a zoomed/rotated echo
// of the main rendering. Each frame, the echo buffer is composited over
// the main framebuffer at the specified alpha, creating ghostly trails.

import * as THREE from 'https://esm.sh/three@0.171.0';
import { AvsComponent } from '../avs-component.js';

const VERT = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Shader to zoom/rotate the echo buffer and blend with source
const FRAG_ECHO = `
  precision mediump float;
  uniform sampler2D tEcho;
  uniform float uZoom;
  uniform float uOrient;  // 0=none, 1=flipX, 2=flipY, 3=flipBoth
  varying vec2 vUv;
  void main() {
    vec2 uv = (vUv - 0.5) * uZoom + 0.5;
    if (uOrient == 1.0 || uOrient == 3.0) uv.x = 1.0 - uv.x;
    if (uOrient == 2.0 || uOrient == 3.0) uv.y = 1.0 - uv.y;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
      gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
    } else {
      gl_FragColor = texture2D(tEcho, uv);
    }
  }
`;

// Shader to composite echo over main frame
const FRAG_COMPOSITE = `
  precision mediump float;
  uniform sampler2D tSource;
  uniform sampler2D tEcho;
  uniform float uAlpha;
  varying vec2 vUv;
  void main() {
    vec4 src = texture2D(tSource, vUv);
    vec4 echo = texture2D(tEcho, vUv);
    gl_FragColor = vec4(mix(src.rgb, echo.rgb, uAlpha), 1.0);
  }
`;

export class Echo extends AvsComponent {
  constructor(opts) {
    super(opts);
    this.zoom = opts.zoom !== undefined ? opts.zoom : 1.0;
    this.alpha = opts.alpha !== undefined ? opts.alpha : 0.5;
    this.orient = opts.orient !== undefined ? opts.orient : 0;
    this._echoTarget = null;
    this._echoTempTarget = null;
    this._echoScene = null;
    this._compScene = null;
    this._camera = null;
    this._echoMaterial = null;
    this._compMaterial = null;
  }

  init(ctx) {
    this._camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const geo = new THREE.PlaneGeometry(2, 2);

    // Echo buffer — persists between frames
    this._echoTarget = new THREE.WebGLRenderTarget(ctx.width, ctx.height, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    });
    this._echoTempTarget = new THREE.WebGLRenderTarget(ctx.width, ctx.height, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    });

    // Echo transform scene (zoom/orient the echo buffer)
    this._echoMaterial = new THREE.ShaderMaterial({
      uniforms: {
        tEcho: { value: null },
        uZoom: { value: this.zoom },
        uOrient: { value: this.orient },
      },
      vertexShader: VERT,
      fragmentShader: FRAG_ECHO,
      depthTest: false,
    });
    this._echoScene = new THREE.Scene();
    this._echoScene.add(new THREE.Mesh(geo.clone(), this._echoMaterial));

    // Composite scene (blend echo over main)
    this._compMaterial = new THREE.ShaderMaterial({
      uniforms: {
        tSource: { value: null },
        tEcho: { value: null },
        uAlpha: { value: this.alpha },
      },
      vertexShader: VERT,
      fragmentShader: FRAG_COMPOSITE,
      depthTest: false,
    });
    this._compScene = new THREE.Scene();
    this._compScene.add(new THREE.Mesh(geo.clone(), this._compMaterial));
  }

  render(ctx, fb) {
    if (!this.enabled || !this._echoTarget) return;

    // Step 1: Store current main frame into echo buffer (with zoom/orient)
    this._echoMaterial.uniforms.tEcho.value = this._echoTarget.texture;
    this._echoMaterial.uniforms.uZoom.value = this.zoom;
    this._echoMaterial.uniforms.uOrient.value = this.orient;

    ctx.renderer.setRenderTarget(this._echoTempTarget);
    ctx.renderer.render(this._echoScene, this._camera);
    this._echoMaterial.uniforms.tEcho.value = null;

    // Swap echo targets
    [this._echoTarget, this._echoTempTarget] = [this._echoTempTarget, this._echoTarget];

    // Step 2: Composite echo over main framebuffer
    this._compMaterial.uniforms.tSource.value = fb.getActiveTexture();
    this._compMaterial.uniforms.tEcho.value = this._echoTarget.texture;
    this._compMaterial.uniforms.uAlpha.value = this.alpha;

    ctx.renderer.setRenderTarget(fb.getBackTarget());
    ctx.renderer.render(this._compScene, this._camera);
    this._compMaterial.uniforms.tSource.value = null;
    this._compMaterial.uniforms.tEcho.value = null;
    fb.swap();
  }

  destroy() {
    if (this._echoTarget) this._echoTarget.dispose();
    if (this._echoTempTarget) this._echoTempTarget.dispose();
    if (this._echoMaterial) this._echoMaterial.dispose();
    if (this._compMaterial) this._compMaterial.dispose();
  }
}

AvsComponent.register('Echo', Echo);
