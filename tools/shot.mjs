// usage: node shot.mjs <out.png> [js-to-eval-after-load] [waitMs]
import { spawn } from 'node:child_process';
const [out, extra = '', waitMs = '6000'] = process.argv.slice(2);
const port = 9333;
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${(await import('node:os')).tmpdir()}/ws-chrome`,
  '--window-size=1200,800', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-first-run', 'about:blank',
], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws;
for (let i = 0; i < 40; i++) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    const page = list.find((t) => t.type === 'page');
    if (page) { ws = new WebSocket(page.webSocketDebuggerUrl); break; }
  } catch {}
  await sleep(250);
}
await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const pending = new Map();
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } else if (m.method === 'Runtime.consoleAPICalled' || m.method === 'Runtime.exceptionThrown') console.log(JSON.stringify(m.params).slice(0, 300)); });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await send('Runtime.enable');
await send('Page.navigate', { url: 'http://127.0.0.1:5179/' });
await sleep(1500);
await send('Runtime.evaluate', { expression: `localStorage.setItem('sky-isle:theme', '${process.env.THEME || 'poke-city'}')` });
await send('Page.reload');
await sleep(2500);
if (extra) console.log(JSON.stringify((await send('Runtime.evaluate', { expression: extra, awaitPromise: true })).result).slice(0, 500));
await sleep(Number(waitMs));
const shot = await send('Page.captureScreenshot', { format: 'jpeg', quality: 80 });
const fs = await import('node:fs');
fs.writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
ws.close(); chrome.kill(); process.exit(0);
