import type { Env } from '../scene/env';

/**
 * 파일 없이 노이즈로 만드는 배경 소리. 폭포 소리는 항상 깔리고,
 * 비와 바람은 장면 연출 값에 따라 커지고 작아진다.
 */
export class Ambience {
  private ctx?: AudioContext;
  private master?: GainNode;
  private rain?: GainNode;
  private wind?: GainNode;

  get playing(): boolean {
    return this.ctx?.state === 'running';
  }

  async toggle(): Promise<boolean> {
    if (!this.ctx) this.build();
    if (this.ctx!.state === 'running') await this.ctx!.suspend();
    else await this.ctx!.resume();
    return this.playing;
  }

  update(env: Env): void {
    if (!this.ctx || !this.playing) return;
    const t = this.ctx.currentTime;
    this.rain!.gain.setTargetAtTime(env.rain * 0.32 + env.snow * 0.02, t, 0.5);
    this.wind!.gain.setTargetAtTime(0.02 + env.wind * 0.16, t, 0.5);
  }

  private build(): void {
    const ctx = new AudioContext();
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    const noise = () => {
      const s = ctx.createBufferSource();
      s.buffer = buffer;
      s.loop = true;
      s.start(0, Math.random() * 3);
      return s;
    };
    const chain = (src: AudioNode, ...nodes: AudioNode[]) => nodes.reduce((a, b) => (a.connect(b), b), src);

    this.master = ctx.createGain();
    this.master.gain.value = 0.7;
    this.master.connect(ctx.destination);

    // 폭포: 낮게 웅웅거리는 소리
    const fallGain = ctx.createGain();
    fallGain.gain.value = 0.07;
    chain(noise(), new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 700 }), fallGain, this.master);

    // 비: 높은 대역의 사각거림
    this.rain = ctx.createGain();
    this.rain.gain.value = 0;
    chain(noise(), new BiquadFilterNode(ctx, { type: 'highpass', frequency: 900 }), new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 7000 }), this.rain, this.master);

    // 바람: 대역 통과 필터 주파수를 천천히 흔들어 휘몰아치는 느낌을 낸다
    this.wind = ctx.createGain();
    this.wind.gain.value = 0;
    const band = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 420, Q: 0.9 });
    const lfo = new OscillatorNode(ctx, { frequency: 0.13 });
    const depth = new GainNode(ctx, { gain: 220 });
    lfo.connect(depth).connect(band.frequency);
    lfo.start();
    chain(noise(), band, this.wind, this.master);

    this.ctx = ctx;
  }
}
