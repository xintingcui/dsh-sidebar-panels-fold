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
      'pop.unknown': '未登记条目'
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
      'pop.unknown': 'Unlisted entry'
    };

    /* ------------------------------------------------------------------ *
     * 样式：只选择本插件自己打上的属性，不依赖任何 CSS Module 哈希类名。
     * 这是「选择器失效」时最关键的降级设计：哈希前缀随构建变化，属性不会。
     * ------------------------------------------------------------------ */
    const CSS = `
/* 收起的行：仅本插件写入的 data-dsh-pf-shown="0" 生效 */
[${ROW_ATTR}][${SHOWN_ATTR}="0"]{display:none!important}

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

    const svg = (path, size = 16) =>
      `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true" fill="none" ` +
      `stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;

    const ICON_SLIDERS = svg('<path d="M4 7h10M18 7h2M4 12h4M12 12h8M4 17h12M20 17h0"/>' +
      '<circle cx="16" cy="7" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="17" r="2"/>');
    const ICON_CLOSE = svg('<path d="m6 6 12 12M18 6 6 18"/>', 14);

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

      /* ---------------- 8. 守护面：DOM/尺寸/语言变化后重新收敛 ---------------- */
      // 自己的节点不参与触发：否则「把触发器 append 到 nav 末尾」会被自己的 observer
      // 当成外部变化，白跑一帧（也会在极端情况下形成 append→observe→append 的自激）。
      const own = (node) =>
        node instanceof Element &&
        (node.hasAttribute(TRIGGER_ATTR) || node.hasAttribute('data-dsh-pf-pop'));

      const relevant = (node) => {
        if (!(node instanceof Element)) return false;
        if (own(node)) return false;
        if (node === nav) return true;
        if (node.matches?.('nav, button, [aria-current]')) return true;
        return node.querySelector?.('nav, button') !== null;
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
        nav = null;
      }

      function syncPanels() {
        panels = panelList();
        schedule();
      }

      return { start, syncPanels, onLocale };
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        const t = ctx.locale.bind(NS);

        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'sidebar-panels-fold: dictionaries');
        ctx.effect(ensureStyle, 'sidebar-panels-fold: stylesheet');

        const engine = createEngine(ctx, t);

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
      }
    };
  }
});
