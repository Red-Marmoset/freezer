// Simple energy-based beat detector for AVS onBeat triggers

export class BeatDetector {
  constructor() {
    this.energyHistory = new Float32Array(60); // ~1 second at 60fps
    this.historyPos = 0;
    this.historyFull = false;
    this.cooldown = 0;
    this.threshold = 1.4;
    this.cooldownFrames = 12; // ~200ms at 60fps
  }

  update(spectrum) {
    if (!spectrum) return false;

    // Compute bass energy (first 10 bins of spectrum)
    let energy = 0;
    const bins = Math.min(10, spectrum.length);
    for (let i = 0; i < bins; i++) {
      // Spectrum is in dB, convert to linear energy
      const linear = Math.pow(10, spectrum[i] / 20);
      energy += linear * linear;
    }
    energy = Math.sqrt(energy / bins);

    // Update history
    this.energyHistory[this.historyPos] = energy;
    this.historyPos = (this.historyPos + 1) % this.energyHistory.length;
    if (this.historyPos === 0) this.historyFull = true;

    // Compute average energy
    const count = this.historyFull ? this.energyHistory.length : this.historyPos;
    if (count < 4) return false;

    let avg = 0;
    for (let i = 0; i < count; i++) avg += this.energyHistory[i];
    avg /= count;

    // Cooldown
    if (this.cooldown > 0) {
      this.cooldown--;
      return false;
    }

    // Beat detected if current energy exceeds average by threshold
    if (avg > 0 && energy > avg * this.threshold) {
      this.cooldown = this.cooldownFrames;
      return true;
    }

    return false;
  }
}
