export type SoundProfile = 'creamy' | 'thock' | 'typewriter';

const MAX_CONCURRENT_SOUNDS = 6;

class SoundFXManager {
  private ctx: AudioContext | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private activeCount = 0;

  private ensureContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtx) return null;

    if (!this.ctx) {
      try {
        this.ctx = new AudioCtx();
      } catch {
        return null;
      }
    }

    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }

    if (!this.noiseBuffer && this.ctx) {
      const sampleRate = this.ctx.sampleRate;
      const length = Math.floor(sampleRate * 0.08);
      const buffer = this.ctx.createBuffer(1, length, sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < length; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (sampleRate * 0.015));
      }
      this.noiseBuffer = buffer;
    }

    return this.ctx;
  }

  public playKeyCommit(
    outcome: 'correct' | 'error' | 'delete',
    profile: SoundProfile,
    volumePercent: number,
    enabled: boolean
  ): void {
    if (!enabled || volumePercent <= 0) return;
    if (this.activeCount >= MAX_CONCURRENT_SOUNDS) return;

    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const masterGainValue =
      Math.min(1, Math.max(0, volumePercent / 100)) * 0.35;
    if (masterGainValue <= 0.001) return;

    this.activeCount++;

    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      // Subtle pitch randomization so consecutive keys feel organic
      const jitter = 1 + (Math.random() - 0.5) * 0.05;

      if (outcome === 'error') {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(135 * jitter, now);
        osc.frequency.exponentialRampToValueAtTime(65, now + 0.075);

        gain.gain.setValueAtTime(masterGainValue * 0.9, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
      } else if (outcome === 'delete') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(210 * jitter, now);
        osc.frequency.exponentialRampToValueAtTime(110, now + 0.045);

        gain.gain.setValueAtTime(masterGainValue * 0.65, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
      } else if (profile === 'creamy') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(340 * jitter, now);
        osc.frequency.exponentialRampToValueAtTime(145, now + 0.042);

        gain.gain.setValueAtTime(masterGainValue, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.045);
      } else if (profile === 'thock') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(230 * jitter, now);
        osc.frequency.exponentialRampToValueAtTime(88, now + 0.055);

        gain.gain.setValueAtTime(masterGainValue * 1.1, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.058);
      } else {
        // typewriter
        osc.type = 'square';
        osc.frequency.setValueAtTime(680 * jitter, now);
        osc.frequency.exponentialRampToValueAtTime(220, now + 0.032);

        gain.gain.setValueAtTime(masterGainValue * 0.75, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.035);
      }

      osc.connect(gain);
      gain.connect(ctx.destination);

      // Add subtle keycap transient click from cached noiseBuffer
      if (this.noiseBuffer && outcome === 'correct') {
        const noise = ctx.createBufferSource();
        const filter = ctx.createBiquadFilter();
        const noiseGain = ctx.createGain();

        noise.buffer = this.noiseBuffer;
        filter.type = 'bandpass';
        filter.frequency.value =
          profile === 'thock' ? 950 : profile === 'creamy' ? 1600 : 2800;
        filter.Q.value = 1.8;

        noiseGain.gain.setValueAtTime(masterGainValue * 0.45, now);
        noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.025);

        noise.connect(filter);
        filter.connect(noiseGain);
        noiseGain.connect(ctx.destination);
        noise.start(now);
        noise.stop(now + 0.03);
      }

      osc.onended = () => {
        this.activeCount = Math.max(0, this.activeCount - 1);
        osc.disconnect();
        gain.disconnect();
      };

      osc.start(now);
      osc.stop(now + 0.085);
    } catch {
      this.activeCount = Math.max(0, this.activeCount - 1);
    }
  }

  public playCompletionChime(volumePercent: number, enabled: boolean): void {
    if (!enabled || volumePercent <= 0) return;
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const masterGainValue =
      Math.min(1, Math.max(0, volumePercent / 100)) * 0.22;
    if (masterGainValue <= 0.001) return;

    const notes = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const start = now + idx * 0.055;
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, start);

      gain.gain.setValueAtTime(0.001, start);
      gain.gain.linearRampToValueAtTime(masterGainValue, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.35);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.onended = () => {
        osc.disconnect();
        gain.disconnect();
      };
      osc.start(start);
      osc.stop(start + 0.36);
    });
  }
}

export const soundFX = new SoundFXManager();
