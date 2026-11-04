/**
 * 小安派工作台 · 宿主半边（Host half）
 * AiPi Workbench — DSH plugin, host half
 *
 * 这个插件的界面全部在 lib/client.js（浏览器半边），宿主这半边现在只做两件事：
 *   1. 让 loader 行有一个合法的入口模块（没有 apply 的模块会让整行加载失败）；
 *   2. 打一条装配日志，方便在宿主日志里确认插件确实起来了。
 *
 * 后续要接的宿主能力（现在没有，别在这里假装有）：
 *   · 串口枚举与下发（USB CDC）—— 需要宿主侧的串口服务，浏览器拿不到 COM 口；
 *   · 能力注册表同步 —— workbench.list_plugins / get_capability；
 *   · 校验与仿真 —— validate_config / simulate；
 *   · 校验失败与验证报告 —— read_state / self_test。
 * 这些都要先有宿主服务，再暴露成工具给 AI，客户端只负责画界面。
 */

/** 插件名，cordis 用它做主键之一。 */
export const name = 'aipi-workbench';

/**
 * 装配入口。
 *
 * 注意：cordis 把 apply 的返回值当 effect 收集，**只能**返回 undefined/null、
 * 一个 dispose 函数、或 thenable/iterator。返回普通对象会抛
 * `TypeError: Invalid effect`，整条插件 fiber 随即被卸载。
 *
 * @param {import('cordis').Context} ctx 宿主上下文
 * @param {object} config loader 行里给的配置
 */
export function apply(ctx, config = {}) {
    try {
        ctx?.logger?.info?.(
            `aipi-workbench: 已装配（enabled=${config.enabled !== false}）`,
        );
    } catch {
        /* 日志失败不影响装配 */
    }
}
