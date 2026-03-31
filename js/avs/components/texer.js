// AVS Texer v1 APE — scans framebuffer for non-black pixels and stamps
// a sprite image at each position. Essentially a texture-based bloom/glow.
// NOT programmable (no EEL code). Positions come from the existing framebuffer.
import * as THREE from 'https://esm.sh/three@0.171.0';
import { AvsComponent } from '../avs-component.js';
import { loadAvsImage, getFallbackTexture } from '../image-loader.js';

const MAX_PARTICLES = 4096;

// Vertex shader: instanced quads
const VERT = `
  attribute vec2 offset;
  attribute vec3 instancePos;
  attribute vec2 instanceSize;
  attribute vec3 instanceColor;
  varying vec2 vUv;
  varying vec3 vColor;
  void main() {
    vUv = offset + 0.5;
    vColor = instanceColor;
    vec2 pos = instancePos.xy + offset * instanceSize;
    gl_Position = vec4(pos, 0.0, 1.0);
  }
`;

// Fragment shader: with optional colorize (multiply sprite by source pixel color)
const FRAG = `
  precision mediump float;
  uniform sampler2D tSprite;
  uniform int uColorize;
  varying vec2 vUv;
  varying vec3 vColor;
  void main() {
    vec4 tex = texture2D(tSprite, vUv);
    vec3 c = uColorize == 1 ? tex.rgb * vColor : tex.rgb;
    if (tex.a < 0.01 || dot(c, c) < 0.001) discard;
    gl_FragColor = vec4(c, tex.a);
  }
`;

// Scan shader: reads framebuffer to find non-black pixels on CPU
// We sample the framebuffer at a grid resolution to find bright pixels

export class Texer extends AvsComponent {
  constructor(opts) {
    super(opts);
    this.imageSrc = opts.imageSrc || '';
    this.numParticles = opts.numParticles || 512;
    this.inputMode = opts.inputMode || 0;   // 0=replace(black bg), 1=additive(keep bg)
    this.outputMode = opts.outputMode || 0; // 0=normal, 1=colorize
    this._imageWidth = 32;
    this._imageHeight = 32;

    this._scene = null;
    this._camera = null;
    this._geometry = null;
    this._material = null;
    this._mesh = null;
    this._blobTexture = null;
    this._readBuffer = null;
  }

  init(ctx) {
    this._scene = new THREE.Scene();
    this._camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 10);
    this._camera.position.z = 1;

    this._blobTexture = getFallbackTexture();
    if (this.imageSrc) {
      loadAvsImage(this.imageSrc).then(tex => {
        this._blobTexture = tex;
        this._imageWidth = tex.image ? tex.image.width : 32;
        this._imageHeight = tex.image ? tex.image.height : 32;
        if (this._material) this._material.uniforms.tSprite.value = tex;
      });
    }

    // Instanced geometry
    const quadVerts = new Float32Array([-0.5,-0.5, 0.5,-0.5, 0.5,0.5, -0.5,0.5]);
    const quadIdx = new Uint16Array([0,1,2, 0,2,3]);
    this._geometry = new THREE.InstancedBufferGeometry();
    this._geometry.setAttribute('offset', new THREE.BufferAttribute(quadVerts, 2));
    this._geometry.setIndex(new THREE.BufferAttribute(quadIdx, 1));

    const instancePos = new Float32Array(MAX_PARTICLES * 3);
    const instanceSize = new Float32Array(MAX_PARTICLES * 2);
    const instanceColor = new Float32Array(MAX_PARTICLES * 3);
    this._posAttr = new THREE.InstancedBufferAttribute(instancePos, 3);
    this._sizeAttr = new THREE.InstancedBufferAttribute(instanceSize, 2);
    this._colorAttr = new THREE.InstancedBufferAttribute(instanceColor, 3);
    this._geometry.setAttribute('instancePos', this._posAttr);
    this._geometry.setAttribute('instanceSize', this._sizeAttr);
    this._geometry.setAttribute('instanceColor', this._colorAttr);
    this._geometry.instanceCount = 0;

