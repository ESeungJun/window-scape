import type { Condition } from '../data/weather';

// 정적 SVG 문자열만 담는다. 사용자 입력은 절대 여기에 섞지 않는다.
const CLOUD = '<path d="M7 18h10a4 4 0 0 0 .4-7.98A6 6 0 0 0 6.2 11.1 3.5 3.5 0 0 0 7 18z"/>';
const CLOUD_UP = `<g transform="translate(0 -3)">${CLOUD}</g>`;
const SUN = '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4"/>';
const MOON = '<path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z"/>';
const SMALL_SUN = '<circle cx="8" cy="8" r="3"/><path d="M8 2v1.3M2 8h1.3M3.8 3.8l.9.9M12.2 3.8l-.9.9"/>';
const SMALL_MOON = '<path d="M11 9.5A4.5 4.5 0 0 1 5.5 4a4.5 4.5 0 1 0 5.5 5.5z"/>';

const PATHS: Record<Condition, (night: boolean) => string> = {
  clear: (n) => (n ? MOON : SUN),
  partly: (n) => (n ? SMALL_MOON : SMALL_SUN) + `<g transform="translate(2 1)">${CLOUD}</g>`,
  cloudy: () => CLOUD,
  wind: () => '<path d="M3 8h11a2.5 2.5 0 1 0-2.5-2.5M3 12h16a2.5 2.5 0 1 1-2.5 2.5M3 16h8"/>',
  fog: () => '<path d="M4 9h16M3 13h18M5 17h14"/>',
  rain: () => CLOUD_UP + '<path d="M9 18l-1 3M13 18l-1 3M17 18l-1 3"/>',
  heavyRain: () => CLOUD_UP + '<path d="M8 17l-1.5 4M11.5 17L10 21M15 17l-1.5 4M18.5 17L17 21"/>',
  storm: () => CLOUD_UP + '<path d="M13 15l-3 4h4l-3 4"/>',
  snow: () => CLOUD_UP + '<path d="M9 19h.01M13 19h.01M17 19h.01M11 22h.01M15 22h.01" stroke-width="2.4"/>',
  rainbow: () => '<path d="M3 18a9 9 0 0 1 18 0M6 18a6 6 0 0 1 12 0M9 18a3 3 0 0 1 6 0"/>',
};

export function weatherIcon(cond: Condition, night = false): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[cond](night)}</svg>`;
}
