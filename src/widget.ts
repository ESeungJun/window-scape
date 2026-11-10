import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { currentMonitor, getCurrentWindow } from '@tauri-apps/api/window';

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

/**
 * 창 상태를 지켜본다.
 *  - 가려짐: 다른 창에 완전히 가려지면 그리기를 멈추도록 알린다(Rust 가 운영체제에서 받아 'occlusion-changed' 로 보낸다).
 *    WebView 가 스스로 문서를 숨김 처리하는 경우(visibilitychange)는 World 가 따로 듣는다.
 *  - 자리: 창을 옮기면 화면 안에서의 자리(-1~1)를 알려 시차에 쓴다.
 */
export function watchWindow(onOccluded: (occluded: boolean) => void, onPlace: (x: number, y: number) => void): void {
  listen<boolean>('occlusion-changed', (e) => onOccluded(e.payload === true)).catch(() => {});
  const win = getCurrentWindow();
  const place = async () => {
    try {
      const [pos, size, monitor] = await Promise.all([win.outerPosition(), win.outerSize(), currentMonitor()]);
      if (!monitor) return;
      const cx = pos.x + size.width / 2 - monitor.position.x;
      const cy = pos.y + size.height / 2 - monitor.position.y;
      // 화면 가운데가 0, 오른쪽·위가 +1
      onPlace((cx / monitor.size.width) * 2 - 1, 1 - (cy / monitor.size.height) * 2);
    } catch {
      // 창 정보를 못 읽으면 시차 없이 둔다
    }
  };
  let timer = 0;
  win.onMoved(() => {
    clearTimeout(timer);
    timer = window.setTimeout(place, 120);
  }).catch(() => {});
  place();
}
