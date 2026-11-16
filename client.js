/**
 * dsh-sidebar-panels-fold — 侧边栏「全局面板条目」呈现层补丁（浏览器半边）
 *
 * 目标：DeepSeek Harness 侧边栏左上角的 panelList（`sidebar.panellist` 槽，当前实测 8 条：
 * plugins / schedules / dsh-context / task-board / skill-explorer / mnemon / mcp-connector /
 * ig5-workbench-panel）。条目一多，它就以 `flex:none` 顶住 `regionArea`（工作区），
 * 手机抽屉与 PC 常驻列同样中招。
 *
 * 做法（最小侵入，不碰核心逻辑、不碰其它插件）：
 *   1. 数据面：从 `ctx.slots.entriesOfSlot('sidebar.panellist')` 读权威清单（id/order/label）。
 *   2. 呈现面：只给已渲染的 <button> 行打 `data-dsh-pf-shown="0"`，由本插件自己的
 *      <style> 用 `display:none` 收起；不卸载、不 shadowing、不改任何注册。
 *   3. 交互面：在 nav 末尾挂一个自有的「更多 / 全局面板」触发器，点开是我们自己的
 *      弹层（全部显示 / 全部收起 / 逐项勾选），选择结果存 localStorage。
 *   4. 守护面：MutationObserver（React 重渲染会抹掉属性）+ ResizeObserver + matchMedia，
 *      保证手机抽屉↔PC 常驻列、宽态↔56px 轨道、语言切换、面板动态注册后都重新收敛。
 *   5. 兜底：找不到 nav 就一行都不隐藏（页面行为 = 原样），控制台只告警一次，并持续重试。
 *
 * 卸载 = 移除触发器/弹层/style、摘掉所有本项目写入的属性，侧边栏恢复原样。
 */

