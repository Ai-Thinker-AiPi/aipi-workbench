/**
 * 小安派工作台 · 宿主半边（Host half）
 * AiPi Workbench — DSH plugin, host half
 *
 * 这一半负责把工作台暴露成 Agent 可调用的工具：
 *
 *   Agent ──tool call──▶ 本文件（工具） ──队列──▶ 浏览器（工作台 React 状态）
 *                                ◀──HTTP 回执──┘
 *
 * 浏览器每 ~350ms 拉一次 /aipi-workbench/agent/poll，执行完把结果 POST 回来，
 * 工具那边等 Promise resolve，再把结构化结果交给模型。
 *
 * 约束：
 *   · 工作台面板没打开时，命令没人执行 → 工具返回明确错误，而不是假装成功；
 *   · 本文件不碰 React 状态，只做转发与超时。
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** 插件名，cordis 用它做主键之一。 */
export const name = 'aipi-workbench';

export const inject = ['tools'];

/**
 * 工具的 output 描述：DSH 要求每个工具声明 schema + render。
 * 统一用 { summary, json } 两个字符串：summary 给一行人类可读结论，
 * json 给结构化数据（模型自己 parse），schema 因此可以保持简单。
 */
const OUTPUT = {
    schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
            summary: { type: 'string' },
            json: { type: 'string' },
        },
        required: ['summary', 'json'],
    },
    render: (_args, value) => [{ type: 'text', text: String(value.summary || '') + '\n' + String(value.json || '{}') }],
};

/** 把任意执行结果包装成工具输出。 */
function pack(summary, payload) {
    return { summary, json: JSON.stringify(payload === undefined ? {} : payload) };
}

const ROUTE_POLL = '/aipi-workbench/agent/poll';
const ROUTE_RESULT = '/aipi-workbench/agent/result';
const ROUTE_DEV = '/aipi-workbench/agent/dev';

/** 等待浏览器执行的最长时间（毫秒）：面板没开时不要卡住模型。 */
const CMD_TIMEOUT_MS = 12000;

/** 工具名 → 执行函数：dev 路由靠它做本机自测（不经过模型）。 */
const TOOL_IMPL = new Map();

/** 待执行命令队列 + 正在等回执的 Promise。 */
// ── 串口服务 ────────────────────────────────────────────────────────
//
// serialport 是 optionalDependency：装不上（或 ABI 不匹配）时插件照常启动，
// 只是串口类工具返回明确的「驱动不可用」，不会把整个插件拖垮。
//
// 帧格式（下发 DSL 用）：
//   'AIPI' | ver(1) | type(1) | len(u32 LE) | payload(UTF-8 JSON) | checksum(u16 LE, 字节和)
let serialModule = null;
let serialPort = null;
let serialPath = '';

async function loadSerial() {
    if (serialModule) return serialModule;
    const mod = await import('serialport');
    serialModule = mod.default || mod;
    return serialModule;
}

/** 字节和校验（简单、可复现；真机协议定了再换 CRC）。 */
export function sum16(buf) {
    let s = 0;
    for (let i = 0; i < buf.length; i += 1) s = (s + buf[i]) & 0xffff;
    return s;
}

/** 把 DSL 打成一帧。 */
function frameDsl(dsl) {
    const payload = Buffer.from(JSON.stringify(dsl), 'utf8');
    const head = Buffer.alloc(10);
    head.write('AIPI', 0, 'ascii');
    head[4] = 1; // version
    head[5] = 1; // type: DSL
    head.writeUInt32LE(payload.length, 6);
    const tail = Buffer.alloc(2);
    tail.writeUInt16LE(sum16(payload), 0);
    return Buffer.concat([head, payload, tail]);
}

/** 打开一个串口（同一时间只保留一个连接）。 */
async function openSerial(path, baudRate) {
    const { SerialPort } = await loadSerial();
    if (serialPort) {
        if (serialPath === path) return serialPort;
        serialPort.close();
        serialPort = null;
    }
    serialPort = await new Promise((resolveOpen, rejectOpen) => {
        const p = new SerialPort({ path, baudRate: baudRate || 115200 }, (err) => {
            if (err) rejectOpen(err);
            else resolveOpen(p);
        });
    });
    serialPath = path;
    return serialPort;
}

