// 生成汇报用截图：先摆一个可读的演示场景，再逐块截图。
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9390;
const APP = process.argv[2];
const BASE = process.argv[3];
const OUT = process.argv[4] || 'docs/report/img';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });

const profile = mkdtempSync(join(tmpdir(), 'aipi-report-'));
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars', '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile, 'about:blank'], { stdio: 'ignore', detached: true, windowsHide: true });
const cdpHttp = async (p, m = 'GET') => (await fetch('http://127.0.0.1:' + PORT + p, { method: m })).json();
let v = null;
for (let i = 0; i < 40; i++) { try { v = await cdpHttp('/json/version'); break; } catch { await sleep(250); } }
if (!v) { console.log('CHROME_FAIL'); process.exit(1); }

const target = await cdpHttp('/json/new?' + encodeURIComponent(APP), 'PUT');
const ws = new WebSocket(target.webSocketDebuggerUrl);
let seq = 0; const pending = new Map();
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
const send = (method, params = {}) => new Promise((res) => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const evl = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true })).result?.result?.value;

const shot = async (name, box) => {
    const params = { format: 'png' };
    if (box) params.clip = { x: box[0], y: box[1], width: box[2], height: box[3], scale: 2 };  // 2x 清晰度，尺寸可控
    const s = await send('Page.captureScreenshot', params);
    writeFileSync(join(OUT, name + '.png'), Buffer.from(s.result.data, 'base64'));
    console.log('shot ' + name);
};

await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Runtime.enable');
await sleep(4500);
await evl(`(() => { const b = [...document.querySelectorAll('button')].find(e => ((e.getAttribute('aria-label')||'')+(e.getAttribute('title')||'')+e.textContent).indexOf('小安派工作台') >= 0); if (b) b.click(); })()`);
await sleep(2400);

const call = async (op, args) => (await fetch(BASE + '/aipi-workbench/agent/dev', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op, args }),
})).json();

// 摆场景：清空 → 主机 + 雷达/灯/语音/温湿度/屏幕
const s0 = await call('state', {});
for (const n of s0.data.nodes) if (n.capType !== 'host') await call('remove_plugin', { uid: n.uid });
await sleep(400);
const cat = s0.data.catalog;
const pick = (id) => cat.find((c) => c.id === id);
for (const id of ['axk-radar', 'axk-light', 'axk-voice', 'axk-temp', 'axk-screen']) {
    if (pick(id)) await call('add_plugin', { pluginId: id });
}
await sleep(900);
const rules = [
    { uart: 1, event: 'person_enter', then: [{ uart: 2, action: 'light.set', args: { on: true } }, { uart: 3, action: 'speech.ask_llm' }] },
    { uart: 1, event: 'person_leave', then: [{ uart: 2, action: 'light.set', args: { on: false } }] },
];
await call('set_rules', { rules });
await sleep(900);

// 选中一个插件，让属性面板出现
await evl(`(() => { const n = [...document.querySelectorAll('.aipi-node')].find((e) => e.className.indexOf('host') < 0); if (n) n.dispatchEvent(new MouseEvent('click', { bubbles: true })); })()`);
await sleep(700);

await shot('01-overview', [280, 0, 1320, 900]);
await shot('02-library', [280, 44, 232, 640]);
await shot('03-canvas', [512, 44, 420, 636]);
await shot('04-property', [932, 44, 264, 856]);
await shot('05-logic-cards', [280, 676, 1320, 224]);

// 流图
await evl(`(() => { const b = [...document.querySelectorAll('.aipi-logic-hd button')].find((x) => x.textContent === '流图'); if (b) b.click(); })()`);
await sleep(700);
await shot('06-logic-flow', [280, 676, 1320, 224]);

// 运行 + trace
await evl(`(() => { const b = [...document.querySelectorAll('.aipi-logic-hd button')].find((x) => x.textContent === '运行'); if (b) b.click(); })()`);
await sleep(1200);
await shot('07-logic-run', [280, 676, 1320, 224]);
await sleep(2200);

// 代码视图
await evl(`(() => { const b = [...document.querySelectorAll('.aipi-seg button')].find((x) => x.textContent === '代码'); if (b) b.click(); })()`);
await sleep(700);
await shot('08-code', [512, 44, 420, 636]);
await evl(`(() => { const b = [...document.querySelectorAll('.aipi-seg button')].find((x) => x.textContent === '预览'); if (b) b.click(); })()`);
await sleep(500);

// 折叠左栏
await evl(`(() => { const b = document.querySelector('.aipi-collapse-left'); if (b) b.click(); })()`);
await sleep(700);
await shot('09-collapsed', [280, 0, 1320, 900]);
await evl(`(() => { const b = document.querySelector('.aipi-collapse-left'); if (b) b.click(); })()`);
await sleep(600);

// 会话
await shot('10-chat', [1180, 0, 420, 900]);

ws.close(); chrome.kill(); process.exit(0);

