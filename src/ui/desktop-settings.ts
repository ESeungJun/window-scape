import { getVersion } from '@tauri-apps/api/app';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { relaunch } from '@tauri-apps/plugin-process';
import { check } from '@tauri-apps/plugin-updater';

/**
 * 데스크톱 위젯 전용 설정: 창 배치(바탕화면 고정·일반·항상 위), 투명도, 버전과 자동 업데이트.
 * 웹 브라우저에서는 부르지 않는다.
 */
const OPACITY_KEY = 'window-scape:opacity';
const AUTO_UPDATE_KEY = 'window-scape:auto-update';
const UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1000;
const FIRST_CHECK_DELAY_MS = 15 * 1000;

type Layer = 'desktop' | 'normal' | 'top';
const LAYERS: [Layer, string][] = [['desktop', '바탕화면 고정'], ['normal', '일반'], ['top', '항상 위']];

const read = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // 저장소를 못 쓰면 이번 실행에만 적용된다
  }
};

function section(title: string): { root: HTMLElement; body: HTMLElement } {
  const root = document.createElement('section');
  root.className = 'chips';
  const h = document.createElement('h3');
  h.textContent = title;
  const body = document.createElement('div');
  body.className = 'chips__list';
  root.append(h, body);
  return { root, body };
}

function chip(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'chip';
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

function applyOpacity(percent: number) {
  document.documentElement.style.setProperty('--app-opacity', String(percent / 100));
}

export function setupDesktopSettings(panel: HTMLElement, toast: (message: string) => void): void {
  const note = panel.querySelector('.panel__note');

  // ── 창 배치 ──
  const layer = section('창 배치');
  layer.body.setAttribute('role', 'group');
  layer.body.setAttribute('aria-label', '창 배치');
  const layerChips = new Map<Layer, HTMLButtonElement>();
  const syncLayer = (current: string) => {
    for (const [value, b] of layerChips) b.setAttribute('aria-pressed', String(value === current));
  };
  for (const [value, label] of LAYERS) {
    const b = chip(label, () => {
      syncLayer(value);
      invoke('set_layer', { layer: value }).catch(() => toast('창 배치를 바꾸지 못했어요.'));
    });
    layerChips.set(value, b);
    layer.body.append(b);
  }
  invoke<string>('get_layer').then(syncLayer).catch(() => {});
  // 메뉴 막대에서 바꿔도 따라온다
  listen<string>('layer-changed', (e) => syncLayer(e.payload));

  // ── 투명도 ──
  const opacity = section('투명도');
  const saved = Number(read(OPACITY_KEY));
  const initial = saved >= 30 && saved <= 100 ? saved : 100;
  const range = document.createElement('input');
  range.type = 'range';
  range.min = '30';
  range.max = '100';
  range.step = '5';
  range.value = String(initial);
  range.className = 'slider';
  range.setAttribute('aria-label', '위젯 투명도');
  const value = document.createElement('span');
  value.className = 'slider__value';
  const show = (v: number) => (value.textContent = `${v}%`);
  range.addEventListener('input', () => {
    const v = Number(range.value);
    applyOpacity(v);
    show(v);
  });
  range.addEventListener('change', () => write(OPACITY_KEY, range.value));
  opacity.body.append(range, value);
  applyOpacity(initial);
  show(initial);

  // ── 앱 정보: 버전과 업데이트 ──
  const about = section('앱 정보');
  const version = document.createElement('span');
  version.className = 'about__version';
  const status = document.createElement('p');
  status.className = 'about__status';
  status.setAttribute('role', 'status');
  let auto = read(AUTO_UPDATE_KEY) !== 'off';
  let busy = false;
  let installed = false;

  const restart = chip('지금 다시 시작', () => relaunch());
  restart.hidden = true;
  const checkBtn = chip('업데이트 확인', () => runCheck(true));
  const autoBtn = chip('', () => {
    auto = !auto;
    write(AUTO_UPDATE_KEY, auto ? 'on' : 'off');
    syncAuto();
  });
  const syncAuto = () => {
    autoBtn.textContent = auto ? '자동 업데이트 켜짐' : '자동 업데이트 꺼짐';
    autoBtn.setAttribute('aria-pressed', String(auto));
  };
  syncAuto();
  about.body.append(version, checkBtn, autoBtn, restart);
  about.root.append(status);
  getVersion().then((v) => (version.textContent = `버전 ${v}`)).catch(() => {});

  /** 새 버전이 있으면 내려받아 설치한다. 적용은 다시 시작할 때 */
  async function runCheck(manual: boolean) {
    if (busy || installed) return;
    busy = true;
    checkBtn.disabled = true;
    if (manual) status.textContent = '업데이트 확인 중…';
    try {
      const update = await check();
      if (!update) {
        if (manual) status.textContent = '최신 버전이에요.';
        return;
      }
      let total = 0;
      let received = 0;
      status.textContent = `새 버전 ${update.version} 내려받는 중…`;
      await update.downloadAndInstall((e) => {
        if (e.event === 'Started') total = e.data.contentLength ?? 0;
        if (e.event === 'Progress') {
          received += e.data.chunkLength;
          if (total) status.textContent = `새 버전 ${update.version} 내려받는 중… ${Math.round((received / total) * 100)}%`;
        }
      });
      installed = true;
      status.textContent = `${update.version} 설치를 마쳤어요. 다시 시작하면 적용돼요.`;
      restart.hidden = false;
      if (!manual) toast(`새 버전 ${update.version}을 설치했어요. 설정에서 다시 시작하면 적용돼요.`);
    } catch {
      if (manual) status.textContent = '업데이트를 확인하지 못했어요. 인터넷 연결을 확인해 주세요.';
    } finally {
      busy = false;
      checkBtn.disabled = installed;
    }
  }

  // 자동 업데이트: 켜 둔 동안 시작 직후와 6시간마다 조용히 확인한다
  window.setTimeout(() => auto && runCheck(false), FIRST_CHECK_DELAY_MS);
  window.setInterval(() => auto && runCheck(false), UPDATE_INTERVAL_MS);

  panel.insertBefore(layer.root, note);
  panel.insertBefore(opacity.root, note);
  panel.insertBefore(about.root, note);
}
