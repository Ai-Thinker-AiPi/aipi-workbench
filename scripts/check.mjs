/**
 * 静态装配检查：在 Node 里把浏览器半边跑一遍。
 *
 * 不需要 React——工厂函数只定义组件、不调用它们，所以给个空壳 React 就够。
 * 这一步验证的是「bundle 外壳、导出形状、以及右侧栏对话标签页的三段接线」：
 *   1. window.__ModuleLoader__.load({ id, factory }) 接得住；
 *   2. factory(require) 返回的模块里有 apply / inject；
 *   3. apply 注册出 main + sidebar.panellist 两个座位；
 *   4. **页类型注册的 id，必须与 sidebar.right.pane.tab 的 body key 相同**
 *      （TabSlot 用 tab.kind 查 definition，再用 definition.id 取 body；
 *        两者不一致 = 标签页打开了却取不到内容）；
 *   5. 通过座位的 inject 回调拿到 openChat，调用后 openTab 收到的是页类型的 kind；
 *   6. 卸载时座位能全部释放。
 *
 * 第 4、5 条是为了防止那次「点了没反应」的 bug 复发。
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

// ── 假宿主 ────────────────────────────────────────────────────────────────
const seats = [];        // 注册的座位
const freed = [];        // 释放记录
const disposers = [];    // inject 回调交回的 disposer
const tabTypes = [];     // 注册的页类型
const opened = [];       // openTab 调用记录

const services = {
    sidebarRightTabs: {
        register: (def) => {
            tabTypes.push(def);
            return () => {};
        },
    },
    sidebarRight: {
        openTab: (kind, options) => { opened.push({ kind, options }); },
    },
};

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
    inject: (names, cb) => {
        const inner = {};
        names.forEach((n) => { inner[n] = services[n]; });
        return cb(inner);
    },
};

mod.apply(ctx);

// ── 断言 ──────────────────────────────────────────────────────────────────
const byName = (n) => seats.filter((s) => s.seat.name === n);
if (!byName('main').length) fail('没注册 main 座位');
if (!byName('sidebar.panellist').length) fail('没注册 sidebar.panellist 座位');

const body = byName('sidebar.right.pane.tab')[0];
if (!body) fail('没注册 sidebar.right.pane.tab（右侧栏对话标签页主体）');
if (!tabTypes.length) fail('没注册页类型（sidebarRightTabs.register）——openTab 会静默失败');

const def = tabTypes[0];
if (def.id !== body.seat.key) {
    fail('页类型 id（' + def.id + '）与 body key（' + body.seat.key + '）不一致——'
        + 'TabSlot 会用 definition.id 取 body，不一致就取不到内容');
}

// 会话子插槽：body 声明了它，并且有人占用
const declaredChildren = Object.keys(body.seat.children || {});
if (!declaredChildren.length) fail('右侧栏标签页没有声明会话子插槽');
declaredChildren.forEach((child) => {
    if (!byName(child).length) fail('声明了子插槽 ' + child + ' 却没有人占用');
});

// 通过 main 座位的 inject 取 openChat，验证打开时传的是页类型的 kind
const mainSeat = byName('main')[0].seat;
if (typeof mainSeat.inject === 'function') {
    const props = mainSeat.inject();
    if (typeof props.openChat === 'function') {
        props.openChat();
        if (!opened.length) fail('openChat 没有调用 sidebarRight.openTab');
        if (opened[0].kind !== def.kind) {
            fail('openTab 传的 kind（' + opened[0].kind + '）与页类型的 kind（' + def.kind + '）不一致');
        }
    } else {
        fail('main 座位没有向组件注入 openChat');
    }
} else {
    fail('main 座位没有 inject 回调，组件拿不到 openChat');
}

// 卸载：slots 服务调用 inject 回调交回来的 disposer（嵌套会让同一个冒泡两层，去重）
Array.from(new Set(disposers)).forEach((d) => d());
if (freed.length !== seats.length) {
    fail('disposer 没有把座位都释放掉（注册 ' + seats.length + '，释放 ' + freed.length + '）');
}

console.log('✓ 装配检查通过：');
console.log('  bundle id      ' + loaded.id);
console.log('  座位           ' + seats.map((s) => s.seat.name).join(' / '));
console.log('  页类型         id=' + def.id + '  kind=' + def.kind + '  title=' + def.title());
console.log('  body key       ' + body.seat.key + '（与页类型 id 一致）');
console.log('  openTab        收到 kind=' + (opened[0] ? opened[0].kind : '未调用'));
console.log('  disposer       已释放 ' + freed.length + ' 个座位');
