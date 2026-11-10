import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CACHE_MAX_AGE_MS, ageLabel, isForecast, parseCachedForecast } from '../src/data/cache.ts';
import { RETRY_STEADY_MS, retryDelay } from '../src/data/retry.ts';
import { KEYS, migrateKeys } from '../src/data/storage.ts';
import { frameCap, shadowInterval } from '../src/scene/pace.ts';

const NOW = Date.parse('2026-11-10T03:00:00Z'); // 서울 12:00
const forecast = () => ({
  utcOffsetSeconds: 9 * 3600,
  current: { temp: 11, humidity: 60, precipitation: 0, code: 1, wind: 8, windDir: 300 },
  daily: [{ date: '2026-11-10', code: 1, max: 14, min: 5, sunrise: '2026-11-10T07:05', sunset: '2026-11-10T17:25', precipitation: 0, wind: 14, windDir: 290 }],
  hourly: [{ time: '2026-11-10T12:00', temp: 11, code: 1, pop: 0 }],
});
const entry = (over: object = {}) => JSON.stringify({ place: { name: '서울', lat: 37.57, lon: 126.98 }, forecast: forecast(), savedAt: NOW - 12 * 60_000, ...over });

test('재시도 간격: 5초·15초·60초, 그 뒤로는 5분', () => {
  assert.deepEqual([1, 2, 3, 4, 9].map(retryDelay), [5000, 15000, 60000, RETRY_STEADY_MS, RETRY_STEADY_MS]);
  assert.equal(retryDelay(0), 5000);
  assert.equal(retryDelay(-2), 5000);
});

test('예보 캐시: 멀쩡한 값은 그대로 돌아온다', () => {
  const c = parseCachedForecast(entry(), NOW);
  assert.ok(c);
  assert.equal(c.place.name, '서울');
  assert.equal(c.forecast.current.temp, 11);
});

test('예보 캐시: 깨진 글자·빈 값·모양이 다른 값은 버린다', () => {
  for (const raw of [null, '', '{', 'null', '[]', '"x"', JSON.stringify({ place: {}, forecast: {}, savedAt: NOW })]) {
    assert.equal(parseCachedForecast(raw, NOW), null, String(raw));
  }
  assert.equal(parseCachedForecast(entry({ place: { name: '서울', lat: 137, lon: 0 } }), NOW), null);
  const noDaily = forecast();
  noDaily.daily = [];
  assert.equal(parseCachedForecast(entry({ forecast: noDaily }), NOW), null);
  const badTemp = forecast();
  (badTemp.current as { temp: unknown }).temp = '11';
  assert.equal(parseCachedForecast(entry({ forecast: badTemp }), NOW), null);
});

test('예보 캐시: 6시간이 지났거나, 미래 시각이거나, 날짜가 넘어갔으면 버린다', () => {
  assert.equal(parseCachedForecast(entry({ savedAt: NOW - CACHE_MAX_AGE_MS - 1 }), NOW), null);
  assert.equal(parseCachedForecast(entry({ savedAt: NOW + 3_600_000 }), NOW), null);
  // 서울 기준 다음 날 00:30
  const nextDay = Date.parse('2026-11-10T15:30:00Z');
  assert.equal(parseCachedForecast(entry({ savedAt: nextDay - 60_000 }), nextDay), null);
});

test('예보 나이 문구', () => {
  assert.equal(ageLabel(20_000), '방금 받은 날씨예요');
  assert.equal(ageLabel(12 * 60_000 + 5), '12분 전 날씨예요');
  assert.equal(ageLabel(3 * 3_600_000 + 60_000), '3시간 전 날씨예요');
  assert.equal(ageLabel(-5), '방금 받은 날씨예요');
});

function memory(init: Record<string, string>, failOn?: 'set' | 'remove') {
  const m = new Map(Object.entries(init));
  return {
    m,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (failOn === 'set') throw new Error('quota');
      m.set(k, v);
    },
    removeItem: (k: string) => {
      if (failOn === 'remove') throw new Error('denied');
      m.delete(k);
    },
  };
}

test('키 이전: 옛 값을 새 키로 옮기고 옛 키를 지운다', () => {
  const s = memory({ 'sky-isle:place': '{"name":"부산"}', 'sky-isle:theme': 'forest' });
  migrateKeys(s);
  assert.equal(s.m.get(KEYS.place), '{"name":"부산"}');
  assert.equal(s.m.get(KEYS.theme), 'forest');
  assert.equal(s.m.has('sky-isle:place'), false);
  assert.equal(s.m.has(KEYS.shape), false);
});

