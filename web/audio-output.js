// Bounded Web Audio scheduling of RTL PCM. No oscillators or sample synthesis.
export class AudioOutput {
  context = null;
  sources = new Set();
  nextTime = 0;

  async unlock() {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) throw new Error("Web Audio is unavailable in this browser.");
    this.context ||= new AudioContext();
    // Called directly from Run's click handler, before any worker await.
    let timeout;
    try {
      await Promise.race([
        this.context.resume(),
        new Promise((_, reject) => {
          timeout = setTimeout(() => reject(new Error("Audio did not unlock. Allow sound for this site.")), 5000);
        }),
      ]);
    } finally { clearTimeout(timeout); }
    if (this.context.state !== "running") throw new Error("Audio is blocked. Allow sound for this site and click Run again.");
  }

  queuedSeconds() {
    return this.context ? Math.max(0, this.nextTime - this.context.currentTime) : 0;
  }

  play(samples, sampleRate) {
    if (!samples?.length) return;
    if (this.context?.state !== "running") throw new Error("Audio was suspended. Allow sound for this site and click Run again.");
    const context = this.context;
    const start = Math.max(this.nextTime, context.currentTime + 0.02);
    // At most 250 ms of audio may be scheduled, including this batch.
    if (start - context.currentTime + samples.length / sampleRate > 0.25) return;
    const buffer = context.createBuffer(1, samples.length, sampleRate);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) channel[i] = samples[i] / 32768;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    this.sources.add(source);
    source.onended = () => { source.disconnect(); this.sources.delete(source); };
    source.start(start);
    this.nextTime = start + buffer.duration;
  }

  clear() {
    for (const source of this.sources) { source.stop(); source.disconnect(); }
    this.sources.clear();
    this.nextTime = 0;
  }

  close() {
    this.clear();
    if (this.context) this.context.close().catch(() => {});
    this.context = null;
  }
}
