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
  let _sourceType = null;

  // Detect if browser supports audio capture via getDisplayMedia
  // Chrome/Edge: yes. Firefox/Safari: no.
  const canScreenShareAudio = /Chrome|Edg/.test(navigator.userAgent) && !/OPR/.test(navigator.userAgent)
    && typeof navigator.mediaDevices?.getDisplayMedia === 'function';

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
    _sourceType = null;
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
      if (stream.getAudioTracks().length === 0) {
        throw new Error('No audio track \u2014 try sharing a tab with audio playing');
      }
      currentSource = audioCtx.createMediaStreamSource(stream);
      currentSource.connect(analyser);
      _sourceType = 'system';
    } else if (type === 'mic') {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        }
      });
      currentStream = stream;
      currentSource = audioCtx.createMediaStreamSource(stream);
      currentSource.connect(analyser);
      _sourceType = 'mic';
    }
  }

  function loadFile(file) {
    ensureContext();
    disconnectCurrent();

    if (!audioEl) {
      audioEl = new Audio();
      audioEl.crossOrigin = 'anonymous';
      audioEl.loop = true;
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
    _sourceType = 'file';
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
    get sourceType() { return _sourceType; },
    get canScreenShareAudio() { return canScreenShareAudio; },
    get audioElement() { return audioEl; },
    switchSource,
    loadFile,
    update
  };
}
