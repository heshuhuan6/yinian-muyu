import { xorshift } from './world';

/** A short, hollow wooden impulse. Synthesized locally; there are no audio files. */
export class WoodSound {
  private context: AudioContext | null = null;
  private output: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private nodes = new Set<AudioNode>();
  enabled = false;
  hits = 0;
  disposed = false;

  async enable(value: boolean): Promise<boolean> {
    if (this.disposed) return false;
    if (!value) {
      this.enabled = false;
      this.nodes.forEach(node => {
        if (node instanceof OscillatorNode || node instanceof AudioBufferSourceNode) {
          try { node.stop(); } catch { /* Already ended. */ }
        }
        node.disconnect();
      });
      this.nodes.clear();
      if (this.context?.state === 'running') await this.context.suspend();
      return false;
    }
    try {
      if (!this.context) {
        this.context = new AudioContext({ latencyHint: 'interactive' });
        this.output = this.context.createGain();
        this.output.gain.value = 0.22;
        this.output.connect(this.context.destination);
        this.noise = this.context.createBuffer(1, Math.ceil(this.context.sampleRate * 0.025), this.context.sampleRate);
        const data = this.noise.getChannelData(0), random = xorshift(0x7a9e11);
        for (let i = 0; i < data.length; i++) data[i] = (random() * 2 - 1) * Math.exp(-i / (data.length * 0.12));
      }
      await this.context.resume();
      this.enabled = !this.disposed && this.context.state === 'running';
      return this.enabled;
    } catch { this.enabled = false; return false; }
  }

  strike(): void {
    const ctx = this.context, output = this.output;
    if (!ctx || !output || !this.enabled || ctx.state !== 'running' || this.disposed) return;
    const time = ctx.currentTime;
    this.hits++;
    for (const [frequency, volume, decay] of [[516, 0.72, 0.085], [837, 0.43, 0.055], [1370, 0.2, 0.033], [2280, 0.08, 0.018]]) {
      const osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(frequency! * 1.045, time);
      osc.frequency.exponentialRampToValueAtTime(frequency!, time + 0.035);
      gain.gain.setValueAtTime(0.0001, time);
      gain.gain.exponentialRampToValueAtTime(volume!, time + 0.0015);
      gain.gain.exponentialRampToValueAtTime(0.0001, time + decay! * 4);
      osc.connect(gain); gain.connect(output);
      this.nodes.add(osc); this.nodes.add(gain);
      osc.onended = () => { osc.disconnect(); gain.disconnect(); this.nodes.delete(osc); this.nodes.delete(gain); };
      osc.start(time); osc.stop(time + decay! * 4 + 0.005);
    }
    const noise = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), gain = ctx.createGain();
    noise.buffer = this.noise;
    filter.type = 'bandpass'; filter.frequency.value = 1800; filter.Q.value = 0.8;
    gain.gain.value = 0.26;
    noise.connect(filter); filter.connect(gain); gain.connect(output);
    [noise, filter, gain].forEach(node => this.nodes.add(node));
    noise.onended = () => { [noise, filter, gain].forEach(node => { node.disconnect(); this.nodes.delete(node); }); };
    noise.start(time);
  }

  inspect(): { enabled: boolean; hits: number; state: string; nodes: number } {
    return { enabled: this.enabled, hits: this.hits, state: this.context?.state ?? 'uninitialized', nodes: this.nodes.size };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.enabled = false;
    this.nodes.forEach(node => node.disconnect()); this.nodes.clear();
    this.output?.disconnect();
    if (this.context) void this.context.close().catch(() => undefined);
    this.context = null; this.noise = null; this.output = null;
  }
}
