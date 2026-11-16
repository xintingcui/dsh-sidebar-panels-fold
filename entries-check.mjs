// entriesOf() 的两代结构回归检查：DSH 旧版（nav 直接子 button）与新版（div.panelEntry 包装）。
// 这是 v1.3.1 折叠失效那次问题的唯一最小守卫，只在开发期跑。
import assert from 'node:assert/strict';

class El {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.attrs = new Map();
  }
  getAttribute(n) { return this.attrs.has(n) ? this.attrs.get(n) : null; }
  setAttribute(n, v) { this.attrs.set(n, String(v)); }
  hasAttribute(n) { return this.attrs.has(n); }
  appendChild(c) { c.parentElement = this; this.children.push(c); return c; }
  querySelector(sel) {
    // 只实现本检查用到的 ":scope > button"
    if (sel === ':scope > button' || sel === 'button') {
      for (const c of this.children) {
        if (c.tagName === 'BUTTON') return c;
      }
      return null;
    }
    return null;
  }
}

const TRIGGER_ATTR = 'data-dsh-pf-trigger';

// —— 与 client.js 中 entriesOf() 同构 ——
function entriesOf(el) {
  const out = [];
  for (const child of el.children) {
    if (child.hasAttribute(TRIGGER_ATTR)) continue;
    if (child.tagName === 'BUTTON') {
      if (!child.hasAttribute('aria-haspopup')) out.push({ wrapper: child, button: child });
      continue;
    }
    const button = child.querySelector(':scope > button');
    if (button !== null && !button.hasAttribute('aria-haspopup')) {
      out.push({ wrapper: child, button });
    }
  }
  return out;
}

function button(label, extra = {}) {
  const b = new El('button');
  b.setAttribute('aria-label', label);
  for (const [k, v] of Object.entries(extra)) b.setAttribute(k, v);
  return b;
}

/* ---------- 1. 旧版：nav 直接子 button，wrapper === button ---------- */
{
  const nav = new El('nav');
  const a = button('插件');
  const b = button('定时');
  nav.appendChild(a);
  nav.appendChild(b);

  const got = entriesOf(nav);
  assert.equal(got.length, 2, '旧版应识别出 2 行');
  assert.ok(got.every((e) => e.wrapper === e.button), '旧版 wrapper 必须就是 button');
  assert.deepEqual(got.map((e) => e.button.getAttribute('aria-label')), ['插件', '定时'], '旧版顺序须保持');
}

/* ---------- 2. 新版：div.panelEntry 包装，wrapper 是 div ---------- */
{
  const nav = new El('nav');
  const wrapA = new El('div');
  const a = button('插件');
  wrapA.appendChild(a);
  const wrapB = new El('div');
  const b = button('定时');
  wrapB.appendChild(b);
  nav.appendChild(wrapA);
  nav.appendChild(wrapB);

  const got = entriesOf(nav);
  assert.equal(got.length, 2, '新版包装层下的 2 行必须被识别（这就是 v1.3.0 折叠失效的根因）');
  assert.ok(got[0].wrapper === wrapA && got[0].button === a, '新版 wrapper 应是包装 div、button 应是内层按钮');
  assert.ok(got[0].wrapper !== got[0].button, '新版 wrapper 不能塌成 button，否则 gap 留空档');
}

/* ---------- 3. 宿主自带的「更多」入口不计入面板行 ---------- */
{
  const nav = new El('nav');
  const wrapA = new El('div');
  wrapA.appendChild(button('插件'));
  nav.appendChild(wrapA);

  const moreWrap = new El('div');
  moreWrap.appendChild(button('更多', { 'aria-haspopup': 'menu' }));
  nav.appendChild(moreWrap);

  const legacyMore = button('更多', { 'aria-haspopup': 'menu' });
  nav.appendChild(legacyMore);

  const got = entriesOf(nav);
  assert.equal(got.length, 1, 'aria-haspopup 的「更多」入口（新旧两代位置）都不许被当成面板行');
  assert.equal(got[0].button.getAttribute('aria-label'), '插件', '留下的应是真实面板行');
}

/* ---------- 4. 插件自己的触发器不计入 ---------- */
{
  const nav = new El('nav');
  nav.appendChild(button('插件'));
  const trig = button('全局面板', { [TRIGGER_ATTR]: '1' });
  nav.appendChild(trig);

  assert.equal(entriesOf(nav).length, 1, '自有触发器不许被当成面板行');
}

console.log('entries check: 4 组断言通过（旧版 / 新版包装 / 更多入口 / 自有触发器）');