window.__ModuleLoader__.load({
  id: 'dsh-sidebar-panels-fold',
  factory(require) {
    const NS = 'dsh-sidebar-panels-fold';
    const STORAGE_KEY = 'dsh.sidebar-panels-fold.v1';
    const STYLE_ID = 'dsh-sidebar-panels-fold/style';
    const NAV_ATTR = 'data-dsh-pf-nav';
    const ROW_ATTR = 'data-dsh-pf-row';
    const SHOWN_ATTR = 'data-dsh-pf-shown';
    const ID_ATTR = 'data-dsh-pf-id';
    const TRIGGER_ATTR = 'data-dsh-pf-trigger';

    /* 顶部标题栏：只收容「含按钮」的条目，左侧标签与右侧 utilities 不碰。 */
    const HEADER_SLOT = 'conversation.session.header.actions';
    const HEADER_ANCHOR = `[data-slot="${HEADER_SLOT}"]`;
    const HDR_HIDDEN_ATTR = 'data-dsh-pf-hdr-hidden';
    const HDR_TRIGGER_ATTR = 'data-dsh-pf-hdr-trigger';
    const HDR_STORAGE_KEY = 'dsh.sidebar-panels-fold.header.v1';
    /** 超过这个高度的条目视为面板而非按钮行，永不收起。 */
    const HEADER_ROW_MAX_PX = 96;

    /* 左侧工作区悬浮：把 `sidebar.workspaces` 的槽锚点整体脱流，原位留占位。
       只改样式，不移节点、不克隆、不遮蔽槽位 —— 工作区插件（dsh-better-workspace）
       的 fiber、类名、事件、对外行为全部不变。 */
    const WS_SLOT = 'sidebar.workspaces';
    const WS_ANCHOR = `[data-slot="${WS_SLOT}"]`;
    const WS_SHELL_ATTR = 'data-dsh-pf-ws-shell';
    const WS_FLOAT_ATTR = 'data-dsh-pf-ws-float';
    const WS_STORAGE_KEY = 'dsh.sidebar-panels-fold.workspace.v1';

    /** 断点与 layout 包的 SIDEBAR_AUTO_COLLAPSE 保持一致（窄屏 = 抽屉式侧边栏）。 */
    const NARROW_QUERY = '(max-width: 1023px)';
    const RAIL_MAX_PX = 72;

    /** 自动模式的可见条数上限：窄屏更激进，桌面留一点常用项。 */
    const AUTO_LIMIT = { narrow: 2, wide: 4, rail: 3 };

    /** 定位失败时的宽限期 / 低频重试节奏（毫秒）。 */
    const MISSING_GRACE_MS = 4000;
    const MISSING_RETRY_MS = 400;
    const MISSING_MAX_RETRY = 10;

    const zh = {
      'trigger.manage': '全局面板',
      'trigger.more': '还有 {count} 个面板',
      'pop.title': '侧边栏面板显示',
      'pop.hint': '勾选的条目会留在左上角，其余收起。只改变显示，不影响插件运行。',
      'pop.showAll': '全部显示',
      'pop.hideAll': '全部收起',
      'pop.reset': '恢复默认',
      'pop.empty': '当前没有可控制的面板条目。',
      'pop.close': '关闭',
      'pop.active': '当前',
      'pop.unknown': '未登记条目',
      'header.expand': '展开顶部操作（{count} 项）',
      'header.collapse': '收起顶部操作',
      'settings.floatWorkspace': '左侧工作区悬浮',
      'settings.floatWorkspaceHint': '把左侧的工作区/会话浏览区浮在一层之上，原位保留占位；不改动工作区插件的任何行为。'
    };
    const en = {
      'trigger.manage': 'Global panels',
      'trigger.more': '{count} more panels',
      'pop.title': 'Sidebar panel visibility',
      'pop.hint': 'Checked panels stay in the top-left list; the rest fold away. Display only — plugins keep running.',
      'pop.showAll': 'Show all',
      'pop.hideAll': 'Hide all',
      'pop.reset': 'Reset to default',
      'pop.empty': 'No panel entries to manage right now.',
      'pop.close': 'Close',
      'pop.active': 'Current',
      'pop.unknown': 'Unlisted entry',
      'header.expand': 'Show header actions ({count})',
      'header.collapse': 'Collapse header actions',
      'settings.floatWorkspace': 'Float workspace browser',
      'settings.floatWorkspaceHint': 'Lifts the workspace/session browser onto its own layer with a placeholder left in place. No workspace plugin behaviour changes.'
    };

    /* ------------------------------------------------------------------ *
     * 样式：只选择本插件自己打上的属性，不依赖任何 CSS Module 哈希类名。
     * 这是「选择器失效」时最关键的降级设计：哈希前缀随构建变化，属性不会。
     * ------------------------------------------------------------------ */
    const CSS = `
/* 收起的行：仅本插件写入的 data-dsh-pf-shown="0" 生效 */
[${ROW_ATTR}][${SHOWN_ATTR}="0"]{display:none!important}

/* 工作区悬浮：锚点脱流浮起。原区域由 regionArea 的 flex:1 自己撑高，
   所以不写任何占位高度（写死会逐帧膨胀）。宽度/位置由脚本按实时矩形写入。 */
[${WS_ANCHOR}][${WS_FLOAT_ATTR}="1"]{
  position:fixed!important;z-index:2147482990!important;
  margin:0!important;overflow:auto!important;
  border-radius:12px;
  border:1px solid var(--dsw-alias-border-l2);
  background:var(--dsw-alias-bg-layer-1);
  box-shadow:0 18px 44px rgba(0,0,0,.32);
}

/* 顶部操作：被收容的条目直接隐藏，绝不移出 DOM（React 持有它们） */
[${HDR_HIDDEN_ATTR}="1"]{display:none!important}

/* 顶部触发器：与 header 里的小图标按钮同尺寸同色 */
button[${HDR_TRIGGER_ATTR}]{
  box-sizing:border-box;flex:none;width:28px;height:28px;padding:0;
  display:inline-flex;align-items:center;justify-content:center;
  color:var(--dsw-alias-label-secondary);background:0 0;
  border:1px solid transparent;border-radius:var(--dsw-radius-md);
  cursor:pointer;-webkit-tap-highlight-color:transparent;touch-action:manipulation;
}
button[${HDR_TRIGGER_ATTR}]:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
button[${HDR_TRIGGER_ATTR}]:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}
button[${HDR_TRIGGER_ATTR}][aria-expanded="true"]{background:var(--dsw-alias-interactive-bg-active);color:var(--dsw-alias-label-primary)}
button[${HDR_TRIGGER_ATTR}] svg{display:block;flex:none;pointer-events:none}

/* 设置行：通用设置区只堆行，内部排版由本插件负责 */
.pf-setting-row{
  display:flex;align-items:flex-start;gap:10px;
  padding:8px 0;cursor:pointer;
  font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary);
}
.pf-setting-row input{
  width:15px;height:15px;flex:none;margin:2px 0 0;
  accent-color:var(--dsw-alias-brand-primary);
}
.pf-setting-row .pf-setting-text{display:flex;flex-direction:column;gap:2px;min-width:0}
.pf-setting-row .pf-setting-hint{
  font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);
}

/* 触发器：尽量与宿主 panelRow 的度量对齐（36px 行高 / radius-md / hover 令牌） */
button[${TRIGGER_ATTR}]{
  box-sizing:border-box;width:calc(100% - 4px);min-height:32px;margin:2px;padding:5px 8px;
  display:flex;align-items:center;gap:8px;
  font:inherit;font-size:13px;line-height:20px;text-align:left;
  color:var(--dsw-alias-label-secondary);
  background:0 0;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);
  cursor:pointer;-webkit-tap-highlight-color:transparent;touch-action:manipulation;
}
button[${TRIGGER_ATTR}]:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
button[${TRIGGER_ATTR}]:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}
button[${TRIGGER_ATTR}][data-dsh-pf-rail="1"]{
  width:36px;height:36px;min-height:36px;margin:0;padding:0;justify-content:center;
  border-style:solid;border-color:transparent;color:var(--dsw-alias-label-primary);
}
button[${TRIGGER_ATTR}][data-dsh-pf-rail="1"] .pf-label{display:none}
button[${TRIGGER_ATTR}] .pf-badge{
  margin-left:auto;flex:none;min-width:18px;height:16px;padding:0 4px;
  display:inline-flex;align-items:center;justify-content:center;
  font-size:10px;line-height:16px;border-radius:8px;
  background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary);
}
button[${TRIGGER_ATTR}][data-dsh-pf-rail="1"] .pf-badge{display:none}
button[${TRIGGER_ATTR}] svg{flex:none;display:block}

/* 弹层：fixed + body 直挂，脱离侧边栏的 overflow:hidden 与 transform 语境 */
[data-dsh-pf-pop]{
  position:fixed;z-index:2147483000;box-sizing:border-box;
  width:min(320px,calc(100vw - 24px));max-height:min(64vh,460px);overflow:auto;
  padding:10px;border-radius:14px;
  border:1px solid var(--dsw-alias-border-l2);
  background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);
  box-shadow:0 12px 32px rgba(0,0,0,.28);
  font-family:inherit;font-size:13px;line-height:20px;
  -webkit-overflow-scrolling:touch;
}
[data-dsh-pf-pop] .pf-head{
  display:flex;align-items:center;gap:8px;padding:2px 2px 8px;
  font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary);
}
[data-dsh-pf-pop] .pf-head .pf-close{
  margin-left:auto;width:26px;height:26px;display:inline-flex;align-items:center;justify-content:center;
  border:none;border-radius:8px;background:0 0;color:var(--dsw-alias-label-secondary);cursor:pointer;
  touch-action:manipulation;
}
[data-dsh-pf-pop] .pf-head .pf-close:hover{background:var(--dsw-alias-interactive-bg-hover)}
[data-dsh-pf-pop] .pf-quick{display:flex;flex-wrap:wrap;gap:6px;padding:0 2px 8px}
[data-dsh-pf-pop] .pf-quick button{
  flex:1 1 auto;min-height:30px;padding:4px 10px;font:inherit;font-size:12px;
  color:var(--dsw-alias-label-primary);background:0 0;cursor:pointer;
  border:1px solid var(--dsw-alias-border-l2);border-radius:8px;touch-action:manipulation;
}
[data-dsh-pf-pop] .pf-quick button:hover{background:var(--dsw-alias-interactive-bg-hover)}
[data-dsh-pf-pop] .pf-list{display:flex;flex-direction:column;gap:2px;padding:0}
[data-dsh-pf-pop] .pf-row{
  display:flex;align-items:center;gap:8px;min-height:34px;padding:4px 6px;border-radius:8px;
  cursor:pointer;touch-action:manipulation;
}
[data-dsh-pf-pop] .pf-row:hover{background:var(--dsw-alias-interactive-bg-hover)}
[data-dsh-pf-pop] .pf-row input{width:15px;height:15px;flex:none;margin:0;accent-color:var(--dsw-alias-brand-primary)}
[data-dsh-pf-pop] .pf-row .pf-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
[data-dsh-pf-pop] .pf-row .pf-id{
  margin-left:auto;flex:none;font-size:11px;color:var(--dsw-alias-label-tertiary);
  font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
}
[data-dsh-pf-pop] .pf-row .pf-active{
  flex:none;font-size:10px;padding:0 5px;border-radius:6px;
  background:var(--dsw-alias-interactive-bg-active);color:var(--dsw-alias-label-secondary);
}
[data-dsh-pf-pop] .pf-note{
  margin:8px 2px 0;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary);
}
@media (prefers-reduced-motion:no-preference){
  button[${TRIGGER_ATTR}],[data-dsh-pf-pop]{transition:background-color .12s ease,color .12s ease}
}
`.trim();

    /* ------------------------------------------------------------------ *
     * 小工具
     * ------------------------------------------------------------------ */
    const resolveLabel = (label) => (typeof label === 'function' ? safe(label) : label);
    function safe(fn) {
      try {
        return fn();
      } catch {
        return undefined;
      }
    }

    function readState() {
      const fallback = { pinned: null, showAll: false };
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (raw === null) return fallback;
        const parsed = JSON.parse(raw);
        if (parsed === null || typeof parsed !== 'object') return fallback;
        // `pos:N` 是运行时兜底 id（槽位清单缺失时按位置反推），不具跨会话意义，
        // 读回来会造成「勾了却什么都没显示」，因此读取时就丢掉。
        const pinned = Array.isArray(parsed.pinned)
          ? parsed.pinned.filter((id) => typeof id === 'string' && !id.startsWith('pos:'))
          : null;
        return { pinned, showAll: parsed.showAll === true };
      } catch {
        // 隐私模式 / 配额 / 脏数据：一律回落到默认，绝不因为存储炸掉侧边栏
        return fallback;
      }
    }

    function writeState(state) {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      } catch {
        /* 存不下就只在本次会话生效，交互不报错 */
      }
    }

    function ensureStyle() {
      const existing = document.getElementById(STYLE_ID);
      if (existing !== null && existing.tagName === 'STYLE') {
        if (existing.textContent !== CSS) existing.textContent = CSS;
        return () => {};
      }
      const tag = document.createElement('style');
      tag.id = STYLE_ID;
      tag.textContent = CSS;
      (document.head ?? document.body).appendChild(tag);
      return () => tag.remove();
    }

    /* ------------------------------------------------------------------ *
     * 设置行组件（在 factory 作用域里取一次 React，避免每次渲染都 require）
     * ------------------------------------------------------------------ */
    const React = require('react');
    /** 设置行需要把开关写回引擎；引擎在 apply() 里创建，故用引用传递。 */
    const engineRef = { current: null };

    function WorkspaceFloatRow(props) {
      const { useState } = React;
      const t = props.t ?? (() => '');
      const [on, setOn] = useState(readWorkspaceFloat());
      const toggle = (next) => {
        setOn(next);
        writeWorkspaceFloat(next);
        engineRef.current?.setWorkspaceFloat(next);
      };
      return React.createElement(
        'label',
        { className: 'pf-setting-row' },
        React.createElement('input', {
          type: 'checkbox',
          checked: on,
          onChange: (event) => toggle(event.target.checked)
        }),
        React.createElement(
          'span',
          { className: 'pf-setting-text' },
          React.createElement('span', { className: 'pf-setting-title' }, t('settings.floatWorkspace')),
          React.createElement('span', { className: 'pf-setting-hint' }, t('settings.floatWorkspaceHint'))
        )
      );
    }


    const svg = (path, size = 16) =>
      `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true" fill="none" ` +
      `stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;

    const ICON_SLIDERS = svg('<path d="M4 7h10M18 7h2M4 12h4M12 12h8M4 17h12M20 17h0"/>' +
      '<circle cx="16" cy="7" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="17" r="2"/>');
    const ICON_CLOSE = svg('<path d="m6 6 12 12M18 6 6 18"/>', 14);
    const ICON_CHEVRON = svg('<path d="m6 9 6 6 6-6"/>', 16);

    /* 顶部操作收容状态：只记一个布尔，默认收起（标题优先）。 */
    function readHeaderCollapsed() {
      try {
        const raw = window.localStorage.getItem(HDR_STORAGE_KEY);
        if (raw === null) return true;
        const parsed = JSON.parse(raw);
        return parsed?.collapsed !== false;
      } catch {
        return true;
      }
    }

    function writeHeaderCollapsed(collapsed) {
      try {
        window.localStorage.setItem(HDR_STORAGE_KEY, JSON.stringify({ collapsed }));
      } catch {
        /* 存不下就只影响本次会话 */
      }
    }

    /* 左侧工作区悬浮开关：默认关闭（不改变既有行为）。 */
    function readWorkspaceFloat() {
      try {
        const raw = window.localStorage.getItem(WS_STORAGE_KEY);
        if (raw === null) return false;
        return JSON.parse(raw)?.float === true;
      } catch {
        return false;
      }
    }

    function writeWorkspaceFloat(float) {
      try {
        window.localStorage.setItem(WS_STORAGE_KEY, JSON.stringify({ float }));
      } catch {
        /* 同上 */
      }
    }

    /* ------------------------------------------------------------------ *
     * 引擎
     * ------------------------------------------------------------------ */
    function createEngine(ctx, t) {
      let state = readState();
      let panels = [];        // [{id, order, label}] —— 槽位权威清单，按 order 升序
      let nav = null;
      let trigger = null;
      let roTarget = null;
      let pop = null;
      // 头部收容状态（放在这里而不是 8b 段：schedule() 首次可能在 8b 的 let 之前触发）
      let hdrAnchor = null;
      let hdrTrigger = null;
      let hdrCollapsed = readHeaderCollapsed();
      let wsFloat = readWorkspaceFloat();
      // 工作区悬浮的尺寸观察器（与侧栏 ro 分开，避免互相 disconnect）
      let roWs =
        typeof ResizeObserver === 'function' ? new ResizeObserver(() => schedule()) : null;
      let roWsTarget = null;
      let disposed = false;
      let warned = false;
      let frame = 0;
      let startedAt = 0;
      let slowRetries = 0;
      const timers = new Set();

      const narrowMq =
        typeof window.matchMedia === 'function' ? window.matchMedia(NARROW_QUERY) : null;

      // Safari < 14 的 MediaQueryList 只有已废弃的 addListener/removeListener
      function watchMedia(handler) {
        if (narrowMq === null) return () => {};
        if (typeof narrowMq.addEventListener === 'function') {
          narrowMq.addEventListener('change', handler);
          return () => narrowMq.removeEventListener('change', handler);
        }
        if (typeof narrowMq.addListener === 'function') {
          narrowMq.addListener(handler);
          return () => narrowMq.removeListener(handler);
        }
        return () => {};
      }

      /* ---------------- 1. 数据面：槽位清单 ---------------- */
      function panelList() {
        const entries = ctx.slots.entriesOfSlot('sidebar.panellist') ?? [];
        const next = [];
        for (const entry of entries) {
          const options = entry?.options ?? {};
          const id = typeof options.id === 'string' ? options.id : undefined;
          if (id === undefined) continue;
          next.push({
            id,
            order: typeof options.order === 'number' ? options.order : 0,
            label: resolveLabel(options.label) ?? id
          });
        }
        next.sort((a, b) => a.order - b.order);
        return next;
      }

      /**
       * 弹层里要列出的条目：以槽位清单为准；槽位暂时读不到（声明尚未提交、或
       * entriesOfSlot 在极早期返回空）时，退化为「用 DOM 现有行反推」，
       * 保证弹层永远有可用项，不会变成一张空表。
       */
      function derivedPanels() {
        if (panels.length > 0) return panels;
        const target = findNav();
        if (target === null) return panels;
        return directButtons(target).map((row, index) => ({
          id: rowId(row, index),
          order: index,
          label: row.getAttribute('aria-label') ?? `${t('pop.unknown')} #${index + 1}`
        }));
      }

      /* ---------------- 2. 定位面：找 panelList 那个 <nav> ---------------- */
      //
      // 三级定位策略（越靠后越不依赖宿主内部结构）：
      //   L1  直接命中自己打过标记的 nav（重渲染丢了标记时也会走 L2）
      //   L2  nav 的直接子 <button> 的 aria-label 与我们掌握的 label 集合命中最多者
      //       —— label 来自同一份槽位数据，天然跟随语言切换，不写死中文/英文
      //   L3  结构兜底：父级是 flex 列、自己 ≥2 个直接 button 子节点、
      //       且后面跟着一个 overflow:hidden 的兄弟（regionArea）—— 唯一命中才采用
      function directButtons(el) {
        const out = [];
        for (const child of el.children) {
          if (child.tagName === 'BUTTON' && !child.hasAttribute(TRIGGER_ATTR)) out.push(child);
        }
        return out;
      }

      function findNav() {
        if (nav !== null && nav.isConnected) return nav;
        nav = null;

        const known = new Set(panels.map((p) => p.label));
        const marked = document.querySelector(`nav[${NAV_ATTR}]`);
        if (marked !== null) {
          nav = marked;
          return nav;
        }

        let best = null;
        let bestScore = 0;
        const structural = [];
        for (const candidate of document.querySelectorAll('nav')) {
          const buttons = directButtons(candidate);
          if (buttons.length === 0) continue;
          let score = 0;
          for (const button of buttons) {
            if (known.has(button.getAttribute('aria-label') ?? '')) score += 1;
          }
          if (score > bestScore) {
            bestScore = score;
            best = candidate;
          }
          if (buttons.length >= 2) {
            const parent = candidate.parentElement;
            const columnar =
              parent !== null &&
              getComputedStyle(parent).display.includes('flex') &&
              getComputedStyle(parent).flexDirection === 'column';
            let tail = null;
            for (const sibling of parent?.children ?? []) {
              if (sibling === candidate) continue;
              if (getComputedStyle(sibling).overflow.includes('hidden')) {
                tail = sibling;
                break;
              }
            }
            if (columnar && tail !== null) structural.push(candidate);
          }
        }

        if (best !== null && bestScore > 0) {
          nav = best;
        } else if (structural.length === 1) {
          nav = structural[0];
        } else {
          nav = null;
        }
        if (nav !== null) nav.setAttribute(NAV_ATTR, '1');
        return nav;
      }

      /* ---------------- 3. 计算面：谁该显示 ---------------- */
      function layoutMode() {
        const width = nav?.getBoundingClientRect().width ?? 0;
        if (width > 0 && width <= RAIL_MAX_PX) return 'rail';
        return narrowMq?.matches === true ? 'narrow' : 'wide';
      }

      function visibleRowCount() {
        const mode = layoutMode();
        return AUTO_LIMIT[mode] ?? AUTO_LIMIT.wide;
      }

      function computeShown(rows) {
        const shown = new Array(rows.length).fill(false);
        if (state.showAll === true) {
          shown.fill(true);
        } else if (Array.isArray(state.pinned)) {
          // 显式选择：只显示勾选项（含 `pos:` 兜底 id 时按位置比对）
          rows.forEach((row, index) => {
            const id = rowId(row, index);
            shown[index] = state.pinned.includes(id);
          });
        } else {
          // 自动：前 N 条
          const limit = visibleRowCount();
          for (let index = 0; index < rows.length && index < limit; index += 1) shown[index] = true;
        }
        // 安全阀：当前选中的面板永远可见，避免「面板在用、行却不见了」
        rows.forEach((row, index) => {
          if (row.getAttribute('aria-current') === 'page') shown[index] = true;
        });
        return shown;
      }

      function rowId(row, index) {
        const stamped = row.getAttribute(ID_ATTR);
        if (stamped !== null) return stamped;
        const label = row.getAttribute('aria-label') ?? '';
        // 先按 label 唯一匹配（语言切换后 DOM 顺序不变、槽位顺序也不变，label 是最稳的键）
        const matches = panels.filter((panel) => panel.label === label);
        if (matches.length === 1) return matches[0].id;
        // 再按位置匹配（仅当该位置的 label 也对得上）
        const byIndex = panels[index];
        if (byIndex !== undefined && byIndex.label === label) return byIndex.id;
        // 位置兜底 id：仅用于本次渲染，不会写入存储
        return `pos:${index}`;
      }

      /* ---------------- 4. 应用面 ---------------- */
      /**
       * 收敛一次。幂等：重复调用只重复写同样的属性值（值相同则不写 DOM），
       * 因此弹层里改完选择可以直接同步调用它拿最新结果，不必等下一帧。
       */
      function apply() {
        if (disposed) return;
        const target = findNav();
        if (target === null) {
          warnMissing();
          return;
        }
        const rows = directButtons(target);
        if (rows.length > 0) {
          // 曾经告警过也没关系：一旦恢复就重新武装，下次真断了还能再报一次
          warned = false;
          slowRetries = 0;
        }
        if (rows.length === 0) {
          // nav 存在但行还没提交（React 提交顺序）：交给 MutationObserver 在行插入时再收敛。
          // 这里绝不能再自我 schedule，否则空 nav 会变成每帧一次的空转。
          return;
        }

        rows.forEach((row, index) => {
          const id = rowId(row, index);
          if (row.getAttribute(ID_ATTR) !== id) row.setAttribute(ID_ATTR, id);
          if (!row.hasAttribute(ROW_ATTR)) row.setAttribute(ROW_ATTR, '1');
        });

        const shown = computeShown(rows);
        let hidden = 0;
        rows.forEach((row, index) => {
          const value = shown[index] ? '1' : '0';
          if (row.getAttribute(SHOWN_ATTR) !== value) row.setAttribute(SHOWN_ATTR, value);
          if (!shown[index]) hidden += 1;
        });

        // nav 可能在运行期被 React 换掉（抽屉/常驻列切换会重挂侧边栏），
        // 因此每次收敛都确认一次尺寸观察目标，而不是只在 start() 里绑一次。
        if (ro !== null && roTarget !== target) {
          ro.disconnect();
          ro.observe(target);
          roTarget = target;
        }

        mountTrigger(target, hidden);
        positionPopover();
      }

      /**
       * 降级告警：只在「等了一段时间仍找不到」时才说，并且只说一次。
       * 插件是 immediately 装载的，首次 apply 时侧边栏通常还没挂载，
       * 此时告警属于误报，必须靠时间窗把误报压掉。
       */
      function warnMissing() {
        if (disposed) return;
        const waited = Date.now() - startedAt;
        if (waited < MISSING_GRACE_MS) {
          // 宽限期内：低频重试（不依赖 MutationObserver 也能自愈）
          if (slowRetries < MISSING_MAX_RETRY) {
            slowRetries += 1;
            later(() => schedule(), MISSING_RETRY_MS);
          }
          return;
        }
        if (warned) return;
        warned = true;
        console.warn(
          '[dsh-sidebar-panels-fold] 未能定位侧边栏 panelList（<nav>），已进入「不隐藏任何条目」的降级状态：' +
            '侧边栏与所有插件功能保持原样，仅本插件的折叠能力暂不可用。' +
            '若宿主结构变更，请更新 client.js 的 findNav()。'
        );
      }

      /** 自建定时器统一登记，卸载时一并取消（避免卸载后还在跑收敛）。 */
      function later(fn, ms) {
        const id = window.setTimeout(() => {
          timers.delete(id);
          if (!disposed) fn();
        }, ms);
        timers.add(id);
        return id;
      }

      function schedule() {
        if (disposed || frame !== 0) return;
        frame = window.requestAnimationFrame(() => {
          frame = 0;
          // 三条能力彼此独立：任一边找不到目标都不影响其余。
          applyHeader();
          applyWorkspaceFloat();
          apply();
        });
      }

      /* ---------------- 5. 触发器 ---------------- */
      function mountTrigger(target, hidden) {
        if (trigger !== null && !trigger.isConnected) trigger = null;
        if (trigger === null) {
          trigger = document.createElement('button');
          trigger.type = 'button';
          trigger.setAttribute(TRIGGER_ATTR, '1');
          trigger.setAttribute('aria-haspopup', 'dialog');
          trigger.setAttribute('aria-expanded', 'false');
          trigger.innerHTML = `<span class="pf-icon">${ICON_SLIDERS}</span><span class="pf-label"></span><span class="pf-badge"></span>`;
          trigger.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            togglePopover();
          });
        }
        if (trigger.parentElement !== target || trigger.nextElementSibling !== null) {
          // 始终贴在列表末尾：动态注册新面板后仍排在最后
          target.appendChild(trigger);
        }

        const rail = layoutMode() === 'rail';
        trigger.setAttribute('data-dsh-pf-rail', rail ? '1' : '0');

        const labelEl = trigger.querySelector('.pf-label');
        const badgeEl = trigger.querySelector('.pf-badge');
        const text = hidden > 0 ? t('trigger.more', { count: hidden }) : t('trigger.manage');
        if (labelEl !== null && labelEl.textContent !== text) labelEl.textContent = text;
        if (badgeEl !== null) {
          const badge = hidden > 0 ? String(hidden) : '';
          if (badgeEl.textContent !== badge) badgeEl.textContent = badge;
        }
        const aria = `${t('trigger.manage')} · ${text}`;
        if (trigger.getAttribute('aria-label') !== aria) trigger.setAttribute('aria-label', aria);
        if (trigger.getAttribute('title') !== text) trigger.setAttribute('title', text);
      }

      /* ---------------- 6. 弹层（选择显示） ---------------- */
      function togglePopover() {
        if (pop !== null) closePopover();
        else openPopover();
      }

      function openPopover() {
        closePopover();
        const rows = nav === null ? [] : directButtons(nav);
        const shown = computeShown(rows);
        const current = new Map();
        rows.forEach((row, index) => current.set(rowId(row, index), shown[index]));

        pop = document.createElement('div');
        pop.setAttribute('data-dsh-pf-pop', '1');
        pop.setAttribute('role', 'dialog');
        pop.setAttribute('aria-label', t('pop.title'));

        const head = document.createElement('div');
        head.className = 'pf-head';
        const title = document.createElement('span');
        title.textContent = t('pop.title');
        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'pf-close';
        close.setAttribute('aria-label', t('pop.close'));
        close.innerHTML = ICON_CLOSE;
        close.addEventListener('click', () => closePopover());
        head.append(title, close);

        const quick = document.createElement('div');
        quick.className = 'pf-quick';
        quick.append(
          quickButton(t('pop.showAll'), () => {
            state = { pinned: null, showAll: true };
            writeState(state);
            apply();
            refreshPopover();
          }),
          quickButton(t('pop.hideAll'), () => {
            state = { pinned: [], showAll: false };
            writeState(state);
            apply();
            refreshPopover();
          }),
          quickButton(t('pop.reset'), () => {
            state = { pinned: null, showAll: false };
            writeState(state);
            apply();
            refreshPopover();
          })
        );

        const list = document.createElement('div');
        list.className = 'pf-list';

        const listed = derivedPanels();
        if (listed.length === 0) {
          const note = document.createElement('p');
          note.className = 'pf-note';
          note.textContent = t('pop.empty');
          list.append(note);
        } else {
          for (const panel of listed) {
            list.append(buildPanelRow(panel, current.get(panel.id) === true));
          }
        }

        const note = document.createElement('p');
        note.className = 'pf-note';
        note.textContent = t('pop.hint');

        pop.append(head, quick, list, note);
        document.body.appendChild(pop);
        if (trigger !== null) trigger.setAttribute('aria-expanded', 'true');
        positionPopover();
        anchorClickGuard();
        // 焦点进入弹层，键盘可达；移动端不强制聚焦以免弹起键盘
        if (narrowMq?.matches !== true) close.focus({ preventScroll: true });
      }

      function quickButton(label, onClick) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = label;
        button.addEventListener('click', onClick);
        return button;
      }

      function buildPanelRow(panel, checked) {
        const row = document.createElement('label');
        row.className = 'pf-row';

        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = checked;
        input.addEventListener('change', () => {
          // 首次勾选时，以「当前可见集合」为基线，避免一次点击把其余项全清空
          const base = Array.isArray(state.pinned)
            ? [...state.pinned]
            : Array.from(collectVisibleIds()).filter((id) => !id.startsWith('pos:'));
          const set = new Set(base);
          if (input.checked) set.add(panel.id);
          else set.delete(panel.id);
          state = { pinned: [...set], showAll: false };
          writeState(state);
          apply();
          refreshPopover();
        });

        const name = document.createElement('span');
        name.className = 'pf-name';
        name.textContent = panel.label;

        row.append(input, name);
        if (isActivePanel(panel.id)) {
          const tag = document.createElement('span');
          tag.className = 'pf-active';
          tag.textContent = t('pop.active');
          row.append(tag);
        }
        const id = document.createElement('span');
        id.className = 'pf-id';
        id.textContent = panel.id;
        row.append(id);
        return row;
      }

      function collectVisibleIds() {
        if (nav === null) return new Set();
        const rows = directButtons(nav);
        const shown = computeShown(rows);
        const ids = new Set();
        rows.forEach((row, index) => {
          if (shown[index]) ids.add(rowId(row, index));
        });
        return ids;
      }

      function isActivePanel(id) {
        if (nav === null) return false;
        return directButtons(nav).some(
          (row) => row.getAttribute('aria-current') === 'page' && row.getAttribute(ID_ATTR) === id
        );
      }

      /** 弹层是自建 DOM：重开一次比原地打补丁更简单，也能顺手刷新「当前」标记。 */
      function refreshPopover() {
        if (pop !== null) {
          openPopover();
        }
      }

      function closePopover() {
        releaseClickGuard();
        if (pop !== null) {
          const element = pop;
          pop = null;
          element.remove();
        }
        if (trigger !== null) trigger.setAttribute('aria-expanded', 'false');
      }

      function positionPopover() {
        if (pop === null || trigger === null) return;
        const rect = trigger.getBoundingClientRect();
        const margin = 8;
        const width = pop.offsetWidth || 280;
        const left = Math.max(margin, Math.min(rect.left, window.innerWidth - width - margin));
        let top = rect.bottom + 6;
        const height = pop.offsetHeight || 0;
        if (top + height > window.innerHeight - margin) {
          top = Math.max(margin, Math.min(rect.top - height - 6, window.innerHeight - height - margin));
        }
        pop.style.left = `${Math.round(left)}px`;
        pop.style.top = `${Math.round(top)}px`;
      }

      /* ---------------- 7. 外部点击 / Esc / 滚动关闭 ---------------- */
      let guard = null;
      function anchorClickGuard() {
        releaseClickGuard();
        const onPointerDown = (event) => {
          const target = event.target;
          if (!(target instanceof Node)) return;
          if (pop?.contains(target) === true) return;
          if (trigger?.contains(target) === true) return;
          closePopover();
        };
        const onKeyDown = (event) => {
          if (event.key === 'Escape') {
            closePopover();
            trigger?.focus?.({ preventScroll: true });
          }
        };
        const onViewport = () => positionPopover();
        window.addEventListener('pointerdown', onPointerDown, true);
        window.addEventListener('keydown', onKeyDown, true);
        window.addEventListener('resize', onViewport);
        window.addEventListener('scroll', onViewport, true);
        guard = () => {
          window.removeEventListener('pointerdown', onPointerDown, true);
          window.removeEventListener('keydown', onKeyDown, true);
          window.removeEventListener('resize', onViewport);
          window.removeEventListener('scroll', onViewport, true);
        };
      }
      function releaseClickGuard() {
        guard?.();
        guard = null;
      }

      /* ---------------- 8b. 头部收容：收拢标题右侧的操作条目 ---------------- */
      //
      // 只碰 `conversation.session.header.actions` 这一槽（标题右侧那排）。
      // 判据是「条目自身渲染出了按钮」：agent-preset 是纯文本 span、
      // dsh-rewind-portals 只挂 portal，二者都不含按钮，因此不会被误收。
      //
      // 呈现方式：收起=display:none；展开=把原条目 position:fixed 悬浮到弹层里。
      // 绝不移动也不克隆节点 —— React 合成事件挂在 root 上，克隆出的 DOM 没有
      // fiber，点了不会触发；移动则会破坏 React 的删除/插入记账。悬浮只改样式，
      // 节点仍归 React 所有，所以弹层里的按钮保持原行为。

      /** 该槽的直接子元素即各条目（渲染器对每个条目锚定一个 display:contents 包装）。 */
      function hdrEntries() {
        if (hdrAnchor === null || !hdrAnchor.isConnected) return [];
        return Array.from(hdrAnchor.children).filter(
          (node) => node instanceof Element && !node.hasAttribute(HDR_TRIGGER_ATTR)
        );
      }

      /**
       * 「可收容」= 条目渲染出了按钮，且它本身是流内操作条。
       *
       * 必须排除同槽里的弹层：`undo-buttons` 打开快照面板时，面板是同一个
       * slot 的兄弟子元素，也含按钮 —— 若一并收起，点了「快照」却什么都
       * 看不到，等于把功能弄坏。弹层用 absolute/fixed 脱流，操作条留在流内。
       */
      function isCollapsibleEntry(node) {
        if (node.querySelector('button') === null) return false;
        // 面板/对话框：任何形态都不收
        if (node.querySelector('[role="dialog"],[role="menu"]') !== null) return false;
        if (node.hasAttribute('role') && /dialog|menu/.test(node.getAttribute('role'))) return false;
        const style = window.getComputedStyle(node);
        const position = style.position;
        if (position === 'absolute' || position === 'fixed') return false;
        // 大块区域不是按钮行（面板常以流内卡片形式出现）
        return node.getBoundingClientRect().height <= HEADER_ROW_MAX_PX;
      }

      function collapsibleEntries(entries) {
        return entries.filter(isCollapsibleEntry);
      }

      function findHeaderAnchor() {
        const anchor = document.querySelector(HEADER_ANCHOR);
        if (anchor !== hdrAnchor) {
          // 槽位重挂（切换会话/视图）后旧触发器一起作废
          if (hdrTrigger !== null) {
            hdrTrigger.remove();
            hdrTrigger = null;
          }
          hdrAnchor = anchor;
        }
        return hdrAnchor;
      }

      function mountHeaderTrigger() {
        if (hdrAnchor === null) return;
        const target = hdrAnchor.parentElement;
        if (target === null) return;
        if (hdrTrigger !== null && !hdrTrigger.isConnected) hdrTrigger = null;
        if (hdrTrigger === null) {
          hdrTrigger = document.createElement('button');
          hdrTrigger.type = 'button';
          hdrTrigger.setAttribute(HDR_TRIGGER_ATTR, '1');
          hdrTrigger.setAttribute('aria-haspopup', 'true');
          hdrTrigger.innerHTML = ICON_CHEVRON;
          hdrTrigger.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            // 触发器是纯 UI 开关：只决定弹层开合，不改「是否有可收条目」的事实
            hdrCollapsed = !hdrCollapsed;
            writeHeaderCollapsed(hdrCollapsed);
            applyHeader();
          });
        }
        // 贴在 actions 槽之后、utilities 之前
        if (hdrTrigger.previousElementSibling !== hdrAnchor) {
          target.insertBefore(hdrTrigger, hdrAnchor.nextElementSibling);
        }
        const count = collapsibleEntries(hdrEntries()).length;
        const aria = hdrCollapsed
          ? t('header.expand', { count })
          : t('header.collapse');
        if (hdrTrigger.getAttribute('aria-label') !== aria) hdrTrigger.setAttribute('aria-label', aria);
        if (hdrTrigger.getAttribute('title') !== aria) hdrTrigger.setAttribute('title', aria);
        const expanded = hdrCollapsed ? 'false' : 'true';
        if (hdrTrigger.getAttribute('aria-expanded') !== expanded) {
          hdrTrigger.setAttribute('aria-expanded', expanded);
        }
        // 没有可收容的条目就不显示触发器
        hdrTrigger.style.display = count === 0 ? 'none' : '';
      }

      function applyHeader() {
        if (disposed) return;
        const anchor = findHeaderAnchor();
        if (anchor === null) return;
        const collapsible = collapsibleEntries(hdrEntries());
        const collapsed = hdrCollapsed === true || collapsible.length === 0;

        // 两条互斥的呈现态：
        //   收起 → display:none（不占位，标题拿回宽度）
        //   展开 → 原槽位正常显示（原地展开，不再有悬浮层）
        for (const node of collapsible) {
          const value = collapsed ? '1' : '0';
          if (node.getAttribute(HDR_HIDDEN_ATTR) !== value) node.setAttribute(HDR_HIDDEN_ATTR, value);
        }
        mountHeaderTrigger();
      }
      /* ---------------- 8d. 左侧工作区悬浮 ---------------- */
      //
      // 安全悬浮的唯一做法：脱流**原锚点**，绝不移动、绝不克隆、绝不遮蔽槽位。
      // 这样 dsh-better-workspace 的 fiber、类名、事件、对外行为全部原样，
      // 悬浮只是几何变化。
      //
      // 定位依据 `regionArea`（锚点的父级）的实时矩形：它是 flex:1 + overflow:hidden，
      // 位置随侧栏折叠/宽度变化，所以每次收敛都重算，并观察它的尺寸。

      function workspaceShell() {
        const anchor = document.querySelector(WS_ANCHOR);
        if (anchor === null) return null;
        const shell = anchor.parentElement;
        if (shell === null) return null;
        if (!shell.hasAttribute(WS_SHELL_ATTR)) shell.setAttribute(WS_SHELL_ATTR, '1');
        return shell;
      }

      function releaseWorkspaceFloat() {
        const anchor = document.querySelector(WS_ANCHOR);
        if (anchor !== null) {
          anchor.removeAttribute(WS_FLOAT_ATTR);
          anchor.style.removeProperty('left');
          anchor.style.removeProperty('top');
          anchor.style.removeProperty('width');
          anchor.style.removeProperty('height');
        }
        const shell = document.querySelector(`[${WS_SHELL_ATTR}]`);
        if (shell !== null) {
          shell.style.removeProperty('min-height');
          shell.removeAttribute(WS_SHELL_ATTR);
        }
      }

      function applyWorkspaceFloat() {
        if (disposed) return;
        const shell = workspaceShell();
        if (shell === null) return;
        const anchor = document.querySelector(WS_ANCHOR);
        if (anchor === null) return;

        if (wsFloat !== true) {
          if (roWs !== null && roWsTarget !== null) {
            roWs.disconnect();
            roWsTarget = null;
          }
          if (anchor.hasAttribute(WS_FLOAT_ATTR)) releaseWorkspaceFloat();
          return;
        }

        // regionArea 尺寸变化（侧栏折叠、拖宽、抽屉开关）都直接影响浮层几何，
        // 用独立的 ResizeObserver 观察它，避免与侧栏那个观察器互相 disconnect。
        if (roWs !== null && roWsTarget !== shell) {
          roWs.disconnect();
          roWs.observe(shell);
          roWsTarget = shell;
        }

        // 脱流后 regionArea 靠 flex:1 自己保持高度，因此这里只读矩形，不写占位高度。
        const rect = shell.getBoundingClientRect();
        // 折叠成 56px 轨道时没有可用宽度：不悬浮，避免浮出一个空壳
        if (rect.width < 120 || rect.height < 120) {
          releaseWorkspaceFloat();
          return;
        }

        anchor.setAttribute(WS_FLOAT_ATTR, '1');
        anchor.style.left = `${Math.round(rect.left)}px`;
        anchor.style.top = `${Math.round(rect.top)}px`;
        anchor.style.width = `${Math.round(rect.width)}px`;
        anchor.style.height = `${Math.round(rect.height)}px`;
      }
      // 自己的节点不参与触发：否则「把触发器 append 到 nav 末尾」会被自己的 observer
      // 当成外部变化，白跑一帧（也会在极端情况下形成 append→observe→append 的自激）。
      const own = (node) =>
        node instanceof Element &&
        (node.hasAttribute(TRIGGER_ATTR) ||
          node.hasAttribute(HDR_TRIGGER_ATTR) ||
          node.hasAttribute('data-dsh-pf-pop'));

      const relevant = (node) => {
        if (!(node instanceof Element)) return false;
        if (own(node)) return false;
        if (node === nav || node === hdrAnchor) return true;
        if (node.matches?.(`[data-slot="${HEADER_SLOT}"]`)) return true;
        if (node.matches?.(WS_ANCHOR)) return true;
        if (node.matches?.('nav, button, [aria-current]')) return true;
        return node.querySelector?.(`nav, button, [data-slot="${HEADER_SLOT}"], ${WS_ANCHOR}`) !== null;
      };

      const mo = new MutationObserver((records) => {
        for (const record of records) {
          if (record.type !== 'childList') continue;
          for (const node of record.addedNodes) if (relevant(node)) return schedule();
          for (const node of record.removedNodes) {
            if (node === nav) {
              nav = null;
              trigger = null;
              return schedule();
            }
            if (node === hdrAnchor) {
              hdrAnchor = null;
              hdrTrigger = null;
              return schedule();
            }
            if (relevant(node)) return schedule();
          }
        }
      });

      const ro =
        typeof ResizeObserver === 'function'
          ? new ResizeObserver(() => schedule())
          : null;

      let unwatchMedia = () => {};
      const onMqChange = () => schedule();
      // 语言切换后：既要把自建文案换掉，也要重新解析槽位 label（label 可能是
      // 跟随 locale 的 thunk），否则 L2 定位与弹层名称会停在旧语言。
      const onLocale = () => syncPanels();
      const onResize = () => {
        schedule();
        positionPopover();
      };

      /* ---------------- 9. 生命周期 ---------------- */
      function start() {
        startedAt = Date.now();
        mo.observe(document.body, { childList: true, subtree: true });
        unwatchMedia = watchMedia(onMqChange);
        window.addEventListener('resize', onResize);
        schedule();
        // 首帧后再补一次：immediately 装载时侧边栏可能尚未完成首次提交
        later(() => schedule(), 120);
        return stop;
      }

      function stop() {
        disposed = true;
        if (frame !== 0) {
          window.cancelAnimationFrame(frame);
          frame = 0;
        }
        for (const id of timers) window.clearTimeout(id);
        timers.clear();
        closePopover();
        mo.disconnect();
        ro?.disconnect();
        roTarget = null;
        roWs?.disconnect();
        roWsTarget = null;
        // 工作区还原：撤掉悬浮几何与占位高度，左栏回到宿主原样
        releaseWorkspaceFloat();
        unwatchMedia();
        unwatchMedia = () => {};
        window.removeEventListener('resize', onResize);
        if (trigger !== null) {
          trigger.remove();
          trigger = null;
        }
        // 还原：摘掉我们写入的呈现属性，侧边栏回到宿主原样
        for (const row of document.querySelectorAll(`[${ROW_ATTR}]`)) {
          row.removeAttribute(ROW_ATTR);
          row.removeAttribute(SHOWN_ATTR);
          row.removeAttribute(ID_ATTR);
        }
        for (const element of document.querySelectorAll(`nav[${NAV_ATTR}]`)) {
          element.removeAttribute(NAV_ATTR);
        }
        // 头部还原：摘掉折叠属性并移除触发器，标题栏回到宿主原样
        for (const node of document.querySelectorAll(`[${HDR_HIDDEN_ATTR}]`)) {
          node.removeAttribute(HDR_HIDDEN_ATTR);
        }
        if (hdrTrigger !== null) {
          hdrTrigger.remove();
          hdrTrigger = null;
        }
        hdrAnchor = null;
        nav = null;
      }

      function syncPanels() {
        panels = panelList();
        schedule();
      }

      /** 设置开关的写入口：切换后立刻收敛，不等下一帧交互。 */
      function setWorkspaceFloat(next) {
        wsFloat = next === true;
        writeWorkspaceFloat(wsFloat);
        applyWorkspaceFloat();
      }

      return { start, syncPanels, onLocale, setWorkspaceFloat };
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        const t = ctx.locale.bind(NS);

        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'sidebar-panels-fold: dictionaries');
        ctx.effect(ensureStyle, 'sidebar-panels-fold: stylesheet');

        const engine = createEngine(ctx, t);
        engineRef.current = engine;

        ctx.effect(() => {
          engine.syncPanels();
          // 面板动态注册/注销：槽位订阅是权威变更源，比轮询 DOM 便宜且及时
          const unsubSlots = ctx.slots.subscribe('sidebar.panellist', () => engine.syncPanels());
          // 语言切换/字典迟到：label 与自建文案都要重算
          const unsubLocale = ctx.locale.subscribe(() => engine.onLocale());
          const stopEngine = engine.start();
          return () => {
            stopEngine();
            unsubSlots();
            unsubLocale();
          };
        }, 'sidebar-panels-fold: engine');

        // 设置项：左侧工作区悬浮开关。通用设置区只堆行，行内容（含标签）由自己画。
        ctx.slots.inject('settings.general.item', () =>
          ctx.slots.register(
            {
              name: 'settings.general.item',
              id: 'sidebar-panels-fold-workspace',
              order: 25,
              locale: NS
            },
            WorkspaceFloatRow
          )
        );
      }
    };
  }
});
