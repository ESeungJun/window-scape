import { defineConfig, type Plugin } from 'vite';

// 배포 빌드에만 CSP 를 넣는다. 개발 서버는 HMR 이 인라인 스타일·웹소켓을 써서 제외한다.
const CSP = [
  "default-src 'self'",
  "connect-src 'self' https://api.open-meteo.com https://geocoding-api.open-meteo.com",
  "img-src 'self' data: blob:",
  "style-src 'self'",
  "script-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

const csp = (): Plugin => ({
  name: 'csp-meta',
  apply: 'build',
  transformIndexHtml: () => [
    { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP }, injectTo: 'head-prepend' },
  ],
});

export default defineConfig({
  plugins: [csp()],
  build: { chunkSizeWarningLimit: 700 }, // three 가 대부분인 단일 번들이라 기본 경고선(500kB)을 조금 올린다
});
