export function createAudioEngine() {
  let audioCtx = null;
  let analyser = null;
  let currentSource = null;
  let currentStream = null;
  let audioEl = null;
  let mediaElSource = null;
  const fftSize = 2048;
  let waveform = null;
  let spectrum = null;
  let spectrumBytes = null;

  function ensureContext() {
    if (!audioCtx) {
      audioCtx = new AudioContext();
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = fftSize;
      waveform = new Uint8Array(analyser.frequencyBinCount);
      spectrum = new Float32Array(analyser.frequencyBinCount);
      spectrumBytes = new Uint8Array(analyser.frequencyBinCount);
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
  }

  function disconnectCurrent() {
    if (currentSource) {
      try { currentSource.disconnect(); } catch {}
      currentSource = null;
    }
    if (analyser) {
      try { analyser.disconnect(); } catch {}
    }
    if (currentStream) {
      currentStream.getTracks().forEach(t => t.stop());
      currentStream = null;
    }
    if (audioEl) {
      audioEl.pause();
      audioEl.src = '';
    }
  }

  async function switchSource(type) {
    ensureContext();
    disconnectCurrent();

    if (type === 'system') {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        audio: true,
        video: true
      });
      // Stop the video track — we only need audio
      stream.getVideoTracks().forEach(t => t.stop());
      currentStream = stream;
      currentSource = audioCtx.createMediaStreamSource(stream);
      currentSource.connect(analyser);
      // Don't connect to destination — avoids feedback loop
    } else if (type === 'mic') {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      currentStream = stream;
      currentSource = audioCtx.createMediaStreamSource(stream);
      currentSource.connect(analyser);
      // Don't connect to destination — avoids feedback loop
    } else if (type === 'file') {
      // File source is handled via loadFile()
      document.getElementById('file-input').click();
    }
  }

  function loadFile(file) {
    ensureContext();
    disconnectCurrent();

    if (!audioEl) {
      audioEl = new Audio();
      audioEl.crossOrigin = 'anonymous';
    }

    const url = URL.createObjectURL(file);
    audioEl.src = url;
    audioEl.play();

    // Only create MediaElementSource once per audio element
    if (!mediaElSource) {
      mediaElSource = audioCtx.createMediaElementSource(audioEl);
    }
    currentSource = mediaElSource;
    currentSource.connect(analyser);
    analyser.connect(audioCtx.destination); // Play audio through speakers
  }

  function update() {
    if (!analyser) return;
    analyser.getByteTimeDomainData(waveform);
    analyser.getFloatFrequencyData(spectrum);
    analyser.getByteFrequencyData(spectrumBytes);
  }

  return {
    get waveform() { return waveform; },
    get spectrum() { return spectrum; },
    get spectrumBytes() { return spectrumBytes; },
    get fftSize() { return fftSize; },
    switchSource,
    loadFile,
    update
  };
}
