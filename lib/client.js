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
        const NW = 128;   // 节点宽
        const NH = 96;    // 节点高（图标主体 48 + 名字一行）
        const PORT_Y = NH / 2; // 端口垂直中心

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
                iface: '4 × UART · USB 2.0 HS · WiFi6',
                desc: '逻辑执行中枢。插件都插在它上面，逻辑与算法在本地芯片跑。',
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
.aipi-col.left{width:232px;flex:0 0 232px;border-right:1px solid var(--line)}
.aipi-col.right{width:264px;flex:0 0 264px;border-left:1px solid var(--line);
  display:flex;flex-direction:column;min-height:0;overflow:hidden}
.aipi-right-body{flex:1;min-height:0;overflow:auto;padding:0 12px 14px}
/* 折叠按钮 / 折叠后的窄条 */
.aipi-collapse{width:20px;height:20px;border-radius:5px;font-size:12px;
  color:var(--muted);display:grid;place-items:center;margin-right:2px}
.aipi-collapse:hover{background:var(--acc-soft);color:var(--acc)}
/* 折叠后的窄条：图标贴顶，与展开状态下标题行里的折叠按钮同一高度（中心 y 对齐） */
.aipi-proprail{width:28px;flex:none;border-left:1px solid var(--line);cursor:pointer;
  color:var(--muted);display:flex;align-items:flex-start;justify-content:center;
  padding-top:13px;transition:background .12s,color .12s}
.aipi-proprail:hover{background:var(--acc-soft);color:var(--acc)}
.aipi-proprail span{display:grid;place-items:center}
.aipi-col.center{flex:1 1 0;background:var(--canvas);min-width:0;position:relative}
/* 中间列 = 通栏工具条 + 下面一行[画布 | 属性]：属性开合只改画布宽度。
   min-width 兜住画布：空间不够时挤的是对话栏，不是把画布压成 0。 */
.aipi-mid{flex:1 1 0;min-width:0;min-height:0;display:flex;flex-direction:column;background:var(--canvas)}
.aipi-body{flex:1;min-width:0;min-height:0;display:flex}
/* 对话栏：宽度由内联 style 给，但允许被压缩，最少 220 */
.aipi-col.chat{flex:0 1 auto;min-width:220px;border-left:1px solid var(--line);min-height:0}
/* 对话栏左侧的分隔条：加宽命中区、常显一道细线，hover 时亮起来并出现抓手 */
.aipi-resizer{width:9px;flex:none;cursor:col-resize;background:transparent;position:relative;z-index:1}
.aipi-resizer::before{content:'';position:absolute;left:4px;top:0;bottom:0;width:1px;
  background:var(--line);transition:background .12s}
.aipi-resizer:hover,.aipi-resizer.on{background:var(--acc-soft)}
.aipi-resizer:hover::before,.aipi-resizer.on::before{background:var(--acc)}
.aipi-resizer .grip{position:absolute;left:50%;top:50%;width:3px;height:30px;border-radius:2px;
  transform:translate(-50%,-50%);background:var(--acc);opacity:0;transition:opacity .12s}
.aipi-resizer:hover .grip,.aipi-resizer.on .grip{opacity:1}
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
.aipi-grid{overflow:auto;padding:2px 10px 14px;display:grid;grid-template-columns:1fr 1fr;gap:8px}
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
/* 节点：图标是主体，名字只是下面一行小字（放不下就省略，完整名在 title 里） */
.aipi-node{position:absolute;width:128px;height:96px;background:var(--node);
  border:1px solid var(--nline);border-radius:12px;user-select:none;cursor:move;
  display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;
  box-shadow:0 1px 3px rgba(0,0,0,.18);transition:border-color .12s,box-shadow .12s}
