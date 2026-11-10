import assert from 'node:assert/strict';
import { test } from 'node:test';
import { composeEnv, createEnv, lerpEnv, sunAzimuthAt, sunElevationAt } from '../src/scene/env.ts';

test('무지개는 밤에 뜨지 않는다', () => {
  assert.equal(composeEnv('day', 'rainbow', 'summer', createEnv()).rainbow, 1);
  assert.equal(composeEnv('night', 'rainbow', 'summer', createEnv()).rainbow, 0);
  // 저녁에서 밤으로 절반 넘게 섞였으면 밤으로 본다
  assert.equal(composeEnv('evening', 'rainbow', 'summer', createEnv(), { blend: { to: 'night', t: 0.7 } }).rainbow, 0);
});

test('눈 덮임: 겨울이어도 최저 6°C 이상이면 없고 영하면 가득, 눈이 오면 계절과 상관없이 덮인다', () => {
  assert.equal(composeEnv('day', 'clear', 'winter', createEnv(), { minTemp: 8 }).snowCover, 0);
  assert.equal(composeEnv('day', 'clear', 'winter', createEnv(), { minTemp: -3 }).snowCover, 1);
  assert.equal(composeEnv('day', 'clear', 'winter', createEnv()).snowCover, 1);
  assert.equal(composeEnv('day', 'clear', 'summer', createEnv(), { minTemp: -3 }).snowCover, 0);
  assert.equal(composeEnv('day', 'snow', 'summer', createEnv()).snowCover, 0.8);
});

test('바람: 실제 풍속을 쓰되 날씨가 정한 세기의 절반 아래로는 내려가지 않는다', () => {
  assert.equal(composeEnv('day', 'clear', 'summer', createEnv(), { windKmh: 45 }).wind, 1);
  assert.equal(composeEnv('day', 'clear', 'summer', createEnv(), { windKmh: 90 }).wind, 1);
  assert.equal(composeEnv('day', 'storm', 'summer', createEnv(), { windKmh: 0 }).wind, 0.475);
  const e = composeEnv('day', 'clear', 'summer', createEnv(), { windFromDeg: 0 });
  // 북풍은 남쪽(+z)으로 분다
  assert.ok(Math.abs(e.windX) < 1e-9 && Math.abs(e.windZ - 1) < 1e-9);
});

test('시간대 섞기: t 가 0 이면 앞 시간대, 1 이면 뒤 시간대와 같다', () => {
  const day = composeEnv('day', 'clear', 'summer', createEnv());
  const eve = composeEnv('evening', 'clear', 'summer', createEnv());
  const b0 = composeEnv('day', 'clear', 'summer', createEnv(), { blend: { to: 'evening', t: 0 } });
  const b1 = composeEnv('day', 'clear', 'summer', createEnv(), { blend: { to: 'evening', t: 1 } });
  for (const k of ['sunIntensity', 'hemiIntensity', 'nightLights', 'stars', 'sunElevation'] as const) {
    assert.ok(Math.abs(b0[k] - day[k]) < 1e-9, `${k} t=0`);
    assert.ok(Math.abs(b1[k] - eve[k]) < 1e-9, `${k} t=1`);
  }
  assert.equal(b1.skyTop.getHexString(), eve.skyTop.getHexString());
  const half = composeEnv('day', 'clear', 'summer', createEnv(), { blend: { to: 'evening', t: 0.5 } });
  assert.ok(half.nightLights > day.nightLights && half.nightLights < eve.nightLights);
});

test('낮↔밤 경계: 가운데에서 해 세기가 0 이 되고 그 틈에 달 높이로 바뀐다', () => {
  const at = (t: number) => composeEnv('evening', 'clear', 'summer', createEnv(), { blend: { to: 'night', t }, dayFraction: 1 });
  assert.equal(at(0.5).sunIntensity, 0);
  assert.ok(at(0.2).sunIntensity > 0 && at(0.8).sunIntensity > 0);
  assert.ok(Math.abs(at(0.2).sunElevation - sunElevationAt(1)) < 1e-9);
  assert.equal(at(0.8).sunElevation, 0.75);
  assert.equal(at(0.8).sunAzimuth, 0);
});

test('연속 태양: 한낮에 가장 높고 뜨고 질 때 낮다. 방위는 한쪽에서 반대쪽으로', () => {
  assert.ok(Math.abs(sunElevationAt(0.5) - 0.95) < 1e-9);
  assert.ok(Math.abs(sunElevationAt(0) - 0.12) < 1e-9 && Math.abs(sunElevationAt(1) - 0.12) < 1e-9);
  assert.ok(sunElevationAt(0.25) > sunElevationAt(0.1));
  assert.ok(sunAzimuthAt(0) < 0 && sunAzimuthAt(1) > 0 && sunAzimuthAt(0.5) === 0);
  assert.equal(sunElevationAt(-3), sunElevationAt(0));
  // 미리보기(진행을 넘기지 않음)는 프리셋 높이 그대로
  assert.equal(composeEnv('day', 'clear', 'summer', createEnv()).sunElevation, 0.95);
});

test('창 유리: 춥고 습하면 김, 영하면 성에. 덥고 건조하면 없다', () => {
  const cold = composeEnv('day', 'clear', 'winter', createEnv(), { temp: 2, humidity: 97 });
  assert.ok(cold.mist > 0.9);
  const freezing = composeEnv('day', 'clear', 'winter', createEnv(), { temp: -8, humidity: 80 });
  assert.ok(freezing.frost > 0.8);
  const warm = composeEnv('day', 'clear', 'summer', createEnv(), { temp: 28, humidity: 40 });
  assert.equal(warm.mist, 0);
  assert.equal(warm.frost, 0);
});

test('젖은 땅: 비가 오면 젖고, 그친 뒤에도 최근 강수량만큼 남고, 눈이 덮이면 없다', () => {
  assert.ok(composeEnv('day', 'heavyRain', 'summer', createEnv()).wet === 1);
  assert.equal(composeEnv('day', 'clear', 'summer', createEnv()).wet, 0);
  const after = composeEnv('day', 'clear', 'summer', createEnv(), { precipMm: 4 });
  assert.ok(Math.abs(after.wet - 0.7) < 1e-9);
  assert.equal(composeEnv('day', 'clear', 'winter', createEnv(), { precipMm: 4, minTemp: -5 }).wet, 0);
});

test('보간: 여러 번 다가가면 목표값에 닿고 넘지 않는다', () => {
  const cur = composeEnv('day', 'clear', 'summer', createEnv());
  const target = composeEnv('night', 'storm', 'winter', createEnv());
  for (let i = 0; i < 400; i++) lerpEnv(cur, target, 0.05);
  assert.ok(Math.abs(cur.rain - target.rain) < 1e-6);
  assert.ok(Math.abs(cur.sunIntensity - target.sunIntensity) < 1e-6);
  assert.ok(cur.rain <= 1);
});
