/**
 * 静态装配检查：在 Node 里把浏览器半边跑一遍。
 *
 * 不需要 React——工厂函数只定义组件、不调用它们，所以给个空壳 React 就够。
 * 这一步验证的是「bundle 外壳和导出形状对不对」：
 *   window.__ModuleLoader__.load({ id, factory }) 接得住；
 *   factory(require) 返回的模块里有 apply（函数）和 inject（数组）；
 *   apply(ctx) 在给了 slots 的假上下文里能注册出 main + sidebar.panellist 两个座位，
 *   并且返回的 disposer 能真的把两个座位释放掉。
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

// 假 slots：inject 的回调返回值就是「该座位的 disposer」，由 slots 服务在 fiber 销毁时调用；
// 所以这里先收集，再模拟一次卸载。
const registered = [];
const freed = [];
const disposers = [];
const slots = {
    inject: (name, cb) => {
        const d = cb();
        if (typeof d === 'function') disposers.push(d);
        return d;
    },
    register: (seat, comp) => {
        registered.push({ seat, comp });
        return () => freed.push(seat.key || seat.id);
    },
};
const ctx = { slots, logger: { info: () => {}, warn: () => {} } };
mod.apply(ctx);

const names = registered.map((r) => r.seat.name);
if (names.indexOf('main') < 0) fail('没注册 main 座位');
if (names.indexOf('sidebar.panellist') < 0) fail('没注册 sidebar.panellist 座位');
registered.forEach((r) => {
    if (typeof r.comp !== 'function') fail(r.seat.name + ' 的组件不是函数');
});

// 模拟 fiber 销毁：slots 服务调用 inject 回调交回来的 disposer。
// 嵌套 inject 会让同一个组合 disposer 冒泡两层，去重后再执行。
Array.from(new Set(disposers)).forEach((d) => d());
if (freed.length !== registered.length) {
    fail('disposer 没有把座位都释放掉（注册 ' + registered.length + '，释放 ' + freed.length + '）');
}

console.log('✓ 装配检查通过：');
console.log('  bundle id      ' + loaded.id);
console.log('  inject         ' + JSON.stringify(mod.inject));
console.log('  座位           ' + names.join(' / '));
console.log('  disposer       已释放 ' + freed.length + ' 个座位');
