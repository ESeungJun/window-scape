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