    this._material = new THREE.RawShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        tSprite: { value: this._blobTexture },
        uColorize: { value: this.outputMode ? 1 : 0 },
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
    });

    this._mesh = new THREE.Mesh(this._geometry, this._material);
    this._mesh.frustumCulled = false;
    this._scene.add(this._mesh);

    // Downscaled render target for framebuffer scanning
    // Much smaller than screen resolution for fast readback
    const scanRes = Math.ceil(Math.sqrt(this.numParticles * 2));
    this._scanW = Math.min(scanRes, ctx.width);
    this._scanH = Math.min(scanRes, ctx.height);
    this._scanTarget = new THREE.WebGLRenderTarget(this._scanW, this._scanH, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    });
    this._scanScene = new THREE.Scene();
    this._scanCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this._scanMat = new THREE.MeshBasicMaterial({ map: null, depthTest: false });
    this._scanScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this._scanMat));
    this._readBuffer = new Uint8Array(this._scanW * this._scanH * 4);
  }

  render(ctx, fb) {
    if (!this.enabled) return;

    const w = ctx.width;
    const h = ctx.height;
    const gl = ctx.renderer.getContext();
    const scanW = this._scanW;
    const scanH = this._scanH;

    // Render active framebuffer downscaled to scan target
    this._scanMat.map = fb.getActiveTexture();
    ctx.renderer.setRenderTarget(this._scanTarget);
    ctx.renderer.render(this._scanScene, this._scanCam);
    this._scanMat.map = null;

    // Read the small scan target (fast — only scanW*scanH pixels)
    gl.readPixels(0, 0, scanW, scanH, gl.RGBA, gl.UNSIGNED_BYTE, this._readBuffer);
    ctx.renderer.setRenderTarget(null);

    // Scan for non-black pixels and collect positions
    const posArr = this._posAttr.array;
    const sizeArr = this._sizeAttr.array;
    const colorArr = this._colorAttr.array;
    const sizeX = this._imageWidth / w * 2;
    const sizeY = this._imageHeight / h * 2;
    let count = 0;

    for (let sy = 0; sy < scanH && count < MAX_PARTICLES && count < this.numParticles; sy++) {
      for (let sx = 0; sx < scanW && count < MAX_PARTICLES && count < this.numParticles; sx++) {
        const idx = (sy * scanW + sx) * 4;
        const r = this._readBuffer[idx];
        const g = this._readBuffer[idx + 1];
        const b = this._readBuffer[idx + 2];

        // Skip black/near-black pixels
        if (r + g + b < 8) continue;

        // Convert scan coordinates to NDC (-1 to 1)
        const px = (sx + 0.5) / scanW * 2 - 1;
        const py = (sy + 0.5) / scanH * 2 - 1;

        posArr[count * 3] = px;
        posArr[count * 3 + 1] = py;
        posArr[count * 3 + 2] = 0;
        sizeArr[count * 2] = sizeX;
        sizeArr[count * 2 + 1] = sizeY;
        colorArr[count * 3] = r / 255;
        colorArr[count * 3 + 1] = g / 255;
        colorArr[count * 3 + 2] = b / 255;
        count++;
      }
    }

    this._posAttr.needsUpdate = true;
    this._sizeAttr.needsUpdate = true;
    this._colorAttr.needsUpdate = true;
    this._geometry.instanceCount = count;

    if (count > 0) {
      // If inputMode is 0 (replace), clear the active FB first
      if (this.inputMode === 0) {
        fb.clear(0x000000);
      }

      ctx.renderer.setRenderTarget(fb.getActiveTarget());
      ctx.renderer.render(this._scene, this._camera);
    }
  }

  destroy() {
    if (this._geometry) this._geometry.dispose();
    if (this._material) this._material.dispose();
    if (this._scanTarget) this._scanTarget.dispose();
    if (this._scanMat) this._scanMat.dispose();
  }
}

AvsComponent.register('Texer', Texer);
