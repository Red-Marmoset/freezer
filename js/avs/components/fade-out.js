// AVS FadeOut component — fades framebuffer toward a color (usually black)
// Creates the classic trailing/feedback effect.
import * as THREE from 'https://esm.sh/three@0.171.0';
import { AvsComponent } from '../avs-component.js';

export class FadeOut extends AvsComponent {
  constructor(opts) {
    super(opts);
    // Speed: 0 = no fade, 1 = instant fade. Typical: 0.05-0.2
    this.speed = opts.speed !== undefined ? opts.speed : 0.07;
    this.color = opts.color || '#000000';

    this._scene = null;
    this._camera = null;
    this._material = null;
    this._mesh = null;
  }

  init(ctx) {
    this._scene = new THREE.Scene();
    this._camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    const c = parseColor(this.color);
    this._material = new THREE.MeshBasicMaterial({
      color: new THREE.Color(c[0], c[1], c[2]),
      transparent: true,
      opacity: this.speed,
      depthTest: false,
    });
    this._mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      this._material
    );
    this._scene.add(this._mesh);
  }

  render(ctx, fb) {
    if (!this.enabled || this.speed <= 0) return;

    // Draw a semi-transparent quad over the active framebuffer
    // This blends the fade color with the existing content
    ctx.renderer.setRenderTarget(fb.getActiveTarget());
    ctx.renderer.render(this._scene, this._camera);
  }

  destroy() {
    if (this._material) this._material.dispose();
  }
}

function parseColor(c) {
  if (typeof c === 'string' && c[0] === '#') c = c.slice(1);
  const n = parseInt(c, 16) || 0;
  return [(n >> 16 & 0xff) / 255, (n >> 8 & 0xff) / 255, (n & 0xff) / 255];
}

AvsComponent.register('FadeOut', FadeOut);
