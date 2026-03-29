// AVS MovingParticle component (code 0x08) — single circle orbiting center
// Port of r_parts.cpp: a filled circle that orbits around the screen center
// using spring physics. On beat, the center target shifts to a random position.
import * as THREE from 'https://esm.sh/three@0.171.0';
import { AvsComponent } from '../avs-component.js';

export class MovingParticle extends AvsComponent {
  constructor(opts) {
    super(opts);
    this.color = opts.color || opts.colors || '#ffffff';
    if (typeof this.color === 'number') {
      // AVS stores as 0x00BBGGRR
      const r = this.color & 0xff;
      const g = (this.color >> 8) & 0xff;
      const b = (this.color >> 16) & 0xff;
      this.color = '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
    }
    this.maxdist = opts.maxdist || 16;
    this.size = opts.size || 8;
    this.size2 = opts.size2 || opts.onBeatSize || 8;
    this.blend = opts.blend || opts.blendMode || 1;

    // Spring physics state
    this._c = [0, 0];     // target center
    this._v = [-0.01551, 0]; // velocity
    this._p = [-0.6, 0.3];  // position
    this._spos = this.size;

    this._scene = null;
    this._camera = null;
    this._mesh = null;
    this._material = null;
  }

  init(ctx) {
    this._scene = new THREE.Scene();
    this._camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 10);
    this._camera.position.z = 1;

    // Circle geometry — unit circle, scaled by size in render
    const circleGeo = new THREE.CircleGeometry(1, 32);
    const c = parseColor(this.color);
    this._material = new THREE.MeshBasicMaterial({
      color: new THREE.Color(c[0], c[1], c[2]),
      depthTest: false,
    });
    this._mesh = new THREE.Mesh(circleGeo, this._material);
    this._scene.add(this._mesh);
  }

  render(ctx, fb) {
    if (!this.enabled) return;

    // On beat: shift target center randomly
    if (ctx.beat) {
      this._c[0] = ((Math.random() * 33 | 0) - 16) / 48;
      this._c[1] = ((Math.random() * 33 | 0) - 16) / 48;
      if (this.size2 !== this.size) {
        this._spos = this.size2;
      }
    }

    // Spring physics: accelerate toward target, damped
    this._v[0] -= 0.004 * (this._p[0] - this._c[0]);
    this._v[1] -= 0.004 * (this._p[1] - this._c[1]);
    this._p[0] += this._v[0];
    this._p[1] += this._v[1];
    this._v[0] *= 0.991;
    this._v[1] *= 0.991;

    // Size interpolation
    this._spos = (this._spos + this.size) / 2;
    const sz = Math.max(1, Math.min(128, this._spos));

    // Convert position to screen coords (-1 to 1)
    const scale = this.maxdist / 32;
    const x = this._p[0] * scale;
    const y = -this._p[1] * scale; // Y inverted

    // Scale circle: sz is in pixels, convert to NDC
    const pixelScale = sz / Math.min(ctx.width, ctx.height);

    this._mesh.position.set(x, y, 0);
    this._mesh.scale.set(pixelScale, pixelScale, 1);

    ctx.renderer.setRenderTarget(fb.getActiveTarget());
    ctx.renderer.render(this._scene, this._camera);
  }

  destroy() {
    if (this._material) this._material.dispose();
  }
}

function parseColor(c) {
  if (typeof c === 'string' && c[0] === '#') c = c.slice(1);
  const n = parseInt(c, 16) || 0xffffff;
  return [(n >> 16 & 0xff) / 255, (n >> 8 & 0xff) / 255, (n & 0xff) / 255];
}

AvsComponent.register('MovingParticle', MovingParticle);
