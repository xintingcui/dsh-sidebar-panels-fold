# dsh-sidebar-panels-fold

Sidebar **global-panel row** presentation patch for DeepSeek Harness.
把侧边栏左上角的全局面板条目折叠成一行，并可勾选「只显示哪几个」。手机端与桌面端同一套规则。

- 不改核心、不改其它插件：始终通过 slot 数据与 DOM 属性工作，不注册、不覆盖任何 slot。
- 只控制**显示**：被收起的条目仍然注册、仍然可以按 id 选中，插件功能完全不变。

## 安装

```bash
dsh plugin add github:xintingcui/dsh-sidebar-panels-fold
```

或在插件市场的 UI / 界面增强分类里直接装。仓库是纯 JS，无构建步骤、无运行时依赖。

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

## 存储

`localStorage['dsh.sidebar-panels-fold.v1'] = { pinned: string[] | null, showAll: boolean }`

- `pinned: null` → 自动模式
- `pinned: string[]` → 只显示这些 id
- `showAll: true` → 全部显示

读失败（隐私模式/脏数据）一律回落默认，不影响页面。

## 降级

- 4 秒内找不到 `nav`：不隐藏任何条目（页面行为 = 原样），期间低频重试。
- 超过宽限期仍找不到：`console.warn` 一次，说明「折叠能力暂不可用，其余不受影响」。
- `localStorage` 不可用：选择只在本次会话生效。

## 卸载

移除触发器/弹层/`<style>`，并摘掉所有 `data-dsh-pf-*` 属性 —— 侧边栏回到宿主原样。

## 自检

```bash
node smoke-test.mjs     # 最小 DOM 桩下的 17 项断言（不依赖浏览器）
```

## 目录

```
package.json        dsh.bundle.patch + dsh.client（platform:web, immediately:true）
cordis.patch.yml    插入一条 Loader 条目
index.js            宿主半边（空实现，满足装载契约）
client.js           全部逻辑（浏览器半边）
locale/{zh,en}.json 插件列表里的标题/描述
icon.svg            插件图标
smoke-test.mjs      开发期自检，不随插件发布
```
