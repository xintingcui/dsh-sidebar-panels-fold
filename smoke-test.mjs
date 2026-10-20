/**
 * 离线冒烟测试（仅用于开发期自检，不随插件发布）。
 *
 * 目的：在没有浏览器可用的情况下，用最小 DOM 桩验证 client.js 的核心链路：
 *   1. 能定位 panelList 的 <nav>（三级策略）
 *   2. 能按策略给每一行打 data-dsh-pf-shown，并真的隐藏多余条目
 *   3. 能挂上触发器，并统计「收起了几条」
 *   4. localStorage 里的显式选择（pinned）能被正确应用
 *   5. 卸载后 DOM 完全还原
 *
 * 运行：node smoke-test.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

/* ----------------------------- 最小 DOM 桩 ----------------------------- */
let nodeSeq = 0;

class Node {
  constructor(tagName) {
    this.tagName = tagName;
    this.children = [];
    this.parentElement = null;
    this.attrs = new Map();
    this.listeners = new Map();
    this.isConnected = true;
    this.style = {};
    this.offsetWidth = 280;
    this.offsetHeight = 200;
    this._text = '';
    this.id = '';
    this._uid = ++nodeSeq;
  }
  get nextElementSibling() {
    if (this.parentElement === null) return null;
    const list = this.parentElement.children;
    const index = list.indexOf(this);
    return index >= 0 && index + 1 < list.length ? list[index + 1] : null;
  }
  appendChild(child) {
    if (child.parentElement !== null) {
      const list = child.parentElement.children;
      const at = list.indexOf(child);
      if (at >= 0) list.splice(at, 1);
    }
    child.parentElement = this;
    this.children.push(child);
    return child;
  }
  append(...nodes) {
    for (const node of nodes) this.appendChild(node);
    return this;
  }
  remove() {
    if (this.parentElement === null) return;
    const list = this.parentElement.children;
    const at = list.indexOf(this);
    if (at >= 0) list.splice(at, 1);
    this.parentElement = null;
    this.isConnected = false;
  }
  contains(node) {
    if (node === this) return true;
    return this.children.some((child) => child.contains(node));
  }
  setAttribute(name, value) {
    this.attrs.set(name, String(value));
  }
  getAttribute(name) {
    return this.attrs.has(name) ? this.attrs.get(name) : null;
  }
  hasAttribute(name) {
    return this.attrs.has(name);
  }
  removeAttribute(name) {
    this.attrs.delete(name);
  }
  get className() {
    return this.getAttribute('class') ?? '';
  }
  set className(value) {
    this.setAttribute('class', value);
  }
  get textContent() {
    if (this.children.length === 0) return this._text;
    return this._text + this.children.map((child) => child.textContent).join('');
  }
  set textContent(value) {
    this.children = [];
    this._text = String(value);
  }
  /** 只解析本插件自己会写的那几种 span：`<span class="x">…</span>` */
  set innerHTML(html) {
    this.children = [];
    this._text = '';
    const re = /<span\s+class="([^"]+)"\s*>([\s\S]*?)<\/span>/g;
    let match;
    while ((match = re.exec(html)) !== null) {
      const span = new Node('SPAN');
      span.setAttribute('class', match[1]);
      span.textContent = match[2];
      this.appendChild(span);
    }
    if (this.children.length === 0) this._text = html;
  }
  get innerHTML() {
    return this.textContent;
  }
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(fn);
  }
  removeEventListener(type, fn) {
    this.listeners.get(type)?.delete(fn);
  }
  dispatch(type, event = {}) {
    for (const fn of this.listeners.get(type) ?? []) fn({ preventDefault() {}, stopPropagation() {}, ...event });
  }
  matches(selector) {
    return selector.split(',').some((part) => {
      const token = part.trim();
      if (token.startsWith('nav')) return this.tagName === 'NAV';
      if (token === 'button') return this.tagName === 'BUTTON';
      if (token === '[aria-current]') return this.hasAttribute('aria-current');
      return false;
    });
  }
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }
  querySelectorAll(selector) {
    const out = [];
    const walk = (node) => {
      for (const child of node.children) {
        if (matchesSelector(child, selector)) out.push(child);
        walk(child);
      }
    };
    walk(this);
    return out;
  }
  getBoundingClientRect() {
    const width = this.hasAttribute('data-dsh-pf-nav')
      ? Number(this.getAttribute('data-test-width') ?? 280)
      : 280;
    return { x: 0, y: 100, left: 0, top: 100, right: width, bottom: 140, width, height: 40 };
  }
  focus() {}
}