/** 读一段时间的串口输出，返回文本。 */
function readFor(portInstance, ms) {
    return new Promise((resolveRead) => {
        let text = '';
        const onData = (chunk) => { text += chunk.toString('utf8'); };
        portInstance.on('data', onData);
        const timer = setTimeout(() => {
            portInstance.removeListener('data', onData);
            resolveRead(text);
        }, ms);
        if (typeof timer.unref === 'function') timer.unref();
    });
}
const pending = [];
const waiting = new Map();
let seq = 0;

/**
 * 把一条命令交给浏览器执行，并等它回执。
 *
 * @param {string} op   命令名（state / add_plugin / remove_plugin / set_rules）
 * @param {object} args 参数
 * @returns {Promise<object>} { ok, data?, error? }
 */
function enqueue(op, args) {
    return new Promise((resolve) => {
        const id = 'c' + (++seq);
        const timer = setTimeout(() => {
            waiting.delete(id);
            const at = pending.findIndex((c) => c.id === id);
            if (at >= 0) pending.splice(at, 1);
            resolve({ ok: false, error: '工作台没有响应：面板可能没打开、或页面已刷新' });
        }, CMD_TIMEOUT_MS);
        waiting.set(id, { resolve, timer });
        pending.push({ id, op, args: args || {} });
    });
}

/** 统一的 JSON 回包。 */
function json(response, status, body) {
    response.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
    });
    response.end(JSON.stringify(body));
}

/** 读请求体（有大小上限，避免被巨包拖死）。 */
function readBody(request) {
    return new Promise((resolve) => {
        let raw = '';
        let done = false;
        const finish = (value) => { if (!done) { done = true; resolve(value); } };
        request.on('data', (chunk) => {
            raw += chunk;
            if (raw.length > 1 << 20) { finish(null); request.destroy(); }
        });
        request.on('end', () => {
            try { finish(JSON.parse(raw || '{}')); } catch { finish(null); }
        });
        request.on('error', () => finish(null));
    });
}

/**
 * 装配入口。
 *
 * 注意：cordis 把 apply 的返回值当 effect 收集，只能返回 undefined/null、
 * 一个 dispose 函数、或 thenable/iterator。返回普通对象会抛 Invalid effect。
 */