test('키 이전: 새 키에 값이 있으면 덮어쓰지 않고, 두 번 돌려도 같다', () => {
  const s = memory({ 'sky-isle:theme': 'forest', [KEYS.theme]: 'city' });
  migrateKeys(s);
  migrateKeys(s);
  assert.equal(s.m.get(KEYS.theme), 'city');
  assert.equal(s.m.has('sky-isle:theme'), false);
});

test('키 이전: 쓰기에 실패하면 옛 값을 지우지 않는다(값을 잃지 않는다)', () => {
  const s = memory({ 'sky-isle:place': 'P', 'sky-isle:theme': 'forest' }, 'set');
  assert.doesNotThrow(() => migrateKeys(s));
  assert.equal(s.m.get('sky-isle:place'), 'P');
  assert.equal(s.m.get('sky-isle:theme'), 'forest');
  // 지우기에 실패해도 새 값은 남고 예외가 새지 않는다
  const r = memory({ 'sky-isle:place': 'P' }, 'remove');
  assert.doesNotThrow(() => migrateKeys(r));
  assert.equal(r.m.get(KEYS.place), 'P');
});

test('프레임 상한: 안 보이면 그리지 않고, 평소에는 기본 상한, 절전에서는 가만히 있을 때 15', () => {
  const base = { visible: true, baseFps: 30, lowPower: false, active: false, lively: false };
  assert.equal(frameCap({ ...base, visible: false }), -1);
  assert.equal(frameCap({ ...base, visible: false, lowPower: true, active: true }), -1);
  assert.equal(frameCap(base), 30);
  assert.equal(frameCap({ ...base, baseFps: 60 }), 60);
  assert.equal(frameCap({ ...base, lowPower: true }), 15);
  assert.equal(frameCap({ ...base, lowPower: true, active: true }), 30);
  assert.equal(frameCap({ ...base, lowPower: true, lively: true }), 30);
  assert.equal(frameCap({ ...base, lowPower: true, baseFps: 0 }), 15);
});

test('그림자 갱신 간격: 바람이 약하면 느리게, 움직이는 것이 있으면 그만큼 자주, 흐리면 드물게', () => {
  const base = { lowPower: false, wind: 0.2, moverHz: 0, shadowStrength: 1 };
  assert.ok(Math.abs(shadowInterval(base) - 1 / 6) < 1e-9);
  assert.ok(Math.abs(shadowInterval({ ...base, wind: 0.8 }) - 0.1) < 1e-9);
  assert.ok(Math.abs(shadowInterval({ ...base, moverHz: 15 }) - 1 / 15) < 1e-9);
  assert.equal(shadowInterval({ ...base, lowPower: true }), 0.4);
  assert.ok(Math.abs(shadowInterval({ ...base, lowPower: true, moverHz: 15 }) - 2 / 15) < 1e-9);
  assert.equal(shadowInterval({ ...base, shadowStrength: 0.05, moverHz: 15 }), 1);
});

test('예보 검증: 범위를 벗어난 값·형식이 다른 날짜·지나치게 긴 목록은 받지 않는다', () => {
  assert.equal(isForecast(forecast()), true);
  const edit = (fn: (f: ReturnType<typeof forecast>) => void) => {
    const f = forecast();
    fn(f);
    return isForecast(f);
  };
  assert.equal(edit((f) => (f.utcOffsetSeconds = 1e300)), false);
  assert.equal(edit((f) => (f.current.windDir = -20)), false);
  assert.equal(edit((f) => (f.current.code = 250)), false);
  assert.equal(edit((f) => (f.daily[0].date = '<b>2026</b>')), false);
  assert.equal(edit((f) => (f.daily[0].sunrise = '07:05')), false);
  assert.equal(edit((f) => (f.hourly[0].time = '2026-11-10 12:00')), false);
  assert.equal(edit((f) => (f.hourly = Array.from({ length: 5000 }, () => f.hourly[0]))), false);
  assert.equal(edit((f) => (f.daily = Array.from({ length: 40 }, () => f.daily[0]))), false);
  assert.equal(isForecast(null), false);
  assert.equal(isForecast('x'), false);
});
