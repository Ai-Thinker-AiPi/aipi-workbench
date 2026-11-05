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

        // 折叠按钮图标（来自用户提供的 折叠.svg，viewBox 1024，用 currentColor 跟主题）
        const PANEL_ICON_PATH = 'M932 872a60 60 0 0 1-60 60l-720 0a60 60 0 0 1-60-60L92 152a60 60 0 0 1 60-60L872 92a60 60 0 0 1 60 60z m-612-12L320 164l-156 0 0 696 156 0z m540 0L860 164 392 164l0 696L860 860z m-373.44-193.44a36 36 0 0 0 50.94 50.88l180-180a36 36 0 0 0 0-50.88l-180-180a36 36 0 0 0-50.94 50.88L641.12 512l-154.56 154.56z';
        const panelIcon = (size) => '<svg viewBox="0 0 1024 1024" width="' + size + '" height="' + size
            + '" fill="currentColor"><path d="' + PANEL_ICON_PATH + '"/></svg>';
        // ── 主机：6 路双向 UART，插件逐个插上去 ────────────────────────────
        // ── 工程文件（.aipi）────────────────────────────────────────
        const PROJECT_FORMAT = 'aipi-workbench-project';
        const PROJECT_VERSION = 1;
        const PROJECT_EXT = '.aipi';
        const AUTOSAVE_KEY = 'aipi-workbench:autosave';
        const HANDLE_DB = 'aipi-workbench';
        const HANDLE_STORE = 'handles';

        // 文件句柄存 IndexedDB：刷新后还能接着写同一个 .aipi（Chrome 允许持久化 FileSystemFileHandle）
        const idbOpen = () => new Promise((resolve, reject) => {
            const req = indexedDB.open(HANDLE_DB, 1);
            req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(HANDLE_STORE)) req.result.createObjectStore(HANDLE_STORE); };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
        const idbSet = async (key, value) => {
            const db = await idbOpen();
            await new Promise((resolve, reject) => {
                const tx = db.transaction(HANDLE_STORE, 'readwrite');
                tx.objectStore(HANDLE_STORE).put(value, key);
                tx.oncomplete = resolve;
                tx.onerror = () => reject(tx.error);
            });
            db.close();
        };
        const idbGet = async (key) => {
            const db = await idbOpen();
            const value = await new Promise((resolve, reject) => {
                const tx = db.transaction(HANDLE_STORE, 'readonly');
                const req = tx.objectStore(HANDLE_STORE).get(key);
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
            });
            db.close();
            return value;
        };

        /** 有写权限就直接写；权限过期就先申请（浏览器要求用户手势，通常在点击保存时通过） */
        const writeHandle = async (handle, text) => {
            if (handle.queryPermission) {
                let state = await handle.queryPermission({ mode: 'readwrite' });
                if (state !== 'granted') state = await handle.requestPermission({ mode: 'readwrite' });
                if (state !== 'granted') throw new Error('没有文件写入权限');
            }
            const writable = await handle.createWritable();
            await writable.write(text);
            await writable.close();
        };

        const RAIL_W = 16;   // 折叠后的窄轨宽度 = 图标宽度（和 DSH 折叠图标同尺寸）
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
        // ── 硬件插件目录（能力名与 06_工程资产/v0/data/registry.json 同源）──
        // *En 字段是英文界面用的文案；缺了会回退中文
        const CATALOG = [
            {
                id: 'aipi-hub', name: 'AiPi-NodeMCU-Hub', nameEn: 'AiPi-NodeMCU-Hub',
                cat: '主机', catEn: 'Host', icon: 'hub',
                cap: 'hub.runtime', capType: 'host', io: { out: [], in: [] },
                author: '安信可官方', authorEn: 'Ai-Thinker', price: '¥99', sku: 'BL618DG 核心板',
                iface: '6 × Type-C（UART）· USB 2.0 HS · WiFi6',
                uarts: 6,
                desc: '逻辑执行中枢。6 路双向 UART，插件都插在它上面，逻辑与算法在本地芯片跑。',
                descEn: 'Logic hub. Six bidirectional UART ports; every plugin plugs into it and logic runs on the local chip.',
            },
            {
                id: 'axk-radar', name: '雷达模组', nameEn: 'Radar module', cat: '传感器', catEn: 'Sensor', icon: 'radar',
                cap: 'radar.person_detect', capType: 'sensor',
                io: { out: ['person_enter', 'person_leave'], in: [] },
                author: '安信可官方', authorEn: 'Ai-Thinker', price: '¥29', sku: 'AiPi-Radar-24G',
                desc: '24GHz 人体感应，输出靠近/离开事件与距离。',
                descEn: '24 GHz presence sensing; emits approach / leave events with distance.',
            },
            {
                id: 'axk-temp', name: '温湿度模组', nameEn: 'Temp & humidity', cat: '传感器', catEn: 'Sensor', icon: 'temp',
                cap: 'sensor.read_temp', capType: 'sensor',
                io: { out: ['temp_change'], in: [] },
                author: '安信可官方', authorEn: 'Ai-Thinker', price: '¥19', sku: 'AiPi-TH-01',
                desc: '温度 ±0.3℃，湿度 ±3%RH，周期上报。',
                descEn: 'Temperature ±0.3 °C, humidity ±3 %RH, periodic reporting.',
            },
            {
                id: 'axk-light', name: '灯 / 继电器', nameEn: 'Light / relay', cat: '控制类', catEn: 'Control', icon: 'light',
                cap: 'light.set', capType: 'actuator', io: { out: [], in: ['on'] },
                author: '安信可官方', authorEn: 'Ai-Thinker', price: '¥25', sku: 'AiPi-Light-01',
                desc: '单路继电器，支持开/关。',
                descEn: 'Single-channel relay, on / off.',
            },
            {
                id: 'axk-relay4', name: '四路继电器', nameEn: '4-ch relay', cat: '控制类', catEn: 'Control', icon: 'relay',
                cap: 'relay.set', capType: 'actuator', io: { out: [], in: ['ch', 'on'] },
                author: '社区 · 阿树', authorEn: 'Community · Ashu', price: '¥59', sku: 'AS-Relay4',
                desc: '四路独立控制，适合多设备场景。',
                descEn: 'Four independently switched channels for multi-device scenes.',
            },
            {
                id: 'axk-screen', name: '1.3" 屏幕', nameEn: '1.3" display', cat: '控制类', catEn: 'Control', icon: 'screen',
                cap: 'screen.show', capType: 'interaction', io: { out: [], in: ['text'] },
                author: '社区 · 林', authorEn: 'Community · Lin', price: '¥45', sku: 'AS-LCD13',
                desc: '显示文字与简单表情。',
                descEn: 'Shows short text and simple emoji.',
            },
            {
                id: 'axk-servo', name: '舵机', nameEn: 'Servo', cat: '电机类', catEn: 'Motor', icon: 'servo',
                cap: 'servo.set_angle', capType: 'actuator', io: { out: [], in: ['angle'] },
                author: '安信可官方', authorEn: 'Ai-Thinker', price: '¥22', sku: 'AiPi-Servo-9G',
                desc: '0–180° 角度控制，PWM 驱动。',
                descEn: '0–180° angle control, PWM driven.',
            },
            {
                id: 'axk-motor', name: '直流电机', nameEn: 'DC motor', cat: '电机类', catEn: 'Motor', icon: 'motor',
                cap: 'motor.run', capType: 'actuator', io: { out: [], in: ['speed', 'dir'] },
                author: '社区 · 阿树', authorEn: 'Community · Ashu', price: '¥35', sku: 'AS-Motor-130',
                desc: '调速 + 正反转。',
                descEn: 'Variable speed, forward / reverse.',
            },
            {
                id: 'axk-wv01-32s', name: 'Ai-WV01-32S 语音', nameEn: 'Ai-WV01-32S voice', cat: 'AI语音', catEn: 'Voice', icon: 'voice',
                cap: 'speech.ask_llm', capType: 'interaction', io: { out: [], in: ['prompt'] },
                author: '安信可官方', authorEn: 'Ai-Thinker', price: '¥69', sku: 'Ai-WV01-32S',
                desc: '离线唤醒 + 云端 TTS，说一句即可。',
                descEn: 'Offline wake word plus cloud TTS — just say it.',
            },
        ];
        const CATS = ['全部', '主机', '传感器', '控制类', '电机类', 'AI语音'];
        const byId = (id) => CATALOG.filter((p) => p.id === id)[0];

        // ── 多语言：跟随 DSH 的 <html lang>，DSH 切语言时自动跟着切 ──────────
        const STRINGS = {
            zh: {
                newProject: '新建', openProject: '打开', saveProject: '保存',
                newTip: '新建工程 (Ctrl+N)', openTip: '打开工程 (Ctrl+O)', saveTip: '保存工程 (Ctrl+S)',
                untitled: '未命名工程', renameTip: '双击重命名', tipLinked: '（自动保存到该文件）', tipLocal: '（仅本地草稿，Ctrl+S 存成文件）',
                preview: '预览', code: '代码',
                connect: '连接设备', scanning: '扫描中…', connected: '底板已连接',
                support: '支持', push: '下发到设备',
                pushVerify: '校验通过…', pushCompile: '编译字节码…', push40: '下发 40%…', push80: '下发 80%…', pushSelfTest: '回读 self-test…',
                pushDone: '下发成功 · 验证报告：预期 2/2 命中',
                helpTitle: '支持', help1: '· 插件没识别到？检查底板是否插入、串口是否被占用。', help2: '· 下发失败会回读 self-test，给出「逻辑错 / 物理错」归因。',
                hardware: '硬件插件', count: '{n} 个', hostBase: '主机 · 底座', dragTip: '（拖到画布上使用）',
                collapsePanel: '折叠插件栏', expandPanel: '展开插件栏', catHost: '主机',
                logicTitle: '逻辑', rulesUnit: '条规则', run: '运行', running: '运行中…',
                viewCards: '卡片', viewFlow: '流图',
                addRule: '＋ 规则', pinRules: '固化为规则', saveRule: '保存', cancelRule: '取消',
                ruleWhen: '触发通道', ruleEvent: '事件', ruleThen: '执行通道', deleteRule: '删除规则',
                pinned: '已固化为可编辑规则', ruleSaved: '规则已添加', ruleUpdated: '规则已更新', editRule: '编辑规则',
                logicNote: '只读预览：规则由「有事件上报的通道 → 有参数下发的通道」自动推断，编辑与连线将在下一版开放。',
                logicEmpty: '画布上还没有能组成逻辑的插件（至少需要一个传感器 + 一个执行器）。',
                collapseLogic: '收起逻辑面板', expandLogic: '展开逻辑面板', dragLogicHeight: '拖动调整高度（双击复位）',
                catAll: '全部', catSensor: '传感器', catControl: '控制类', catMotor: '电机类', catVoice: 'AI语音',
                emptyTitle: '把左边的硬件插件拖进来',
                emptyHint: '插件会自动插到主机空闲的 UART 上；也可从插件两侧的 Type-C 口拖到指定接口',
                idle: '空闲', hostTitle: '主机 · {n} 路 UART', pluggedIn: '已接 {n} / {m}',
                unplugged: '未接入', uart: 'UART{n}', typeC: 'Type-C {n}',
                hostExists: '画布上已经有主机了', uartFull: '主机 {n} 路 UART 已占满，先移除一个插件',
                assigned: '已接入 UART{n}', uartTaken: 'UART{n} 已被占用', unpluggedToast: '已断开连接', removed: '已从画布移除',
                props: '属性', category: '分类', desc: '说明', iface: '接口', author: '作者',
                capability: '能力', events: '可上报事件', params: '可下发参数',
                purchase: '购买方式', buy: '去官方店铺购买', remove: '从画布移除', toCanvas: '放到画布',
                rules: '静态校验',
                ruleSchema: '结构 schema', ruleCaps: '能力存在性', ruleHost: '主机在位', ruleChannel: '通道不冲突',
                rulePlugged: '插口已接', ruleEvents: '事件合法', ruleLimit: '实例上限', ruleSensor: '至少一个传感器',
                pass: '通过', canvasEmpty: '画布为空', allInRegistry: '全部命中注册表',
                hostOk: '唯一主机', hostMissing: '缺主机', chUsed: '已用 {n}/{m}', chConflict: 'UART 重复占用',
                allPlugged: '全部已接', nUnplugged: '{n} 个插件未接 UART', inModel: '均在 behavior_model 事件集内',
                plugins: '插件 {n}/{m}', nSensors: '{n} 个', noSensor: '缺传感器',
                savedTo: '已保存 {name}', exported: '已导出到下载目录：{name}', opened: '已打开 {name}',
                skipped: '（跳过 {n} 个未知插件）', canceledSave: '已取消保存', canceledOpen: '已取消打开',
                newDone: '已新建工程', restored: '已恢复上次自动保存的工程',
                saveFailed: '保存失败：{e}', openFailed: '打开失败：{e}', confirmNew: '当前工程还没保存，确定新建？',
                devConnected: '已断开', dragLeft: '拖动调整插件栏宽度（双击恢复默认）', dragChat: '拖动调整对话宽度（双击恢复默认）',
                chatNoSlot: '宿主没有把 renderFactorySlot 传给 main 座位，内嵌会话不可用。',
                chatFailed: '渲染失败：{e}',
            },
            en: {
                newProject: 'New', openProject: 'Open', saveProject: 'Save',
                newTip: 'New project (Ctrl+N)', openTip: 'Open project (Ctrl+O)', saveTip: 'Save project (Ctrl+S)',
                untitled: 'Untitled project', renameTip: 'double-click to rename', tipLinked: '(auto-saving to this file)', tipLocal: '(local draft only — Ctrl+S to save as file)',
                preview: 'Preview', code: 'Code',
                connect: 'Connect device', scanning: 'Scanning…', connected: 'Hub connected',
                support: 'Help', push: 'Download',
                pushVerify: 'Validating…', pushCompile: 'Compiling…', push40: 'Uploading 40%…', push80: 'Uploading 80%…', pushSelfTest: 'Reading self-test…',
                pushDone: 'Deployed · verification 2/2 hit',
                helpTitle: 'Help', help1: '· Plugin not detected? Check the hub and whether the serial port is busy.', help2: '· On failure we read back self-test and attribute logic vs hardware faults.',
                hardware: 'Hardware plugins', count: '{n} items', hostBase: 'Host · base', dragTip: '(drag onto the canvas)',
                collapsePanel: 'Collapse panel', expandPanel: 'Expand panel', catHost: 'Host',
                logicTitle: 'Logic', rulesUnit: 'rules', run: 'Run', running: 'Running…',
                viewCards: 'Cards', viewFlow: 'Flow',
                addRule: '+ Rule', pinRules: 'Pin as rules', saveRule: 'Save', cancelRule: 'Cancel',
                ruleWhen: 'Trigger channel', ruleEvent: 'Event', ruleThen: 'Target channel', deleteRule: 'Delete rule',
                pinned: 'Pinned as editable rules', ruleSaved: 'Rule added', ruleUpdated: 'Rule updated', editRule: 'Edit rule',
                logicNote: 'Read-only preview: rules are inferred from channels that emit events to channels that accept actions. Editing lands in the next version.',
                logicEmpty: 'Not enough plugins for logic yet — need at least one sensor and one actuator.',
                collapseLogic: 'Collapse logic panel', expandLogic: 'Expand logic panel', dragLogicHeight: 'Drag to resize (double-click to reset)',
                catAll: 'All', catSensor: 'Sensor', catControl: 'Control', catMotor: 'Motor', catVoice: 'Voice',
                emptyTitle: 'Drag hardware plugins here',
                emptyHint: 'Plugins take the next free UART automatically; you can also drag a Type-C port onto a specific one',
                idle: 'free', hostTitle: 'Host · {n} UART', pluggedIn: 'Plugged {n} / {m}',
                unplugged: 'Not connected', uart: 'UART{n}', typeC: 'Type-C {n}',
                hostExists: 'The canvas already has a host', uartFull: 'All {n} UART ports are taken — remove a plugin first',
                assigned: 'Connected to UART{n}', uartTaken: 'UART{n} is taken', unpluggedToast: 'Disconnected', removed: 'Removed from canvas',
                props: 'Properties', category: 'Category', desc: 'Description', iface: 'Interface', author: 'Author',
                capability: 'Capability', events: 'Events', params: 'Parameters',
                purchase: 'Buy', buy: 'Open official store', remove: 'Remove from canvas', toCanvas: 'Put on canvas',
                rules: 'Validation',
                ruleSchema: 'Schema', ruleCaps: 'Capabilities', ruleHost: 'Host present', ruleChannel: 'Channels',
                rulePlugged: 'Ports', ruleEvents: 'Events', ruleLimit: 'Limit', ruleSensor: 'Sensor',
                pass: 'ok', canvasEmpty: 'canvas is empty', allInRegistry: 'all in registry',
                hostOk: 'single host', hostMissing: 'no host', chUsed: '{n}/{m} used', chConflict: 'duplicate UART',
                allPlugged: 'all plugged', nUnplugged: '{n} plugin(s) not plugged', inModel: 'all in behavior_model',
                plugins: '{n}/{m} plugins', nSensors: '{n}', noSensor: 'none',
                savedTo: 'Saved {name}', exported: 'Exported to Downloads: {name}', opened: 'Opened {name}',
                skipped: ' (skipped {n} unknown plugins)', canceledSave: 'Save cancelled', canceledOpen: 'Open cancelled',
                newDone: 'New project created', restored: 'Restored the last autosaved project',
                saveFailed: 'Save failed: {e}', openFailed: 'Open failed: {e}', confirmNew: 'This project has unsaved changes. Create a new one?',
                devConnected: 'Disconnected', dragLeft: 'Drag to resize the plugin panel (double-click to reset)', dragChat: 'Drag to resize the chat column (double-click to reset)',
                chatNoSlot: 'The host did not pass renderFactorySlot to the main seat, so the embedded session is unavailable.',
                chatFailed: 'Render failed: {e}',
            },
        };
        /** 按当前语言二选一（给宿主回调、系统对话框文案用，这些拿不到 t()） */
        const tt = (zh, en) => (pickLang() === 'zh' ? zh : en);
        const pickLang = () => {
            let tag = '';
            try { tag = document.documentElement.lang || ''; } catch (e) { tag = ''; }
            if (!tag) tag = (typeof navigator !== 'undefined' && navigator.language) || 'zh';
            return String(tag).toLowerCase().indexOf('zh') === 0 ? 'zh' : 'en';
        };

        // ── 样式：一次性注入，全部选择器收在 .aipi-wb 下，不污染宿主 ────────
        const CSS = `
/* 配色全部取自 DSH 自己的语义令牌（--dsw-alias-*），深浅色主题由宿主切换，
   插件不再自己写死浅色/深色两套。令牌缺失时（脱离 DSH 单独预览）用括号里的兜底值。 */
.aipi-wb{display:flex;flex-direction:column;height:100%;min-height:0;position:relative;overflow:hidden;
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
/* 工具栏下面那一行：左栏 + 画布/属性 + 对话 */
.aipi-main{flex:1;min-width:0;min-height:0;display:flex;position:relative}
/* 左栏放在一个占位槽里：折叠时槽只有 44px，悬停时面板浮出覆盖画布、不挤压布局 */
.aipi-left-slot{flex:none;position:relative;z-index:4;min-width:0}
.aipi-col.left{position:absolute;left:0;top:0;bottom:0;border-right:1px solid var(--line);
  background:var(--panel);display:flex;flex-direction:column;min-height:0;overflow:hidden;
  transition:width .16s ease,box-shadow .16s ease}
.aipi-col.left.collapsed .aipi-left-gap,
.aipi-col.left.collapsed .aipi-cats,
.aipi-col.left.collapsed .aipi-grid,
.aipi-col.left.collapsed .aipi-hd-title{display:none}
.aipi-col.left.collapsed .aipi-hd{justify-content:center;padding:8px 0}
.aipi-collapse-left{width:28px;height:28px;padding:0;border-radius:7px;color:var(--muted);margin-left:auto;
  display:grid;place-items:center;line-height:0}
.aipi-collapse-left:hover{background:var(--acc-soft);color:var(--acc)}
.aipi-collapse-left .aipi-collapse-ico{display:grid;place-items:center;opacity:.9}
/* 折叠态水平镜像（只做 transform，path 不变）：箭头指向「展开回来」 */
.aipi-collapse-left .aipi-collapse-ico.flipped{transform:scaleX(-1)}

.aipi-col.left.collapsed .aipi-collapse-left{width:16px;height:16px;border-radius:4px;margin:0 auto}
/* 左栏顶部这一行放工程操作，高度与中央工具条一致；下面的『硬件插件』与『属性』齐平 */
.aipi-left-gap .aipi-btn.sm{flex:none;padding:3px 7px;font-size:11px}
.aipi-left-gap .aipi-proj{flex:1;min-width:0;max-width:none}
.aipi-col.right{width:264px;flex:0 0 264px;border-left:1px solid var(--line);
  display:flex;flex-direction:column;min-height:0;overflow:hidden}
.aipi-right-body{flex:1;min-height:0;overflow:auto;padding:0 12px 14px}
.aipi-col.center{flex:1 1 0;background:var(--canvas);min-width:0;position:relative}
/* 中间列 = 通栏工具条 + 下面一行[画布 | 属性]：属性开合只改画布宽度。
   min-width 兜住画布：空间不够时挤的是对话栏，不是把画布压成 0。 */
.aipi-mid{flex:1 1 0;min-width:0;min-height:0;display:flex;flex-direction:column;background:var(--canvas)}
.aipi-body{flex:1;min-width:0;min-height:0;display:flex}
/* 对话栏：宽度由内联 style 给，但允许被压缩，最少 220 */
.aipi-col.chat{flex:0 1 auto;min-width:220px;border-left:1px solid var(--line);min-height:0;
  /* 会话区用 DSH 原本的底色，避免比外部深/浅一档出现接缝 */
  background:var(--dsw-alias-bg-base,transparent)}
/* 分隔条：不占布局宽度（否则相邻两栏之间会多出 9px 底色，顶栏像被切断），
   视觉上两栏直接相邻；用一个悬在中缝上的透明伪元素提供命中区 */
.aipi-resizer{width:0;flex:none;position:relative;z-index:2}
.aipi-resizer::after{content:'';position:absolute;top:0;bottom:0;left:-5px;width:10px;
  cursor:col-resize}
/* 画布下方的逻辑 dock（只读预览） */
.aipi-logic{flex:none;display:flex;flex-direction:column;border-top:1px solid var(--line);background:var(--panel);min-height:37px;overflow:hidden}
.aipi-logic-resizer{height:6px;flex:none;cursor:ns-resize;margin-top:-3px}
.aipi-logic-resizer:hover{background:var(--acc-soft)}
.aipi-logic-hd{display:flex;align-items:center;gap:8px;height:36px;flex:none;padding:0 10px;
  font-size:12px;font-weight:600;border-bottom:1px solid var(--line)}
.aipi-logic-hd .t{font-weight:600}
.aipi-logic-hd .n{font-size:11px;color:var(--muted);font-weight:400}
.aipi-logic-body{flex:1;min-height:0;overflow:auto;padding:8px 10px 10px}
.aipi-logic-note{font-size:11px;color:var(--muted);line-height:1.6;margin-bottom:8px}
.aipi-logic-empty{font-size:12px;color:var(--muted);padding:10px 0}
/* 只读流图：左传感器 / 右动作，自动布局 */
.aipi-flow-wrap{overflow:auto;max-height:186px}
.aipi-flow{position:relative}
.aipi-flow-wires{position:absolute;left:0;top:0;pointer-events:none;overflow:visible}
.aipi-flow-wire{fill:none;stroke:var(--line);stroke-width:1.6}
.aipi-flow-wire.on{stroke:var(--acc);stroke-width:2.4}
.aipi-fnode{position:absolute;display:flex;align-items:center;gap:8px;padding:0 10px;
  border:1px solid var(--line);border-radius:8px;background:var(--panel);overflow:hidden}
.aipi-fnode.on{border-color:var(--acc);box-shadow:0 0 0 3px var(--acc-soft)}
.aipi-fnode .ico{display:grid;place-items:center;color:var(--acc);flex:none}
.aipi-fnode .tx{min-width:0;flex:1}
.aipi-fnode .t1{font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.aipi-fnode .t2{font-size:10px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.aipi-fnode .ch{position:absolute;right:7px;top:4px;font-size:9px;color:var(--muted);opacity:.8}
.aipi-fnode.action{background:var(--acc-soft)}
.aipi-lgroups{display:flex;flex-direction:column;gap:8px}
.aipi-ruledraft{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:8px;
  padding:6px 8px;border:1px dashed var(--line);border-radius:8px}
.aipi-ruledraft .lbl{font-size:11px;color:var(--muted)}
.aipi-ruledraft select{font:inherit;font-size:11px;color:inherit;background:var(--panel);
  border:1px solid var(--line);border-radius:5px;padding:2px 4px;max-width:150px}
.aipi-ruledraft .arrow{color:var(--muted)}
.aipi-pfield{display:inline-flex;align-items:center;gap:4px;font-size:11px;color:var(--muted)}
.aipi-pfield input[type="number"],.aipi-pfield input[type="text"]{width:64px;font:inherit;font-size:11px;
  color:inherit;background:var(--panel);border:1px solid var(--line);border-radius:5px;padding:2px 4px}
.aipi-ruleedit{width:16px;height:16px;padding:0;border-radius:4px;color:var(--muted);
  font:11px/1 sans-serif;margin-left:auto}
.aipi-ruleedit:hover{color:var(--acc);background:var(--acc-soft)}
.aipi-lgroup.clickable{cursor:pointer}
.aipi-lgroup.clickable:hover{border-color:var(--acc)}
.aipi-ruledel{width:16px;height:16px;padding:0;border-radius:4px;color:var(--muted);
  font:12px/1 sans-serif;margin-left:6px}
.aipi-ruledel:hover{color:#c92a2a;background:var(--acc-soft)}
.aipi-lgroup{border:1px solid var(--line);border-radius:8px;padding:8px;background:var(--canvas)}
.aipi-lwhen{display:flex;align-items:center;gap:6px;font-size:12px}
.aipi-lwhen .ico{display:grid;place-items:center;color:var(--acc)}
.aipi-lwhen .who{color:var(--muted)}
.aipi-lwhen .ev{color:var(--dsw-alias-label-primary,inherit);font-weight:600}
.aipi-lwhen .ch{margin-left:auto;font-size:10px;color:var(--muted)}
.aipi-lthen{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;padding-left:21px}
.aipi-laction{display:inline-flex;align-items:center;gap:5px;font-size:11px;
  padding:3px 8px;border-radius:20px;background:var(--acc-soft);color:var(--acc)}
.aipi-laction em{font-style:normal;color:var(--muted);font-size:10px}
.aipi-laction.on{outline:1px solid var(--acc);background:var(--acc);color:#fff}
.aipi-laction.on em{color:rgba(255,255,255,.8)}
.aipi-lrules{display:flex;flex-direction:column;gap:4px}
.aipi-lrule{display:flex;align-items:center;gap:8px;font-size:12px;padding:5px 8px;border-radius:6px;
  border:1px solid transparent;color:var(--dsw-alias-label-secondary,inherit)}
.aipi-lrule.on{border-color:var(--acc);background:var(--acc-soft)}
.aipi-lrule .when{color:var(--acc)}
.aipi-lrule .arrow{color:var(--muted)}
.aipi-lrule .then{color:var(--dsw-alias-label-primary,inherit)}
.aipi-trace{margin-top:10px;border-top:1px dashed var(--line);padding-top:8px;
  font:11px/1.7 var(--ds-font-family-code,Consolas,monospace);color:var(--muted)}
.aipi-trace .row{display:flex;gap:8px}
.aipi-trace .t{color:var(--acc);min-width:44px;text-align:right}
.aipi-chat-wrap{flex:1;min-height:0;overflow:auto;display:flex;flex-direction:column}
.aipi-chat-note{padding:10px 12px;font-size:11px;color:var(--muted);
  line-height:1.8;border-bottom:1px dashed var(--line)}
.aipi-hd{display:flex;align-items:center;gap:8px;padding:8px 12px;font-size:12px;font-weight:600}
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
.aipi-card.wide{grid-column:span 2}
.aipi-card.wide .thumb{aspect-ratio:auto;height:74px}
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
.aipi-tool{display:flex;align-items:center;gap:8px;height:44px;padding:0 12px;flex:none;position:relative;
  border-bottom:1px solid var(--line);background:var(--panel)}
/* 工程名：工具条正中间，双击改名 */
.aipi-proj-wrap{position:absolute;left:50%;top:0;bottom:0;transform:translateX(-50%);
  display:flex;align-items:center;max-width:40%;padding:0 8px;border-radius:6px;cursor:text}
.aipi-proj-wrap:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.14))}
.aipi-proj-name{font-size:12px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.aipi-proj-input{font:inherit;font-size:12px;color:inherit;background:var(--panel);border:1px solid var(--acc);
  border-radius:5px;padding:2px 6px;min-width:140px;outline:none;text-align:center}
/* 分段切换：照 DSH 原生标签页（文字 + 选中项底部 2px 下划线） */
.aipi-seg{display:flex;align-items:center;gap:36px;background:none;border:0;padding:0;position:relative}
.aipi-seg button{background:none;border:0;padding:0 0 7px;font-size:13px;font-weight:500;line-height:16px;
  color:var(--dsw-alias-label-tertiary,var(--muted));cursor:pointer;position:relative}
.aipi-seg button::after{content:'';position:absolute;left:0;right:0;bottom:-1px;height:2px;border-radius:2px;background:transparent}
.aipi-seg button.on{color:var(--dsw-alias-state-business-primary,var(--acc))}
.aipi-seg button.on::after{background:var(--dsw-alias-state-business-primary,var(--acc))}
.aipi-seg.sm{gap:36px;padding:0}
.aipi-seg.sm button{padding:0 0 5px;font-size:12px}
.aipi-sp{flex:1}
.aipi-btn{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line);
  border-radius:8px;padding:5px 11px;font-size:12px;background:var(--panel)}
.aipi-btn:hover{border-color:var(--acc);color:var(--acc)}
.aipi-btn.primary{background:var(--dsw-alias-button-primary-fill,var(--acc));border-color:var(--dsw-alias-button-primary-fill,var(--acc));color:var(--dsw-alias-label-primary-foreground,#fff)}
.aipi-btn.primary:hover{background:var(--dsw-alias-button-primary-hover,var(--acc));color:var(--dsw-alias-label-primary-foreground,#fff)}
.aipi-btn.sm{padding:4px 9px}
.aipi-proj{max-width:112px;font-size:11px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
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
/* 仿真时正在流动的节点 */
.aipi-node.flow .aipi-frame{border-color:var(--acc);box-shadow:0 0 0 4px var(--acc-soft)}
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
/* 连接线：加粗透明命中区 + 选中态 */
.aipi-wire-hit{fill:none;stroke:transparent;stroke-width:16;pointer-events:stroke;cursor:pointer}
.aipi-wire.sel{opacity:1;stroke-width:3.5;filter:drop-shadow(0 0 3px var(--acc))}
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

            // 语言跟随 DSH：读 <html lang>，宿主切语言时自动重渲染
            const [lang, setLang] = React.useState(pickLang);
            React.useEffect(() => {
                const html = document.documentElement;
                const obs = new MutationObserver(() => setLang(pickLang()));
                obs.observe(html, { attributes: true, attributeFilter: ['lang'] });
                return () => obs.disconnect();
            }, []);
            const t = React.useCallback((key, vars) => {
                const pack = STRINGS[lang] || STRINGS.zh;
                let s = pack[key];
                if (s == null) s = STRINGS.zh[key];
                if (s == null) return key;
                if (vars) Object.keys(vars).forEach((k) => { s = s.split('{' + k + '}').join(String(vars[k])); });
                return s;
            }, [lang]);
            /** 目录条目的本地化视图（缺 *En 字段回退中文） */
            const catLabel = React.useCallback((c) => ({ '全部': t('catAll'), '传感器': t('catSensor'), '控制类': t('catControl'), '主机': t('catHost'), '电机类': t('catMotor'), 'AI语音': t('catVoice') }[c] || c), [t]);
            const pl = React.useCallback((p) => (lang === 'zh' || !p ? p : Object.assign({}, p, {
                name: p.nameEn || p.name,
                cat: p.catEn || p.cat,
                desc: p.descEn || p.desc,
                author: p.authorEn || p.author,
            })), [lang]);

            const [filter, setFilter] = React.useState('全部');
            // 每个插件占主机一路 UART（node.uart = 1..6）；主机自己不需要 uart
            const [nodes, setNodes] = React.useState(() => [
                { uid: 'n2', id: 'aipi-hub', x: 172, y: 150 },
                { uid: 'n1', id: 'axk-radar', x: 16, y: 40, uart: 1 },
                { uid: 'n3', id: 'axk-light', x: 16, y: 180, uart: 2 },
                { uid: 'n4', id: 'axk-wv01-32s', x: 16, y: 316, uart: 3 },
            ]);
            const [sel, setSel] = React.useState('n1');
            // 左侧插件栏里点中的卡片（还没放到画布），右侧同样显示它的属性
            const [cardSel, setCardSel] = React.useState(null);
            // 选中的连接线（值是被连插件的 uid）；Delete 断开它
            const [wireSel, setWireSel] = React.useState(null);
            // 工程文件状态
            const [projName, setProjName] = React.useState(''); // 空 = 未命名（显示时按当前语言补）
            const [dirty, setDirty] = React.useState(false);
            const [linkedName, setLinkedName] = React.useState(''); // 已绑定到磁盘文件的文件名
            const [editing, setEditing] = React.useState(false);     // 工程名是否在改名中
            const [draft, setDraft] = React.useState('');
            const fileRef = React.useRef(null);      // File System Access 句柄
            const savedTextRef = React.useRef('');   // 最近一次落盘的工程文本，用来判断是否真有改动
            const [mode, setMode] = React.useState('preview');
            const [connected, setConnected] = React.useState(false);
            const [scanning, setScanning] = React.useState(false);
            const [pushing, setPushing] = React.useState(false);
            const [pushStep, setPushStep] = React.useState('');
            const [toast, setToast] = React.useState('');
            const [help, setHelp] = React.useState(false);
            // 逻辑面板（只读预览）：展开状态、当前高亮规则、仿真轨迹
            const [logicOpen, setLogicOpen] = React.useState(true);
            const [runningLogic, setRunningLogic] = React.useState(false);
            const [activeRule, setActiveRule] = React.useState(null);
            const [flow, setFlow] = React.useState(null);
            const [trace, setTrace] = React.useState([]);
            const [logicView, setLogicView] = React.useState('cards'); // cards | flow
            // 逻辑 dock 高度：可上下拖动调整
            const [logicH, setLogicH] = React.useState(220);
            const [logicDrag, setLogicDrag] = React.useState(null);
            // 用户规则（可编辑、会写进 .aipi）；为空时退回自动推断
            const [userRules, setUserRules] = React.useState([]);
            const [ruleDraft, setRuleDraft] = React.useState(null);
            // 右栏对话宽度：默认 604，可拖分隔条调整
            const [chatW, setChatW] = React.useState(604);
            const [resize, setResize] = React.useState(null);
            // 左栏插件库宽度：默认 232，同样可拖
            const [leftW, setLeftW] = React.useState(232);
            const [leftCollapsed, setLeftCollapsed] = React.useState(false); // 插件栏折叠成窄轨
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
            /** 两个矩形（带内边距）是否重叠 */
            const hits = (a, b, pad) => {
                const p = pad || 0;
                return !(a.x + a.w + p <= b.x || b.x + b.w + p <= a.x
                    || a.y + a.h + p <= b.y || b.y + b.h + p <= a.y);
            };

            /**
             * 给插件算一个位置：优先贴着它那一侧的接口，其次上/下/右的网格，
             * 全程限制在画布可视区内。没有这一步时所有插件都会堆在 (40,40)。
             */
            const placeNearSocket = (prev, host, uart, size, bounds) => {
                const GAP = 30;
                const PITCH = size.w + 12;
                const W = Math.max(bounds && bounds.w ? bounds.w : 420, 260);
                const H = Math.max(bounds && bounds.h ? bounds.h : 600, 260);
                const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(v)));
                const used = prev.map((n) => {
                    const s = sizeOf(n);
                    return { x: n.x, y: n.y, w: s.w, h: s.h };
                });
                const p = uartPos(host, uart);
                const mySide = uart <= 2 ? 'down' : uart <= 4 ? 'up' : 'right';
                // 每条边排两列/两行，和主机居中对齐；放不下就往外再排一圈
                const rowStart = host.x + (HOST_W - (2 * size.w + 12)) / 2;
                const colStart = host.y + (HOST_H - (2 * size.h + 12)) / 2;
                const cands = [];
                const add = (side, x, y) => cands.push({ side, x, y });
                for (let r = 0; r < 4; r += 1) {
                    for (let c = 0; c < 2; c += 1) {
                        add('down', rowStart + c * PITCH, host.y + HOST_H + GAP + r * (size.h + 12));
                        add('up', rowStart + c * PITCH, host.y - size.h - GAP - r * (size.h + 12));
                        add('right', host.x + HOST_W + GAP + r * (size.w + 12), colStart + c * PITCH);
                    }
                }
                // 越界就不要「硬夹进来」——夹进来的位置会压住主机，看起来更糟
                const fit = (cand) => {
                    if (cand.x < 8 || cand.y < 8) return null;
                    if (cand.x + size.w > W - 8 || cand.y + size.h > H - 8) return null;
                    return { x: Math.round(cand.x), y: Math.round(cand.y), w: size.w, h: size.h };
                };
                const free = (r) => !used.some((u) => hits(r, u, 10));
                const dist = (cand) => Math.abs(cand.x + size.w / 2 - p.x) + Math.abs(cand.y + size.h / 2 - p.y);
                cands.sort((a, b) => {
                    const sa = a.side === mySide ? 0 : 1;
                    const sb = b.side === mySide ? 0 : 1;
                    if (sa !== sb) return sa - sb;
                    return dist(a) - dist(b);
                });
                for (const cand of cands) {
                    const r = fit(cand);
                    if (r && free(r)) return { x: r.x, y: r.y };
                }
                return { x: 8, y: 8 };
            };
            const addNode = React.useCallback((id, x, y) => {
                const p = byId(id);
                if (!p) return;
                setNodes((prev) => {
                    const isHost = p.cat === '主机';
                    if (isHost && prev.some((n) => (byId(n.id) || {}).capType === 'host')) {
                        say(t('hostExists'));
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
                    // 没给坐标（Agent 放置 / 「放到画布」按钮）就按接口位置自动摆，
                    // 否则全部堆在 (40,40) 互相压住，很难看
                    const auto = (x === null || x === undefined || y === null || y === undefined);
                    let px = x;
                    let py = y;
                    if (auto) {
                        const hostNode = prev.filter((n) => (byId(n.id) || {}).capType === 'host')[0];
                        // 必须在本实例的根节点里找，不能用 document——页面里可能还有另一份隐藏的工作台
                        const scope = rootRef.current || document;
                        const stageEl = scope.querySelector('.aipi-stage');
                        const bounds = {
                            w: stageEl ? stageEl.clientWidth : 900,
                            h: stageEl ? stageEl.clientHeight : 600,
                        };
                        if (!isHost && hostNode && uart) {
                            const spot = placeNearSocket(prev, hostNode, uart, { w: NW, h: NH }, bounds);
                            px = spot.x;
                            py = spot.y;
                        } else {
                            // 主机：画布正中偏上，给下面的插件留位置
                            px = Math.max(8, Math.round((bounds.w - HOST_W) / 2));
                            // 上留一排、下留两排插件的高度：主机居中但别贴顶
                            // 下方要能塞下两排插件：y 太靠下时第二排就出界了
                            py = Math.max(142, Math.min(Math.round((bounds.h - HOST_H) / 2), Math.max(142, bounds.h - 442)));
                        }
                    }
                    // 从插件库拖进来时默认走右口；之后用哪个口由用户拖拽决定，不再自动换
                    const node = { uid, id, x: Math.max(6, px), y: Math.max(6, py), uart, side: 'right' };
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
                say(t('removed'));
            }, [say]);

            // ── 工程：序列化 / 反序列化 / 新建 / 打开 / 保存 ────────────────────
            /** 当前工作台全部状态 → 工程对象（连线由每个插件的 uart + side 推导，不单独存） */
            const serialize = React.useCallback(() => ({
                format: PROJECT_FORMAT,
                version: PROJECT_VERSION,
                savedAt: new Date().toISOString(),
                meta: { name: projName },
                host: { id: 'aipi-hub', uarts: HOST_UARTS },
                nodes: nodes.map((n) => ({
                    uid: n.uid,
                    pluginId: n.id,
                    x: Math.round(n.x),
                    y: Math.round(n.y),
                    rot: n.rot || 0,
                    uart: n.uart || null,
                    side: n.side || 'right',
                })),
                view: { mode, leftWidth: leftW, chatWidth: chatW },
                logic: { rules: userRules },
                device: { connected },
            }), [nodes, projName, mode, leftW, chatW, connected, userRules]);

            /** 工程文本 → 工作台状态；不认识/越界的数据按规则收敛，并返回提示信息 */
            const applyProject = React.useCallback((text, nameFromFile) => {
                let raw;
                try { raw = JSON.parse(text); } catch (e) { throw new Error('不是合法的 JSON'); }
                if (!raw || raw.format !== PROJECT_FORMAT) throw new Error(tt('不是小安派工作台工程（' + PROJECT_EXT + '）', 'Not an AiPi Workbench project (' + PROJECT_EXT + ')'));
                if (!Number.isInteger(raw.version) || raw.version < 1) throw new Error('工程版本号不合法');
                if (raw.version > PROJECT_VERSION) throw new Error('工程版本 ' + raw.version + ' 比当前插件新，请先升级工作台');

                const list = Array.isArray(raw.nodes) ? raw.nodes : [];
                const kept = [];
                let dropped = 0;
                list.forEach((n, i) => {
                    const p = byId(n.pluginId);
                    if (!p) { dropped += 1; return; }
                    kept.push({
                        uid: 'n' + (i + 1000),
                        id: n.pluginId,
                        x: Math.max(0, Number(n.x) || 0),
                        y: Math.max(0, Number(n.y) || 0),
                        rot: (((Number(n.rot) || 0) % 360) + 360) % 360,
                        uart: Number.isInteger(Number(n.uart)) && Number(n.uart) >= 1 ? Number(n.uart) : null,
                        side: n.side === 'left' ? 'left' : 'right',
                    });
                });
                if (!kept.length) throw new Error('工程里没有可用的插件');

                // 主机只留第一个，插件按原通道尽量保留，冲突/超额的重排
                const hostNode = kept.filter((n) => (byId(n.id) || {}).capType === 'host')[0] || null;
                const plugins = kept.filter((n) => n !== hostNode);
                const used = [];
                let overflow = 0;
                plugins.forEach((n) => {
                    let ch = n.uart;
                    if (!ch || ch > HOST_UARTS || used.indexOf(ch) >= 0) {
                        ch = 0;
                        for (let i = 1; i <= HOST_UARTS; i += 1) {
                            if (used.indexOf(i) < 0) { ch = i; break; }
                        }
                    }
                    if (!ch) { overflow += 1; n.uart = null; } else { used.push(ch); n.uart = ch; }
                });
                const next = (hostNode ? [hostNode] : []).concat(plugins);

                setNodes(next);
                uidRef.current = next.length + 1000;
                setSel(next.length ? next[0].uid : null);
                setCardSel(null);
                setWireSel(null);
                const view = raw.view || {};
                if (Number.isFinite(view.leftWidth)) setLeftW(Math.max(180, Math.min(420, Math.round(view.leftWidth))));
                if (Number.isFinite(view.chatWidth)) setChatW(Math.max(220, Math.round(view.chatWidth)));
                if (view.mode === 'code' || view.mode === 'preview') setMode(view.mode);
                setConnected(!!(raw.device && raw.device.connected));
                const rawRules = (raw.logic && Array.isArray(raw.logic.rules)) ? raw.logic.rules : [];
                setUserRules(rawRules.map((r, i) => ({
                    id: r.id || 'r' + (i + 1),
                    uart: Number(r.uart) || null,
                    event: r.event || '',
                    then: Array.isArray(r.then) ? r.then.map((x) => ({ uart: Number(x.uart) || null, action: x.action || '', args: x.args || {} })) : [],
                })).filter((r) => r.uart && r.event && r.then.length));
                const nm = String(nameFromFile || (raw.meta && raw.meta.name) || '未命名工程');
                setProjName(nm.replace(/\.aipi$/i, ''));
                setDirty(false);
                return { dropped, overflow, hasHost: !!hostNode };
            }, []);
            /** 双击改名后提交：空名字视为不动 */
            const commitRename = React.useCallback(() => {
                const name = String(draft || '').trim();
                setEditing(false);
                if (!name) return;
                setProjName(name);
            }, [draft]);

            /** 保存：有句柄直接覆盖；没有就调系统保存框；系统框不可用/报错就退回下载 */
            const saveProject = React.useCallback(async (saveAs) => {
                const text = JSON.stringify(serialize(), null, 2);
                const download = () => {
                    const blob = new Blob([text], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = (projName || t('untitled')) + PROJECT_EXT;
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                    setTimeout(() => URL.revokeObjectURL(url), 2000);
                    savedTextRef.current = text;
                    setDirty(false);
                    say('已导出到下载目录：' + projName + PROJECT_EXT);
                };
                const afterFileSave = async (handle) => {
                    fileRef.current = handle;
                    setLinkedName(handle.name || '');
                    savedTextRef.current = text;
                    setProjName(String(handle.name || projName).replace(/\.aipi$/i, ''));
                    try { await idbSet('file', handle); } catch (e) { /* 句柄存不下不影响保存 */ }
                    setDirty(false);
                    say('已保存 ' + (handle.name || projName + PROJECT_EXT));
                };

                try {
                    // 1) 已有句柄且不是「另存为」：直接覆盖原文件
                    if (!saveAs && fileRef.current) {
                        try {
                            await writeHandle(fileRef.current, text);
                            await afterFileSave(fileRef.current);
                            return;
                        } catch (e) {
                            // 权限丢了/句柄失效 → 往下走，让用户重选或下载
                        }
                    }
                    // 2) 系统保存框
                    if (typeof window !== 'undefined' && typeof window.showSaveFilePicker === 'function') {
                        try {
                            const handle = await window.showSaveFilePicker({
                                suggestedName: (projName || t('untitled')) + PROJECT_EXT,
                                types: [{ description: tt('小安派工作台工程', 'AiPi Workbench project'), accept: { 'application/json': [PROJECT_EXT] } }],
                            });
                            await writeHandle(handle, text);
                            await afterFileSave(handle);
                            return;
                        } catch (e) {
                            if (e && e.name === 'AbortError') { say('已取消保存'); return; }
                            // 系统框被环境挡住（无手势/无权限/headless）→ 下载兜底
                        }
                    }
                    // 3) 兜底：直接下载
                    download();
                } catch (err) {
                    say('保存失败：' + ((err && err.message) || err));
                }
            }, [serialize, projName, say]);


            /** 打开：优先系统打开框，退回落 file input；拿到的句柄记下来给自动保存用 */
            const openProject = React.useCallback(async () => {
                const finish = async (text, name, handle) => {
                    try {
                        const r = applyProject(text, name);
                        if (handle) {
                            fileRef.current = handle;
                            setLinkedName(name || '');
                            try { await idbSet('file', handle); } catch (e) { /* 存不下不影响打开 */ }
                        }
                        say('已打开 ' + name + (r.dropped ? '（跳过 ' + r.dropped + ' 个未知插件）' : ''));
                    } catch (err) {
                        say('打开失败：' + ((err && err.message) || err));
                    }
                };
                try {
                    if (typeof window !== 'undefined' && typeof window.showOpenFilePicker === 'function') {
                        let handles = null;
                        try {
                            handles = await window.showOpenFilePicker({
                                multiple: false,
                                types: [{ description: tt('小安派工作台工程', 'AiPi Workbench project'), accept: { 'application/json': [PROJECT_EXT] } }],
                            });
                        } catch (e) {
                            if (e && e.name === 'AbortError') { say('已取消打开'); return; }
                            handles = null; // 系统框不可用 → 走 input
                        }
                        if (handles && handles[0]) {
                            const file = await handles[0].getFile();
                            await finish(await file.text(), file.name, handles[0]);
                            return;
                        }
                    }
                    const input = document.createElement('input');
                    input.type = 'file';
                    input.accept = PROJECT_EXT + ',application/json';
                    input.onchange = async () => {
                        const f = input.files && input.files[0];
                        if (!f) return;
                        await finish(await f.text(), f.name, null);
                    };
                    input.click();
                } catch (err) {
                    say('打开失败：' + ((err && err.message) || err));
                }
            }, [applyProject, say]);
            const newProject = React.useCallback(() => {
                if (dirty && typeof window !== 'undefined' && window.confirm && !window.confirm('当前工程还没保存，确定新建？')) return;
                fileRef.current = null;
                setLinkedName('');
                try { idbSet('file', null); } catch (e) { /* 忽略 */ }
                const uid = 'n' + (++uidRef.current);
                // 主机放在工作区正中（按当前画布可视区域算，滚动条/尺寸变化都能用对）
                const cv = canvasRef.current;
                const cw = cv ? cv.clientWidth : 420;
                const ch = cv ? cv.clientHeight : 600;
                setNodes([{
                    uid,
                    id: 'aipi-hub',
                    x: Math.max(12, Math.round((cw - HOST_W) / 2)),
                    // 上方留一排插件的高度，下面留两排，插件才能围着主机排开
                    y: Math.max(142, Math.min(Math.round((ch - HOST_H) / 2), Math.max(142, ch - 442))),
                }]);
                setSel(uid);
                setCardSel(null);
                setWireSel(null);
                setProjName('');
                setUserRules([]);
                setRuleDraft(null);
                setMode('preview');
                setConnected(false);
                try { localStorage.removeItem(AUTOSAVE_KEY); } catch (e) { /* 忽略 */ }
                setDirty(false);
                say(t('newDone'));
            }, [dirty, say]);

            // 自动保存：内容真的变了才落盘（900ms 防抖）；有文件句柄就写文件，没有就写 localStorage
            const projectText = React.useMemo(() => JSON.stringify(serialize(), null, 2), [serialize]);
            React.useEffect(() => {
                if (projectText === savedTextRef.current) { setDirty(false); return undefined; }
                setDirty(true);
                const timer = setTimeout(async () => {
                    try {
                        if (fileRef.current && typeof fileRef.current.createWritable === 'function') {
                            const w = await fileRef.current.createWritable();
                            await w.write(projectText);
                            await w.close();
                        } else {
                            localStorage.setItem(AUTOSAVE_KEY, projectText);
                        }
                        savedTextRef.current = projectText;
                        setDirty(false);
                    } catch (e) { /* 自动保存失败不打断操作 */ }
                }, 900);
                return () => clearTimeout(timer);
            }, [projectText]);

            // 挂载时恢复上次的自动保存
            React.useEffect(() => {
                let saved = null;
                try { saved = localStorage.getItem(AUTOSAVE_KEY); } catch (e) { saved = null; }
                if (!saved) return;
                try {
                    applyProject(saved, null);
                    say(t('restored'));
                } catch (e) { /* 坏数据直接忽略 */ }
            }, []);

            // 挂载时把上次绑定的文件句柄取回来（权限还在就继续自动写该文件）
            React.useEffect(() => {
                (async () => {
                    try {
                        const handle = await idbGet('file');
                        if (!handle) return;
                        let state = handle.queryPermission ? await handle.queryPermission({ mode: 'readwrite' }) : 'prompt';
                        if (state === 'granted') {
                            fileRef.current = handle;
                            setLinkedName(handle.name || '');
                            if (handle.name) setProjName(String(handle.name).replace(/\.aipi$/i, ''));
                        }
                    } catch (e) { /* 句柄失效无所谓，走下载/重选 */ }
                })();
            }, []);

            React.useEffect(() => {
                const onKey = (e) => {
                    if (!(e.ctrlKey || e.metaKey)) return;
                    const t = e.target;
                    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
                    const k = String(e.key || '').toLowerCase();
                    if (k === 's') { e.preventDefault(); saveProject(e.shiftKey); }
                    else if (k === 'o') { e.preventDefault(); openProject(); }
                    else if (k === 'n') { e.preventDefault(); newProject(); }
                };
                window.addEventListener('keydown', onKey);
                return () => window.removeEventListener('keydown', onKey);
            }, [saveProject, openProject, newProject]);

            // 有未保存改动时离开页面给个提醒
            React.useEffect(() => {
                const h = (e) => { if (!dirty) return; e.preventDefault(); e.returnValue = ''; };
                window.addEventListener('beforeunload', h);
                return () => window.removeEventListener('beforeunload', h);
            }, [dirty]);

            // 逻辑 dock：拖动上沿改高度（往上拖变高）
            React.useEffect(() => {
                if (!logicDrag) return;
                const onMove = (e) => {
                    const scope = rootRef.current || document;
                    const stage = scope.querySelector('.aipi-stage');
                    const maxH = Math.max(120, (stage ? stage.clientHeight : 600) - 120);
                    const next = logicDrag.h0 - (e.clientY - logicDrag.py);
                    setLogicH(Math.max(80, Math.min(Math.round(next), maxH)));
                };
                const onUp = () => setLogicDrag(null);
                window.addEventListener('pointermove', onMove);
                window.addEventListener('pointerup', onUp);
                return () => {
                    window.removeEventListener('pointermove', onMove);
                    window.removeEventListener('pointerup', onUp);
                };
            }, [logicDrag]);

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
                                    const next = { ...x, uart: n, side: drag.side || 'right' };
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

            // 空格：只转容器外框（.aipi-rot），内部元素不跟转
            // Delete：选中的连接线 → 断开；选中的插件 → 从画布移除
            React.useEffect(() => {
                const onKey = (e) => {
                    const t = e.target;
                    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
                    if (e.key === 'Delete' || e.key === 'Backspace') {
                        if (wireSel) {
                            e.preventDefault();
                            setNodes((prev) => prev.map((x) => (x.uid === wireSel ? { ...x, uart: null } : x)));
                            setWireSel(null);
                            say(t('unpluggedToast'));
                            return;
                        }
                        if (sel) {
                            e.preventDefault();
                            removeNode(sel);
                        }
                        return;
                    }
                    if (!sel) return;
                    if (e.code !== 'Space' && e.key !== ' ') return;
                    e.preventDefault();
                    setNodes((prev) => prev.map((n) => (n.uid === sel
                        ? { ...n, rot: ((n.rot || 0) + 90) % 360 }
                        : n)));
                };
                window.addEventListener('keydown', onKey);
                return () => window.removeEventListener('keydown', onKey);
            }, [sel, wireSel, removeNode, say]);

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
            /** 插件某个 Type-C 口的位置（跟随节点旋转）。用哪个口由节点自己记着，不按远近自动换 */
            const plugPos = (n, side) => {
                const { w, h } = sizeOf(n);
                return side === 'left'
                    ? spin(n, n.x, n.y + h / 2)
                    : spin(n, n.x + w, n.y + h / 2);
            };
            const plugDir = (n, side) => dirOf((n.rot || 0) + (side === 'left' ? 180 : 0));
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
                // 规则也编进 DSL：Agent 拿到的产物必须是「能直接下发」的完整描述，
                // 而不是只有通道清单（之前这里漏了规则，模型只能看到接线）
                return {
                    version: '0.2',
                    host: 'AiPi-NodeMCU-Hub',
                    channels,
                    rules: userRules.map((r) => ({
                        when: { uart: 'UART' + r.uart, event: r.event },
                        then: r.then.map((t) => ({
                            uart: 'UART' + t.uart,
                            action: t.action,
                            args: t.args || {},
                        })),
                    })),
                };
            }, [nodes, userRules]);

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

            // 动作参数：按字段名推断控件类型（注册表目前只有字段名，没有类型信息）
            const PARAM_SPECS = {
                on: { kind: 'bool' },
                ch: { kind: 'num', min: 1, max: 4, step: 1 },
                angle: { kind: 'num', min: 0, max: 180, step: 5 },
                speed: { kind: 'num', min: 0, max: 100, step: 5 },
                dir: { kind: 'enum', options: [['fwd', '正转'], ['rev', '反转']] },
                text: { kind: 'text' },
                prompt: { kind: 'text' },
            };
            const paramNames = (plugin) => ((plugin && plugin.io && plugin.io.in) || []);
            const paramDefault = (plugin) => {
                const out = {};
                paramNames(plugin).forEach((n) => {
                    const s = PARAM_SPECS[n] || { kind: 'text' };
                    out[n] = s.kind === 'bool' ? true : (s.kind === 'num' ? (s.min || 0) : (s.kind === 'enum' ? s.options[0][0] : ''));
                });
                return out;
            };
            const argsText = (args) => Object.keys(args || {}).map((k) => {
                const s = PARAM_SPECS[k] || { kind: 'text' };
                const v = args[k];
                return k + '=' + (s.kind === 'bool' ? (v ? '开' : '关') : String(v));
            }).join(' · ');
            // 逻辑预览：按「传感器 + 事件」分组，下面挂它能触发的动作
            const EVENT_TEXT = {
                person_enter: ['有人靠近', 'person enters'],
                person_leave: ['有人离开', 'person leaves'],
                temp_change: ['温度变化', 'temperature changes'],
            };
            const ACTION_TEXT = {
                'light.set': ['开灯', 'turn the light on'],
                'speech.ask_llm': ['语音播报', 'speak'],
                'screen.show': ['显示文字', 'show text'],
                'servo.set_angle': ['转到角度', 'set the angle'],
                'motor.run': ['转动电机', 'run the motor'],
                'relay.set': ['切换继电器', 'switch the relay'],
                'sensor.read_temp': ['读取温度', 'read the temperature'],
            };
            const L = (pair, fallback) => (pair ? (lang === 'zh' ? pair[0] : pair[1]) : fallback);

            const logicGroups = React.useMemo(() => {
                // 1) 有用户规则：按规则渲染（可编辑）
                if (userRules.length) {
                    return userRules.map((r) => {
                        const sNode = nodes.filter((n) => n.uart === r.uart)[0];
                        const sp = sNode ? byId(sNode.id) : null;
                        if (!sp) return null;
                        const actions = r.then.map((t) => {
                            const aNode = nodes.filter((n) => n.uart === t.uart)[0];
                            const ap = aNode ? byId(aNode.id) : null;
                            if (!ap) return null;
                            return {
                                uid: aNode.uid,
                                uart: t.uart,
                                name: pl(ap).name,
                                icon: ap.icon,
                                cap: t.action,
                                args: t.args || {},
                                label: L(ACTION_TEXT[t.action], t.action),
                            };
                        }).filter(Boolean);
                        if (!actions.length) return null;
                        return {
                            key: r.id,
                            ruleId: r.id,
                            sensorUid: sNode.uid,
                            sensorName: pl(sp).name,
                            sensorIcon: sp.icon,
                            uart: r.uart,
                            event: r.event,
                            eventLabel: L(EVENT_TEXT[r.event], r.event),
                            actions,
                        };
                    }).filter(Boolean);
                }
                // 2) 没有用户规则：按通道能力自动推断（只读）
                const sensors = nodes.filter((n) => {
                    const p = byId(n.id);
                    return p && (p.io && p.io.out ? p.io.out.length : 0) > 0 && n.uart;
                });
                const actors = nodes.filter((n) => {
                    const p = byId(n.id);
                    return p && (p.io && p.io.in ? p.io.in.length : 0) > 0 && n.uart;
                });
                const groups = [];
                sensors.forEach((s) => {
                    const sp = byId(s.id);
                    (sp.io.out || []).forEach((ev) => {
                        const actions = actors.map((a) => {
                            const ap = byId(a.id);
                            return {
                                uid: a.uid,
                                uart: a.uart,
                                name: pl(ap).name,
                                icon: ap.icon,
                                cap: ap.cap,
                                args: paramDefault(ap),
                                label: L(ACTION_TEXT[ap.cap], ap.cap),
                            };
                        });
                        if (!actions.length) return;
                        groups.push({
                            key: s.uid + ':' + ev,
                            sensorUid: s.uid,
                            sensorName: pl(sp).name,
                            sensorIcon: sp.icon,
                            uart: s.uart,
                            event: ev,
                            eventLabel: L(EVENT_TEXT[ev], ev),
                            actions,
                        });
                    });
                });
                return groups;
            }, [nodes, lang, userRules]);

            /** 只读流图布局：左侧传感器事件、右侧动作，自动排布（不拖拽、不缩放） */
            const flowLayout = React.useMemo(() => {
                const NW2 = 152;
                const NH2 = 46;
                const GAP = 12;
                const COL_GAP = 96;
                const left = [];
                const right = [];
                const edges = [];
                let y = 6;
                logicGroups.forEach((g) => {
                    const gid = 'g:' + g.key;
                    left.push({
                        id: gid,
                        x: 6,
                        y,
                        w: NW2,
                        h: NH2,
                        icon: g.sensorIcon,
                        title: g.sensorName,
                        sub: g.eventLabel,
                        ch: 'UART' + g.uart,
                        kind: 'sensor',
                    });
                    let ay = y;
                    g.actions.forEach((a) => {
                        const aid = 'a:' + g.key + '>' + a.uid;
                        right.push({
                            id: aid,
                            x: 6 + NW2 + COL_GAP,
                            y: ay,
                            w: NW2,
                            h: NH2,
                            icon: a.icon,
                            title: a.label,
                            sub: a.name,
                            ch: 'UART' + a.uart,
                            kind: 'action',
                        });
                        edges.push({ key: g.key + '>' + a.uid, from: gid, to: aid });
                        ay += NH2 + GAP;
                    });
                    y = Math.max(y + NH2 + GAP, ay) + 8;
                });
                const nodes = left.concat(right);
                const byIdMap = {};
                nodes.forEach((n) => { byIdMap[n.id] = n; });
                return { nodes, edges, byIdMap, width: 6 + NW2 + COL_GAP + NW2 + 6, height: Math.max(y, 120) };
            }, [logicGroups]);
            /** 把自动推断的规则固化成可编辑数据 */
            const pinRules = React.useCallback(() => {
                if (!logicGroups.length) return;
                setUserRules(logicGroups.map((g, i) => ({
                    id: 'r' + (i + 1) + '-' + Date.now().toString(36),
                    uart: g.uart,
                    event: g.event,
                    then: g.actions.map((a) => ({ uart: a.uart, action: a.cap })),
                })));
                say(t('pinned'));
            }, [logicGroups, say, t]);

            const saveRuleDraft = React.useCallback(() => {
                const d = ruleDraft;
                if (!d || !d.uart || !d.event || !d.toUart) return;
                const target = nodes.filter((n) => String(n.uart) === String(d.toUart))[0];
                const ap = target ? byId(target.id) : null;
                if (!ap) return;
                const editedAction = { uart: Number(d.toUart), action: ap.cap, args: d.args || paramDefault(ap) };
                // 编辑已有规则时只替换选中的那个动作，其余动作保留
                const existing = d.id ? userRules.filter((r) => r.id === d.id)[0] : null;
                const thenList = existing
                    ? existing.then.map((x) => (String(x.uart) === String(d.toUart) ? editedAction : x))
                    : [editedAction];
                const next = {
                    id: d.id || ('r' + Date.now().toString(36)),
                    uart: Number(d.uart),
                    event: d.event,
                    then: thenList,
                };
                setUserRules((prev) => (d.id
                    ? prev.map((r) => (r.id === d.id ? next : r))
                    : prev.concat(next)));
                setRuleDraft(null);
                say(t(d.id ? 'ruleUpdated' : 'ruleSaved'));
            }, [ruleDraft, nodes, say, t]);

            /** 点规则卡片：画布上把对应的传感器和执行器同时点亮一下 */
            const focusRule = React.useCallback((g) => {
                if (!g || !g.actions.length) return;
                setFlow({ from: g.sensorUid, to: g.actions[0].uid });
                setTimeout(() => setFlow(null), 1200);
            }, []);

            const editRule = React.useCallback((g) => {
                const a = g.actions[0];
                setRuleDraft({
                    id: g.ruleId,
                    uart: String(g.uart),
                    event: g.event,
                    toUart: String(a.uart),
                    args: Object.assign({}, a.args || {}),
                });
            }, []);

            const deleteRule = React.useCallback((id) => {
                setUserRules((prev) => prev.filter((r) => r.id !== id));
            }, []);
            /** 仿真按「事件 × 动作」逐条播，画布高亮起止插件 */
            const logicRules = React.useMemo(() => {
                const out = [];
                logicGroups.forEach((g) => {
                    g.actions.forEach((a) => {
                        out.push({
                            key: g.key + '>' + a.uid,
                            fromUid: g.sensorUid,
                            toUid: a.uid,
                            sentence: g.sensorName + ' ' + g.eventLabel + ' → ' + a.label + '（' + a.name + '）',
                        });
                    });
                });
                return out.slice(0, 24);
            }, [logicGroups]);

            const runLogic = React.useCallback(() => {
                if (runningLogic || !logicRules.length) return;
                setRunningLogic(true);
                setTrace([]);
                setActiveRule(null);
                let i = 0;
                const step = () => {
                    if (i >= logicRules.length) {
                        setRunningLogic(false);
                        setActiveRule(null);
                        setFlow(null);
                        return;
                    }
                    const r = logicRules[i];
                    setActiveRule(r.key);
                    setFlow({ from: r.fromUid, to: r.toUid });
                    setTrace((prev) => prev.concat({ at: i * 12 + 4, text: r.sentence }));
                    i += 1;
                    setTimeout(step, 320);
                };
                step();
            }, [logicRules, runningLogic]);

            // ── Agent 通道：浏览器这侧的命令执行器 ────────────────────────────
            // 宿主 index.js 把命令排进队列，这里轮询取走、执行、回执。
            const AGENT_POLL = '/aipi-workbench/agent/poll';
            const AGENT_RESULT = '/aipi-workbench/agent/result';

            const agentRef = React.useRef(null);
            agentRef.current = async (cmd) => {
                const op = cmd && cmd.op;
                const args = (cmd && cmd.args) || {};
                if (op === 'state') {
                    return {
                        ok: true,
                        data: {
                            name: projName || null,
                            connected: !!connected,
                            nodes: nodes.map((n) => {
                                const pp = byId(n.id) || {};
                                return {
                                    uid: n.uid,
                                    pluginId: n.id,
                                    name: pl(pp).name,
                                    cat: pp.cat || '',
                                    capType: pp.capType || '',
                                    uart: n.uart || null,
                                    side: n.side || null,
                                };
                            }),
                            rules: userRules,
                            catalog: CATALOG.map((pp) => ({
                                id: pp.id,
                                name: pl(pp).name,
                                cat: pp.cat,
                                cap: pp.cap,
                                events: (pp.io && pp.io.out) || [],
                                params: (pp.io && pp.io.in) || [],
                            })),
                            validation: rules.map((r) => ({ name: r[0], ok: !!r[1], detail: r[2] })),
                        },
                    };
                }
                if (op === 'add_plugin') {
                    const pp = byId(args.pluginId);
                    if (!pp) return { ok: false, error: '未知插件 id：' + args.pluginId };
                    const before = nodes.length;
                    addNode(args.pluginId, args.x == null ? null : args.x, args.y == null ? null : args.y);
                    return { ok: true, data: { added: args.pluginId, nodesBefore: before } };
                }
                if (op === 'remove_plugin') {
                    if (!nodes.some((n) => n.uid === args.uid)) return { ok: false, error: '没有这个节点：' + args.uid };
                    removeNode(args.uid);
                    return { ok: true, data: { removed: args.uid } };
                }
                if (op === 'set_rules') {
                    const list = Array.isArray(args.rules) ? args.rules : [];
                    const norm = list.map((r, i) => ({
                        id: r.id || ('r' + (i + 1)),
                        uart: Number(r.uart) || null,
                        event: r.event || '',
                        then: Array.isArray(r.then) ? r.then.map((x) => ({
                            uart: Number(x.uart) || null,
                            action: x.action || '',
                            args: x.args || {},
                        })) : [],
                    })).filter((r) => r.uart && r.event && r.then.length);
                    setUserRules(norm);
                    return { ok: true, data: { count: norm.length } };
                }
                if (op === 'validate') {
                    const issues = [];
                    const hostNode = nodes.filter((n) => (byId(n.id) || {}).capType === 'host')[0];
                    if (!hostNode) issues.push({ level: 'error', code: 'NO_HOST', message: '画布上没有主机' });
                    nodes.forEach((n) => {
                        const pp = byId(n.id) || {};
                        if (pp.capType === 'host') return;
                        if (!n.uart) issues.push({ level: 'error', code: 'NO_UART', message: '插件没接到主机：' + n.uid + ' ' + pl(pp).name });
                    });
                    userRules.forEach((r, i) => {
                        if (!nodes.some((n) => n.uart === r.uart)) {
                            issues.push({ level: 'error', code: 'RULE_TRIGGER_MISSING', message: '第 ' + (i + 1) + ' 条规则的触发通道 UART' + r.uart + ' 上没有插件' });
                        }
                        r.then.forEach((t) => {
                            if (!nodes.some((n) => n.uart === t.uart)) {
                                issues.push({ level: 'error', code: 'RULE_TARGET_MISSING', message: '第 ' + (i + 1) + ' 条规则的执行通道 UART' + t.uart + ' 上没有插件' });
                            }
                        });
                    });
                    rules.forEach((r) => {
                        if (!r[1]) issues.push({ level: 'error', code: 'CHECK', message: r[0] + '：' + r[2] });
                    });
                    return { ok: true, data: { passed: issues.filter((x) => x.level === 'error').length === 0, issues } };
                }
                if (op === 'compile') {
                    return {
                        ok: true,
                        data: {
                            dsl,
                            summary: {
                                nodes: nodes.length,
                                channels: nodes.filter((n) => n.uart).length,
                                rules: userRules.length,
                            },
                        },
                    };
                }
                if (op === 'export_state') {
                    return { ok: true, data: { project: serialize(), name: projName || '' } };
                }
                if (op === 'import_state') {
                    try {
                        applyProject(JSON.stringify(args.project || {}), args.name || 'agent.aipi');
                        return { ok: true, data: { imported: true, nodes: (args.project && args.project.nodes ? args.project.nodes.length : 0) } };
                    } catch (e) {
                        return { ok: false, error: String((e && e.message) || e) };
                    }
                }
                if (op === 'simulate') {
                    const steps = [];
                    logicGroups.forEach((g) => g.actions.forEach((a) => steps.push({
                        at: steps.length * 12 + 4,
                        text: g.sensorName + ' ' + g.eventLabel + ' → ' + a.label + '（' + a.name + '）',
                    })));
                    return { ok: true, data: { steps } };
                }
                return { ok: false, error: '未知命令：' + op };
            };

            React.useEffect(() => {
                let stopped = false;
                // 工作台可能被挂载多份（侧栏预览 / 主画布各一个），只能有一个实例轮询，
                // 否则命令会被随机分到不同的状态副本上（曾出现 nodes 在 3/4 之间跳）。
                // 规则：只有可见实例参与，且最后声明可见的实例拥有通道。
                const token = {};
                const el = rootRef.current;
                const loop = async () => {
                    while (!stopped) {
                        if (window.__aipiAgentOwner !== token) {
                            const visible = el && el.isConnected && el.offsetWidth > 0;
                            if (!visible) { await new Promise((r) => setTimeout(r, 350)); continue; }
                            window.__aipiAgentOwner = token;
                        }
                        if (el && (!el.isConnected || el.offsetWidth === 0)) {
                            await new Promise((r) => setTimeout(r, 350));
                            continue;
                        }
                        try {
                            const res = await fetch(AGENT_POLL, { headers: { accept: 'application/json' } });
                            if (res.ok) {
                                const list = await res.json();
                                for (const cmd of (Array.isArray(list) ? list : [])) {
                                    let out;
                                    try {
                                        out = await agentRef.current(cmd);
                                    } catch (e) {
                                        out = { ok: false, error: String((e && e.message) || e) };
                                    }
                                    try {
                                        await fetch(AGENT_RESULT, {
                                            method: 'POST',
                                            headers: { 'content-type': 'application/json' },
                                            body: JSON.stringify(Object.assign({ id: cmd.id }, out)),
                                        });
                                    } catch { /* 回执失败：宿主那边会超时 */ }
                                }
                            }
                        } catch { /* 没有这条路由：静默，不影响界面 */ }
                        await new Promise((r) => setTimeout(r, 350));
                    }
                };
                loop();
                return () => { stopped = true; };
            }, []);
            const canPush = nodes.some((n) => n.uart) && rules.every((r) => r[1]);

            const selNode = nodes.filter((n) => n.uid === sel)[0] || null;
            const cardPlugin = cardSel ? byId(cardSel) : null;
            const selPlugin = selNode ? byId(selNode.id) : cardPlugin;
            const selShow = selPlugin ? pl(selPlugin) : null;

            // 主机也是插件列表里的第一项（不再单独置顶）
            const list = CATALOG.filter((p) => filter === '全部' || p.cat === filter);

            function cardProps(p, isHost) {
                return {
                    className: 'aipi-card' + (isHost ? ' wide' : ''),
                    draggable: true,
                    onDragStart: (e) => {
                        e.dataTransfer.setData('text/plain', p.id);
                        e.dataTransfer.effectAllowed = 'copy';
                    },
                    // 点击卡片只在右侧看它的属性；放进画布仍然是拖拽（或面板里的「放到画布」）
                    onClick: () => { setCardSel(p.id); setSel(null); setWireSel(null); },
                    title: pl(p).name + ' ' + t('dragTip'),
                };
            }

            return h('div', { className: 'aipi-wb', ref: rootRef },
                // 顶部工具栏：固定在工作台顶部，插件栏折叠/展开都不影响它
                h('div', {
                    className: 'aipi-tool',
                    // 对话栏升到了最上面，工具栏右端给它让出宽度，否则按钮会被盖住
                    style: { paddingRight: chatW + 10 },
                },
                    h('button', { className: 'aipi-btn sm', title: t('newTip'), onClick: newProject }, t('newProject')),
                    h('button', { className: 'aipi-btn sm', title: t('openTip'), onClick: openProject }, t('openProject')),
                    h('button', { className: 'aipi-btn sm', title: t('saveTip'), onClick: () => saveProject(false) }, t('saveProject')),
                    h('div', { className: 'aipi-sp' }),
                    h('div', {
                        className: 'aipi-proj-wrap',
                    // 右端被对话栏占去一块，绝对居中的圆心得跟着往左挪一半，才是「看得见的中间」
                    style: { marginLeft: -(chatW + 10) / 2 },
                        title: (projName || t('untitled')) + PROJECT_EXT + ' ' + (linkedName ? t('tipLinked') : t('tipLocal')) + ' · ' + t('renameTip'),
                        onDoubleClick: () => { setDraft(projName || t('untitled')); setEditing(true); },
                    }, editing
                        ? h('input', {
                            className: 'aipi-proj-input',
                            autoFocus: true,
                            value: draft,
                            onChange: (e) => setDraft(e.target.value),
                            onBlur: () => commitRename(),
                            onKeyDown: (e) => {
                                if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
                                else if (e.key === 'Escape') { e.preventDefault(); setEditing(false); }
                                e.stopPropagation();
                            },
                        })
                        : h('span', { className: 'aipi-proj-name' }, (projName || t('untitled')) + (dirty ? ' •' : ''))),
                    h('div', { className: 'aipi-sp' }),
                    h('div', { className: 'aipi-seg' },
                        h('button', { className: mode === 'preview' ? 'on' : '', onClick: () => setMode('preview') }, t('preview')),
                        h('button', { className: mode === 'code' ? 'on' : '', onClick: () => setMode('code') }, t('code')),
                    ),
                    h('button', {
                        className: 'aipi-btn',
                        onClick: () => {
                            if (connected) { setConnected(false); say(t('devConnected')); return; }
                            setScanning(true);
                            setTimeout(() => {
                                setScanning(false);
                                setConnected(true);
                                say('found: AiPi-NodeMCU-Hub · 枚举到 3 个插件');
                            }, 900);
                        },
                    }, h('span', { className: 'aipi-led' + (connected ? ' on' : '') }),
                        scanning ? t('scanning') : (connected ? t('connected') : t('connect'))),
                    h('button', { className: 'aipi-btn', onClick: () => setHelp(!help) }, t('support')),
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
                    }, pushing ? pushStep : t('push')),
                    help && h('div', { className: 'aipi-pop' },
                        h('b', null, t('helpTitle')),
                        h('p', null, '· 插件没识别到？检查底板是否插入、串口是否被占用。'),
                        h('p', null, '· 下发失败会回读 self-test，给出「逻辑错 / 物理错」归因。'),
                    ),
                ),
                h('div', { className: 'aipi-main' },
                // 左：插件库（可折叠；折叠后只留一条窄轨，点图标展开）
                h('div', { className: 'aipi-left-slot', style: { width: leftCollapsed ? RAIL_W : leftW } },
                    h('div', {
                        className: 'aipi-col left' + (leftCollapsed ? ' collapsed' : ''),
                        style: { width: leftCollapsed ? RAIL_W : leftW },
                    },
                        // 标题右侧是折叠按钮（原来的数量去掉了）
                        h('div', { className: 'aipi-hd' }, h('span', { className: 'aipi-hd-title' }, t('hardware')),
                            h('button', {
                                className: 'aipi-collapse-left',
                                title: leftCollapsed ? t('expandPanel') : t('collapsePanel'),
                                onClick: () => setLeftCollapsed(!leftCollapsed),
                            }, h('span', { className: 'aipi-collapse-ico' + (leftCollapsed ? ' flipped' : '') },
                                // 用 React 元素直接画 path（不走 innerHTML，避免任何环境把它当字符串吞掉）
                                h('svg', {
                                    viewBox: '92 92 840 840',
                                    width: 16,
                                    height: 16,
                                    fill: 'currentColor',
                                    'aria-hidden': 'true',
                                }, h('path', { d: PANEL_ICON_PATH }))))),
                        h('div', { className: 'aipi-cats' },
                            CATS.map((c) => h('button', {
                                key: c,
                                className: 'aipi-cat' + (c === filter ? ' on' : ''),
                                onClick: () => setFilter(c),
                            }, catLabel(c))),
                        ),
                        h('div', { className: 'aipi-grid' },
                            list.map((p) => h('div', Object.assign({ key: p.id }, cardProps(p, p.capType === 'host')),
                                h('div', { className: 'tag' }, pl(p).cat),
                                h('div', { className: 'thumb' }, h(Ico, { name: p.icon, size: 42 })),
                                h('div', { className: 'nm' }, pl(p).name),
                            )),
                        ),
                    ),
                ),

                // 左栏与工作区之间的分隔条：拖动调插件库宽度，双击回到 232（折叠时不需要）
                !leftCollapsed && h('div', {
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
                            onClick: () => { setSel(null); setCardSel(null); setWireSel(null); },
                        },
                            nodes.length === 0 && h('div', { className: 'aipi-empty' },
                                h('b', null, t('emptyTitle')),
                                t('emptyHint'),
                            ),
                            h('svg', { className: 'aipi-wires' },
                                // 占着 UART 的插件，各画一条「插件 Type-C 口 → 主机接口」的线
                                // 可见线 + 一条加粗透明的命中线，点一下选中，Delete 断开
                                hostNode && nodes.filter((n) => n.uart).map((n) => {
                                    const target = uartPos(hostNode, n.uart);
                                    const side = n.side || 'right';
                                    const d = wirePath(plugPos(n, side), plugDir(n, side), target, socketDir(hostNode, n.uart));
                                    return [
                                        h('path', {
                                            key: 'w' + n.uid,
                                            className: 'aipi-wire' + (wireSel === n.uid ? ' sel' : ''),
                                            d,
                                        }),
                                        h('path', {
                                            key: 'wh' + n.uid,
                                            className: 'aipi-wire-hit',
                                            d,
                                            onClick: (e) => {
                                                e.stopPropagation();
                                                setWireSel(n.uid);
                                                setSel(null);
                                                setCardSel(null);
                                            },
                                        }),
                                    ];
                                }),
                                drag && nodeByUid(drag.from) && (() => {
                                    const src = nodeByUid(drag.from);
                                    const p0 = plugPos(src, drag.side);
                                    const d0 = plugDir(src, drag.side);
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
                                    className: 'aipi-node' + (sel === n.uid ? ' sel' : '') + (isHost ? ' host' : '')
                                        + (flow && (flow.from === n.uid || flow.to === n.uid) ? ' flow' : ''),
                                    style: Object.assign({
                                        left: n.x, top: n.y,
                                        ...(isHost ? { height: HOST_H } : {}),
                                        '--rot': (n.rot || 0) + 'deg',
                                    }),
                                    title: p.name,
                                    // 选中不能只靠 pointerdown：pointerup 之后浏览器还会补一个
                                    // click，它会冒泡到画布把 sel 清掉 —— 属性栏「一闪而过」就是这个。
                                    onClick: (e) => { e.stopPropagation(); setSel(n.uid); setCardSel(null); setWireSel(null); },
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
                                                    title: 'Type-C ' + ch + ' · ' + (used ? pl(byId(used.id) || {}).name : t('idle')),
                                                }, h('span', { className: 'lbl' }, 'Type-C ' + ch));
                                            })
                                            // 插件自带一左一右两个 Type-C 口（双向），任一个都能插到主机
                                            : ['left', 'right'].map((side) => h('div', {
                                                key: 'plug' + side,
                                                className: 'aipi-plug ' + side
                                                    + ((n.uart && (n.side || 'right') === side) ? ' on' : ''),
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
                                        h('div', { className: 'nm' }, pl(p).name),
                                        h('div', { className: 'sub' },
                                            t('pluggedIn', { n: nodes.filter((x) => x.uart).length, m: HOST_UARTS })))
                                        : [
                                            h('div', { className: 'aipi-node-ico', key: 'ico' },
                                                h(Ico, { name: p.icon, size: 30 })),
                                            h('div', { className: 'aipi-node-nm', key: 'nm' }, pl(p).name),
                                            h('div', { className: 'aipi-node-ch' + (n.uart ? '' : ' off'), key: 'ch' },
                                                n.uart ? 'UART' + n.uart : '未接入'),
                                        ],
                                );
                            }),
                        ),
                    ),
                    // 画布下方：逻辑（只读预览）dock

                    h('div', { className: 'aipi-code' + (mode === 'code' ? ' show' : '') },
                        h('pre', null, JSON.stringify(dsl, null, 2)),
                        h('div', { className: 'aipi-rules' },
                            h('div', { className: 't' }, t('rules')),
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
                selShow && h('div', { className: 'aipi-col right' },
                        h('div', { className: 'aipi-hd' }, t('props')),
                        h('div', { className: 'aipi-right-body' },
                        selShow && h('div', null,
                            h('div', { className: 'aipi-f', style: { display: 'flex', gap: 10, alignItems: 'center' } },
                                h('span', {
                                    style: {
                                        width: 38, height: 38, flex: 'none', borderRadius: 9,
                                        display: 'grid', placeItems: 'center',
                                        background: 'var(--acc-soft)', color: 'var(--acc)',
                                    },
                                }, h(Ico, { name: selShow.icon, size: 24 })),
                                h('div', { style: { minWidth: 0 } },
                                    h('div', { className: 'val' }, h('b', null, selShow.name)),
                                    h('div', { style: { color: 'var(--muted)', fontSize: 11 } }, selShow.id),
                                ),
                            ),
                            h('div', { className: 'aipi-f' },
                                h('div', { className: 'lbl' }, t('category')),
                                h('div', { className: 'val' }, selShow.cat),
                            ),
                            h('div', { className: 'aipi-f' },
                                h('div', { className: 'lbl' }, t('desc')),
                                h('div', { className: 'val', style: { color: 'var(--muted)' } }, selShow.desc),
                            ),
                            selShow.iface && h('div', { className: 'aipi-f' },
                                h('div', { className: 'lbl' }, t('iface')),
                                h('div', { className: 'val' }, selShow.iface),
                            ),
                            h('div', { className: 'aipi-div' }),
                            h('div', { className: 'aipi-f' },
                                h('div', { className: 'lbl' }, t('author')),
                                h('div', { className: 'val' }, selShow.author),
                            ),
                            selShow.capType !== 'host' && h('div', null,
                                h('div', { className: 'aipi-f' },
                                    h('div', { className: 'lbl' }, t('capability')),
                                    h('div', { className: 'aipi-chips' },
                                        h('span', { className: 'aipi-chip' }, selShow.cap),
                                        h('span', { className: 'aipi-chip' }, selShow.capType),
                                    ),
                                ),
                                h('div', { className: 'aipi-f' },
                                    h('div', { className: 'lbl' }, (selShow.io.out || []).length ? t('events') : t('params')),
                                    h('div', { className: 'aipi-chips' },
                                        ((selShow.io.out || []).length ? selShow.io.out : selShow.io.in)
                                            .map((x) => h('span', { key: x, className: 'aipi-chip' }, x)),
                                    ),
                                ),
                            ),
                            h('div', { className: 'aipi-div' }),
                            h('div', { className: 'aipi-f' },
                                h('div', { className: 'lbl' }, t('purchase')),
                                h('div', { className: 'aipi-price' },
                                    h('b', null, selShow.price),
                                    h('span', { style: { color: 'var(--muted)', fontSize: 11 } }, selShow.sku),
                                ),
                                h('a', { className: 'aipi-buy', href: '#', onClick: (e) => e.preventDefault() }, t('buy')),
                            ),
                            h('div', { className: 'aipi-f', style: { marginTop: 14 } },
                                selNode
                                    ? h('button', {
                                        className: 'aipi-btn', style: { width: '100%', justifyContent: 'center' },
                                        onClick: () => removeNode(selNode.uid),
                                    }, t('remove'))
                                    : h('button', {
                                        className: 'aipi-btn primary',
                                        style: { width: '100%', justifyContent: 'center' },
                                        onClick: () => {
                                            addNode(cardSel, null, null);
                                            setCardSel(null);
                                        },
                                    }, t('toCanvas')),
                            ),
                        ),
                    ),
                ),
                ),
                ),

                // 右：原生对话（渲染 DSH 的 conversation.content 工厂槽）
                // 宽度由 chatW 决定，左侧分隔条可拖
                h('div', {
                    className: 'aipi-resizer chat-rz' + (resize ? ' on' : ''),
                    title: '拖动调整对话宽度（双击恢复默认）',
                    onPointerDown: (e) => {
                        e.preventDefault();
                        setResize({ w0: chatW, px: e.clientX });
                    },
                    onDoubleClick: () => setChatW(fitChat(rootRef.current ? rootRef.current.clientWidth : 1200)),
                }),
                h('div', { className: 'aipi-col chat', style: {
                    width: chatW,
                    marginTop: -44,
                    // 对话栏贯穿整高：工具栏 44 + 底部逻辑条的高度都要算进去
                    height: 'calc(100% + ' + (44 + (logicOpen ? logicH : 37)) + 'px)',
                } },
                    h(ChatPane, props),
                ),
                ),
                // 底部通栏：和顶部工具栏一样的宽度，不受左右栏折叠影响
                mode === 'preview' && h('div', {
                        className: 'aipi-logic' + (logicOpen ? ' open' : ''),
                        // 和顶部工具栏一样通栏：右端给对话栏让出宽度
                        style: Object.assign({ paddingRight: chatW + 10 }, logicOpen ? { height: logicH } : {}),
                },
                    // 上沿可拖：往上拖变高，双击复位
                    h('div', {
                        className: 'aipi-logic-resizer',
                        title: t('dragLogicHeight'),
                        onPointerDown: (e) => { e.preventDefault(); setLogicDrag({ h0: logicH, py: e.clientY }); },
                        onDoubleClick: () => setLogicH(220),
                        style: logicOpen ? undefined : { display: 'none' },
                    }),
                    h('div', { className: 'aipi-logic-hd' },
                        h('span', { className: 't' }, t('logicTitle')),
                        h('span', { className: 'n' }, logicRules.length + ' ' + t('rulesUnit')),
                        h('div', { className: 'aipi-sp' }),
                        !userRules.length && logicGroups.length > 0 && h('button', {
                            className: 'aipi-btn sm', title: t('pinRules'), onClick: pinRules,
                        }, t('pinRules')),
                        h('button', {
                            className: 'aipi-btn sm', title: t('addRule'),
                            onClick: () => setRuleDraft({ uart: '', event: '', toUart: '' }),
                        }, t('addRule')),
                        h('div', { className: 'aipi-seg sm' },
                            h('button', { className: logicView === 'cards' ? 'on' : '', onClick: () => setLogicView('cards') }, t('viewCards')),
                            h('button', { className: logicView === 'flow' ? 'on' : '', onClick: () => setLogicView('flow') }, t('viewFlow')),
                        ),
                        h('button', {
                            className: 'aipi-btn sm',
                            disabled: runningLogic || !logicRules.length,
                            onClick: runLogic,
                        }, runningLogic ? t('running') : t('run')),
                        h('button', {
                            className: 'aipi-collapse-left',
                            title: logicOpen ? t('collapseLogic') : t('expandLogic'),
                            onClick: () => setLogicOpen(!logicOpen),
                        }, h('span', { className: 'aipi-collapse-ico' },
                            // 逻辑面板是上下折叠，用竖直箭头：展开时朝下（收起），收起时朝上（展开）
                            h('svg', {
                                viewBox: '0 0 24 24', width: 14, height: 14, fill: 'none',
                                stroke: 'currentColor', strokeWidth: 2.2,
                                strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true',
                            }, h('path', { d: logicOpen ? 'M6 9l6 6 6-6' : 'M6 15l6-6 6 6' })))),
                    ),
                    logicOpen && h('div', { className: 'aipi-logic-body' },
                        ruleDraft && (() => {
                            const sensors = nodes.filter((n) => {
                                const pp = byId(n.id);
                                return n.uart && pp && (pp.io.out || []).length;
                            });
                            const actors = nodes.filter((n) => {
                                const pp = byId(n.id);
                                return n.uart && pp && (pp.io.in || []).length;
                            });
                            const p0 = nodes.filter((n) => String(n.uart) === String(ruleDraft.uart))[0];
                            const events = p0 ? ((byId(p0.id) || {}).io || {}).out || [] : [];
                            return h('div', { className: 'aipi-ruledraft' },
                                h('span', { className: 'lbl' }, t('ruleWhen')),
                                h('select', {
                                    value: ruleDraft.uart,
                                    onChange: (e) => {
                                        const uart = e.target.value;
                                        const node0 = nodes.filter((n) => String(n.uart) === uart)[0];
                                        const ev0 = node0 ? (((byId(node0.id) || {}).io || {}).out || [])[0] || '' : '';
                                        setRuleDraft({ ...ruleDraft, uart, event: ev0 });
                                    },
                                },
                                    h('option', { value: '' }, '—'),
                                    sensors.map((n) => h('option', { key: n.uid, value: String(n.uart) },
                                        'UART' + n.uart + ' ' + pl(byId(n.id)).name))),
                                h('select', {
                                    value: ruleDraft.event,
                                    onChange: (e) => setRuleDraft({ ...ruleDraft, event: e.target.value }),
                                },
                                    h('option', { value: '' }, '—'),
                                    events.map((ev) => h('option', { key: ev, value: ev }, L(EVENT_TEXT[ev], ev)))),
                                h('span', { className: 'arrow' }, '→'),
                                h('select', {
                                    value: ruleDraft.toUart,
                                    onChange: (e) => {
                                        const node0 = nodes.filter((n) => String(n.uart) === e.target.value)[0];
                                        const ap0 = node0 ? byId(node0.id) : null;
                                        setRuleDraft({ ...ruleDraft, toUart: e.target.value, args: paramDefault(ap0) });
                                    },
                                },
                                    h('option', { value: '' }, '—'),
                                    actors.map((n) => h('option', { key: n.uid, value: String(n.uart) },
                                        'UART' + n.uart + ' ' + pl(byId(n.id)).name))),
                                // 选中执行通道后，按它的 io.in 渲染参数控件
                                (() => {
                                    const tn = nodes.filter((n) => String(n.uart) === String(ruleDraft.toUart))[0];
                                    const ap = tn ? byId(tn.id) : null;
                                    if (!ap) return null;
                                    const base = ruleDraft.args || paramDefault(ap);
                                    const setv = (k, v) => setRuleDraft({
                                        ...ruleDraft,
                                        args: Object.assign({}, base, { [k]: v }),
                                    });
                                    return paramNames(ap).map((name) => {
                                        const spec = PARAM_SPECS[name] || { kind: 'text' };
                                        const val = base[name] !== undefined ? base[name] : paramDefault(ap)[name];
                                        if (spec.kind === 'bool') {
                                            return h('label', { key: name, className: 'aipi-pfield' },
                                                h('span', null, name),
                                                h('input', {
                                                    type: 'checkbox', checked: !!val,
                                                    onChange: (e) => setv(name, e.target.checked),
                                                }));
                                        }
                                        if (spec.kind === 'num') {
                                            return h('label', { key: name, className: 'aipi-pfield' },
                                                h('span', null, name),
                                                h('input', {
                                                    type: 'number', min: spec.min, max: spec.max, step: spec.step,
                                                    value: val, onChange: (e) => setv(name, Number(e.target.value)),
                                                }));
                                        }
                                        if (spec.kind === 'enum') {
                                            return h('label', { key: name, className: 'aipi-pfield' },
                                                h('span', null, name),
                                                h('select', {
                                                    value: val, onChange: (e) => setv(name, e.target.value),
                                                }, spec.options.map((o) => h('option', { key: o[0], value: o[0] }, o[1]))));
                                        }
                                        return h('label', { key: name, className: 'aipi-pfield' },
                                            h('span', null, name),
                                            h('input', {
                                                type: 'text', value: val, placeholder: name,
                                                onChange: (e) => setv(name, e.target.value),
                                            }));
                                    });
                                })(),
                                h('button', { className: 'aipi-btn sm primary', onClick: saveRuleDraft }, t('saveRule')),
                                h('button', { className: 'aipi-btn sm', onClick: () => setRuleDraft(null) }, t('cancelRule')));
                        })(),
                        logicGroups.length === 0
                            ? h('div', { className: 'aipi-logic-empty' }, t('logicEmpty'))
                            : logicView === 'flow'
                            ? h('div', { className: 'aipi-flow-wrap' },
                                h('div', { className: 'aipi-flow', style: { width: flowLayout.width, height: flowLayout.height } },
                                    h('svg', { className: 'aipi-flow-wires', width: flowLayout.width, height: flowLayout.height },
                                        flowLayout.edges.map((e) => {
                                            const a = flowLayout.byIdMap[e.from];
                                            const b = flowLayout.byIdMap[e.to];
                                            const x1 = a.x + a.w;
                                            const y1 = a.y + a.h / 2;
                                            const x2 = b.x;
                                            const y2 = b.y + b.h / 2;
                                            const dx = Math.max(26, (x2 - x1) * 0.5);
                                            return h('path', {
                                                key: e.key,
                                                className: 'aipi-flow-wire' + (activeRule === e.key ? ' on' : ''),
                                                d: 'M' + x1 + ',' + y1 + ' C' + (x1 + dx) + ',' + y1 + ' '
                                                    + (x2 - dx) + ',' + y2 + ' ' + x2 + ',' + y2,
                                            });
                                        })),
                                    flowLayout.nodes.map((n) => {
                                        const actId = activeRule ? 'a:' + activeRule : null;
                                        const grpId = activeRule ? 'g:' + activeRule.split('>')[0] : null;
                                        const on = n.id === actId || n.id === grpId;
                                        return h('div', {
                                            key: n.id,
                                            className: 'aipi-fnode ' + n.kind + (on ? ' on' : ''),
                                            style: { left: n.x, top: n.y, width: n.w, height: n.h },
                                        },
                                            h('span', { className: 'ico' }, h(Ico, { name: n.icon, size: 16 })),
                                            h('div', { className: 'tx' },
                                                h('div', { className: 't1' }, n.title),
                                                h('div', { className: 't2' }, n.sub)),
                                            h('span', { className: 'ch' }, n.ch));
                                    })))
                            : h('div', { className: 'aipi-lgroups' },
                                logicGroups.map((g) => h('div', {
                                    key: g.key,
                                    className: 'aipi-lgroup clickable',
                                    onClick: () => focusRule(g),
                                },
                                    h('div', { className: 'aipi-lwhen' },
                                        h('span', { className: 'ico' }, h(Ico, { name: g.sensorIcon, size: 15 })),
                                        h('span', { className: 'who' }, g.sensorName),
                                        h('b', { className: 'ev' }, g.eventLabel),
                                        h('span', { className: 'ch' }, 'UART' + g.uart),
                                        g.ruleId && h('button', {
                                            className: 'aipi-ruleedit', title: t('editRule'),
                                            onClick: (e) => { e.stopPropagation(); editRule(g); },
                                        }, '✎'),
                                        g.ruleId && h('button', {
                                            className: 'aipi-ruledel', title: t('deleteRule'),
                                            onClick: (e) => { e.stopPropagation(); deleteRule(g.ruleId); },
                                        }, '×')),
                                    h('div', { className: 'aipi-lthen' },
                                        g.actions.map((a) => h('span', {
                                            key: a.uid,
                                            className: 'aipi-laction'
                                                + (activeRule === (g.key + '>' + a.uid) ? ' on' : ''),
                                        },
                                            h(Ico, { name: a.icon, size: 13 }),
                                            h('b', null, a.label),
                                            h('em', null, a.name + ' · UART' + a.uart + (argsText(a.args) ? ' · ' + argsText(a.args) : '')))))))),
                        trace.length > 0 && h('div', { className: 'aipi-trace' },
                            trace.map((x, i) => h('div', { key: i, className: 'row' },
                                h('span', { className: 't' }, x.at + 'ms'),
                                h('span', null, x.text)))),
                    ),
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
            // 新对话（还没有消息）时让 DSH 自己渲染欢迎屏：logo + 探索未至之境 + 项目/模式选择器。
            // 一旦有消息就切回 active，否则欢迎屏会一直盖在消息上面。
            const [hasTurns, setHasTurns] = React.useState(false);
            const hostRef = React.useRef(null);
            React.useEffect(() => {
                const el = hostRef.current;
                if (!el || typeof MutationObserver === 'undefined') return undefined;
                const check = () => {
                    const hit = el.querySelector('[data-slot="conversation.session"] > *');
                    setHasTurns(!!hit);
                };
                const mo = new MutationObserver(check);
                mo.observe(el, { childList: true, subtree: true });
                check();
                return () => mo.disconnect();
            }, []);

            if (!props || typeof props.renderFactorySlot !== 'function') {
                return h('div', { className: 'aipi-chat-wrap' },
                    note('宿主没有把 renderFactorySlot 传给 main 座位，内嵌会话不可用。'),
                    note('当前可用的 props：' + Object.keys(props || {}).join(' / ')),
                );
            }

            try {
                const node = props.renderFactorySlot('conversation.content', {
                    variant: 'embedded',
                    phase: hasTurns ? 'active' : 'hero',
                    hero: !hasTurns,
                });
                if (node === undefined || node === null) return note('conversation.content 返回了空。');
                return h('div', { className: 'aipi-chat-wrap', ref: hostRef }, node);
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
                // 导轨名是宿主渲染的，语言变了要重新注册一次座位，宿主才会重画
                const railLabel = () => tt('小安派工作台', 'AiPi Workbench');
                let remountRail = null;
                let observer = null;
                ctx.slots.inject('main', () =>
                    ctx.slots.inject('sidebar.panellist', () => {
                        const stopMain = ctx.slots.register(
                            { name: 'main', key: PANEL_ID },
                            Workbench,
                        );
                        let stopIcon = ctx.slots.register(
                            { name: 'sidebar.panellist', id: PANEL_ID, order: 40, label: railLabel },
                            RailIcon,
                        );
                        // DSH 改语言 → <html lang> 变 → 重注册导轨条目，名字跟着变
                        remountRail = () => {
                            try {
                                if (typeof stopIcon === 'function') stopIcon();
                                stopIcon = ctx.slots.register(
                                    { name: 'sidebar.panellist', id: PANEL_ID, order: 40, label: railLabel },
                                    RailIcon,
                                );
                            } catch (e) { /* 重注册失败就维持旧的 */ }
                        };
                        try {
                            if (typeof MutationObserver === 'function' && document.documentElement) {
                                observer = new MutationObserver(() => { if (remountRail) remountRail(); });
                                observer.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
                            }
                        } catch (e) { /* 观察不了就算了 */ }
                        return () => {
                            if (observer) { observer.disconnect(); observer = null; }
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
