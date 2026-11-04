# 小安派创意工作台 · AiPi Idea Workbench

安信可「小安派」创意工作台，以 **DSH 插件**形态提供：装进 DeepSeek Harness 桌面端后，在左侧导轨多一个入口，点开占满主区域的编排工作台。

> AiPi = 小安派，安信可的开源硬件品牌线。

## 它长什么样

```
┌ 硬件插件库 ┬──────── 工作区 ────────┬ 属性 ┐
│ 主机 · 底座 │ 预览 | 代码  连接 支持 下发 │ 作者 │
│ 分类筛选    │                            │ 购买 │
│ 卡片×8      │      可拖拽的编排画布        │ 能力 │
└────────────┴────────────────────────────┴──────┘
```

- **左栏**：主机（AiPi-NodeMCU-Hub）单独置顶，下面按分类（传感器 / 控制类 / 电机类 / AI语音）排列硬件插件，每张卡是「预览图 + 底部名字」。
- **中间**：顶部左边「预览 | 代码」切换，右边「连接设备 / 支持 / 下发到设备」；下面是画布，把左侧卡片拖进来，从节点右侧圆点拉线到另一个节点即可连接。
- **右栏**：选中节点后显示作者、能力、可下发参数、价格与购买方式。

## 目录结构

```
AiPi-IdeaWorkbench/
├─ index.js            宿主半边（Host）：目前只做装配日志，预留串口/校验/下发
├─ lib/client.js       浏览器半边（Client）：整块工作台界面，手写 bundle，无构建
├─ cordis.patch.yml    bundle patch：往 profile 里插一条 loader 行
├─ package.json        dsh.bundle / dsh.client 声明
└─ assets/             预留（截图等）
```

## 怎么装进 DSH

插件是标准的三件套：`package.json` 的 `dsh.bundle.patch` + `dsh.client`、一条 `cordis.patch.yml` 插入行、一个能被模块加载器接住的 `lib/client.js`。

**装到哪个 profile**：`desktop`（Electron 桌面端）这名字由 Electron 把持，CLI 明确拒绝对它做插件管理。所以本地联调一律用 `web` profile，装好后用 `dsh web` 打开验证；要进桌面端，走「自有 fork 在构建期打包」这条路（见项目文档《上位机软件》§2.2）。

```sh
# 1) 本地连到 web profile（pnpm 转发）
dsh plugin --profile web add "D:\Users\Seahi\Desktop\项目文档\下一代开源硬件\AiPi-IdeaWorkbench"

# 2) 把包名加进 profile 的 bundles
#    %DSH_HOME%\profiles\web\package.json → dsh.profile.bundles 里加 "aipi-idea-workbench"

# 3) 起 web
dsh web
```

## 开发

客户端 `lib/client.js` 是**手写 bundle**：没有 `import`/`export`、没有 JSX、没有构建步骤。整份文件包在

```js
window.__ModuleLoader__.load({ id: 'aipi-idea-workbench', factory: (require) => { ... } })
```

里，只能用 `require('react')`。改完存盘，配合宿主的客户端插件 HMR 可以直接刷新面板；没有 HMR 就刷新页面。

生成单文件预览页（不启动 DSH 也能看界面）：

```sh
# 用 DSH 的 preview 工具，或手工：
# preview gen(plugin=<本目录>) → assets/preview.html
```

## 现在做到哪一步（诚实版）

**真的能用**：拖拽加节点、连线、选中、属性面板、预览/代码切换、静态校验 8 条、模拟设备连接与下发进度、主机唯一性约束。

**还是假的**：
- 设备连接与下发**全是模拟**，没有真串口——浏览器拿不到 COM 口，必须由宿主半边提供串口服务；
- 能力清单是内置目录（能力名与 `06_工程资产/v0/data/registry.json` 同源），**没有真正枚举底板插件**；
- 代码页的 DSL 是由画布关系即时拼的骨架，**不是真正的编译器输出**；
- 除主机与雷达/灯/语音外的 5 个插件是占位条目，作者与价格均为示例。

这些都要等宿主半边接上串口、注册表、校验与仿真之后才有意义——不要在演示里说成已完成。

## 许可

MIT
