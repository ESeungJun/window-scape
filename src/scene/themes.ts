import { mulberry32 } from '../util';
import { MovingCastle } from './castle';
import { City } from './city';
import { Drive } from './drive';
import { Forest } from './forest';
import { Island } from './island';
import type { Stage } from './kit';

export type Theme = 'island' | 'drive' | 'city' | 'castle' | 'forest';

export const THEMES: [Theme, string][] = [
  ['island', '하늘섬'],
  ['drive', '드라이브'],
  ['city', '도시'],
  ['castle', '움직이는 성'],
  ['forest', '숲'],
];

export const isTheme = (v: unknown): v is Theme => THEMES.some(([t]) => t === v);

/** 테마마다 시드를 고정해 새로고침해도 같은 배치가 나온다 */
export function createStage(theme: Theme): Stage {
  switch (theme) {
    case 'island': return new Island(mulberry32(7));
    case 'drive': return new Drive(mulberry32(11));
    case 'city': return new City(mulberry32(23));
    case 'castle': return new MovingCastle(mulberry32(31));
    case 'forest': return new Forest(mulberry32(43));
  }
}