.aipi-node:hover{border-color:var(--dsw-alias-border-l4,#b9c6d8)}
.aipi-node.sel{border-color:var(--acc);box-shadow:0 0 0 3px var(--acc-soft)}
.aipi-node.host{background:linear-gradient(180deg,var(--acc-soft),var(--node))}
.aipi-node-ico{width:52px;height:52px;border-radius:14px;display:grid;place-items:center;
  background:var(--acc-soft);color:var(--acc);flex:none}
.aipi-node-ico svg{width:32px;height:32px;display:block;stroke-width:2.4}
.aipi-node-nm{max-width:110px;font-size:11px;line-height:1.2;color:var(--muted);
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
            const [nodes, setNodes] = React.useState(() => [
                { uid: 'n1', id: 'axk-radar', x: 48, y: 84 },
                { uid: 'n2', id: 'aipi-hub', x: 352, y: 228 },
                { uid: 'n3', id: 'axk-light', x: 620, y: 70 },
                { uid: 'n4', id: 'axk-wv01-32s', x: 620, y: 196 },
            ]);
            const [wires, setWires] = React.useState([
                { from: 'n1', to: 'n3' },
                { from: 'n1', to: 'n4' },
            ]);
            const [sel, setSel] = React.useState('n1');
            const [mode, setMode] = React.useState('preview');
            const [connected, setConnected] = React.useState(false);
            const [scanning, setScanning] = React.useState(false);
            const [pushing, setPushing] = React.useState(false);
            const [pushStep, setPushStep] = React.useState('');
            const [toast, setToast] = React.useState('');
            const [help, setHelp] = React.useState(false);
            // 属性栏是否展开（折叠后只留一条竖排窄条；开合只挤压画布，不动工具条）
            const [propOpen, setPropOpen] = React.useState(true);
            // 右栏对话宽度：固定 604（= 属性 264 + 原对话 340），可拖分隔条调整
            const [chatW, setChatW] = React.useState(604);
            const [resize, setResize] = React.useState(null);
            const [drag, setDrag] = React.useState(null); // 连线拖拽中
            const [move, setMove] = React.useState(null); // 节点拖动中

            const canvasRef = React.useRef(null);
            const rootRef = React.useRef(null);
            const uidRef = React.useRef(100);
            const toastTimer = React.useRef(null);

            // 对话栏默认宽度跟着容器走：1280 这种窄窗口下写死 604 会把画布压没。
            // 预算 = 容器宽 - 左栏 232 -（属性打开时 264，折叠时窄条 26）- 给画布的 300
            const fitChat = React.useCallback((avail, propShown) => {
                const w = avail || 1200;
                const right = propShown === false ? 26 : 264;
                return Math.max(220, Math.min(604, Math.round(w - 232 - right - 300)));
            }, []);

            // 首次挂载：窄窗口（<1150）默认把属性栏折叠，先把画布和对话留出来
            React.useEffect(() => {
                const el = rootRef.current;
                if (!el) return;
                const avail = el.clientWidth;
                const showProp = avail >= 1150;
                setPropOpen(showProp);
                setChatW(fitChat(avail, showProp));
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
                    if (p.cat === '主机' && prev.some((n) => (byId(n.id) || {}).capType === 'host')) {
                        say('画布上已经有主机了');
                        return prev;
                    }
                    const uid = 'n' + ++uidRef.current;
                    const node = { uid, id, x: Math.max(6, x), y: Math.max(6, y) };
                    setSel(uid);
                    return prev.concat(node);
                });
            }, [say]);

            /** 从画布移除一个节点，连带摘掉它两端的连线，选中态一起清掉。 */
            const removeNode = React.useCallback((uid) => {
                setNodes((prev) => prev.filter((n) => n.uid !== uid));
                setWires((prev) => prev.filter((w) => w.from !== uid && w.to !== uid));
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

            // 连线拖拽
            React.useEffect(() => {
                if (!drag) return;
                const onMove = (e) => {
                    const r = canvasRef.current.getBoundingClientRect();
                    setDrag((d) => (d ? { ...d, x: e.clientX - r.left, y: e.clientY - r.top } : d));
                };
                const onUp = (e) => {
                    const t = document.elementFromPoint(e.clientX, e.clientY);
                    // 旧的 '.aipi-port-in' 永远匹配不到（类名其实是 "aipi-port in"），
                    // 连线一直连不上；改用 data-port 定位。
                    const port = t && t.closest ? t.closest('[data-port="in"]') : null;
                    if (port) {
                        const to = port.getAttribute('data-uid');
                        if (to && to !== drag.from) {
                            setWires((prev) => (prev.some((w) => w.from === drag.from && w.to === to)
                                ? prev : prev.concat({ from: drag.from, to })));
                            say('已连接');
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

            // 拖分隔条调整对话宽度
            React.useEffect(() => {
                if (!resize) return;
                const onMove = (e) => {
                    const w = resize.w0 - (e.clientX - resize.px);
                    const avail = rootRef.current ? rootRef.current.clientWidth : 1200;
                    const right = propOpen ? 264 : 26;
                    const max = Math.max(240, avail - 232 - right - 240);
                    setChatW(Math.max(220, Math.min(max, w)));
                };
                const onUp = () => setResize(null);
                window.addEventListener('pointermove', onMove);
                window.addEventListener('pointerup', onUp);
                return () => {
                    window.removeEventListener('pointermove', onMove);
                    window.removeEventListener('pointerup', onUp);
                };
            }, [resize, propOpen]);

            const portPos = (uid) => {
                const n = nodes.filter((x) => x.uid === uid)[0];
                return n ? { x: n.x + NW, y: n.y + PORT_Y } : { x: 0, y: 0 };
            };
            const inPos = (uid) => {
                const n = nodes.filter((x) => x.uid === uid)[0];
                return n ? { x: n.x, y: n.y + PORT_Y } : { x: 0, y: 0 };
            };
            const bez = (a, b) => {
                const dx = Math.max(30, Math.abs(b.x - a.x) * 0.45);
                return 'M' + a.x + ',' + a.y + ' C' + (a.x + dx) + ',' + a.y + ' ' +
                    (b.x - dx) + ',' + b.y + ' ' + b.x + ',' + b.y;
            };

            // 代码视图 + 校验
            const dsl = React.useMemo(() => {
                const logic = wires.map((w) => {
                    const s = byId((nodes.filter((n) => n.uid === w.from)[0] || {}).id);
                    const t = byId((nodes.filter((n) => n.uid === w.to)[0] || {}).id);
                    if (!s || !t) return null;
                    return {
                        when: { plugin: s.cap, event: (s.io.out || [])[0] || null },
                        then: [Object.assign({}, { [t.cap]: '…' })],
                    };
                }).filter(Boolean);
                return { version: '0.1', logic };
            }, [nodes, wires]);

            const rules = React.useMemo(() => {
                const sensors = nodes.filter((n) => (byId(n.id) || {}).capType === 'sensor').length;
                const actors = nodes.filter((n) => ['actuator', 'interaction']
                    .indexOf((byId(n.id) || {}).capType) >= 0);
                const orphan = actors.filter((n) => !wires.some((w) => w.to === n.uid)).length;
                const self = wires.some((w) => w.from === w.to);
                return [
                    ['结构 schema', nodes.length > 0, nodes.length ? '通过' : '画布为空'],
                    ['能力存在性', nodes.every((n) => !!byId(n.id)), '全部命中注册表'],
                    ['类型匹配', !wires.some((w) => (byId((nodes.filter((n) => n.uid === w.from)[0] || {}).id) || {}).capType !== 'sensor'), 'when 只挂 sensor'],
                    ['事件合法', true, '均在 behavior_model 事件集内'],
                    ['实例 / 通道', nodes.length <= 12, '插件 ' + nodes.length + '/12'],
                    ['无环', !self, self ? '存在自环' : '无自环'],
                    ['有执行出口', orphan === 0, orphan ? orphan + ' 个执行器未连接' : '全部已连接'],
                    ['至少一个传感器', sensors > 0, sensors ? sensors + ' 个' : '缺传感器'],
                ];
            }, [nodes, wires]);

            const canPush = wires.length > 0 && rules.every((r) => r[1]);

            const selNode = nodes.filter((n) => n.uid === sel)[0] || null;
            const selPlugin = selNode ? byId(selNode.id) : null;

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
                    // 只支持拖入画布：点一下只当作「看一眼」，不再往画布上丢节点
                    title: p.name + '（拖到画布上使用）',
                };
            }

            return h('div', { className: 'aipi-wb', ref: rootRef },

                // 左：主机 + 分类 + 插件库
                h('div', { className: 'aipi-col left' },
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

                // 中：工具条横跨「画布 + 属性」整行 —— 属性栏开合只挤压画布，
                // 不会把工具条挤窄；两者都在工具条下面那一行里
                h('div', {
                    className: 'aipi-mid',
                    // 画布最小宽度兜底：属性展开时 mid 至少要放得下 264+画布，
                    // 折叠时只要 26+画布；这样空间不够时先挤对话栏，不会压没画布
                    style: { minWidth: propOpen ? 560 : 340 },
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
                            onClick: () => setSel(null),
                        },
                            nodes.length === 0 && h('div', { className: 'aipi-empty' },
                                h('b', null, '把左边的硬件插件拖进来'),
                                '拖入后，从右侧圆点拉线到另一个插件即可连接',
                            ),
                            h('svg', { className: 'aipi-wires' },
                                wires.map((w, i) => h('path', {
                                    key: 'w' + i,
                                    className: 'aipi-wire',
                                    d: bez(portPos(w.from), inPos(w.to)),
                                    onClick: (e) => {
                                        e.stopPropagation();
                                        setWires((prev) => prev.filter((_, k) => k !== i));
                                    },
                                })),
                                drag && h('path', {
                                    className: 'aipi-wire tmp',
                                    d: bez(portPos(drag.from), { x: drag.x, y: drag.y }),
                                }),
                            ),
                            nodes.map((n) => {
                                const p = byId(n.id) || {};
                                return h('div', {
                                    key: n.uid,
                                    className: 'aipi-node' + (sel === n.uid ? ' sel' : '')
                                        + (p.capType === 'host' ? ' host' : ''),
                                    style: { left: n.x, top: n.y },
                                    title: p.name,
                                    // 选中不能只靠 pointerdown：pointerup 之后浏览器还会补一个
                                    // click，它会冒泡到画布把 sel 清掉 —— 属性栏「一闪而过」就是这个。
                                    onClick: (e) => { e.stopPropagation(); setSel(n.uid); },
                                    onPointerDown: (e) => {
                                        if (e.target.classList.contains('aipi-port')) return;
                                        if (e.target.closest && e.target.closest('.aipi-del')) return;
                                        e.stopPropagation();
                                        setSel(n.uid);
                                        setMove({ uid: n.uid, x0: n.x, y0: n.y, px: e.clientX, py: e.clientY });
                                    },
                                },
                                    h('button', {
                                        className: 'aipi-del',
                                        title: '从画布移除',
                                        onPointerDown: (e) => e.stopPropagation(),
                                        onClick: (e) => { e.stopPropagation(); removeNode(n.uid); },
                                    }, '×'),
                                    h('div', { className: 'aipi-node-ico' },
                                        h(Ico, { name: p.icon, size: 30 })),
                                    h('div', { className: 'aipi-node-nm' }, p.name),
                                    (p.io && p.io.in && p.io.in.length > 0) && h('div', {
                                        className: 'aipi-port in',
                                        'data-uid': n.uid,
                                        'data-port': 'in',
                                    }),
                                    p.capType !== 'host' && h('div', {
                                        className: 'aipi-port out',
                                        'data-uid': n.uid,
                                        'data-port': 'out',
                                        onPointerDown: (e) => {
                                            e.stopPropagation();
                                            e.preventDefault();
                                            const r = canvasRef.current.getBoundingClientRect();
                                            setDrag({
                                                from: n.uid,
                                                x: e.clientX - r.left,
                                                y: e.clientY - r.top,
                                            });
                                        },
                                    }),
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

                // 属性：停靠在「工作区」里（工具条下面那一行），开合只挤压画布，
                // 不改变工具条宽度；标题右侧可折叠，折叠后留一条竖排「属性」窄条
                selPlugin && (propOpen
                    ? h('div', { className: 'aipi-col right' },
                        h('div', { className: 'aipi-hd' },
                            h('button', {
                                className: 'aipi-collapse',
                                title: '折叠属性栏',
                                onClick: () => setPropOpen(false),
                            }, '⟩'),
                            '属性'),
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
                                h('button', {
                                    className: 'aipi-btn', style: { width: '100%', justifyContent: 'center' },
                                    onClick: () => {
                                        const uid = selNode.uid;
                                        setNodes((prev) => prev.filter((n) => n.uid !== uid));
                                        setWires((prev) => prev.filter((w) => w.from !== uid && w.to !== uid));
                                        setSel(null);
                                        say('已移除');
                                    },
                                }, '从画布移除'),
                            ),
                        ),
                    )
                    )
                    : h('button', {
                        className: 'aipi-proprail',
                        title: '展开属性栏',
                        onClick: () => setPropOpen(true),
                    }, h('span', {
                        // 展开箭头：指向左（面板向左展开）
                        dangerouslySetInnerHTML: {
                            __html: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" '
                                + 'stroke="currentColor" stroke-width="2.2" stroke-linecap="round" '
                                + 'stroke-linejoin="round"><path d="M14.5 5.5 8 12l6.5 6.5"/></svg>',
                        },
                    }))),
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
                    onDoubleClick: () => setChatW(fitChat(rootRef.current ? rootRef.current.clientWidth : 1200, propOpen)),
                }, h('span', { className: 'grip' })),
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
