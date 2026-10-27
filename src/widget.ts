import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';

/** Tauri 데스크톱 앱 안에서 실행 중인지. 웹 브라우저에서는 false. */
export const isDesktopApp = '__TAURI_INTERNALS__' in window;

/** 네이티브 위치 실패 코드 → GeolocationPositionError 코드(1 거부, 2 불가, 3 시간 초과) */
const LOCATION_ERRORS: Record<string, number> = { denied: 1, unavailable: 2, timeout: 3 };

/**
 * 데스크톱 앱의 현재 위치. 앱 창의 WebKit 은 위치 권한을 처리하지 못해 macOS 위치 API 를 쓴다.
 * 좌표는 Rust 쪽에서 이미 소수 2자리로 줄여 온다. 실패하면 오류 코드(number)를 던진다.
 */
export async function nativeLocation(): Promise<{ lat: number; lon: number }> {
  try {
    const [lat, lon] = await invoke<[number, number]>('current_location');
    return { lat, lon };
  } catch (e) {
    throw LOCATION_ERRORS[String(e)] ?? 2;
  }
}

/**
 * 테두리 없는 위젯 창 꾸미기. 위쪽 띠를 끌면 창이 옮겨지고(섬 회전과 겹치지 않게 띠만),
 * 오른쪽 아래 손잡이를 끌면 크기가 바뀐다.
 */
export function setupWidget(app: HTMLElement): void {
  document.documentElement.classList.add('widget');
  document.body.classList.add('widget');

  const strip = document.createElement('div');
  strip.className = 'drag-strip';
  strip.setAttribute('data-tauri-drag-region', '');
  strip.title = '끌어서 옮기기';

  const grip = document.createElement('div');
  grip.className = 'resize-grip';
  grip.title = '끌어서 크기 조절';
  grip.addEventListener('mousedown', (e) => {
    e.preventDefault();
    getCurrentWindow().startResizeDragging('SouthEast');
  });

  app.append(strip, grip);
}
