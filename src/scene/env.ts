import { Color } from 'three';
import type { Condition, Season, TimeOfDay } from '../data/weather.ts';
import { smoothstep } from '../math.ts';

/**
 * 장면 전체가 읽는 연출 값. 시간대·날씨·계절 프리셋을 합쳐 목표값을 만들고,
 * 매 프레임 현재값을 목표값 쪽으로 보간해 전환이 부드럽게 일어난다.
 */
const COLOR_KEYS = ['skyTop', 'skyBottom', 'sunColor', 'hemiSky', 'grass', 'foliageA', 'foliageB', 'pine'] as const;
const NUM_KEYS = [
  'sunIntensity', 'sunElevation', 'hemiIntensity', 'nightLights', 'stars',
  'cloudCover', 'cloudDark', 'overcast', 'rain', 'snow', 'fog', 'wind', 'storm', 'rainbow', 'snowCover',
  // 바람이 불어 가는 방향(단위 벡터, 북쪽 = -z, 동쪽 = +x)
  'windX', 'windZ',
  // 해 방위(기본 방위에서 벗어난 각도, 라디안). 해가 뜬 쪽에서 지는 쪽으로 움직인다
  'sunAzimuth',
  // 창 유리에 끼는 김·성에, 비에 젖은 정도(0~1)
  'mist', 'frost', 'wet',
] as const;

type ColorKey = (typeof COLOR_KEYS)[number];
type NumKey = (typeof NUM_KEYS)[number];
export type Env = Record<ColorKey, Color> & Record<NumKey, number>;

export function createEnv(): Env {
  const env = {} as Env;
  for (const k of COLOR_KEYS) env[k] = new Color();
  for (const k of NUM_KEYS) env[k] = 0;
  return env;
}

export function copyEnv(dst: Env, src: Env): void {
  for (const k of COLOR_KEYS) dst[k].copy(src[k]);
  for (const k of NUM_KEYS) dst[k] = src[k];
}

export function lerpEnv(cur: Env, target: Env, t: number): void {
  for (const k of COLOR_KEYS) cur[k].lerp(target[k], t);
  for (const k of NUM_KEYS) cur[k] += (target[k] - cur[k]) * t;
}

const TIME: Record<TimeOfDay, {
  skyTop: string; skyBottom: string; sun: string; sunI: number; elev: number;
  hemi: number; hemiSky: string; lights: number; stars: number;
}> = {
  // 하늘·안개색은 시간대마다 크게 바뀌지만, 장면을 비추는 빛(sun·hemiSky)은 중립에 가깝게 둬 장면 고유색이 덜 흔들리게 한다
  morning: { skyTop: '#9fb8dc', skyBottom: '#f3dcc6', sun: '#ffdcb6', sunI: 2.3, elev: 0.3, hemi: 1.2, hemiSky: '#e9e6ec', lights: 0.25, stars: 0 },
  day: { skyTop: '#8db8e0', skyBottom: '#dce6ee', sun: '#fff1dc', sunI: 2.5, elev: 0.95, hemi: 1.5, hemiSky: '#e4eef6', lights: 0, stars: 0 },
  evening: { skyTop: '#6b9bd2', skyBottom: '#ecd6cc', sun: '#ffc89a', sunI: 1.8, elev: 0.16, hemi: 1.05, hemiSky: '#efdcd2', lights: 0.8, stars: 0.2 },
  night: { skyTop: '#1a2140', skyBottom: '#34406a', sun: '#9fb2ff', sunI: 0.85, elev: 0.75, hemi: 1.05, hemiSky: '#7086c4', lights: 1, stars: 1 },
};

const WEATHER: Record<Condition, {
  cover: number; dark: number; overcast: number; rain: number; snow: number;
  fog: number; wind: number; storm: number; rainbow: number;
}> = {
  clear: { cover: 0.12, dark: 0, overcast: 0, rain: 0, snow: 0, fog: 0, wind: 0.15, storm: 0, rainbow: 0 },
  partly: { cover: 0.45, dark: 0.05, overcast: 0.05, rain: 0, snow: 0, fog: 0, wind: 0.25, storm: 0, rainbow: 0 },
  cloudy: { cover: 0.85, dark: 0.3, overcast: 0.5, rain: 0, snow: 0, fog: 0.1, wind: 0.3, storm: 0, rainbow: 0 },
  wind: { cover: 0.55, dark: 0.1, overcast: 0.15, rain: 0, snow: 0, fog: 0, wind: 1, storm: 0, rainbow: 0 },
  fog: { cover: 0.35, dark: 0.15, overcast: 0.6, rain: 0, snow: 0, fog: 1, wind: 0.05, storm: 0, rainbow: 0 },
  rain: { cover: 0.9, dark: 0.45, overcast: 0.6, rain: 0.5, snow: 0, fog: 0.25, wind: 0.4, storm: 0, rainbow: 0 },
  heavyRain: { cover: 1, dark: 0.65, overcast: 0.8, rain: 1, snow: 0, fog: 0.4, wind: 0.6, storm: 0, rainbow: 0 },
  storm: { cover: 1, dark: 0.85, overcast: 0.9, rain: 1, snow: 0, fog: 0.35, wind: 0.95, storm: 1, rainbow: 0 },
  snow: { cover: 0.85, dark: 0.2, overcast: 0.5, rain: 0, snow: 1, fog: 0.3, wind: 0.2, storm: 0, rainbow: 0 },
  rainbow: { cover: 0.5, dark: 0.15, overcast: 0.1, rain: 0.12, snow: 0, fog: 0, wind: 0.2, storm: 0, rainbow: 1 },
};

