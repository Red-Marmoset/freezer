// AVS Starfield component (code 0x1B) — r_stars.cpp
// 3D starfield that flies toward the viewer with beat-reactive speed boost.
import * as THREE from 'https://esm.sh/three@0.171.0';
import { AvsComponent } from '../avs-component.js';

const MAX_STARS = 4096;

export class Starfield extends AvsComponent {
  constructor(opts) {
    super(opts);
    this.numStars = Math.min(MAX_STARS, opts.numStars || 350);
    this.speed = opts.speed != null ? opts.speed : 16;
    this.onBeatAction = opts.onBeatAction || 0; // 0=no action, 1=speed boost
    this.onBeatDuration = opts.onBeatDuration || 15;
    this.color = opts.color ? parseHexColor(opts.color) : [1, 1, 1];

    // Runtime state
    this._stars = null;
    this._currentSpeed = 0;
    this._beatCounter = 0;
    this._scene = null;
    this._camera = null;
    this._geometry = null;
    this._material = null;
    this._points = null;
  }

  init(ctx) {
    this._scene = new THREE.Scene();
    this._camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 10);
    this._camera.position.z = 1;

    // Initialize star array
    this._stars = [];
    for (let i = 0; i < this.numStars; i++) {
      this._stars.push(this._spawnStar(true));
    }

    this._currentSpeed = this.speed;

    // Create points geometry
    this._geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(MAX_STARS * 3);
    const colors = new Float32Array(MAX_STARS * 3);
    this._geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this._geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this._geometry.setDrawRange(0, 0);

    this._material = new THREE.PointsMaterial({
      size: 2,
      vertexColors: true,
      sizeAttenuation: false,
    });
    this._material.depthTest = false;

    this._points = new THREE.Points(this._geometry, this._material);
    this._scene.add(this._points);
  }

  _spawnStar(initial) {
    return {
      x: (Math.random() - 0.5) * 512,
      y: (Math.random() - 0.5) * 512,
      z: initial ? (Math.random() * 255) : 255,
      speed: 1 + Math.random() * 4,
    };
  }

  render(ctx, fb) {
    if (!this.enabled || !this._stars) return;

    // Beat speed boost
    if (ctx.beat && this.onBeatAction === 1) {
      this._beatCounter = this.onBeatDuration;
    }

    let effectiveSpeed = this._currentSpeed;
    if (this._beatCounter > 0) {
      effectiveSpeed = this._currentSpeed * 3; // triple speed on beat
      this._beatCounter--;
    }

    const positions = this._geometry.attributes.position.array;
    const colorsBuf = this._geometry.attributes.color.array;

    const cx = 0; // center X in NDC
    const cy = 0; // center Y in NDC
    let drawCount = 0;

    for (let i = 0; i < this._stars.length; i++) {
      const star = this._stars[i];

      // Move star closer
      star.z -= star.speed * (effectiveSpeed / 32);

      // Respawn if behind camera
      if (star.z <= 1) {
        const newStar = this._spawnStar(false);
        star.x = newStar.x;
        star.y = newStar.y;
        star.z = newStar.z;
        star.speed = newStar.speed;
      }

      // Project to screen — AVS formula: screenX = x * 127 / z + centerX
      const projScale = 127 / star.z;
      const screenX = (star.x * projScale) / 256; // normalize to [-1, 1]
      const screenY = (star.y * projScale) / 256;

      // Cull off-screen stars
      if (screenX < -1.1 || screenX > 1.1 || screenY < -1.1 || screenY > 1.1) {
        continue;
      }

      // Brightness based on distance and speed
      const brightness = Math.min(1, ((255 - star.z) * star.speed) / (255 * 3));

      positions[drawCount * 3] = screenX + cx;
      positions[drawCount * 3 + 1] = screenY + cy;
      positions[drawCount * 3 + 2] = 0;

      colorsBuf[drawCount * 3] = this.color[0] * brightness;
      colorsBuf[drawCount * 3 + 1] = this.color[1] * brightness;
      colorsBuf[drawCount * 3 + 2] = this.color[2] * brightness;

      drawCount++;
    }

    this._geometry.attributes.position.needsUpdate = true;
    this._geometry.attributes.color.needsUpdate = true;
    this._geometry.setDrawRange(0, drawCount);

    ctx.renderer.setRenderTarget(fb.getActiveTarget());
    ctx.renderer.render(this._scene, this._camera);
  }

  destroy() {
    if (this._geometry) this._geometry.dispose();
    if (this._material) this._material.dispose();
    this._stars = null;
    this._scene = null;
    this._camera = null;
  }
}

function parseHexColor(hex) {
  if (typeof hex === 'string' && hex[0] === '#') hex = hex.slice(1);
  const n = parseInt(hex, 16);
  return [(n >> 16 & 0xff) / 255, (n >> 8 & 0xff) / 255, (n & 0xff) / 255];
}

AvsComponent.register('Starfield', Starfield);
// APE alias — some presets reference it by this name
AvsComponent.register('Winamp Starfield v1', Starfield);