export function apply(ctx, config = {}) {
    try {
        ctx?.logger?.info?.(`aipi-workbench: 已装配（enabled=${config.enabled !== false}）`);
    } catch { /* 日志失败不影响装配 */ }

    // ── webServer 路由：浏览器 ↔ 宿主 ──────────────────────────────────
    try {
        if (typeof ctx?.inject === 'function') {
            ctx.inject(['webServer'], (inner) => {
                const webServer = inner.webServer;
                if (!webServer || typeof webServer.register !== 'function') return;
                const publish = (path, handler, label) => {
                    const disposer = webServer.register({ kind: 'exact', path, handler });
                    if (typeof inner.effect === 'function') inner.effect(() => disposer, label);
                };

                // 浏览器轮询：取走当前排队的命令
                publish(ROUTE_POLL, (request, response) => {
                    if (request.method !== 'GET') { json(response, 405, { ok: false }); return; }
                    json(response, 200, pending.splice(0, pending.length));
                }, 'aipi-workbench: agent poll');

                // 浏览器回执：{ id, ok, data?, error? }
                publish(ROUTE_RESULT, async (request, response) => {
                    if (request.method !== 'POST') { json(response, 405, { ok: false }); return; }
                    const body = await readBody(request);
                    if (!body || !body.id) { json(response, 400, { ok: false, error: 'id 必填' }); return; }
                    const slot = waiting.get(body.id);
                    if (slot) {
                        waiting.delete(body.id);
                        clearTimeout(slot.timer);
                        slot.resolve(body);
                    }
                    json(response, 200, { ok: true });
                }, 'aipi-workbench: agent result');

                // 本机调试入口：直接像工具一样跑一条命令（给自测脚本用）
                publish(ROUTE_DEV, async (request, response) => {
                    if (request.method !== 'POST') { json(response, 405, { ok: false }); return; }
                    const body = await readBody(request);
                    if (!body || !body.op) { json(response, 400, { ok: false, error: 'op 必填' }); return; }
                    // tool:<name> 直接跑某个工具实现（本机自测，不经过模型）
                    if (body.op.indexOf('tool:') === 0) {
                        const fn = TOOL_IMPL.get(body.op.slice(5));
                        if (!fn) { json(response, 404, { ok: false, error: '没有这个工具' }); return; }
                        try {
                            json(response, 200, { ok: true, data: await fn(body.args || {}) });
                        } catch (error) {
                            json(response, 200, { ok: false, error: String((error && error.message) || error) });
                        }
                        return;
                    }
                    json(response, 200, await enqueue(body.op, body.args || {}));
                }, 'aipi-workbench: agent dev');
            });
        }
    } catch (error) {
        console.warn('aipi-workbench: 注册路由失败', error);
    }

    // ── 工具：给 Agent 用的操作面 ─────────────────────────────────────
    try {
        if (!ctx?.tools || typeof ctx.tools.register !== 'function') return;

        ctx.tools.register({
            name: 'workbench_state',
            description: '读取小安派工作台当前状态：画布上的主机与插件、每路 UART 占用、逻辑规则、插件目录（可用 id）。'
                + '做任何改动前先读一次，改完再读一次确认。',
            parameters: { type: 'object', properties: {}, additionalProperties: false },
            output: OUTPUT,
            execute: async () => {
                const r = await enqueue('state');
                if (!r.ok) return pack('读取失败：' + (r.error || '未知错误'), { error: r.error });
                const d = r.data || {};
                return pack('工作台：' + (d.nodes || []).length + ' 个节点、' + (d.rules || []).length + ' 条规则', d);
            },
        });

        ctx.tools.register({
            name: 'workbench_add_plugin',
            description: '往画布上放一个硬件插件（按插件目录里的 id）。插件会自动插到主机空闲的 UART；主机已存在时再加主机会被拒绝。',
            parameters: {
                type: 'object',
                properties: {
                    pluginId: { type: 'string', description: '插件 id，来自 workbench_state 的 catalog' },
                    x: { type: 'number', description: '可选：画布坐标 x' },
                    y: { type: 'number', description: '可选：画布坐标 y' },
                },
                required: ['pluginId'],
                additionalProperties: false,
            },
            output: OUTPUT,
            execute: async (args) => {
                const r = await enqueue('add_plugin', args || {});
                if (!r.ok) return pack('添加失败：' + (r.error || '未知错误'), { error: r.error });
                return pack('已添加插件 ' + (args && args.pluginId), r.data || {});
            },
        });

        ctx.tools.register({
            name: 'workbench_remove_plugin',
            description: '从画布移除一个插件（按 uid），它占用的 UART 随之释放。',
            parameters: {
                type: 'object',
                properties: { uid: { type: 'string', description: '节点 uid，来自 workbench_state 的 nodes[].uid' } },
                required: ['uid'],
                additionalProperties: false,
            },
            output: OUTPUT,
            execute: async (args) => {
                const r = await enqueue('remove_plugin', args || {});
                if (!r.ok) return pack('移除失败：' + (r.error || '未知错误'), { error: r.error });
                return pack('已移除节点 ' + (args && args.uid), r.data || {});
            },
        });

        ctx.tools.register({
            name: 'workbench_set_rules',
            description: '整体替换工作台的逻辑规则。每条规则 = 触发通道上某个事件 → 一个或多个执行通道上的动作（可带参数）。'
                + '事件名与动作名必须来自插件目录的能力定义，否则校验会失败。',
            parameters: {
                type: 'object',
                properties: {
                    rules: {
                        type: 'array',
                        description: '规则数组；传空数组即清空规则（退回自动推断的只读视图）',
                        items: {
                            type: 'object',
                            properties: {
                                uart: { type: 'number', description: '触发通道号 1-6' },
                                event: { type: 'string', description: '事件名，如 person_enter' },
                                then: {
                                    type: 'array',
                                    items: {
                                        type: 'object',
                                        properties: {
                                            uart: { type: 'number' },
                                            action: { type: 'string' },
                                            args: { type: 'object' },
                                        },
                                        required: ['uart', 'action'],
                                    },
                                },
                            },
                            required: ['uart', 'event', 'then'],
                        },
                    },
                },
                required: ['rules'],
                additionalProperties: false,
            },
            output: OUTPUT,
            execute: async (args) => {
                const r = await enqueue('set_rules', args || {});
                if (!r.ok) return pack('写入失败：' + (r.error || '未知错误'), { error: r.error });
                return pack('已写入 ' + ((r.data && r.data.count) || 0) + ' 条规则', r.data || {});
            },
        });

        ctx.tools.register({
            name: 'workbench_validate',
            description: '按当前画布与规则跑一遍静态校验：主机是否存在、插件是否都接到通道、规则引用的通道是否存在、以及内置的工程校验项。返回 passed 与 issues 列表。',
            parameters: { type: 'object', properties: {}, additionalProperties: false },
            output: OUTPUT,
            execute: async () => {
                const r = await enqueue('validate');
                if (!r.ok) return pack('校验失败：' + (r.error || '未知错误'), { error: r.error });
                const d = r.data || {};
                const n = (d.issues || []).length;
                return pack((d.passed ? '校验通过' : '校验未通过') + '（' + n + ' 条问题）', d);
            },
        });

        ctx.tools.register({
            name: 'workbench_compile',
            description: '把当前工作台编译成下发用的 DSL（通道、插件、规则），返回 dsl 与规模摘要。编译不写盘、不下发。',
            parameters: { type: 'object', properties: {}, additionalProperties: false },
            output: OUTPUT,
            execute: async () => {
                const r = await enqueue('compile');
                if (!r.ok) return pack('编译失败：' + (r.error || '未知错误'), { error: r.error });
                const s = (r.data && r.data.summary) || {};
                return pack('已编译：' + (s.nodes || 0) + ' 节点 / ' + (s.rules || 0) + ' 规则', r.data || {});
            },
        });

        ctx.tools.register({
            name: 'workbench_simulate',
            description: '按当前规则跑一次只读仿真，返回按时间排序的执行步骤（谁触发、执行了什么）。不连硬件。',
            parameters: { type: 'object', properties: {}, additionalProperties: false },
            output: OUTPUT,
            execute: async () => {
                const r = await enqueue('simulate');
                if (!r.ok) return pack('仿真失败：' + (r.error || '未知错误'), { error: r.error });
                const steps = (r.data && r.data.steps) || [];
                return pack('仿真：' + steps.length + ' 步', { steps });
            },
        });

        ctx.tools.register({
            name: 'workbench_save_project',
            description: '把当前工作台导出成 .aipi 工程文件并写到宿主磁盘。path 省略时写到当前工作目录下 <工程名>.aipi。',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: '目标文件路径（绝对或相对宿主 cwd）' },
                },
                additionalProperties: false,
            },
            output: OUTPUT,
            execute: async (args) => {
                const r = await enqueue('export_state');
                if (!r.ok) return pack('导出失败：' + (r.error || '未知错误'), { error: r.error });
                const project = (r.data && r.data.project) || {};
                const name = (project.meta && project.meta.name) || 'untitled';
                const target = args && args.path ? resolve(args.path) : resolve(process.cwd(), name + '.aipi');
                try {
                    writeFileSync(target, JSON.stringify(project, null, 2), 'utf8');
                } catch (error) {
                    return pack('写盘失败：' + error.message, { path: target });
                }
                return pack('已保存到 ' + target, { path: target });
            },
        });

        ctx.tools.register({
            name: 'workbench_open_project',
            description: '从宿主磁盘读一个 .aipi 工程并载入工作台（替换当前画布与规则）。',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: '工程文件路径（绝对或相对宿主 cwd）' },
                },
                required: ['path'],
                additionalProperties: false,
            },
            output: OUTPUT,
            execute: async (args) => {
                const target = resolve((args && args.path) || '');
                let raw;
                try {
                    raw = JSON.parse(readFileSync(target, 'utf8'));
                } catch (error) {
                    return pack('读取失败：' + error.message, { path: target });
                }
                const r = await enqueue('import_state', { project: raw, name: target });
                if (!r.ok) return pack('载入失败：' + (r.error || '未知错误'), { error: r.error });
                return pack('已载入 ' + target, r.data || {});
            },
        });

        // ── 串口工具 ──────────────────────────────────────────────
        const mount = (def) => {
            TOOL_IMPL.set(def.name, def.execute);
            ctx.tools.register(def);
        };

        mount({
            name: 'workbench_serial_ports',
            description: '列出宿主上可用的串口（COM 口）。驱动未安装或加载失败时返回明确原因。',
            parameters: { type: 'object', properties: {}, additionalProperties: false },
            output: OUTPUT,
            execute: async () => {
                try {
                    const { SerialPort } = await loadSerial();
                    const list = await SerialPort.list();
                    return pack('串口：' + list.length + ' 个', { ports: list });
                } catch (error) {
                    return pack('串口驱动不可用：' + error.message, { ports: [], error: String(error.message || error) });
                }
            },
        });

        mount({
            name: 'workbench_push',
            description: '编译当前工作台并下发：把 DSL 打成 AIPI 帧写到串口，然后读回一段时间的输出（self-test）。'
                + 'dry=true 或省略 path 时只做打包预览，不打开串口。',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: '串口路径，如 COM5' },
                    baudRate: { type: 'number', description: '波特率，默认 115200' },
                    readMs: { type: 'number', description: '下发后读回时长（毫秒），默认 1500' },
                    dry: { type: 'boolean', description: 'true = 只打包不发送' },
                },
                additionalProperties: false,
            },
            output: OUTPUT,
            execute: async (args) => {
                const a = args || {};
                const r = await enqueue('compile');
                if (!r.ok) return pack('编译失败：' + (r.error || '未知错误'), { error: r.error });
                const dsl = (r.data && r.data.dsl) || {};
                const frame = frameDsl(dsl);
                const hexHead = frame.subarray(0, Math.min(24, frame.length)).toString('hex');
                if (a.dry || !a.path) {
                    return pack('打包完成（未发送）：' + frame.length + ' 字节', {
                        bytes: frame.length,
                        hexHead,
                        rules: (dsl.rules || []).length,
                        channels: (dsl.channels || []).length,
                        checksum: sum16(frame.subarray(10, frame.length - 2)),
                        dry: true,
                    });
                }
                try {
                    const port = await openSerial(a.path, a.baudRate);
                    const readP = readFor(port, a.readMs || 1500);
                    await new Promise((res, rej) => { port.write(frame, (err) => (err ? rej(err) : res())); });
                    await new Promise((res) => port.drain(() => res()));
                    const received = await readP;
                    return pack('已下发 ' + frame.length + ' 字节到 ' + a.path + '，读回 ' + received.length + ' 字符', {
                        path: a.path, bytes: frame.length, hexHead, received: received.slice(0, 2000),
                    });
                } catch (error) {
                    return pack('下发失败：' + error.message, { path: a.path, error: String(error.message || error) });
                }
            },
        });

        mount({
            name: 'workbench_serial_read',
            description: '打开串口并读取指定时长（默认 1000ms）的输出，用来抓 self-test 日志。',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: '串口路径，如 COM5' },
                    baudRate: { type: 'number', description: '波特率，默认 115200' },
                    ms: { type: 'number', description: '读取时长，默认 1000' },
                },
                required: ['path'],
                additionalProperties: false,
            },
            output: OUTPUT,
            execute: async (args) => {
                const a = args || {};
                try {
                    const port = await openSerial(a.path, a.baudRate);
                    const text = await readFor(port, a.ms || 1000);
                    return pack('读回 ' + text.length + ' 字符', { path: a.path, text: text.slice(0, 4000) });
                } catch (error) {
                    return pack('读取失败：' + error.message, { path: a.path, error: String(error.message || error) });
                }
            },
        });

        mount({
            name: 'workbench_serial_close',
            description: '关闭当前打开的串口。',
            parameters: { type: 'object', properties: {}, additionalProperties: false },
            output: OUTPUT,
            execute: async () => {
                if (!serialPort) return pack('没有打开的串口', { closed: false });
                const path = serialPath;
                try { await new Promise((res) => serialPort.close(() => res())); } catch { /* 关掉就行 */ }
                serialPort = null;
                serialPath = '';
                return pack('已关闭 ' + path, { closed: true, path });
            },
        });
    } catch (error) {
        console.warn('aipi-workbench: 注册工具失败', error);
    }
}
