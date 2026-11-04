/**
 * 静态装配检查：在 Node 里把浏览器半边跑一遍。
 *
 * 不需要 React——工厂函数只定义组件、不调用它们，所以给个空壳 React 就够。
 * 验证的是「bundle 外壳 + 座位注册 + 可卸载」：
 *   1. window.__ModuleLoader__.load({ id, factory }) 接得住；
 *   2. factory(require) 返回的模块里有 apply / inject；
 *   3. apply 注册出 main 与 sidebar.panellist 两个座位；
 *   4. 卸载时座位能全部释放。
 *
 * 界面本身（含右侧的原生对话）要在真宿主里看，这里不做渲染断言。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '..', 'lib', 'client.js'), 'utf8');

let loaded = null;
const sandbox = {
    window: { __ModuleLoader__: { load: (def) => { loaded = def; } } },
    console,
};
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: 'client.js' });

const fail = (msg) => { console.error('✗ ' + msg); process.exit(1); };

if (!loaded) fail('没有调用 window.__ModuleLoader__.load');
if (loaded.id !== 'aipi-workbench') fail('bundle id 不对：' + loaded.id);
if (typeof loaded.factory !== 'function') fail('factory 不是函数');

const React = {
    createElement: () => null,
    useState: () => [null, () => {}],
    useRef: () => ({ current: null }),
    useEffect: () => {},
    useMemo: (fn) => fn(),
    useCallback: (fn) => fn,
};
const mod = loaded.factory((name) => {
    if (name === 'react') return React;
    throw new Error('不该 require 的模块：' + name);
});

if (typeof mod.apply !== 'function') fail('没导出 apply');
if (!Array.isArray(mod.inject) || mod.inject.indexOf('slots') < 0) fail('inject 缺 slots');

const seats = [];
const freed = [];
const disposers = [];

const slots = {
    inject: (name, cb) => {
        const d = cb();
        if (typeof d === 'function') disposers.push(d);
        return d;
    },
    register: (seat, comp) => {
        seats.push({ seat, comp });
        return () => freed.push(seat.key || seat.id || seat.name);
    },
};

const ctx = {
    slots,
    logger: { info: () => {}, warn: () => {} },
    inject: () => {},
};

mod.apply(ctx);

const byName = (n) => seats.filter((s) => s.seat.name === n);
if (!byName('main').length) fail('没注册 main 座位');
if (!byName('sidebar.panellist').length) fail('没注册 sidebar.panellist 座位');
seats.forEach((s) => {
    if (typeof s.comp !== 'function') fail(s.seat.name + ' 的组件不是函数');
});

// 导轨名是产品名，改名时这里会先失败，避免只改了文档、界面还是旧名
const rail = byName('sidebar.panellist')[0];
if (typeof rail.seat.label !== 'function') fail('sidebar.panellist 没有 label 函数');
const railLabel = rail.seat.label();
if (railLabel !== '小安派工作台') fail('导轨名不对：' + railLabel);

Array.from(new Set(disposers)).forEach((d) => d());
if (freed.length !== seats.length) {
    fail('disposer 没有把座位都释放掉（注册 ' + seats.length + '，释放 ' + freed.length + '）');
}

console.log('✓ 装配检查通过：');
console.log('  bundle id      ' + loaded.id);
console.log('  导轨名         ' + railLabel);
console.log('  inject         ' + JSON.stringify(mod.inject));
console.log('  座位           ' + seats.map((s) => s.seat.name).join(' / '));
console.log('  disposer       已释放 ' + freed.length + ' 个座位');

// ── 宿主半边：工具与路由 ──────────────────────────────────────────────
// index.js 是 ESM；这里把 export 关键字去掉后在 vm 里跑，验证：
//   1. apply 不返回对象（返回对象会被 cordis 判为 Invalid effect）；
//   2. 注册了 4 个工具、3 条路由。
const hostSrc = readFileSync(join(here, '..', 'index.js'), 'utf8')
    .replace(/export\s+const\s+/g, 'const ')
    .replace(/export\s+function\s+/g, 'function ');

const hostSandbox = { console, setTimeout, clearTimeout, Promise, JSON, Date, Array, Object, Number, String, Math, globalThis: null };
hostSandbox.globalThis = hostSandbox;
vm.createContext(hostSandbox);
vm.runInContext(hostSrc + '\n;globalThis.__host = { name, inject, apply };', hostSandbox, { filename: 'index.js' });

const host = hostSandbox.__host;
const hostTools = [];
const hostRoutes = [];
const hostCtx = {
    logger: { info: () => {}, warn: () => {} },
    inject: (deps, cb) => cb({
        webServer: { register: (opts) => { hostRoutes.push(opts.path); return () => {}; } },
        effect: () => {},
    }),
    tools: { register: (t) => { hostTools.push(t.name); return () => {}; } },
};
const applied = host.apply(hostCtx);
if (applied !== undefined) fail('宿主 apply 返回了 ' + typeof applied + '（会触发 Invalid effect）');
if (host.inject.indexOf('tools') < 0) fail('宿主 inject 缺 tools');

['workbench_state', 'workbench_add_plugin', 'workbench_remove_plugin', 'workbench_set_rules']
    .forEach((n) => { if (hostTools.indexOf(n) < 0) fail('没注册工具：' + n); });
['/aipi-workbench/agent/poll', '/aipi-workbench/agent/result', '/aipi-workbench/agent/dev']
    .forEach((r) => { if (hostRoutes.indexOf(r) < 0) fail('没注册路由：' + r); });

console.log('  宿主工具       ' + hostTools.join(' / '));
console.log('  宿主路由       ' + hostRoutes.join(' / '));