const SEASON: Record<Season, { grass: string; a: string; b: string; pine: string; snow: number }> = {
  // 채도 낮고 따뜻한 색(세이지 잔디, 머스터드·황토 단풍)
  spring: { grass: '#a3b866', a: '#b9c97a', b: '#e6bcc4', pine: '#557f5b', snow: 0 },
  summer: { grass: '#8fab5a', a: '#7f9e4e', b: '#6b8f45', pine: '#4f7a57', snow: 0 },
  autumn: { grass: '#8ea35a', a: '#e2b65a', b: '#cf8a45', pine: '#4f7a57', snow: 0 },
  winter: { grass: '#9aa287', a: '#bdb39e', b: '#ada28e', pine: '#4a6a55', snow: 1 },
};

const SNOW = new Color('#eef3f8');
const tmp = new Color();

const luminance = (c: Color) => c.r * 0.3 + c.g * 0.59 + c.b * 0.11;

/** 실제 날씨 값. 주어진 것만 프리셋 대신 쓴다(미리보기로 고른 항목은 넘기지 않는다) */
export interface LiveWeather {
  /** 최저 기온(°C). 겨울 눈 덮임을 기온으로 정한다(6°C 이상이면 눈 없음) */
  minTemp?: number;
  /** 풍속(km/h). 45km/h 이상이면 바람 연출 최대 */
  windKmh?: number;
  /** 바람이 불어오는 방위(도, 북쪽 0 · 시계 방향) */
  windFromDeg?: number;
  /** 지금 기온(°C)과 습도(%). 창 유리의 김·성에를 정한다 */
  temp?: number;
  humidity?: number;
  /** 최근 강수량(mm). 비가 그친 뒤에도 땅이 젖어 있게 */
  precipMm?: number;
  /** 다음 시간대로 섞는 정도(실시간일 때만). 시간대가 바뀌는 앞뒤로 하늘·빛을 천천히 섞는다 */
  blend?: { to: TimeOfDay; t: number };
  /** 해가 떠 있는 동안의 진행(0 해 뜸 ~ 1 해 짐). 주면 해의 높이·방위가 시각을 따라 움직인다 */
  dayFraction?: number;
}

const NIGHT_ELEVATION = TIME.night.elev;
const col2 = new Color();

/** 해가 뜬 뒤 진행에 따른 해 높이(라디안). 뜨고 질 때 0.12, 한낮 0.95 */
export function sunElevationAt(dayFraction: number): number {
  return 0.12 + 0.83 * Math.sin(Math.PI * Math.min(1, Math.max(0, dayFraction)));
}

/** 해 방위가 기본 방위에서 벗어난 각도. 아침에는 한쪽, 저녁에는 반대쪽 */
export function sunAzimuthAt(dayFraction: number): number {
  return (Math.min(1, Math.max(0, dayFraction)) - 0.5) * 1.6;
}

