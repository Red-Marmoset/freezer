// AVS Texer APE component — renders a sprite image at waveform-driven positions
// Texer v1 is NOT programmable (no EEL code). It places particles along the
// waveform with configurable count and blend mode.
import * as THREE from 'https://esm.sh/three@0.171.0';
import { AvsComponent } from '../avs-component.js';
import { loadAvsImage, getFallbackTexture } from '../image-loader.js';

const MAX_POINTS = 4096;

const VERT_SHADER = `
  attribute vec2 offset;
  attribute vec3 instancePos;
  attribute vec2 instanceSize;
  varying vec2 vUv;

  void main() {
    vUv = offset + 0.5;
    vec2 pos = instancePos.xy + offset * instanceSize;
    gl_Position = vec4(pos, 0.0, 1.0);
  }
`;

const FRAG_SHADER = `
  precision mediump float;
  uniform sampler2D tSprite;
  varying vec2 vUv;

  void main() {
    vec4 tex = texture2D(tSprite, vUv);
    gl_FragColor = tex;
  }
`;

export class Texer extends AvsComponent {
  constructor(opts) {
    super(opts);

    this.imageSrc = opts.imageSrc || '';
    this.wrap = opts.wrap !== false;
    this.resize = opts.resize !== false;
    this.numParticles = opts.numParticles || 100;

    this._scene = null;
    this._camera = null;
    this._geometry = null;
    this._material = null;
    this._mesh = null;
    this._blobTexture = null;
    this._imageWidth = 32;
    this._imageHeight = 32;
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

    const instancePos = new Float32Array(MAX_POINTS * 3);
    const instanceSize = new Float32Array(MAX_POINTS * 2);
    this._instancePosAttr = new THREE.InstancedBufferAttribute(instancePos, 3);
    this._instanceSizeAttr = new THREE.InstancedBufferAttribute(instanceSize, 2);
    this._geometry.setAttribute('instancePos', this._instancePosAttr);
    this._geometry.setAttribute('instanceSize', this._instanceSizeAttr);
    this._geometry.instanceCount = 0;

    this._material = new THREE.RawShaderMaterial({
      vertexShader: VERT_SHADER,
      fragmentShader: FRAG_SHADER,
      uniforms: { tSprite: { value: this._blobTexture } },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
    });

    this._mesh = new THREE.Mesh(this._geometry, this._material);
    this._mesh.frustumCulled = false;
    this._scene.add(this._mesh);
  }

  render(ctx, fb) {
    if (!this.enabled) return;

    const waveform = ctx.audioData.waveform;
    const n = Math.min(MAX_POINTS, this.numParticles);
    if (n <= 0) return;

    const sizeX = this._imageWidth / ctx.width * 2;
    const sizeY = this._imageHeight / ctx.height * 2;

    const posArr = this._instancePosAttr.array;
    const sizeArr = this._instanceSizeAttr.array;
    const sampleCount = waveform ? waveform.length : 576;

    for (let i = 0; i < n; i++) {
      const t = n > 1 ? i / (n - 1) : 0;
      const x = t * 2 - 1;
      const sampleIdx = Math.floor(t * (sampleCount - 1));
      const v = waveform ? (waveform[sampleIdx] - 128) / 128 : 0;
      const y = -v;

      posArr[i * 3] = x;
      posArr[i * 3 + 1] = y;
      posArr[i * 3 + 2] = 0;
      sizeArr[i * 2] = sizeX;
      sizeArr[i * 2 + 1] = sizeY;
    }

    this._instancePosAttr.needsUpdate = true;
    this._instanceSizeAttr.needsUpdate = true;
    this._geometry.instanceCount = n;

    ctx.renderer.setRenderTarget(fb.getActiveTarget());
    ctx.renderer.render(this._scene, this._camera);
  }

  destroy() {
    if (this._geometry) this._geometry.dispose();
    if (this._material) this._material.dispose();
  }
}

AvsComponent.register('Texer', Texer);
