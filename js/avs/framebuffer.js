// Ping-pong WebGLRenderTarget manager for AVS framebuffer effects
import * as THREE from 'https://esm.sh/three@0.171.0';

export class Framebuffer {
  constructor(renderer, width, height) {
    this.renderer = renderer;
    this.width = width;
    this.height = height;

    const opts = {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
    };

    this.targets = [
      new THREE.WebGLRenderTarget(width, height, opts),
      new THREE.WebGLRenderTarget(width, height, opts),
    ];
    this.current = 0;

    // Full-screen quad for copy operations
    this._copyScene = new THREE.Scene();
    this._copyCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this._copyMaterial = new THREE.MeshBasicMaterial({ map: null });
    const quad = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      this._copyMaterial
    );
    this._copyScene.add(quad);
  }

  // The "active" target — components render onto this one.
  // After clear or copyToWrite, this contains the current frame content.
  getActiveTarget() {
    return this.targets[this.current];
  }

  // The texture of the active target (for display / reading)
  getActiveTexture() {
    return this.targets[this.current].texture;
  }

  // The "back" target — used as temp for ping-pong operations
  getBackTarget() {
    return this.targets[1 - this.current];
  }

  // Swap active/back
  swap() {
    this.current = 1 - this.current;
  }

  // Copy active target to back, then swap (for feedback effects).
  // After this call, active contains a copy and back has the original.
  copyForFeedback() {
    this._copyMaterial.map = this.getActiveTexture();
    this.renderer.setRenderTarget(this.getBackTarget());
    this.renderer.render(this._copyScene, this._copyCamera);
    this.swap();
  }

  // Clear the active target to a color
  clear(color = 0x000000, alpha = 1) {
    const prev = this.renderer.getClearColor(new THREE.Color());
    const prevAlpha = this.renderer.getClearAlpha();

    this.renderer.setRenderTarget(this.getActiveTarget());
    this.renderer.setClearColor(color, alpha);
    this.renderer.clear();

    this.renderer.setClearColor(prev, prevAlpha);
  }

  // Resize both targets
  resize(width, height) {
    this.width = width;
    this.height = height;
    this.targets[0].setSize(width, height);
    this.targets[1].setSize(width, height);
  }

  // Free GPU resources
  dispose() {
    this.targets[0].dispose();
    this.targets[1].dispose();
    this._copyMaterial.dispose();
  }
}
