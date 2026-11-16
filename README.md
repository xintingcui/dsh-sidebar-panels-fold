# dsh-sidebar-panels-fold

Sidebar **global-panel row** presentation patch for DeepSeek Harness.
把侧边栏左上角的全局面板条目折叠成一行，并可勾选「只显示哪几个」。手机端与桌面端同一套规则。

三件事，彼此独立，任一边找不到目标都只降级自己那一半：

1. **侧栏面板折叠**（`sidebar.panellist`）—— 原能力。
2. **标题栏操作收容**（`conversation.session.header.actions`）—— 原地展开。
3. **左侧工作区悬浮**（`sidebar.workspaces`）—— v1.3.0 新增，设置里开关，默认关闭。

- 不改核心、不改其它插件：始终通过 slot 数据与 DOM 属性工作，不注册、不覆盖宿主槽位。
- 只控制**显示与几何**：被收起的条目仍然注册、仍然可以按 id 选中，插件功能完全不变。

## 为什么需要

宿主 `@deepseek-ai/dsh-client-ui-sidebar` 的渲染是：

```
div.root
├─ button.newSession
├─ nav.panelList          ← 全局面板条目（flex:none，撑住下方区域）
├─ div.regionArea         ← 工作区/会话区（flex:1, overflow:hidden）
└─ div.footArea
```

`nav.panelList` 是 `flex:none`，条目越多它越高，`regionArea` 就被压得越小 ——
手机上抽屉本身很矮，条目一多直接把工作区挤没了。桌面端条目数一样，只是相对没那么明显。

## 工作机制

1. **数据面** `ctx.slots.entriesOfSlot('sidebar.panellist')` 读权威清单
   `[{ id, order, label }]`（label 支持 thunk，跟随语言）。
2. **定位面** `findNav()` 三级策略，见下表。
3. **呈现面** 给每个行 `<button>` 打 `data-dsh-pf-row` / `data-dsh-pf-id` /
   `data-dsh-pf-shown="0|1"`，本插件自己的 `<style>` 用
   `[data-dsh-pf-row][data-dsh-pf-shown="0"]{display:none!important}` 收起。
4. **交互面** 在 `nav` 末尾挂一个自有触发器（`data-dsh-pf-trigger`），点开是自建弹层：
   全部显示 / 全部收起 / 恢复默认 / 逐项勾选。选择存 `localStorage`。
5. **守护面** `MutationObserver`（React 重渲染会抹掉属性）+ `ResizeObserver` +
   `matchMedia`：手机抽屉↔桌面常驻列、宽态↔56px 轨道、语言切换、面板动态注册后都会重新收敛。

## 定位策略（选择器会随构建变化，属性不会）

| 级别 | 依据 | 说明 |
| --- | --- | --- |
| L1 | `nav[data-dsh-pf-nav]` | 本插件自己打的标记，命中即复用 |
| L2 | `nav` 的直接子 `<button>` 的 `aria-label` ∩ 槽位 label 集合 | 分数最高者胜；label 来自同一份槽位数据，天然跟随语言 |
| L3 | 结构兜底 | 父级 `flex` 且 `flex-direction:column`、自身 ≥2 个直接 button 子节点、且存在 `overflow:hidden` 的兄弟 → 唯一命中才采用 |

**不使用任何 CSS Module 哈希类名**（如 `hHd-Xa_panelList`）：那是构建产物，随时会变。

## 策略与默认值

自动模式（未做显式选择时）保留前 N 条：

| 形态 | 判定 | 保留 |
| --- | --- | --- |
| 轨道（rail） | `nav` 宽度 ≤ 72px | 3 |
| 窄屏 | `matchMedia('(max-width: 1023px)')` 命中 | 2 |
| 宽屏 | 其余 | 4 |

当前正在使用的面板（`aria-current="page"`）**永远可见**，避免「面板在用、行却不见了」。

## 标题栏操作收容

宿主的 `conversation.session.header.actions`（标题右侧那排）是 `flex:none`，条目一多就把
`Dc7zOa_titleRow` 里的标题挤成一条缝。本插件只对**这一槽**动手：

| 面 | 做法 |
| --- | --- |
| 定位 | `[data-slot="conversation.session.header.actions"]` —— 渲染器给每个 outlet 打的 `data-slot`，不随构建变化 |
| 判据 | 只收「条目自身渲染出了 `<button>`」的；`agent-preset` 是纯文本 `span`、`dsh-rewind-portals` 只挂 portal，二者都不含按钮，因此不被误收 |
| 收起 | 打 `data-dsh-pf-hdr-hidden="1"`，本插件 `<style>` 用 `display:none` 隐藏 |
| 展开 | 原地展开：把隐藏标记改回 `"0"`，条目回到正常布局 |
| 交互 | 在该槽之后插一个自有箭头按钮，点一下收起/展开，状态存 `localStorage` |
| 安全阀 | 没有任何可收条目时触发器自动隐藏，标题栏保持原样 |

