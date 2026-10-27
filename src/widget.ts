import { getCurrentWindow } from '@tauri-apps/api/window';

/** Tauri 데스크톱 앱 안에서 실행 중인지. 웹 브라우저에서는 false. */
export const isDesktopApp = '__TAURI_INTERNALS__' in window;

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
