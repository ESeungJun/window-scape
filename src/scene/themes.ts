import type { Stage } from './kit';
import { GymBattle, PokemonCenter, ScenicLake, ViridianCity } from './pokemon';

export type Theme = 'poke-city' | 'poke-center' | 'poke-battle' | 'poke-lake';

export const THEMES: [Theme, string][] = [
  ['poke-city', '상록시티'],
  ['poke-center', '포켓몬센터'],
  ['poke-battle', '체육관 배틀'],
  ['poke-lake', '노을 호수'],
];

export const isTheme = (v: unknown): v is Theme => THEMES.some(([t]) => t === v);

export function createStage(theme: Theme): Stage {
  switch (theme) {
    case 'poke-city': return new ViridianCity();
    case 'poke-center': return new PokemonCenter();
    case 'poke-battle': return new GymBattle();
    case 'poke-lake': return new ScenicLake();
  }
}
