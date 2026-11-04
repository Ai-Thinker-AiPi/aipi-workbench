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
if (loaded.id !== 'aipi-idea-workbench') fail('bundle id 不对：' + loaded.id);
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

Array.from(new Set(disposers)).forEach((d) => d());
if (freed.length !== seats.length) {
    fail('disposer 没有把座位都释放掉（注册 ' + seats.length + '，释放 ' + freed.length + '）');
}

console.log('✓ 装配检查通过：');
console.log('  bundle id      ' + loaded.id);
console.log('  inject         ' + JSON.stringify(mod.inject));
console.log('  座位           ' + seats.map((s) => s.seat.name).join(' / '));
console.log('  disposer       已释放 ' + freed.length + ' 个座位');