export function composeEnv(time: TimeOfDay, cond: Condition, season: Season, out: Env, live: LiveWeather = {}): Env {
  const { minTemp } = live;
  const T = TIME[time];
  const W = WEATHER[cond];
  const S = SEASON[season];
  const B = live.blend && live.blend.to !== time && live.blend.t > 0 ? TIME[live.blend.to] : undefined;
  const k = B ? Math.min(1, live.blend!.t) : 0;
  const mix = (a: number, b: number) => a + (b - a) * k;

  out.skyTop.set(T.skyTop);
  out.skyBottom.set(T.skyBottom);
  out.hemiSky.set(T.hemiSky);
  if (B) {
    out.skyTop.lerp(col2.set(B.skyTop), k);
    out.skyBottom.lerp(col2.set(B.skyBottom), k);
    out.hemiSky.lerp(col2.set(B.hemiSky), k);
  }
  out.nightLights = B ? mix(T.lights, B.lights) : T.lights;

  // 해(밤에는 달). 낮↔밤 경계에서는 해와 달이 한 조명을 나눠 쓰므로 섞지 않고,
  // 가운데에서 세기를 0 으로 떨어뜨린 틈에 높이·색을 바꾼다(달이 해처럼 떠오르는 것처럼 보이지 않게)
  const crossing = B !== undefined && (time === 'night') !== (live.blend!.to === 'night');
  const side = crossing && k >= 0.5 ? B! : T;
  let sunI = B && !crossing ? mix(T.sunI, B.sunI) : side.sunI;
  if (crossing) sunI *= Math.abs(1 - 2 * k);
  out.sunColor.set(side.sun);
  if (B && !crossing) out.sunColor.lerp(col2.set(B.sun), k);
  const isNight = side === TIME.night;
  if (live.dayFraction !== undefined && !isNight) {
    out.sunElevation = sunElevationAt(live.dayFraction);
    out.sunAzimuth = sunAzimuthAt(live.dayFraction);
  } else {
    out.sunElevation = B && !crossing ? mix(T.elev, B.elev) : isNight ? NIGHT_ELEVATION : side.elev;
    out.sunAzimuth = 0;
  }

  // 흐릴수록 하늘을 같은 밝기의 회색 쪽으로 당긴다
  const lb = luminance(out.skyBottom);
  out.skyBottom.lerp(tmp.setRGB(lb * 0.95, lb, lb * 1.06), W.overcast * 0.75);
  const lt = luminance(out.skyTop);
  out.skyTop.lerp(tmp.setRGB(lt * 0.95, lt, lt * 1.08), W.overcast * 0.8);

  out.sunIntensity = sunI * (1 - 0.7 * W.overcast);
  out.hemiIntensity = (B ? mix(T.hemi, B.hemi) : T.hemi) * (1 - 0.25 * W.overcast);
  out.stars = (B ? mix(T.stars, B.stars) : T.stars) * (1 - W.overcast);

  out.cloudCover = W.cover;
  out.cloudDark = W.dark;
  out.overcast = W.overcast;
  out.rain = W.rain;
  out.snow = W.snow;
  out.fog = W.fog;
  // 실제 풍속이 있으면 그 세기로(날씨 종류가 정한 값보다 약해지지는 않게 절반은 남긴다)
  out.wind = live.windKmh === undefined ? W.wind : Math.max(W.wind * 0.5, Math.min(1, live.windKmh / 45));
  // 풍향: 불어오는 방위의 반대쪽으로 분다. 모르면 동쪽(+x)으로
  const from = ((live.windFromDeg ?? 270) * Math.PI) / 180;
  out.windX = -Math.sin(from);
  out.windZ = Math.cos(from);
  out.storm = W.storm;
  const nightness = time === 'night' ? 1 - k : live.blend?.to === 'night' ? k : 0;
  out.rainbow = nightness >= 0.5 ? 0 : W.rainbow;

  // 계절 + 눈이 내리면 계절과 상관없이 섬이 하얗게 덮인다
  const seasonSnow = minTemp === undefined ? S.snow : S.snow * smoothstep(6, 0, minTemp);
  const snow = Math.max(seasonSnow, cond === 'snow' ? 0.8 : 0);
  out.snowCover = snow;
  // 눈은 위를 보는 면에 쌓이는 것으로 그린다(baked.ts). 색은 조금만 바래게 해 나무가 통째로 하얘지지 않게 한다
  out.grass.set(S.grass).lerp(SNOW, snow * 0.3);
  out.foliageA.set(S.a).lerp(SNOW, snow * 0.25);
  out.foliageB.set(S.b).lerp(SNOW, snow * 0.25);
  out.pine.set(S.pine).lerp(SNOW, snow * 0.15);

  // 창 유리: 춥고 습하면 김, 영하면 성에. 실제 값이 없으면 날씨 종류로 어림한다
  const { temp, humidity } = live;
  if (temp !== undefined && humidity !== undefined) {
    out.mist = Math.min(1, smoothstep(70, 96, humidity) * smoothstep(16, 3, temp) + W.rain * 0.25 + W.fog * 0.3);
    out.frost = smoothstep(0.5, -7, temp) * (0.55 + 0.45 * smoothstep(40, 90, humidity));
  } else {
    out.mist = Math.min(1, W.fog * 0.5 + W.rain * 0.3 + W.snow * 0.25);
    out.frost = Math.max(W.snow * 0.6, snow * 0.35);
  }
  // 젖은 땅: 비가 오는 동안, 그리고 그친 뒤에도 최근 강수량만큼. 눈이 쌓였으면 젖은 티를 내지 않는다
  const raining = W.rain > 0 ? 0.55 + 0.45 * W.rain : 0;
  const lingering = live.precipMm === undefined ? 0 : 0.7 * smoothstep(0, 2.5, live.precipMm);
  out.wet = Math.max(raining, lingering) * (1 - snow);
  return out;
}
