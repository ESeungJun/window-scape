import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PIXEL_BUDGET, lowPowerFor, pixelRatioFor } from '../src/scene/pace.ts';

const base = { dpr: 2, level: 'high' as const, lowPower: false };

test('작은 창(위젯)은 레티나 2배 그대로', () => {
  assert.equal(pixelRatioFor({ ...base, width: 420, height: 300 }), 2);
});

test('큰 창은 픽셀 예산 안으로 비율을 낮춘다', () => {
  // 16인치 맥 1728×1080 창: 2배면 약 580만 픽셀
  const r = pixelRatioFor({ ...base, width: 1728, height: 1080 });
  assert.ok(r < 2);
  assert.ok(1728 * r * 1080 * r <= PIXEL_BUDGET.high);
});

test('아무리 커도 1 아래로는 내리지 않고, 화면 비율보다 크지 않다', () => {
  assert.equal(pixelRatioFor({ ...base, width: 5120, height: 2880 }), 1);
  assert.equal(pixelRatioFor({ ...base, dpr: 1, width: 400, height: 300 }), 1);
});

test('절전은 1.25 상한, 화질 낮음은 1', () => {
  assert.equal(pixelRatioFor({ ...base, lowPower: true, width: 400, height: 300 }), 1.25);
  assert.equal(pixelRatioFor({ ...base, level: 'low', width: 400, height: 300 }), 1);
});

test('자동 절전: 앱의 큰 창만, 기본 위젯·웹은 그대로, 사용자가 켜면 언제나', () => {
  assert.equal(lowPowerFor({ setting: false, auto: true, width: 1728, height: 1080 }), true);
  assert.equal(lowPowerFor({ setting: false, auto: true, width: 440, height: 320 }), false);
  assert.equal(lowPowerFor({ setting: false, auto: false, width: 1728, height: 1080 }), false);
  assert.equal(lowPowerFor({ setting: true, auto: false, width: 440, height: 320 }), true);
});