function matchesSelector(node, selector) {
  // 测试里只用到这几种形式
  for (const raw of selector.split(',')) {
    const part = raw.trim();
    if (part.length === 0) continue;
    let tag = null;   // 无标签前缀 = 匹配任意标签（真实 CSS 语义）
    let rest = part;
    const tagMatch = /^([a-zA-Z]+)/.exec(part);
    if (tagMatch !== null) {
      tag = tagMatch[1].toUpperCase();
      rest = part.slice(tagMatch[1].length);
    }
    if (tag !== null && node.tagName !== tag) continue;
    const attrs = [...rest.matchAll(/\[([^\]=]+)(?:="([^"]*)")?\]/g)];
    let ok = true;
    for (const [, name, value] of attrs) {
      if (!node.hasAttribute(name)) {
        ok = false;
        break;
      }
      if (value !== undefined && node.getAttribute(name) !== value) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }
  return false;
}

/* ----------------------------- window / document 桩 ----------------------------- */
const head = new Node('HEAD');
const body = new Node('BODY');
const store = new Map();

const documentStub = {
  head,
  body,
  documentElement: new Node('HTML'),
  createElement: (tag) => new Node(tag.toUpperCase()),
  getElementById: (id) => head.querySelectorAll(`[id]`).find((n) => n.id === id) ?? null,
  querySelector: (sel) => body.querySelectorAll(sel)[0] ?? head.querySelectorAll(sel)[0] ?? null,
  querySelectorAll: (sel) => [...body.querySelectorAll(sel), ...head.querySelectorAll(sel)],
  addEventListener() {},
  removeEventListener() {}
};
// getElementById 需要能命中 id 属性：简单覆盖
documentStub.getElementById = (id) => {
  const found = [...head.children, ...body.querySelectorAll('*')].find((n) => n.id === id);
  return found ?? null;
};

const viewport = { width: 1280, innerWidth: 1280, innerHeight: 800 };
const rafQueue = [];
let timerQueue = [];

const windowStub = {
  innerWidth: viewport.innerWidth,
  innerHeight: viewport.innerHeight,
  matchMedia: (query) => ({
    matches: query.includes('1023') ? windowStub.innerWidth < 1024 : false,
    addEventListener() {},
    removeEventListener() {}
  }),
  requestAnimationFrame: (fn) => {
    rafQueue.push(fn);
    return rafQueue.length;
  },
  cancelAnimationFrame: () => {},
  setTimeout: (fn) => {
    timerQueue.push(fn);
    return timerQueue.length;
  },
  clearTimeout: () => {},
  localStorage: {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, value),
    removeItem: (key) => store.delete(key)
  },
  addEventListener() {},
  removeEventListener() {},
  getComputedStyle: () => ({ display: 'flex', flexDirection: 'column', overflow: 'hidden' })
};

class MutationObserverStub {
  observe() {}
  disconnect() {}
}
class ResizeObserverStub {
  observe() {}
  disconnect() {}
}

let captured = null;
globalThis.window = windowStub;
globalThis.document = documentStub;
globalThis.localStorage = windowStub.localStorage;
globalThis.MutationObserver = MutationObserverStub;
globalThis.ResizeObserver = ResizeObserverStub;
globalThis.getComputedStyle = windowStub.getComputedStyle;
globalThis.requestAnimationFrame = windowStub.requestAnimationFrame;
globalThis.Element = Node;
globalThis.Node = Node;
globalThis.__ModuleLoader__ = { load: (mod) => (captured = mod) };
windowStub.__ModuleLoader__ = globalThis.__ModuleLoader__;

/* ----------------------------- 搭出侧边栏骨架 ----------------------------- */
const PANEL_COUNT = 8;
const LABELS = ['Plugins', 'Schedules', 'Context', 'Task Board', 'Skill Explorer', 'Mnemon', 'MCP Connector', 'IG5 Workbench'];

const root = new Node('DIV');                    // .root
const nav = new Node('NAV');
nav.setAttribute('data-test-width', '280');
const region = new Node('DIV');                  // regionArea（overflow:hidden 的兄弟）
root.append(nav, region);
body.appendChild(root);

for (const label of LABELS) {
  const button = new Node('BUTTON');
  button.setAttribute('aria-label', label);
  nav.appendChild(button);
}
nav.children[0].setAttribute('aria-current', 'page');

/* ----------------------------- 装载插件 ----------------------------- */
const source = readFileSync(join(here, 'client.js'), 'utf8');
// 用 Function 求值，保持与浏览器同样的全局访问路径
new Function('window', 'document', 'localStorage', source)(windowStub, documentStub, windowStub.localStorage);

if (captured === null) throw new Error('插件没有调用 window.__ModuleLoader__.load');
if (captured.id !== 'dsh-sidebar-panels-fold') throw new Error(`插件 id 异常: ${captured.id}`);

const plugin = captured.factory(() => {
  throw new Error('本插件不应当 require 任何运行时模块');
});

const effects = [];
const subscriptions = [];
const ctx = {
  effect(fn) {
    const dispose = fn();
    effects.push(typeof dispose === 'function' ? dispose : () => {});
    return dispose;
  },
  locale: {
    bind: () => (key, params) => {
      const table = {
        'trigger.manage': '全局面板',
        'trigger.more': `还有 ${params?.count ?? 0} 个面板`,
        'pop.title': '侧边栏面板显示',
        'pop.hint': '仅改变显示',
        'pop.showAll': '全部显示',
        'pop.hideAll': '全部收起',
        'pop.reset': '恢复默认',
        'pop.empty': '无可控制条目',
        'pop.close': '关闭',
        'pop.active': '当前',
        'pop.unknown': '未登记条目'
      };
      return table[key] ?? key;
    },
    register: () => () => {},
    subscribe: () => () => {}
  },
  slots: {
    entriesOfSlot: () =>
      LABELS.map((label, index) => ({ options: { id: label.toLowerCase().replace(/\s+/g, '-'), order: index, label } })),
    subscribe: () => {
      subscriptions.push(1);
      return () => {};
    }
  }
};

plugin.apply(ctx);
const flush = () => {
  const pending = rafQueue.splice(0);
  for (const fn of pending) fn();
};

const ok = [];
const bad = [];
const check = (name, condition, detail = '') => (condition ? ok.push(name) : bad.push(`${name} ${detail}`));

/* ----------------------------- 断言 ----------------------------- */
check('导出 inject 含 slots/locale', Array.isArray(plugin.inject) && plugin.inject.includes('slots') && plugin.inject.includes('locale'));

flush();
const rows = nav.children.filter((n) => n.tagName === 'BUTTON' && !n.hasAttribute('data-dsh-pf-trigger'));
check('定位到 nav 并标记', nav.hasAttribute('data-dsh-pf-nav'), String(nav.attrs.size));
check('行数 = 面板数', rows.length === PANEL_COUNT, `got ${rows.length}`);
check('每行都打了 row/id/shown 三属性', rows.every((r) => r.hasAttribute('data-dsh-pf-row') && r.hasAttribute('data-dsh-pf-id') && r.hasAttribute('data-dsh-pf-shown')));
check('行 id 与槽位 id 对齐', rows[0].getAttribute('data-dsh-pf-id') === 'plugins', rows[0].getAttribute('data-dsh-pf-id'));

const shownCount = rows.filter((r) => r.getAttribute('data-dsh-pf-shown') === '1').length;
check('默认收起（PC 宽态保留 4 条）', shownCount === 4, `shown=${shownCount}`);
check('当前选中项强制可见', rows[0].getAttribute('data-dsh-pf-shown') === '1');

const trigger = nav.children.find((n) => n.hasAttribute('data-dsh-pf-trigger'));
check('触发器挂在 nav 末尾', trigger !== undefined && nav.children[nav.children.length - 1] === trigger);
check('触发器报告收起条数', trigger?.textContent.includes('4'), trigger?.textContent);

// 打开弹层
trigger.dispatch('click');
const pop = body.children.find((n) => n.hasAttribute('data-dsh-pf-pop'));
check('弹层挂到 body', pop !== undefined);
check('弹层列出全部条目', pop !== undefined && pop.querySelectorAll('input').length === PANEL_COUNT, String(pop?.querySelectorAll('input').length));

// 模拟来源选择：只显示第 1、3 条
windowStub.localStorage.setItem('dsh.sidebar-panels-fold.v1', JSON.stringify({ pinned: ['plugins', 'context'], showAll: false }));

// 卸载 + 重装，模拟持久化选择生效
for (const dispose of effects.splice(0).reverse()) dispose();
check('卸载后触发器被移除', nav.children.every((n) => !n.hasAttribute('data-dsh-pf-trigger')));
check('卸载后行属性被还原', nav.children.every((n) => !n.hasAttribute('data-dsh-pf-shown') && !n.hasAttribute('data-dsh-pf-row')));
check('卸载后 nav 标记被还原', !nav.hasAttribute('data-dsh-pf-nav'));

const again = captured.factory(() => {});
again.apply(ctx);
flush();
const rows2 = nav.children.filter((n) => n.tagName === 'BUTTON' && !n.hasAttribute('data-dsh-pf-trigger'));
const visible2 = rows2.filter((r) => r.getAttribute('data-dsh-pf-shown') === '1').map((r) => r.getAttribute('data-dsh-pf-id'));
check('pinned 选择被正确应用', visible2.length === 2 && visible2.includes('plugins') && visible2.includes('context'), visible2.join(','));

// 窄屏：改视口 + 重装
windowStub.innerWidth = 390;
nav.setAttribute('data-test-width', '280');
for (const dispose of effects.splice(0).reverse()) dispose();
windowStub.localStorage.setItem('dsh.sidebar-panels-fold.v1', JSON.stringify({ pinned: null, showAll: false }));
const third = captured.factory(() => {});
third.apply(ctx);
flush();
const rows3 = nav.children.filter((n) => n.tagName === 'BUTTON' && !n.hasAttribute('data-dsh-pf-trigger'));
const shown3 = rows3.filter((r) => r.getAttribute('data-dsh-pf-shown') === '1').length;
check('窄屏自动模式只留 2 条', shown3 === 2, `shown=${shown3}`);

// 轨道态（宽度 ≤72）
nav.setAttribute('data-test-width', '56');
for (const dispose of effects.splice(0).reverse()) dispose();
const fourth = captured.factory(() => {});
fourth.apply(ctx);
flush();
const trigger4 = nav.children.find((n) => n.hasAttribute('data-dsh-pf-trigger'));
check('轨道态触发器切换为图标态', trigger4?.getAttribute('data-dsh-pf-rail') === '1', trigger4?.getAttribute('data-dsh-pf-rail'));

/* ----------------------------- 结果 ----------------------------- */
console.log(`\n通过 ${ok.length} 项：`);
for (const name of ok) console.log(`  ✓ ${name}`);
if (bad.length > 0) {
  console.log(`\n失败 ${bad.length} 项：`);
  for (const name of bad) console.log(`  ✗ ${name}`);
  process.exitCode = 1;
} else {
  console.log('\n全部通过');
}
