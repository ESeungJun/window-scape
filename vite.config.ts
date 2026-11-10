import { defineConfig, type Plugin } from 'vite';

// 배포 빌드에만 CSP 를 넣는다. 개발 서버는 HMR 이 인라인 스타일·웹소켓을 써서 제외한다.
const CSP = [
  "default-src 'self'",
  "connect-src 'self' https://api.open-meteo.com https://geocoding-api.open-meteo.com",
  "img-src 'self' data: blob:",
  "style-src 'self'",
  // 모델 압축(Draco) 해독기: WASM 컴파일과 blob 워커가 필요하다(일반 JS eval 은 여전히 막힌다)
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

// Tauri 빌드는 tauri.conf.json 의 CSP(IPC 허용 포함)를 쓰므로 메타 태그를 넣지 않는다.
const csp = (): Plugin => ({
  name: 'csp-meta',
  apply: (_config, { command }) => command === 'build' && process.env.TAURI_ENV_PLATFORM === undefined,
  transformIndexHtml: () => [
    { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP }, injectTo: 'head-prepend' },
  ],
});

// three 의 DRACOLoader 가 자기 해독기 사본(assets/draco_*, 약 1.3MB)을 번들에 끌고 온다.
// 앱은 public/draco 의 해독기를 쓰므로(props.ts 의 setDecoderPath) 쓰이지 않는 사본은 내보내지 않는다
// 번들 안에 사본을 가리키는 주소 문자열은 남지만 setDecoderPath 를 쓰는 한 요청되지 않는다. 경로 없는 DRACOLoader 를 새로 만들면 404 가 난다
const dropDracoCopies = (): Plugin => ({
  name: 'drop-draco-copies',
  apply: 'build',
  generateBundle(_options, bundle) {
    for (const name of Object.keys(bundle)) {
      if (/(^|\/)draco_[^/]*\.(js|wasm)$/.test(name)) delete bundle[name];
    }
  },
});

export default defineConfig({
  plugins: [csp(), dropDracoCopies()],
  build: { chunkSizeWarningLimit: 700 }, // three 가 대부분인 단일 번들이라 기본 경고선(500kB)을 조금 올린다
});
