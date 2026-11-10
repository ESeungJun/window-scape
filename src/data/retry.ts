/** 예보를 못 받았을 때 다시 시도하기까지 기다리는 시간. 5초·15초·60초, 그 뒤로는 5분마다 */
export const RETRY_DELAYS_MS = [5_000, 15_000, 60_000];
export const RETRY_STEADY_MS = 5 * 60_000;

/** failures: 지금까지 연달아 실패한 횟수(1 이상) */
export function retryDelay(failures: number): number {
  const i = Math.max(1, Math.floor(failures)) - 1;
  return RETRY_DELAYS_MS[i] ?? RETRY_STEADY_MS;
}
