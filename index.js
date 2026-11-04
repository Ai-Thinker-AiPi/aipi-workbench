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

/** 待执行命令队列 + 正在等回执的 Promise。 */
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
    } catch (error) {
        console.warn('aipi-workbench: 注册工具失败', error);
    }
}
