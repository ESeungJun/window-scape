import assert from 'node:assert/strict';
import { test } from 'node:test';
import { conditionFromCode, localIso, nextPrecip, seasonAt, skyPhaseAt, timeOfDayAt, type HourlyForecast } from '../src/data/weather.ts';

const min = (iso: string) => Date.parse(`${iso}:00Z`) / 60000;
const RISE = '2026-11-10T07:00';
const SET = '2026-11-10T17:30';

test('날씨 코드 → 장면: WMO 코드 전부가 10종 중 하나로 간다', () => {
  const table: [number[], string][] = [
    [[0], 'clear'], [[1, 2], 'partly'], [[3], 'cloudy'], [[45, 48], 'fog'],
    [[51, 53, 55, 56, 57, 61, 63, 66, 80, 81], 'rain'], [[65, 67, 82], 'heavyRain'],
    [[71, 73, 75, 77, 85, 86], 'snow'], [[95, 96, 99], 'storm'],
  ];
  for (const [codes, want] of table) for (const c of codes) assert.equal(conditionFromCode(c), want, `code ${c}`);
});

test('날씨 코드 → 장면: 센 바람은 맑음·구름에서만 바람으로 바뀐다', () => {
  assert.equal(conditionFromCode(0, 30), 'wind');
  assert.equal(conditionFromCode(3, 45), 'wind');
  assert.equal(conditionFromCode(0, 29.9), 'clear');
  assert.equal(conditionFromCode(63, 60), 'rain');
  assert.equal(conditionFromCode(95, 60), 'storm');
});

test('시간대: 해 뜨기 30분 전부터 아침, 뜬 뒤 2시간부터 낮, 지기 90분 전부터 저녁, 진 뒤 45분부터 밤', () => {
  const at = (t: string) => timeOfDayAt(min(t), RISE, SET);
  assert.equal(at('2026-11-10T06:29'), 'night');
  assert.equal(at('2026-11-10T06:31'), 'morning');
  assert.equal(at('2026-11-10T08:59'), 'morning');
  assert.equal(at('2026-11-10T09:01'), 'day');
  assert.equal(at('2026-11-10T15:59'), 'day');
  assert.equal(at('2026-11-10T16:01'), 'evening');
  assert.equal(at('2026-11-10T18:14'), 'evening');
  assert.equal(at('2026-11-10T18:16'), 'night');
  assert.equal(at('2026-11-10T23:30'), 'night');
  assert.equal(at('2026-11-10T00:10'), 'night');
});

test('시간대: 일출·일몰을 모르면 6시·18시로 본다', () => {
  assert.equal(timeOfDayAt(min('2026-11-10T12:00')), 'day');
  assert.equal(timeOfDayAt(min('2026-11-10T03:00')), 'night');
  assert.equal(timeOfDayAt(min('2026-11-10T12:00'), 'nope', undefined), 'day');
});

test('시간대: 백야는 하루 종일 낮, 극야는 하루 종일 밤, 자정을 넘는 일몰도 그대로 비교한다', () => {
  assert.equal(timeOfDayAt(min('2026-06-21T02:00'), '2026-06-21T00:00', '2026-06-21T23:59'), 'day');
  assert.equal(timeOfDayAt(min('2026-12-21T12:00'), '2026-12-21T00:00', '2026-12-21T00:00'), 'night');
  // 일몰이 다음 날 00:40 인 곳의 23:50 은 아직 저녁
  assert.equal(timeOfDayAt(min('2026-06-21T23:50'), '2026-06-21T03:00', '2026-06-22T00:40'), 'evening');
});

test('하늘 단계: 경계에서 멀면 섞지 않고, 경계 앞뒤로 0→1 로 단조 증가한다', () => {
  const far = skyPhaseAt(min('2026-11-10T12:00'), RISE, SET);
  assert.deepEqual([far.from, far.to, far.t], ['day', 'day', 0]);
  let prev = -1;
  for (let m = min('2026-11-10T15:20'); m <= min('2026-11-10T16:40'); m += 5) {
    const p = skyPhaseAt(m, RISE, SET);
    assert.deepEqual([p.from, p.to], ['day', 'evening']);
    assert.ok(p.t >= prev && p.t >= 0 && p.t <= 1, `t=${p.t}`);
    prev = p.t;
  }
  assert.equal(prev, 1);
});

