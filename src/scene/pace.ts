/**
 * 얼마나 자주 그릴지 정한다. 하루 종일 떠 있는 위젯이라 보이지 않을 때는 아예 그리지 않고,
 * 절전 설정에서는 아무 일도 없을 때 프레임을 더 낮춘다.
 */
export interface PaceInput {
  /** 창이 보이는지(문서가 숨겨졌거나 창이 완전히 가려졌으면 false) */
  visible: boolean;
  /** 평소 상한(위젯 30, 웹 60). 0 이면 제한 없음 */
  baseFps: number;
  lowPower: boolean;
  /** 방금 조작했는지(마우스가 창 위에 있거나 시점을 돌리는 중) */
  active: boolean;
  /** 비·눈이 오거나 바람이 세서 화면이 바쁘게 움직이는지 */
  lively: boolean;
}

export const LOW_POWER_IDLE_FPS = 15;
export const LOW_POWER_FPS = 30;

/** 초당 프레임 상한. 0 = 제한 없음, -1 = 그리지 않는다 */
export function frameCap(i: PaceInput): number {
  if (!i.visible) return -1;
  if (!i.lowPower) return i.baseFps;
  const cap = i.active || i.lively ? LOW_POWER_FPS : LOW_POWER_IDLE_FPS;
  return i.baseFps > 0 ? Math.min(cap, i.baseFps) : cap;
}

/**
 * 그림자 맵을 다시 그리는 간격(초). 해 방향이나 그림자 범위가 바뀌면 이와 상관없이 바로 다시 그린다.
 * moverHz: 그 테마의 움직이는 것(자동차·걷는 성)이 그림자가 끊겨 보이지 않을 갱신 횟수.
 */
export function shadowInterval(i: { lowPower: boolean; wind: number; moverHz: number; shadowStrength: number }): number {
  // 흐려서 그림자가 거의 안 보이면 드물게만
  if (i.shadowStrength < 0.08) return 1;
  // 절전: 드물게 그리되, 움직이는 것이 있으면 그 절반 빈도까지는 따라간다(자동차 그림자가 차에서 떨어지지 않게)
  if (i.lowPower) return i.moverHz > 0 ? Math.min(0.4, 2 / i.moverHz) : 0.4;
  const swayHz = i.wind < 0.3 ? 6 : 10;
  return 1 / Math.max(swayHz, i.moverHz);
}

/**
 * 화질마다 한 프레임에 그리는 최대 픽셀 수(그리기 버퍼 가로×세로). 창을 크게 키워도 레티나 2배를 그대로 그리면
 * 픽셀 수가 4배로 늘어 GPU 가 쉬지 못하고 노트북이 뜨거워진다(16인치 맥 1728×1080 창에서 약 580만 픽셀, 프레임당 GPU 17ms).
 * 그래서 창이 크면 픽셀 비율을 이 예산에 맞게 낮춘다. 작은 창(위젯)은 예산 안이라 그대로 선명하다
 */
export const PIXEL_BUDGET = { low: 1.0e6, medium: 2.0e6, high: 3.0e6 } as const;

/** 렌더러 픽셀 비율. 화질 단계 상한·절전 상한·픽셀 예산 중 가장 작은 값(화면 비율보다 크지 않게) */
export function pixelRatioFor(i: { dpr: number; level: keyof typeof PIXEL_BUDGET; lowPower: boolean; width: number; height: number }): number {
  const cap = i.level === 'low' ? 1 : i.level === 'medium' ? 1.5 : 2;
  // 창 넓이(CSS 픽셀)로 예산을 나눠 비율 상한을 구한다. 1 아래로는 내리지 않는다(글자처럼 흐려 보인다).
  // 0.05 단위로 끊어 창을 조금씩 끌 때마다 그리기 버퍼를 다시 만들지 않게 한다
  const area = Math.max(1, i.width * i.height);
  const budget = Math.max(1, Math.floor(Math.sqrt(PIXEL_BUDGET[i.level] / area) * 20) / 20);
  return Math.min(i.dpr, i.lowPower ? Math.min(cap, 1.25) : cap, budget);
}

/**
 * 데스크톱 앱에서 창이 이만큼(CSS 픽셀 넓이) 넘게 크면 절전처럼 그린다(가만히 있으면 초당 15번, 화질 한 단계 아래).
 * 앱은 내장 GPU로 투명 창을 그려 프레임마다 드는 고정 비용이 커서, 픽셀을 줄이는 것보다 덜 자주 그리는 것이 발열에 훨씬 듣는다
 * (16인치 인텔 맥, 1728×1080 앱 창·미니어처: 내장 GPU 67%·CPU 32% → 23%·14%). 기본 위젯(440×320)은 한참 아래라 그대로다
 */
export const AUTO_LOW_POWER_AREA = 900 * 650;

/** 실제로 절전으로 그릴지: 사용자가 켰거나, 자동 절전을 쓰는 창(데스크톱 앱)이 충분히 클 때 */
export function lowPowerFor(i: { setting: boolean; auto: boolean; width: number; height: number }): boolean {
  return i.setting || (i.auto && i.width * i.height > AUTO_LOW_POWER_AREA);
}

