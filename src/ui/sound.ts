import type { Env } from '../scene/env';

/**
 * 파일 없이 만드는 배경 소리. 폭포 소리는 항상 깔리고, 비와 바람은 장면 연출 값에 따라 커지고 작아진다.
 * 미니어처(오르골) 모양일 때는 오르골 멜로디가 작게 돈다(직접 만든 짧은 왈츠, 사인파 두 개로 금속 빗 소리를 흉내).
 */

/** 오르골 멜로디: 3박 왈츠 24칸(MIDI 음 번호, 0 은 쉼). 마디 첫 칸마다 낮은 음을 하나 더 친다 */
const TUNE = [72, 76, 79, 76, 74, 72, 74, 77, 81, 79, 77, 76, 72, 76, 79, 84, 81, 79, 77, 76, 74, 72, 0, 0];
const BASS = [48, 48, 50, 55, 48, 53, 55, 48];
/** 한 칸 길이(초) */
const STEP = 0.38;
const hz = (n: number) => 440 * 2 ** ((n - 69) / 12);
export class Ambience {
  private ctx?: AudioContext;
  private master?: GainNode;
  private rain?: GainNode;
  private wind?: GainNode;
  private music?: GainNode;
  /** 다음 오르골 음을 칠 시각과 칸 */
  private nextAt = 0;
  private step = 0;

  private get playing(): boolean {
    return this.ctx?.state === 'running';
  }

  async toggle(): Promise<boolean> {
    if (!this.ctx) this.build();
    if (this.ctx!.state === 'running') await this.ctx!.suspend();
    else await this.ctx!.resume();
    return this.playing;
  }

  /** musicBox: 미니어처(오르골) 모양인지 */
  update(env: Env, musicBox: boolean): void {
    if (!this.ctx || !this.playing) return;
    const t = this.ctx.currentTime;
    this.rain!.gain.setTargetAtTime(env.rain * 0.32 + env.snow * 0.02, t, 0.5);
    this.wind!.gain.setTargetAtTime(0.02 + env.wind * 0.16, t, 0.5);
    this.music!.gain.setTargetAtTime(musicBox ? 0.6 : 0, t, 0.6);
    if (!musicBox) return;
    // 프레임이 끊겼다 돌아오면(창이 가려졌다 보이면) 밀린 음을 몰아 치지 않고 지금부터 잇는다
    if (this.nextAt < t) this.nextAt = t + 0.05;
    // 0.4초 앞까지 미리 예약한다(프레임 간격이 들쭉날쭉해도 박자가 흔들리지 않게)
    while (this.nextAt < t + 0.4) {
      const n = TUNE[this.step];
      if (n) this.pluck(hz(n), this.nextAt, 0.16);
      if (this.step % 3 === 0) this.pluck(hz(BASS[this.step / 3]), this.nextAt, 0.09);
      this.step = (this.step + 1) % TUNE.length;
      this.nextAt += STEP;
    }
  }

  /** 오르골 빗 하나를 튕긴다: 기본음 + 높은 배음(약하게, 빨리 사라짐), 빠르게 올라가 길게 줄어든다 */
  private pluck(f: number, at: number, level: number): void {
    const ctx = this.ctx!;
    for (const [mul, amp, len] of [[1, 1, 1.8], [3.01, 0.28, 0.5]] as const) {
      const osc = new OscillatorNode(ctx, { frequency: f * mul });
      const g = new GainNode(ctx, { gain: 0 });
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(level * amp, at + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, at + len);
      osc.connect(g).connect(this.music!);
      osc.start(at);
      osc.stop(at + len + 0.05);
    }
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

    // 오르골: 짧은 메아리를 조금 섞어 상자 안에서 울리는 느낌
    this.music = ctx.createGain();
    this.music.gain.value = 0;
    const echo = new DelayNode(ctx, { delayTime: 0.29 });
    const back = new GainNode(ctx, { gain: 0.28 });
    this.music.connect(this.master);
    this.music.connect(echo).connect(back).connect(echo);
    back.connect(new GainNode(ctx, { gain: 0.6 })).connect(this.master);

    this.ctx = ctx;
  }
}
