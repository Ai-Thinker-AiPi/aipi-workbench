// 小安派工作台 · AiPi Workbench · 浏览器半边（client half）
//
// 这是一个**手写 bundle**：没有构建步骤、没有 import/export、没有 JSX。
// 页面把它当脚本加载，模块加载器给它一个 require，它只能要 React。
//
// 它贡献两处界面：
//   1. `sidebar.panellist` —— 左侧导轨上的一个入口（图标 + 名字）；
//   2. `main` —— 与入口同 key 的中心区面板，占满 DSH 主区域。
//
// 布局事实（照 dsh-wsl-tool 验证过的写法）：
//   · `sidebar.panellist` 的条目带 `id` / `order` / `label`，图标自己画；
//   · `main` 用同一个 id 作 key，`inject` 回调给它补 props；
//   · 注册返回 disposer，必须在 apply 里交回去，否则热重载后旧面板不释放。

window.__ModuleLoader__.load({
    id: 'aipi-workbench',
    factory: (require) => {
        var module = { exports: {} };
        var exports = module.exports;
        Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

        const React = require('react');
        const h = React.createElement;

        const PANEL_ID = 'aipi-wb';

        // ── 节点尺寸：固定值，连线坐标由它算出来，不依赖 DOM 测量 ──────────
        // 插件节点做成正方形：旋转 90° 后外框footprint 不变，内容不会被框切掉
        const NW = 112;   // 节点宽
        const NH = 112;   // 节点高
        const PORT_Y = NH / 2; // 端口垂直中心

        // ── 主机：6 路双向 UART，插件逐个插上去 ────────────────────────────
        const HOST_UARTS = 6;
        const HOST_W = 220;     // 主机节点宽
        const HOST_H = 168;     // 主机节点高

        // ── 图标：内联 SVG 字符串，按尺寸补 width/height 后塞进 span ────────
        const ICON = {
            radar: '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="24" cy="24" r="15" opacity=".25"/><circle cx="24" cy="24" r="9" opacity=".45"/><circle cx="24" cy="24" r="3" fill="currentColor" stroke="none"/><path d="M24 24 L36 15"/></svg>',
            light: '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M24 9a10 10 0 0 0-6 18v4h12v-4a10 10 0 0 0-6-18z"/><path d="M18 36h12M20 41h8"/></svg>',
            voice: '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><rect x="19" y="10" width="10" height="18" rx="5"/><path d="M14 24a10 10 0 0 0 20 0M24 34v6M19 40h10"/></svg>',
            temp: '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M28 12a5 5 0 0 0-10 0v16a8 8 0 1 0 10 0z"/><path d="M23 20v10"/></svg>',
            servo: '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><rect x="12" y="17" width="24" height="17" rx="3"/><path d="M24 17v-4M24 13h9"/><circle cx="24" cy="26" r="4.5"/></svg>',
            motor: '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="24" cy="24" r="11"/><path d="M24 13v6M24 29v6M13 24h6M29 24h6"/><circle cx="24" cy="24" r="3" fill="currentColor" stroke="none"/></svg>',
            relay: '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><rect x="11" y="15" width="26" height="18" rx="2"/><path d="M17 33v5M24 33v5M31 33v5M18 21h12"/></svg>',
            screen: '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><rect x="10" y="12" width="28" height="19" rx="2"/><path d="M18 36h12M24 31v5"/></svg>',
            hub: '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><rect x="7" y="12" width="34" height="24" rx="4"/><rect x="18" y="19" width="12" height="10" rx="2"/><path d="M13 12V8M31 12V8M13 36v4M31 36v4M7 20h-3M7 28h-3M44 20h-3M44 28h-3"/></svg>',
        };
        const iconSvg = (k, size) =>
            (ICON[k] || ICON.relay).replace('<svg ', '<svg width="' + size + '" height="' + size + '" ');

        // ── 硬件插件目录（能力名与 06_工程资产/v0/data/registry.json 同源）──
        const CATALOG = [
            {
                id: 'aipi-hub', name: 'AiPi-NodeMCU-Hub', cat: '主机', icon: 'hub',
                cap: 'hub.runtime', capType: 'host', io: { out: [], in: [] },
                author: '安信可官方', price: '¥99', sku: 'BL618DG 核心板',
                iface: '6 × Type-C（UART）· USB 2.0 HS · WiFi6',
                uarts: 6,
                desc: '逻辑执行中枢。6 路双向 UART，插件都插在它上面，逻辑与算法在本地芯片跑。',
            },
            {
                id: 'axk-radar', name: '雷达模组', cat: '传感器', icon: 'radar',
                cap: 'radar.person_detect', capType: 'sensor',
                io: { out: ['person_enter', 'person_leave'], in: [] },
                author: '安信可官方', price: '¥29', sku: 'AiPi-Radar-24G',
                desc: '24GHz 人体感应，输出靠近/离开事件与距离。',
            },
            {
                id: 'axk-temp', name: '温湿度模组', cat: '传感器', icon: 'temp',
                cap: 'sensor.read_temp', capType: 'sensor',
                io: { out: ['temp_change'], in: [] },
                author: '安信可官方', price: '¥19', sku: 'AiPi-TH-01',
                desc: '温度 ±0.3℃，湿度 ±3%RH，周期上报。',
            },
            {
                id: 'axk-light', name: '灯 / 继电器', cat: '控制类', icon: 'light',
                cap: 'light.set', capType: 'actuator', io: { out: [], in: ['on'] },
                author: '安信可官方', price: '¥25', sku: 'AiPi-Light-01',
                desc: '单路继电器，支持开/关。',
            },
            {
                id: 'axk-relay4', name: '四路继电器', cat: '控制类', icon: 'relay',
                cap: 'relay.set', capType: 'actuator', io: { out: [], in: ['ch', 'on'] },
                author: '社区 · 阿树', price: '¥59', sku: 'AS-Relay4',
                desc: '四路独立控制，适合多设备场景。',
            },
            {
                id: 'axk-screen', name: '1.3" 屏幕', cat: '控制类', icon: 'screen',
                cap: 'screen.show', capType: 'interaction', io: { out: [], in: ['text'] },
                author: '社区 · 林', price: '¥45', sku: 'AS-LCD13',
                desc: '显示文字与简单表情。',
            },
            {
                id: 'axk-servo', name: '舵机', cat: '电机类', icon: 'servo',
                cap: 'servo.set_angle', capType: 'actuator', io: { out: [], in: ['angle'] },
                author: '安信可官方', price: '¥22', sku: 'AiPi-Servo-9G',
                desc: '0–180° 角度控制，PWM 驱动。',
            },
            {
                id: 'axk-motor', name: '直流电机', cat: '电机类', icon: 'motor',
                cap: 'motor.run', capType: 'actuator', io: { out: [], in: ['speed', 'dir'] },
                author: '社区 · 阿树', price: '¥35', sku: 'AS-Motor-130',
                desc: '调速 + 正反转。',
            },
            {
                id: 'axk-wv01-32s', name: 'Ai-WV01-32S 语音', cat: 'AI语音', icon: 'voice',
                cap: 'speech.ask_llm', capType: 'interaction', io: { out: [], in: ['prompt'] },
                author: '安信可官方', price: '¥69', sku: 'Ai-WV01-32S',
                desc: '离线唤醒 + 云端 TTS，说一句即可。',
            },
        ];
        const CATS = ['全部', '传感器', '控制类', '电机类', 'AI语音'];
        const byId = (id) => CATALOG.filter((p) => p.id === id)[0];

        // ── 样式：一次性注入，全部选择器收在 .aipi-wb 下，不污染宿主 ────────
        const CSS = `
/* 配色全部取自 DSH 自己的语义令牌（--dsw-alias-*），深浅色主题由宿主切换，
   插件不再自己写死浅色/深色两套。令牌缺失时（脱离 DSH 单独预览）用括号里的兜底值。 */
.aipi-wb{display:flex;height:100%;min-height:0;position:relative;overflow:hidden;
  font-family:var(--dsw-font-family,"Microsoft YaHei","PingFang SC",system-ui,sans-serif);
  font-size:13px;line-height:1.6;
  color:var(--dsw-alias-label-primary,#1f2328);
  background:var(--dsw-alias-bg-base,#f7f9fb);
  --panel:var(--dsw-alias-bg-layer-1,#fff);
  --canvas:var(--dsw-alias-bg-base,#fbfcfe);
  --node:var(--dsw-alias-bg-layer-2,#fff);
  --line:var(--dsw-alias-border-l2,#dce2ea);
  --nline:var(--dsw-alias-border-l3,#d7dee8);
  --muted:var(--dsw-alias-label-tertiary,#6b7684);
  --acc:var(--dsw-alias-link,#2f6feb);
  --acc-soft:color-mix(in srgb,var(--acc) 16%,transparent);
  --grid:color-mix(in srgb,var(--dsw-alias-label-primary,#1f2328) 9%,transparent);
  --danger:var(--dsw-static-red-400,#f25a5a);
  --danger-soft:var(--dsw-alias-interactive-bg-hover-danger,rgba(242,90,90,.15));
  --ok:var(--dsw-static-green-400,#3fb950)}
.aipi-wb *{box-sizing:border-box}
.aipi-wb button{font:inherit;color:inherit;background:none;border:0;cursor:pointer}
.aipi-col{display:flex;flex-direction:column;min-width:0;background:var(--panel)}
.aipi-col.left{width:232px;min-width:180px;flex:0 0 auto;border-right:1px solid var(--line)}
.aipi-col.right{width:264px;flex:0 0 264px;border-left:1px solid var(--line);
  display:flex;flex-direction:column;min-height:0;overflow:hidden}
.aipi-right-body{flex:1;min-height:0;overflow:auto;padding:0 12px 14px}
.aipi-col.center{flex:1 1 0;background:var(--canvas);min-width:0;position:relative}
/* 中间列 = 通栏工具条 + 下面一行[画布 | 属性]：属性开合只改画布宽度。
   min-width 兜住画布：空间不够时挤的是对话栏，不是把画布压成 0。 */
.aipi-mid{flex:1 1 0;min-width:0;min-height:0;display:flex;flex-direction:column;background:var(--canvas)}
.aipi-body{flex:1;min-width:0;min-height:0;display:flex}
/* 对话栏：宽度由内联 style 给，但允许被压缩，最少 220 */
.aipi-col.chat{flex:0 1 auto;min-width:220px;border-left:1px solid var(--line);min-height:0}
/* 分隔条：不占布局宽度（否则相邻两栏之间会多出 9px 底色，顶栏像被切断），
   视觉上两栏直接相邻；用一个悬在中缝上的透明伪元素提供命中区 */
.aipi-resizer{width:0;flex:none;position:relative;z-index:2}
.aipi-resizer::after{content:'';position:absolute;top:0;bottom:0;left:-5px;width:10px;
  cursor:col-resize}
.aipi-chat-wrap{flex:1;min-height:0;overflow:auto;display:flex;flex-direction:column}
.aipi-chat-note{padding:10px 12px;font-size:11px;color:var(--muted);
  line-height:1.8;border-bottom:1px dashed var(--line)}
.aipi-hd{display:flex;align-items:center;gap:8px;padding:10px 12px 6px;font-size:12px;font-weight:600}
.aipi-hd .s{margin-left:auto;color:var(--muted);font-weight:400;font-size:11px}
.aipi-host{padding:0 10px 8px}
.aipi-host .lbl{font-size:10px;color:var(--muted);letter-spacing:.4px;margin:2px 2px 5px}
.aipi-cats{display:flex;flex-wrap:wrap;gap:5px;padding:0 10px 8px}
.aipi-cat{font-size:11px;padding:3px 8px;border-radius:20px;color:var(--muted);border:1px solid transparent}
.aipi-cat.on{background:var(--acc-soft);color:var(--acc)}
/* 卡片尺寸固定：栏拉宽只多排几列，不把卡片本身撑大 */
.aipi-grid{overflow:auto;padding:2px 10px 14px;display:grid;
  grid-template-columns:repeat(auto-fill,100px);justify-content:start;gap:8px}
.aipi-card{border:1px solid var(--line);border-radius:10px;background:var(--panel);padding:6px;
  cursor:grab;user-select:none;position:relative;transition:.12s}
.aipi-card:hover{border-color:var(--acc);transform:translateY(-1px)}
.aipi-card.host{display:flex;align-items:center;gap:9px;padding:7px;cursor:grab}
.aipi-card .thumb{aspect-ratio:1/.86;border-radius:7px;display:grid;place-items:center;
  background:var(--acc-soft);color:var(--acc);overflow:hidden}
.aipi-card.host .thumb{width:44px;height:44px;aspect-ratio:auto;flex:none}
.aipi-card .nm{margin-top:5px;font-size:11px;text-align:center;overflow:hidden;
  text-overflow:ellipsis;white-space:nowrap}
.aipi-card.host .nm{margin:0;text-align:left;font-size:12px;font-weight:600}
.aipi-card.host .sm{font-size:10px;color:var(--muted);margin-top:2px;white-space:nowrap;
  overflow:hidden;text-overflow:ellipsis}
.aipi-card .tag{position:absolute;top:6px;right:6px;font-size:9px;color:var(--muted);
  background:var(--panel);border:1px solid var(--line);border-radius:4px;padding:0 4px}
.aipi-tool{display:flex;align-items:center;gap:8px;height:44px;padding:0 12px;flex:none;
  border-bottom:1px solid var(--line);background:var(--panel)}
.aipi-seg{display:flex;background:var(--canvas);border:1px solid var(--line);border-radius:8px;padding:2px}
.aipi-seg button{padding:4px 12px;border-radius:6px;font-size:12px;color:var(--muted)}
.aipi-seg button.on{background:var(--panel);color:inherit;box-shadow:0 1px 3px rgba(0,0,0,.18)}
.aipi-sp{flex:1}
.aipi-btn{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line);
  border-radius:8px;padding:5px 11px;font-size:12px;background:var(--panel)}
.aipi-btn:hover{border-color:var(--acc);color:var(--acc)}
.aipi-btn.primary{background:var(--dsw-alias-button-primary-fill,var(--acc));border-color:var(--dsw-alias-button-primary-fill,var(--acc));color:var(--dsw-alias-label-primary-foreground,#fff)}
.aipi-btn.primary:hover{background:var(--dsw-alias-button-primary-hover,var(--acc));color:var(--dsw-alias-label-primary-foreground,#fff)}
.aipi-btn:disabled{opacity:.45;cursor:not-allowed}
.aipi-led{width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-label-dimmed,#b9c2ce)}
.aipi-led.on{background:var(--ok);box-shadow:0 0 0 3px color-mix(in srgb,var(--ok) 22%,transparent)}
.aipi-stage{position:relative;flex:1;min-height:0;overflow:auto}
.aipi-canvas{position:relative;min-height:100%;min-width:100%;
  background-image:radial-gradient(var(--grid) 1px,transparent 1px);background-size:16px 16px}
.aipi-empty{position:absolute;inset:0;display:grid;place-content:center;text-align:center;
  color:var(--muted);font-size:12px;line-height:2;pointer-events:none}
.aipi-empty b{display:block;color:inherit;font-size:13px;margin-bottom:2px}
/* 节点：图标是主体，名字只是下面一行小字（放不下就省略，完整名在 title 里）。
/* 节点容器本身不转：只有 .aipi-rot 这一层（外框 + 接口）跟着 --rot 转，
   图标 / 名字 / × 始终正向。 */
.aipi-node{position:absolute;width:112px;height:112px;background:transparent;border:0;
  user-select:none;cursor:move;
  display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px}
.aipi-rot{position:absolute;inset:0;z-index:0;transform:rotate(var(--rot,0deg));transform-origin:center}
.aipi-frame{position:absolute;inset:0;border:1px solid var(--nline);border-radius:12px;
  background:var(--node);box-shadow:0 1px 3px rgba(0,0,0,.18);
  transition:border-color .12s,box-shadow .12s}
.aipi-node:hover .aipi-frame{border-color:var(--dsw-alias-border-l4,#b9c6d8)}
.aipi-node.sel .aipi-frame{border-color:var(--acc);box-shadow:0 0 0 3px var(--acc-soft)}
.aipi-node.host .aipi-frame{background:linear-gradient(180deg,var(--acc-soft),var(--node))}
.aipi-node-ico,.aipi-node-nm,.aipi-node-ch,.aipi-host-body{position:relative;z-index:1}
.aipi-node-ico svg{width:32px;height:32px;display:block;stroke-width:2.4}
.aipi-node-nm{max-width:100px;font-size:11px;line-height:1.2;color:var(--muted);
  text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
/* 删除按钮：常驻可见（淡一点），hover 或选中时变实；颜色跟随主题，不用死白底 */
.aipi-del{position:absolute;top:6px;right:6px;width:16px;height:16px;border-radius:50%;
  display:grid;place-items:center;font:12px/1 sans-serif;color:var(--muted);
  background:var(--panel);border:1px solid var(--line);opacity:.45;transition:opacity .12s,color .12s,border-color .12s;z-index:3}
.aipi-node:hover .aipi-del,.aipi-node.sel .aipi-del{opacity:1}
.aipi-del:hover{color:var(--danger);border-color:var(--danger);background:var(--danger-soft);opacity:1}
.aipi-port{position:absolute;top:50%;width:10px;height:10px;border-radius:50%;
  background:var(--panel);border:2px solid var(--nline);transform:translateY(-50%);z-index:2}
.aipi-port.in{left:-6px;border-color:var(--dsw-alias-label-caption,#9aa8b8)}
.aipi-port.out{right:-6px;border-color:var(--acc);cursor:crosshair}
/* 插件自身的 Type-C 口：一左一右，双向；未接入时与主机空闲接口完全同款（灰描边空心） */
.aipi-plug{position:absolute;width:16px;height:8px;border-radius:5px;z-index:3;background:var(--panel);
  border:2px solid var(--dsw-alias-label-caption,#9aa8b8);cursor:crosshair}
.aipi-plug.left{left:-6px;top:50%;transform:translateY(-50%)}
.aipi-plug.right{right:-6px;top:50%;transform:translateY(-50%)}
.aipi-plug.on,.aipi-plug:hover{background:var(--acc);border-color:var(--acc)}
/* 插件右下角的通道标记 */
.aipi-node-ch{margin-top:-2px;font-size:10px;line-height:1;letter-spacing:.3px;color:var(--acc)}
.aipi-node-ch.off{color:var(--muted)}
/* 主机：卡片本体只放图标 / 名字 / 占用数，6 个 Type-C 接口挂在 下、上、右 三条边上 */
.aipi-node.host{width:220px;height:168px;padding-top:16px;overflow:visible}
.aipi-host-body{display:flex;flex-direction:column;align-items:center;gap:5px;pointer-events:none}
.aipi-host-body .ico{display:grid;place-items:center;color:var(--acc)}
.aipi-host-body .nm{font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary,inherit)}
.aipi-host-body .sub{font-size:10px;color:var(--muted);letter-spacing:.3px}
/* Type-C 接口：圆角小长条，贴在边上；标签朝卡片内侧 */
.aipi-socket{position:absolute;width:16px;height:8px;border-radius:5px;z-index:3;
  background:var(--panel);border:2px solid var(--dsw-alias-label-caption,#9aa8b8);cursor:crosshair}
.aipi-socket.on{background:var(--acc);border-color:var(--acc)}
.aipi-socket .lbl{position:absolute;font-size:9px;line-height:1;color:var(--muted);white-space:nowrap}
.aipi-socket.top{top:-4px;transform:translateX(-50%)}
.aipi-socket.top .lbl{left:50%;top:11px;transform:translateX(-50%) rotate(calc(var(--rot,0deg) * -1))}
.aipi-socket.bottom{bottom:-4px;transform:translateX(-50%)}
.aipi-socket.bottom .lbl{left:50%;bottom:11px;transform:translateX(-50%) rotate(calc(var(--rot,0deg) * -1))}
.aipi-socket.right{right:-6px;transform:translateY(-50%)}
.aipi-socket.right .lbl{right:17px;top:50%;transform:translateY(-50%) rotate(calc(var(--rot,0deg) * -1))}
.aipi-socket:hover{background:var(--acc);border-color:var(--acc)}
.aipi-port:hover{background:var(--acc);border-color:var(--acc)}
.aipi-wires{position:absolute;inset:0;overflow:visible;pointer-events:none}
.aipi-wire{fill:none;stroke:var(--acc);stroke-width:2;opacity:.75;pointer-events:stroke;cursor:pointer}
.aipi-wire:hover{opacity:1;stroke-width:3}
.aipi-wire.tmp{stroke-dasharray:4 4;opacity:.6;pointer-events:none}
.aipi-code{display:none;flex:1;overflow:auto;padding:14px 16px}
.aipi-code.show{display:block}
.aipi-code pre{margin:0 0 12px;background:var(--panel);border:1px solid var(--line);
  border-radius:8px;padding:12px 14px;font-family:var(--ds-font-family-code,Consolas,monospace);font-size:12px;line-height:1.7;
  overflow:auto}
.aipi-rules{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:10px 14px;font-size:12px}
.aipi-rules .t{font-size:11px;color:var(--muted);margin-bottom:6px;letter-spacing:.4px}
.aipi-rule{display:flex;gap:8px;padding:2px 0}
.aipi-rule .k{width:14px;text-align:center}
.aipi-rule.ok .k{color:var(--ok)}.aipi-rule.bad .k{color:var(--danger)}
.aipi-rule .n{flex:1}
.aipi-rule .v{color:var(--muted)}
.aipi-f{margin-bottom:12px}
.aipi-f .lbl{font-size:11px;color:var(--muted);margin-bottom:3px}
.aipi-f .val{font-size:12px}
.aipi-chips{display:flex;flex-wrap:wrap;gap:5px;margin-top:4px}
.aipi-chip{font-size:11px;padding:2px 7px;border-radius:5px;background:var(--acc-soft);color:var(--acc)}
.aipi-div{height:1px;background:var(--line);margin:12px 0}
.aipi-price{display:flex;align-items:baseline;gap:6px}
.aipi-price b{font-size:16px}
.aipi-buy{display:block;text-align:center;margin-top:6px;padding:7px;border-radius:8px;
  background:var(--dsw-alias-button-info-fill,var(--acc));color:var(--dsw-alias-label-primary-foreground,#fff);font-size:12px;text-decoration:none}
/* 状态提示：工作区顶部居中，从上往下弹出 */
.aipi-toast{position:absolute;left:50%;top:10px;transform:translateX(-50%);
  background:var(--panel);border:1px solid var(--line);border-top:3px solid var(--acc);
  border-radius:8px;padding:8px 14px;font-size:12px;box-shadow:0 8px 24px rgba(0,0,0,.16);
  max-width:340px;z-index:9;animation:aipi-drop .18s ease-out}
@keyframes aipi-drop{from{opacity:0;transform:translate(-50%,-8px)}to{opacity:1;transform:translate(-50%,0)}}
.aipi-pop{position:absolute;top:44px;right:12px;z-index:8;background:var(--panel);
  border:1px solid var(--line);border-radius:10px;padding:12px 14px;width:250px;font-size:12px;
  box-shadow:0 10px 30px rgba(0,0,0,.15)}
.aipi-pop p{margin:4px 0;color:var(--muted);line-height:1.7}
.aipi-pop b{display:block;margin-bottom:6px}
`;

        /** 注入样式表（只注入一次，按 id 去重）。 */
        function useStyle() {
            React.useEffect(() => {
                if (document.getElementById('aipi-wb-style')) return;
                const el = document.createElement('style');
                el.id = 'aipi-wb-style';
                el.textContent = CSS;
                document.head.appendChild(el);
            }, []);
        }

        /** 内联图标。 */
        function Ico(props) {
            return h('span', {
                className: props.cls || '',
                style: props.style,
                dangerouslySetInnerHTML: { __html: iconSvg(props.name, props.size || 20) },
            });
        }

        // ── 主面板 ────────────────────────────────────────────────────────
        function Workbench(props) {
            useStyle();

            const [filter, setFilter] = React.useState('全部');
            // 每个插件占主机一路 UART（node.uart = 1..6）；主机自己不需要 uart
            const [nodes, setNodes] = React.useState(() => [
                { uid: 'n2', id: 'aipi-hub', x: 172, y: 44 },
                { uid: 'n1', id: 'axk-radar', x: 16, y: 40, uart: 1 },
                { uid: 'n3', id: 'axk-light', x: 16, y: 180, uart: 2 },
                { uid: 'n4', id: 'axk-wv01-32s', x: 16, y: 316, uart: 3 },
            ]);
            const [sel, setSel] = React.useState('n1');
            // 左侧插件栏里点中的卡片（还没放到画布），右侧同样显示它的属性
            const [cardSel, setCardSel] = React.useState(null);
            const [mode, setMode] = React.useState('preview');
            const [connected, setConnected] = React.useState(false);
            const [scanning, setScanning] = React.useState(false);
            const [pushing, setPushing] = React.useState(false);
            const [pushStep, setPushStep] = React.useState('');
            const [toast, setToast] = React.useState('');
            const [help, setHelp] = React.useState(false);
            // 右栏对话宽度：默认 604，可拖分隔条调整
            const [chatW, setChatW] = React.useState(604);
            const [resize, setResize] = React.useState(null);
            // 左栏插件库宽度：默认 232，同样可拖
            const [leftW, setLeftW] = React.useState(232);
            const [leftResize, setLeftResize] = React.useState(null);
            const [drag, setDrag] = React.useState(null); // 连线拖拽中
            const [move, setMove] = React.useState(null); // 节点拖动中

            const canvasRef = React.useRef(null);
            const rootRef = React.useRef(null);
            const uidRef = React.useRef(100);
            const toastTimer = React.useRef(null);

            // 对话栏默认宽度跟着容器走：1280 这种窄窗口下写死 604 会把画布压没。
            // 预算 = 容器宽 - 左栏 - 属性栏 264 - 给画布的 300
            const fitChat = React.useCallback((avail, left) => {
                const w = avail || 1200;
                const l = left || 232;
                return Math.max(220, Math.min(604, Math.round(w - l - 264 - 420)));
            }, []);

            // 首次挂载按容器宽度定一次对话栏宽度
            React.useEffect(() => {
                const el = rootRef.current;
                if (!el) return;
                setChatW(fitChat(el.clientWidth, 232));
            }, [fitChat]);

            const say = React.useCallback((msg) => {
                setToast(msg);
                if (toastTimer.current) clearTimeout(toastTimer.current);
                toastTimer.current = setTimeout(() => setToast(''), 2600);
            }, []);

            const addNode = React.useCallback((id, x, y) => {
                const p = byId(id);
                if (!p) return;
                setNodes((prev) => {
                    const isHost = p.cat === '主机';
                    if (isHost && prev.some((n) => (byId(n.id) || {}).capType === 'host')) {
                        say('画布上已经有主机了');
                        return prev;
                    }
                    // 插件必须插在主机的一路 UART 上：自动挑最小的空闲通道
                    let uart = null;
                    if (!isHost) {
                        const total = HOST_UARTS;
                        const used = prev.map((n) => n.uart).filter(Boolean);
                        for (let i = 1; i <= total; i++) {
                            if (used.indexOf(i) < 0) { uart = i; break; }
                        }
                        if (!uart) { say('主机 ' + total + ' 路 UART 已占满，先移除一个插件'); return prev; }
                    }
                    const uid = 'n' + ++uidRef.current;
                    const node = { uid, id, x: Math.max(6, x), y: Math.max(6, y), uart };
                    // 插上通道后顺手把插件转到接口对着主机接口（按最近的 90° 档）
                    if (!isHost) {
                        const host = prev.filter((n) => (byId(n.id) || {}).capType === 'host')[0];
                        if (host) node.rot = faceAngle(node, host, uart);
                    }
                    setSel(uid);
                    return prev.concat(node);
                });
            }, [say]);

            /** 从画布移除一个节点；占用的 UART 随节点一起释放。 */
            const removeNode = React.useCallback((uid) => {
                setNodes((prev) => prev.filter((n) => n.uid !== uid));
                setSel((cur) => (cur === uid ? null : cur));
                say('已从画布移除');
            }, [say]);

            // 节点拖动：window 级监听，松手即摘
            React.useEffect(() => {
                if (!move) return;
                const onMove = (e) => {
                    setNodes((prev) => prev.map((n) => (n.uid === move.uid
                        ? { ...n, x: Math.max(0, move.x0 + e.clientX - move.px), y: Math.max(0, move.y0 + e.clientY - move.py) }
                        : n)));
                };
                const onUp = () => setMove(null);
                window.addEventListener('pointermove', onMove);
                window.addEventListener('pointerup', onUp);
                return () => {
                    window.removeEventListener('pointermove', onMove);
                    window.removeEventListener('pointerup', onUp);
                };
            }, [move]);

            // 连线拖拽：从插件的出线口拖到主机某一路 UART 上，松手即占用该通道
            React.useEffect(() => {
                if (!drag) return;
                const onMove = (e) => {
                    const r = canvasRef.current.getBoundingClientRect();
                    setDrag((d) => (d ? { ...d, x: e.clientX - r.left, y: e.clientY - r.top } : d));
                };
                const onUp = (e) => {
                    const t = document.elementFromPoint(e.clientX, e.clientY);
                    const port = t && t.closest ? t.closest('[data-uart]') : null;
                    if (port) {
                        const n = parseInt(port.getAttribute('data-uart'), 10);
                        if (n >= 1) {
                            setNodes((prev) => {
                                const taken = prev.some((x) => x.uid !== drag.from && x.uart === n);
                                if (taken) { say('UART' + n + ' 已被占用'); return prev; }
                                const host = prev.filter((x) => (byId(x.id) || {}).capType === 'host')[0];
                                say('已接入 UART' + n);
                                return prev.map((x) => {
                                    if (x.uid !== drag.from) return x;
                                    const next = { ...x, uart: n };
                                    // 转到接口正对该 UART，线才不会横穿
                                    if (host) next.rot = faceAngle(next, host, n);
                                    return next;
                                });
                            });
                        }
                    }
                    setDrag(null);
                };
                window.addEventListener('pointermove', onMove);
                window.addEventListener('pointerup', onUp);
                return () => {
                    window.removeEventListener('pointermove', onMove);
                    window.removeEventListener('pointerup', onUp);
                };
            }, [drag, say]);

            // 空格：只转容器外框（.aipi-rot），内部元素不跟转；Delete：删掉选中插件
            React.useEffect(() => {
                const onKey = (e) => {
                    const t = e.target;
                    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
                    if (!sel) return;
                    if (e.key === 'Delete' || e.key === 'Backspace') {
                        e.preventDefault();
                        removeNode(sel);
                        return;
                    }
                    if (e.code !== 'Space' && e.key !== ' ') return;
                    e.preventDefault();
                    setNodes((prev) => prev.map((n) => (n.uid === sel
                        ? { ...n, rot: ((n.rot || 0) + 90) % 360 }
                        : n)));
                };
                window.addEventListener('keydown', onKey);
                return () => window.removeEventListener('keydown', onKey);
            }, [sel, removeNode]);

            // 拖分隔条调整对话宽度
            React.useEffect(() => {
                if (!resize) return;
                const onMove = (e) => {
                    const w = resize.w0 - (e.clientX - resize.px);
                    const avail = rootRef.current ? rootRef.current.clientWidth : 1200;
                    const max = Math.max(240, avail - 232 - 264 - 240);
                    setChatW(Math.max(220, Math.min(max, w)));
                };
                const onUp = () => setResize(null);
                window.addEventListener('pointermove', onMove);
                window.addEventListener('pointerup', onUp);
                return () => {
                    window.removeEventListener('pointermove', onMove);
                    window.removeEventListener('pointerup', onUp);
                };
            }, [resize]);

            // 左栏（插件库）拖拽调宽
            React.useEffect(() => {
                if (!leftResize) return;
                const onMove = (e) => {
                    const w = leftResize.w0 + (e.clientX - leftResize.px);
                    const avail = rootRef.current ? rootRef.current.clientWidth : 1200;
                    // 上限：保证中间列 520、对话栏 220 之后还有余量
                    const max = Math.max(200, Math.min(420, avail - 520 - 220 - 18));
                    setLeftW(Math.max(180, Math.min(max, w)));
                };
                const onUp = () => setLeftResize(null);
                window.addEventListener('pointermove', onMove);
                window.addEventListener('pointerup', onUp);
                return () => {
                    window.removeEventListener('pointermove', onMove);
                    window.removeEventListener('pointerup', onUp);
                };
            }, [leftResize]);
            const nodeByUid = (uid) => nodes.filter((x) => x.uid === uid)[0] || null;
            // 主机节点（画布上最多一个）
            const hostNode = nodes.filter((n) => (byId(n.id) || {}).capType === 'host')[0] || null;

            /** 节点自身的宽高（主机是加宽加高的一块底座） */
            const sizeOf = (n) => ((byId(n.id) || {}).capType === 'host'
                ? { w: HOST_W, h: HOST_H } : { w: NW, h: NH });
            /** 把节点内的偏移点按节点旋转角（绕中心）转过去，连线端点和接口位置都靠它 */
            const spin = (n, px, py) => {
                const { w, h } = sizeOf(n);
                const cx = n.x + w / 2;
                const cy = n.y + h / 2;
                const t = ((n.rot || 0) * Math.PI) / 180;
                const dx = px - cx;
                const dy = py - cy;
                return {
                    x: cx + dx * Math.cos(t) - dy * Math.sin(t),
                    y: cy + dx * Math.sin(t) + dy * Math.cos(t),
                };
            };
            /** 插件出线口：节点右边中点（跟随旋转） */
            /** 插件两个 Type-C 口的大致位置与朝向（左右各一，双向）；连线挑离目标近的那个 */
            const plugEnds = (n, target) => {
                const { w, h } = sizeOf(n);
                const left = spin(n, n.x, n.y + h / 2);
                const right = spin(n, n.x + w, n.y + h / 2);
                const dl = (left.x - target.x) ** 2 + (left.y - target.y) ** 2;
                const dr = (right.x - target.x) ** 2 + (right.y - target.y) ** 2;
                const useLeft = dl <= dr;
                return {
                    p: useLeft ? left : right,
                    side: useLeft ? 'left' : 'right',
                    dir: dirOf((n.rot || 0) + (useLeft ? 180 : 0)),
                };
            };
            /** 单位方向向量（0° = 向右，顺时针为正），旋转按 90° 走 */
            const dirOf = (deg) => {
                const t = ((deg || 0) * Math.PI) / 180;
                return { x: Math.cos(t), y: Math.sin(t) };
            };
            /** 主机某个接口朝外的法线方向（接口在哪个边就朝哪边，再叠加主机自身旋转） */
            const socketDir = (host, i) => {
                const base = i <= 2 ? 90 : i <= 4 ? -90 : 0; // 下 / 上 / 右
                return dirOf(base + (host.rot || 0));
            };
            /**
             * 主机的 6 个 Type-C 接口：下边 2 个（1、2）、上边 2 个（3、4）、右边 2 个（5、6）。
             * 返回接口中心的画布坐标（已按主机旋转角转过去）。
             */
            const uartPos = (host, i) => {
                let px;
                let py;
                if (i <= 2) { px = host.x + HOST_W * (i === 1 ? 0.3 : 0.7); py = host.y + HOST_H; }
                else if (i <= 4) { px = host.x + HOST_W * (i === 3 ? 0.3 : 0.7); py = host.y; }
                else { px = host.x + HOST_W; py = host.y + HOST_H * (i === 5 ? 0.35 : 0.65); }
                return spin(host, px, py);
            };
            /**
             * 连线：两端都沿各自接口的法线方向进出，插件转成“接口对着主机接口”时
             * 线就会变成一段顺滑的直角弯，而不是横着穿过去。
             */
            const wirePath = (a, aDir, b, bDir) => {
                const dist = Math.hypot(b.x - a.x, b.y - a.y);
                const d = Math.max(24, Math.min(110, dist * 0.5));
                const c1x = a.x + aDir.x * d;
                const c1y = a.y + aDir.y * d;
                const c2x = b.x + bDir.x * d;
                const c2y = b.y + bDir.y * d;
                return 'M' + a.x + ',' + a.y + ' C' + c1x + ',' + c1y + ' ' + c2x + ',' + c2y + ' ' + b.x + ',' + b.y;
            };
            /** 插件该转多少度，才能让自己的接口正对某个 UART 口（取最近的 90°） */
            const faceAngle = (node, host, uart) => {
                const { w, h } = sizeOf(node);
                const p = uartPos(host, uart);
                const ang = (Math.atan2(p.y - (node.y + h / 2), p.x - (node.x + w / 2)) * 180) / Math.PI;
                return ((Math.round(ang / 90) * 90) % 360 + 360) % 360;
            };

            // 代码视图：主机 + 每路 UART 上挂了哪个插件
            const dsl = React.useMemo(() => {
                const channels = nodes
                    .filter((n) => n.uart)
                    .map((n) => {
                        const p = byId(n.id);
                        if (!p) return null;
                        return {
                            uart: 'UART' + n.uart,
                            plugin: p.cap,
                            type: p.capType,
                            events: p.io.out || [],
                            params: p.io.in || [],
                        };
                    })
                    .filter(Boolean)
                    .sort((a, b) => a.uart.localeCompare(b.uart));
                return { version: '0.2', host: 'AiPi-NodeMCU-Hub', channels };
            }, [nodes]);

            const rules = React.useMemo(() => {
                const plugins = nodes.filter((n) => (byId(n.id) || {}).capType !== 'host');
                const used = plugins.map((n) => n.uart).filter(Boolean);
                const dup = used.length !== new Set(used).size;
                const unassigned = plugins.filter((n) => !n.uart).length;
                const sensors = plugins.filter((n) => (byId(n.id) || {}).capType === 'sensor').length;
                const hasHost = !!hostNode;
                return [
                    ['结构 schema', nodes.length > 0, nodes.length ? '通过' : '画布为空'],
                    ['能力存在性', nodes.every((n) => !!byId(n.id)), '全部命中注册表'],
                    ['主机在位', hasHost, hasHost ? '唯一主机' : '缺主机'],
                    ['通道不冲突', !dup, dup ? 'UART 重复占用' : '已用 ' + used.length + '/' + HOST_UARTS],
                    ['插口已接', unassigned === 0, unassigned ? unassigned + ' 个插件未接 UART' : '全部已接'],
                    ['事件合法', true, '均在 behavior_model 事件集内'],
                    ['实例上限', plugins.length <= HOST_UARTS, '插件 ' + plugins.length + '/' + HOST_UARTS],
                    ['至少一个传感器', sensors > 0, sensors ? sensors + ' 个' : '缺传感器'],
                ];
            }, [nodes, hostNode]);

            const canPush = nodes.some((n) => n.uart) && rules.every((r) => r[1]);

            const selNode = nodes.filter((n) => n.uid === sel)[0] || null;
            const cardPlugin = cardSel ? byId(cardSel) : null;
            const selPlugin = selNode ? byId(selNode.id) : cardPlugin;

            const list = CATALOG.filter((p) => p.cat !== '主机')
                .filter((p) => filter === '全部' || p.cat === filter);
            const host = CATALOG.filter((p) => p.cat === '主机')[0];

            function cardProps(p, isHost) {
                return {
                    className: 'aipi-card' + (isHost ? ' host' : ''),
                    draggable: true,
                    onDragStart: (e) => {
                        e.dataTransfer.setData('text/plain', p.id);
                        e.dataTransfer.effectAllowed = 'copy';
                    },
                    // 点击卡片只在右侧看它的属性；放进画布仍然是拖拽（或面板里的「放到画布」）
                    onClick: () => { setCardSel(p.id); setSel(null); },
                    title: p.name + '（拖到画布上使用）',
                };
            }

            return h('div', { className: 'aipi-wb', ref: rootRef },

                // 左：主机 + 分类 + 插件库
                h('div', { className: 'aipi-col left', style: { width: leftW } },
                    h('div', { className: 'aipi-hd' }, '硬件插件', h('span', { className: 's' }, list.length + ' 个')),
                    h('div', { className: 'aipi-host' },
                        h('div', { className: 'lbl' }, '主机 · 底座'),
                        h('div', cardProps(host, true),
                            h('div', { className: 'thumb' }, h(Ico, { name: host.icon, size: 30 })),
                            h('div', { style: { minWidth: 0, flex: 1 } },
                                h('div', { className: 'nm' }, host.name),
                                h('div', { className: 'sm' }, host.iface),
                            ),
                        ),
                    ),
                    h('div', { className: 'aipi-cats' },
                        CATS.map((c) => h('button', {
                            key: c,
                            className: 'aipi-cat' + (c === filter ? ' on' : ''),
                            onClick: () => setFilter(c),
                        }, c)),
                    ),
                    h('div', { className: 'aipi-grid' },
                        list.map((p) => h('div', Object.assign({ key: p.id }, cardProps(p, false)),
                            h('div', { className: 'tag' }, p.cat),
                            h('div', { className: 'thumb' }, h(Ico, { name: p.icon, size: 42 })),
                            h('div', { className: 'nm' }, p.name),
                        )),
                    ),
                ),

                // 左栏与工作区之间的分隔条：拖动调插件库宽度，双击回到 232
                h('div', {
                    className: 'aipi-resizer left' + (leftResize ? ' on' : ''),
                    title: '拖动调整插件栏宽度（双击恢复默认）',
                    onPointerDown: (e) => {
                        e.preventDefault();
                        setLeftResize({ w0: leftW, px: e.clientX });
                    },
                    onDoubleClick: () => setLeftW(232),
                }),

                // 中：工具条横跨「画布 + 属性」整行 —— 属性栏开合只挤压画布，
                // 不会把工具条挤窄；两者都在工具条下面那一行里
                h('div', {
                    className: 'aipi-mid',
                    // 画布最小宽度兜底：空间不够时先挤对话栏，不会把画布压没
                    style: { minWidth: 520 },
                },
                    h('div', { className: 'aipi-tool' },
                        h('div', { className: 'aipi-seg' },
                            h('button', { className: mode === 'preview' ? 'on' : '', onClick: () => setMode('preview') }, '预览'),
                            h('button', { className: mode === 'code' ? 'on' : '', onClick: () => setMode('code') }, '代码'),
                        ),
                        h('div', { className: 'aipi-sp' }),
                        h('button', {
                            className: 'aipi-btn',
                            onClick: () => {
                                if (connected) { setConnected(false); say('已断开'); return; }
                                setScanning(true);
                                setTimeout(() => {
                                    setScanning(false);
                                    setConnected(true);
                                    say('found: AiPi-NodeMCU-Hub · 枚举到 3 个插件');
                                }, 900);
                            },
                        }, h('span', { className: 'aipi-led' + (connected ? ' on' : '') }),
                            scanning ? '扫描中…' : (connected ? '底板已连接' : '连接设备')),
                        h('button', { className: 'aipi-btn', onClick: () => setHelp(!help) }, '支持'),
                        h('button', {
                            className: 'aipi-btn primary',
                            disabled: !canPush || pushing,
                            onClick: () => {
                                const steps = ['校验通过…', '编译字节码…', '下发 40%…', '下发 80%…', '回读 self-test…'];
                                setPushing(true);
                                let i = 0;
                                const tick = () => {
                                    if (i >= steps.length) {
                                        setPushing(false); setPushStep('');
                                        say('下发成功 · 验证报告：预期 2/2 命中');
                                        return;
                                    }
                                    setPushStep(steps[i++]);
                                    setTimeout(tick, 520);
                                };
                                tick();
                            },
                        }, pushing ? pushStep : '下发到设备'),
                        help && h('div', { className: 'aipi-pop' },
                            h('b', null, '支持'),
                            h('p', null, '· 插件没识别到？检查底板是否插入、串口是否被占用。'),
                            h('p', null, '· 下发失败会回读 self-test，给出「逻辑错 / 物理错」归因。'),
                        ),
                    ),

                    h('div', { className: 'aipi-body' },
                    h('div', { className: 'aipi-col center' },
                    h('div', {
                        className: 'aipi-stage',
                        style: mode === 'code' ? { display: 'none' } : null,
                    },
                        h('div', {
                            className: 'aipi-canvas',
                            ref: canvasRef,
                            onDragOver: (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; },
                            onDrop: (e) => {
                                e.preventDefault();
                                const id = e.dataTransfer.getData('text/plain');
                                if (!id) return;
                                const r = canvasRef.current.getBoundingClientRect();
                                addNode(id, e.clientX - r.left - NW / 2, e.clientY - r.top - NH / 2);
                            },
                            onClick: () => { setSel(null); setCardSel(null); },
                        },
                            nodes.length === 0 && h('div', { className: 'aipi-empty' },
                                h('b', null, '把左边的硬件插件拖进来'),
                                '插件会自动插到主机空闲的 UART 上；也可从插件右侧圆点拖到指定 UART',
                            ),
                            h('svg', { className: 'aipi-wires' },
                                // 占着 UART 的插件，各画一条「插件最近的 Type-C 口 → 主机该路接口」的线
                                hostNode && nodes.filter((n) => n.uart).map((n) => {
                                    const target = uartPos(hostNode, n.uart);
                                    const end = plugEnds(n, target);
                                    return h('path', {
                                        key: 'w' + n.uid,
                                        className: 'aipi-wire',
                                        d: wirePath(end.p, end.dir, target, socketDir(hostNode, n.uart)),
                                    });
                                }),
                                drag && nodeByUid(drag.from) && (() => {
                                    const src = nodeByUid(drag.from);
                                    const dim = sizeOf(src);
                                    const p0 = drag.side === 'left'
                                        ? spin(src, src.x, src.y + dim.h / 2)
                                        : spin(src, src.x + dim.w, src.y + dim.h / 2);
                                    const d0 = dirOf((src.rot || 0) + (drag.side === 'left' ? 180 : 0));
                                    return h('path', {
                                        className: 'aipi-wire tmp',
                                        d: wirePath(p0, d0, { x: drag.x, y: drag.y }, { x: -1, y: 0 }),
                                    });
                                })(),
                            ),
                            nodes.map((n) => {
                                const p = byId(n.id) || {};
                                const isHost = p.capType === 'host';
                                return h('div', {
                                    key: n.uid,
                                    className: 'aipi-node' + (sel === n.uid ? ' sel' : '') + (isHost ? ' host' : ''),
                                    style: Object.assign({
                                        left: n.x, top: n.y,
                                        ...(isHost ? { height: HOST_H } : {}),
                                        '--rot': (n.rot || 0) + 'deg',
                                    }),
                                    title: p.name,
                                    // 选中不能只靠 pointerdown：pointerup 之后浏览器还会补一个
                                    // click，它会冒泡到画布把 sel 清掉 —— 属性栏「一闪而过」就是这个。
                                    onClick: (e) => { e.stopPropagation(); setSel(n.uid); setCardSel(null); },
                                    onPointerDown: (e) => {
                                        if (e.target.classList.contains('aipi-port')) return;
                                        if (e.target.classList.contains('aipi-plug')) return;
                                        if (e.target.closest && e.target.closest('.aipi-del')) return;
                                        e.stopPropagation();
                                        setSel(n.uid);
                                        setMove({ uid: n.uid, x0: n.x, y0: n.y, px: e.clientX, py: e.clientY });
                                    },
                                },
                                    // 外框单独一层：只转「框 + 接口」，里面的图标 / 文字始终正向
                                    h('div', { className: 'aipi-rot', key: 'rot' },
                                        h('div', { className: 'aipi-frame', key: 'frame' }),
                                        isHost
                                            ? Array.from({ length: HOST_UARTS }).map((_, k) => {
                                                const ch = k + 1;
                                                const used = nodes.filter((x) => x.uart === ch)[0];
                                                const edge = ch <= 2 ? 'bottom' : ch <= 4 ? 'top' : 'right';
                                                const style = edge === 'right'
                                                    ? { top: ch === 5 ? '35%' : '65%' }
                                                    : { left: (ch % 2 === 1 ? '30%' : '70%') };
                                                return h('div', {
                                                    key: 'sock' + ch,
                                                    className: 'aipi-socket ' + edge + (used ? ' on' : ''),
                                                    style,
                                                    'data-uart': ch,
                                                    title: 'Type-C ' + ch + (used ? ' · ' + (byId(used.id) || {}).name : ' · 空闲'),
                                                }, h('span', { className: 'lbl' }, 'Type-C ' + ch));
                                            })
                                            // 插件自带一左一右两个 Type-C 口（双向），任一个都能插到主机
                                            : ['left', 'right'].map((side) => h('div', {
                                                key: 'plug' + side,
                                                className: 'aipi-plug ' + side
                                                    + ((n.uart && hostNode
                                                        && plugEnds(n, uartPos(hostNode, n.uart)).side === side) ? ' on' : ''),
                                                'data-uid': n.uid,
                                                title: 'Type-C（双向）· 拖到主机某个接口',
                                                onPointerDown: (e) => {
                                                    e.stopPropagation();
                                                    e.preventDefault();
                                                    const r = canvasRef.current.getBoundingClientRect();
                                                    setDrag({
                                                        from: n.uid,
                                                        side,
                                                        x: e.clientX - r.left,
                                                        y: e.clientY - r.top,
                                                    });
                                                },
                                            })),
                                    ),
                                    h('button', {
                                        className: 'aipi-del',
                                        key: 'del',
                                        title: '从画布移除',
                                        onPointerDown: (e) => e.stopPropagation(),
                                        onClick: (e) => { e.stopPropagation(); removeNode(n.uid); },
                                    }, '×'),

                                    isHost ? h('div', { className: 'aipi-host-body', key: 'body' },
                                        h('span', { className: 'ico' }, h(Ico, { name: p.icon, size: 24 })),
                                        h('div', { className: 'nm' }, p.name),
                                        h('div', { className: 'sub' },
                                            '已接 ' + nodes.filter((x) => x.uart).length + ' / ' + HOST_UARTS))
                                        : [
                                            h('div', { className: 'aipi-node-ico', key: 'ico' },
                                                h(Ico, { name: p.icon, size: 30 })),
                                            h('div', { className: 'aipi-node-nm', key: 'nm' }, p.name),
                                            h('div', { className: 'aipi-node-ch' + (n.uart ? '' : ' off'), key: 'ch' },
                                                n.uart ? 'UART' + n.uart : '未接入'),
                                        ],
                                );
                            }),
                        ),
                    ),

                    h('div', { className: 'aipi-code' + (mode === 'code' ? ' show' : '') },
                        h('pre', null, JSON.stringify(dsl, null, 2)),
                        h('div', { className: 'aipi-rules' },
                            h('div', { className: 't' }, '静态校验'),
                            rules.map((r, i) => h('div', { key: i, className: 'aipi-rule ' + (r[1] ? 'ok' : 'bad') },
                                h('span', { className: 'k' }, r[1] ? '✓' : '✗'),
                                h('span', { className: 'n' }, r[0]),
                                h('span', { className: 'v' }, r[2]),
                            )),
                        ),
                    ),

                    // 状态提示：跟画布同一个坐标系，顶部居中往下弹
                    toast && h('div', { className: 'aipi-toast' }, toast),
                ),

                // 属性：停靠在「工作区」里（工具条下面那一行），只挤压画布，
                // 不改变工具条宽度；没有选中节点时整列不渲染
                selPlugin && h('div', { className: 'aipi-col right' },
                        h('div', { className: 'aipi-hd' }, '属性'),
                        h('div', { className: 'aipi-right-body' },
                        selPlugin && h('div', null,
                            h('div', { className: 'aipi-f', style: { display: 'flex', gap: 10, alignItems: 'center' } },
                                h('span', {
                                    style: {
                                        width: 38, height: 38, flex: 'none', borderRadius: 9,
                                        display: 'grid', placeItems: 'center',
                                        background: 'var(--acc-soft)', color: 'var(--acc)',
                                    },
                                }, h(Ico, { name: selPlugin.icon, size: 24 })),
                                h('div', { style: { minWidth: 0 } },
                                    h('div', { className: 'val' }, h('b', null, selPlugin.name)),
                                    h('div', { style: { color: 'var(--muted)', fontSize: 11 } }, selPlugin.id),
                                ),
                            ),
                            h('div', { className: 'aipi-f' },
                                h('div', { className: 'lbl' }, '分类'),
                                h('div', { className: 'val' }, selPlugin.cat),
                            ),
                            h('div', { className: 'aipi-f' },
                                h('div', { className: 'lbl' }, '说明'),
                                h('div', { className: 'val', style: { color: 'var(--muted)' } }, selPlugin.desc),
                            ),
                            selPlugin.iface && h('div', { className: 'aipi-f' },
                                h('div', { className: 'lbl' }, '接口'),
                                h('div', { className: 'val' }, selPlugin.iface),
                            ),
                            h('div', { className: 'aipi-div' }),
                            h('div', { className: 'aipi-f' },
                                h('div', { className: 'lbl' }, '作者'),
                                h('div', { className: 'val' }, selPlugin.author),
                            ),
                            selPlugin.capType !== 'host' && h('div', null,
                                h('div', { className: 'aipi-f' },
                                    h('div', { className: 'lbl' }, '能力'),
                                    h('div', { className: 'aipi-chips' },
                                        h('span', { className: 'aipi-chip' }, selPlugin.cap),
                                        h('span', { className: 'aipi-chip' }, selPlugin.capType),
                                    ),
                                ),
                                h('div', { className: 'aipi-f' },
                                    h('div', { className: 'lbl' }, (selPlugin.io.out || []).length ? '可上报事件' : '可下发参数'),
                                    h('div', { className: 'aipi-chips' },
                                        ((selPlugin.io.out || []).length ? selPlugin.io.out : selPlugin.io.in)
                                            .map((x) => h('span', { key: x, className: 'aipi-chip' }, x)),
                                    ),
                                ),
                            ),
                            h('div', { className: 'aipi-div' }),
                            h('div', { className: 'aipi-f' },
                                h('div', { className: 'lbl' }, '购买方式'),
                                h('div', { className: 'aipi-price' },
                                    h('b', null, selPlugin.price),
                                    h('span', { style: { color: 'var(--muted)', fontSize: 11 } }, selPlugin.sku),
                                ),
                                h('a', { className: 'aipi-buy', href: '#', onClick: (e) => e.preventDefault() }, '去官方店铺购买'),
                            ),
                            h('div', { className: 'aipi-f', style: { marginTop: 14 } },
                                selNode
                                    ? h('button', {
                                        className: 'aipi-btn', style: { width: '100%', justifyContent: 'center' },
                                        onClick: () => removeNode(selNode.uid),
                                    }, '从画布移除')
                                    : h('button', {
                                        className: 'aipi-btn primary',
                                        style: { width: '100%', justifyContent: 'center' },
                                        onClick: () => {
                                            addNode(cardSel, 60, 60);
                                            setCardSel(null);
                                        },
                                    }, '放到画布'),
                            ),
                        ),
                    ),
                ),
                ),
                ),

                // 右：原生对话（渲染 DSH 的 conversation.content 工厂槽）
                // 宽度由 chatW 决定，左侧分隔条可拖
                h('div', {
                    className: 'aipi-resizer' + (resize ? ' on' : ''),
                    title: '拖动调整对话宽度（双击恢复默认）',
                    onPointerDown: (e) => {
                        e.preventDefault();
                        setResize({ w0: chatW, px: e.clientX });
                    },
                    onDoubleClick: () => setChatW(fitChat(rootRef.current ? rootRef.current.clientWidth : 1200)),
                }),
                h('div', { className: 'aipi-col chat', style: { width: chatW } },
                    h(ChatPane, props),
                ),
            );
        }

        /** 左侧导轨上的入口图标。 */
        function RailIcon() {
            return h('span', {
                style: { display: 'grid', placeItems: 'center', width: 20, height: 20 },
                dangerouslySetInnerHTML: { __html: iconSvg('hub', 18) },
            });
        }

        // ── 面板内的原生对话 ──────────────────────────────────────────────
        //
        // 目标：在工作台右侧直接显示 DSH 的原生会话，不动主区、不依赖右侧栏。
        //
        // 做法是渲染 DSH 的工厂槽 `conversation.content` —— client-ui-subagent
        // 就是用 `renderFactorySlot('conversation.content', …)` 把会话挂进侧栏标签页的。
        //
        // 前提是宿主把这个 render 函数传给 main 座位的组件。给没给、给了什么，
        // 这里如实显示出来：拿不到就把可用 props 列在面板上，一眼能看出缺什么。
        function ChatPane(props) {
            const note = (text) => h('div', { className: 'aipi-chat-note' }, String(text));

            if (!props || typeof props.renderFactorySlot !== 'function') {
                return h('div', { className: 'aipi-chat-wrap' },
                    note('宿主没有把 renderFactorySlot 传给 main 座位，内嵌会话不可用。'),
                    note('当前可用的 props：' + Object.keys(props || {}).join(' / ')),
                );
            }

            try {
                const node = props.renderFactorySlot('conversation.content', {
                    variant: 'embedded',
                    phase: 'active',
                    hero: false,
                });
                if (node === undefined || node === null) return note('conversation.content 返回了空。');
                return h('div', { className: 'aipi-chat-wrap' }, node);
            } catch (error) {
                console.error('aipi-workbench: conversation.content 渲染失败', error);
                return h('div', { className: 'aipi-chat-wrap' },
                    note('渲染失败：' + String((error && error.message) || error)),
                );
            }
        }

        // ── apply ─────────────────────────────────────────────────────────
        function apply(ctx) {
            try {
                if (!ctx || !ctx.slots) {
                    console.error('aipi-workbench: 这个 DSH 没有 slots 服务，面板不会挂载');
                    return;
                }
                ctx.slots.inject('main', () =>
                    ctx.slots.inject('sidebar.panellist', () => {
                        const stopMain = ctx.slots.register(
                            { name: 'main', key: PANEL_ID },
                            Workbench,
                        );
                        const stopIcon = ctx.slots.register(
                            { name: 'sidebar.panellist', id: PANEL_ID, order: 40, label: () => '小安派工作台' },
                            RailIcon,
                        );
                        return () => {
                            if (typeof stopIcon === 'function') stopIcon();
                            if (typeof stopMain === 'function') stopMain();
                        };
                    }),
                );
            } catch (error) {
                console.error('aipi-workbench: 注册面板失败', error);
            }
        }
        const inject = ['slots'];
        exports.apply = apply;
        exports.inject = inject;
        return module.exports;
    },
});