test('하늘 단계: 해 진행은 일출 0, 한낮 0.5, 일몰 1 이고 밤에는 끝값에 머문다', () => {
  assert.equal(skyPhaseAt(min(RISE), RISE, SET).dayFraction, 0);
  assert.equal(skyPhaseAt(min(SET), RISE, SET).dayFraction, 1);
  assert.ok(Math.abs(skyPhaseAt(min('2026-11-10T12:15'), RISE, SET).dayFraction - 0.5) < 1e-9);
  assert.equal(skyPhaseAt(min('2026-11-10T22:00'), RISE, SET).dayFraction, 1);
  assert.equal(skyPhaseAt(min('2026-11-10T03:00'), RISE, SET).dayFraction, 0);
});

test('하늘 단계: 낮이 아주 짧아도 아침 → 낮 → 저녁 순서가 뒤집히지 않는다', () => {
  const rise = '2026-12-21T11:00';
  const set = '2026-12-21T13:00';
  const order = ['night', 'morning', 'day', 'evening'];
  let stage = 0;
  let wrapped = false;
  for (let m = min('2026-12-21T09:00'); m <= min('2026-12-21T15:00'); m += 3) {
    const k = order.indexOf(timeOfDayAt(m, rise, set));
    if (k === 0 && stage > 0) wrapped = true;
    else {
      assert.ok(!wrapped, '밤으로 넘어간 뒤 다시 낮이 나오면 안 된다');
      assert.ok(k >= stage, `순서가 뒤집혔다: ${order[stage]} → ${order[k]}`);
      stage = k;
    }
  }
  assert.ok(wrapped && stage === 3);
});

test('계절: 북반구·남반구·열대', () => {
  assert.equal(seasonAt(0, 37.5), 'winter');
  assert.equal(seasonAt(3, 37.5), 'spring');
  assert.equal(seasonAt(6, 37.5), 'summer');
  assert.equal(seasonAt(9, 37.5), 'autumn');
  assert.equal(seasonAt(11, 37.5), 'winter');
  assert.equal(seasonAt(0, -33.9), 'summer');
  assert.equal(seasonAt(6, -33.9), 'winter');
  assert.equal(seasonAt(0, 1.3), 'summer');
  assert.equal(seasonAt(6, -23.4), 'summer');
});

const hours = (codes: number[], pop = 80): HourlyForecast[] =>
  codes.map((code, i) => ({ time: `2026-11-10T${String(i).padStart(2, '0')}:00`, temp: 10, code, pop }));

test('다가오는 비·눈: 3시간 안에 시작하면 몇 시간 뒤인지 알려 준다', () => {
  assert.deepEqual(nextPrecip(hours([0, 0, 1, 61, 61]), '2026-11-10T01:20'), { inHours: 2, kind: 'rain' });
  assert.deepEqual(nextPrecip(hours([0, 73]), '2026-11-10T00:59'), { inHours: 1, kind: 'snow' });
});

test('다가오는 비·눈: 이미 오는 중·너무 먼 예보·낮은 확률·시각이 범위 밖이면 없다', () => {
  assert.equal(nextPrecip(hours([61, 61, 61]), '2026-11-10T00:10'), null);
  assert.equal(nextPrecip(hours([0, 0, 0, 0, 61]), '2026-11-10T00:10'), null);
  assert.equal(nextPrecip(hours([0, 61], 20), '2026-11-10T00:10'), null);
  assert.equal(nextPrecip(hours([0, 61]), '2026-11-11T00:10'), null);
  assert.equal(nextPrecip([], '2026-11-10T00:10'), null);
});

test('현지 시각 글자: UTC 오프셋을 더한 벽시계', () => {
  assert.equal(localIso(9 * 3600, Date.parse('2026-11-10T15:30:00Z')), '2026-11-11T00:30');
  assert.equal(localIso(-5 * 3600, Date.parse('2026-11-10T03:05:00Z')), '2026-11-09T22:05');
});