只改显示属性，**不移动、不克隆、不悬浮任何节点**，因此 React fiber 与事件完好，
按钮点击行为与宿主原生完全一致。

> 曾尝试过「悬浮弹层」方案（把原条目 `position:fixed` 覆在一块背景板上，
> 以便展开时不挤压标题），因实际运行有 bug 已撤回。当前实现为原地展开。

左侧的 `标准模式`（`agent-preset`）与右端的 utilities **完全不碰**。

## 左侧工作区悬浮（v1.3.0）

设置 → 通用 里有开关「左侧工作区悬浮」，**默认关闭**（不改变任何既有行为）。

| 面 | 做法 |
| --- | --- |
| 定位 | `[data-slot="sidebar.workspaces"]` —— 该槽的锚点，不依赖任何类名 |
| 做法 | 给锚点打 `data-dsh-pf-ws-float="1"`，用 `position:fixed` 脱流浮起；几何按父级 `regionArea` 的实时矩形写入 |
| 不占位 | 脱流后 `regionArea` 仍由自身 `flex:1` 撑高，**不写任何占位高度**（写死会逐帧膨胀） |
| 轨道态 | 侧栏折叠成 56px 轨道时（宽 < 120px）自动不悬浮，避免浮出空壳 |
| 跟随 | 独立 `ResizeObserver` 观察 `regionArea`，折叠/拖宽/抽屉开关后自动重新贴合 |
| 还原 | 关开关或卸载即摘掉属性和全部内联几何，恢复宿主原样 |

### 为什么这样算「安全悬浮」

- **不移动节点**：脱流的只是槽锚点自身，`dsh-better-workspace` 的根仍在该锚点下，父级不变。
- **不克隆**：没有 `cloneNode`，React fiber 与事件绑定完好。
- **不遮蔽槽位**：本插件**不注册** `sidebar.workspaces`。该槽是 `single` 且 `replaceRisk:
  shadows-shipped-ui`，已被 `dsh-better-workspace` 占位；一旦注册就顶掉它。
- **不改它的类名/属性/样式**：工作区插件的节点上一个属性、一条内联样式都不会被本插件写入。

### 与工作区相关插件的关系

| 插件 | 关系 | 风险 |
| --- | --- | --- |
| `dsh-better-workspace` | 占 `sidebar.workspaces`，是浮起的那个面板 | 低：只改锚点几何，它的 fiber/类名/事件不变 |
| `dsh-better-sidebar` | 提供左栏外壳、`chat`/`files` 等右侧标签页 | 低：实测不读写左栏 DOM（无 `regionArea`/`panelList` 引用） |
| `dsh-session-manager` | 改会话标题、归档、移动 | 低：作用于数据与 header，不碰本槽几何 |

已核实 `dsh-better-workspace` 全文无 `createPortal`、仅 2 处 `getBoundingClientRect`，不依赖左栏绝对几何。

## 存储

`localStorage['dsh.sidebar-panels-fold.v1'] = { pinned: string[] | null, showAll: boolean }`

- `pinned: null` → 自动模式
- `pinned: string[]` → 只显示这些 id
- `showAll: true` → 全部显示

`localStorage['dsh.sidebar-panels-fold.header.v1'] = { collapsed: boolean }`（缺省 `collapsed: true`，标题优先）

`localStorage['dsh.sidebar-panels-fold.workspace.v1'] = { float: boolean }`（缺省 `float: false`，即不悬浮）

读失败（隐私模式/脏数据）一律回落默认，不影响页面。
读失败（隐私模式/脏数据）一律回落默认，不影响页面。

## 降级

- 4 秒内找不到 `nav`：不隐藏任何条目（页面行为 = 原样），期间低频重试。
- 超过宽限期仍找不到：`console.warn` 一次，说明「折叠能力暂不可用，其余不受影响」。
- 找不到标题栏 actions 槽：头部收容静默跳过，侧边栏折叠照常工作；反之亦然。
- `localStorage` 不可用：选择只在本次会话生效。

## 卸载

移除触发器/弹层/`<style>`，并摘掉所有 `data-dsh-pf-*` 属性 —— 侧边栏与标题栏都回到宿主原样。

## 自检

```bash
node header-fold-check.mjs      # 17 项：头部判据 / 排除 / 只改显示 / 防回退
node workspace-float-check.mjs  # 20 项：悬浮判据 / 不动结构 / 不遮蔽槽位 / 还原 / 默认关闭
```

## 目录

```
package.json        dsh.bundle.patch + dsh.client（platform:web, immediately:true）
cordis.patch.yml    插入一条 Loader 条目
index.js            宿主半边（空实现，满足装载契约）
client.js           全部逻辑（浏览器半边）
locale/{zh,en}.json 插件列表里的标题/描述
icon.svg            插件图标
header-fold-check.mjs     头部收容的开发期自检
workspace-float-check.mjs 工作区悬浮的开发期自检
```
