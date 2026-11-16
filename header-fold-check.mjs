// 头部收容（原地展开方案）的自检：不渲染 React，只验「哪些条目该收」
// 与「收容只改显示、不动结构」这两组不变量。用与 client.js 同构的极简 DOM 桩。
import assert from 'node:assert/strict';

class El {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.attrs = new Map();
    this.style = makeStyle();
    this.parentElement = null;
    this.isConnected = true;
    this.height = 28;
    this.width = 120;
  }
  getAttribute(n) { return this.attrs.has(n) ? this.attrs.get(n) : null; }
  setAttribute(n, v) { this.attrs.set(n, String(v)); }
  removeAttribute(n) { this.attrs.delete(n); }
  hasAttribute(n) { return this.attrs.has(n); }
  appendChild(c) { return this.insertBefore(c, null); }
  insertBefore(c, ref) {
    const at = ref === null ? this.children.length : this.children.indexOf(ref);
    this.children.splice(at < 0 ? this.children.length : at, 0, c);
    c.parentElement = this;
    return c;
  }
  remove() {
    this.parentElement?.children.splice(this.parentElement.children.indexOf(this), 1);
    this.isConnected = false;
  }
  get nextElementSibling() {
    const p = this.parentElement;
    if (p === null) return null;
    return p.children[p.children.indexOf(this) + 1] ?? null;
  }
  get previousElementSibling() {
    const p = this.parentElement;
    if (p === null) return null;
    return p.children[p.children.indexOf(this) - 1] ?? null;
  }
  getBoundingClientRect() { return { left: 0, top: 0, width: this.width, height: this.height }; }
  querySelector(sel) {
    if (sel === 'button') {
      for (const c of this.children) {
        if (c.tagName === 'BUTTON') return c;
        const hit = c.querySelector(sel);
        if (hit !== null) return hit;
      }
      return null;
    }
    if (sel === '[role="dialog"],[role="menu"]') {
      for (const c of this.children) {
        if (c.hasAttribute('role') && /dialog|menu/.test(c.getAttribute('role'))) return c;
        const hit = c.querySelector(sel);
        if (hit !== null) return hit;
      }
      return null;
    }
    return null;
  }
}

function makeStyle() {
  const props = new Map();
  return {
    get position() { return props.get('position') ?? ''; },
    set position(v) { props.set('position', v); },
    removeProperty(n) { props.delete(n); },
    _props: props
  };
}

const HEADER_ROW_MAX_PX = 96;
const HDR_HIDDEN_ATTR = 'data-dsh-pf-hdr-hidden';
const HDR_TRIGGER_ATTR = 'data-dsh-pf-hdr-trigger';

/* ------------------------------------------------------------------ *
 * 与 client.js 同一判据
 * ------------------------------------------------------------------ */
const isCollapsibleEntry = (node) => {
  if (node.querySelector('button') === null) return false;
  if (node.querySelector('[role="dialog"],[role="menu"]') !== null) return false;
  if (node.hasAttribute('role') && /dialog|menu/.test(node.getAttribute('role'))) return false;
  const position = node.style.position || 'static';
  if (position === 'absolute' || position === 'fixed') return false;
  return node.getBoundingClientRect().height <= HEADER_ROW_MAX_PX;
};

/* ------------------------------------------------------------------ *
 * 1. 判据：只收「含按钮的流内操作条」
 * ------------------------------------------------------------------ */
const actions = new El('div');
actions.setAttribute('data-slot', 'conversation.session.header.actions');

const agentPreset = new El('span');   // 左侧「标准模式」：纯文本，无按钮
agentPreset.appendChild(new El('svg'));
const undo = new El('div');           // 撤销/恢复/快照/对话撤回：含按钮
undo.appendChild(new El('button'));
const sessionManager = new El('div'); // 归档/收藏/…/移动/删除：含按钮
sessionManager.appendChild(new El('button'));
const rewindPortal = new El('div');   // 只挂 portal：无按钮
actions.appendChild(agentPreset);
actions.appendChild(undo);
actions.appendChild(sessionManager);
actions.appendChild(rewindPortal);

const entries = () =>
  Array.from(actions.children).filter((n) => !n.hasAttribute(HDR_TRIGGER_ATTR));
const collapsible = entries().filter(isCollapsibleEntry);

assert.equal(entries().length, 4, '四个条目都应被枚举');
assert.equal(collapsible.length, 2, '只应收两个含按钮的条目');
assert.ok(!collapsible.includes(agentPreset), 'agent-preset 文本标签不许被收');
assert.ok(!collapsible.includes(rewindPortal), 'portal 桥不许被收');
assert.ok(collapsible.includes(undo) && collapsible.includes(sessionManager), '两个按钮条目必须被收');
assert.deepEqual(collapsible, [undo, sessionManager], '顺序须与槽位原顺序一致');

/* ------------------------------------------------------------------ *
 * 2. 回归：快照面板 / 脱流浮层不得被收
 * ------------------------------------------------------------------ */
const snapshotPanel = new El('div');
snapshotPanel.setAttribute('role', 'dialog');
snapshotPanel.appendChild(new El('button'));
snapshotPanel.height = 420;
actions.appendChild(snapshotPanel);
let withPanel = entries().filter(isCollapsibleEntry);
assert.ok(!withPanel.includes(snapshotPanel), '快照面板不许被收（否则点了看不到）');
assert.equal(withPanel.length, 2, '面板出现时收取集合保持不变');

const floating = new El('div');
floating.appendChild(new El('button'));
floating.style.position = 'fixed';
actions.appendChild(floating);
withPanel = entries().filter(isCollapsibleEntry);
assert.ok(!withPanel.includes(floating), '脱流浮层不许被收');

/* ------------------------------------------------------------------ *
 * 3. 原地展开方案的不变量（上一版悬浮弹层已撤回）
 * ------------------------------------------------------------------ */
// 3a. 只改显示属性，绝不移动节点
for (const node of collapsible) node.setAttribute(HDR_HIDDEN_ATTR, '1');
assert.ok(collapsible.every((n) => n.parentElement === actions), '收容不得改变父级');
assert.ok(collapsible.every((n) => n.getAttribute(HDR_HIDDEN_ATTR) === '1'), '收起态必须打 hidden=1');

// 3b. 展开 = 摘掉隐藏，节点仍在原位（原地展开，不产生悬浮层）
for (const node of collapsible) node.setAttribute(HDR_HIDDEN_ATTR, '0');
assert.ok(collapsible.every((n) => n.parentElement === actions), '展开后父级不变');
assert.ok(
  collapsible.every((n) => (n.style._props.get('position') ?? '') === ''),
  '展开不得写 position（悬浮方案已撤回）'
);
assert.ok(collapsible.every((n) => n.style._props.size === 0), '不得残留任何内联几何样式');

// 3c. 防回退：client.js 里不得再出现悬浮/弹层符号
const fsMod = await import('node:fs');
const src = fsMod.readFileSync(new URL('./client.js', import.meta.url), 'utf8');
for (const gone of [
  'HDR_PANEL_ATTR',
  'HDR_FLOAT_ATTR',
  'hdrPanel',
  'openHeaderPanel',
  'closeHeaderPanel',
  'positionHeaderPanel',
  'headerOrigin',
  'anchorHeaderGuard'
]) {
  assert.equal(src.includes(gone), false, `悬浮弹层符号 ${gone} 必须已移除`);
}

// 3d. 触发器在没有可收条目时隐藏
assert.ok(collapsible.length > 0, '当前场景有可收条目');
const emptyCount = Array.from(new El('div').children).filter(isCollapsibleEntry).length;
assert.equal(emptyCount, 0, '无条目时应得 0，触发器据此隐藏');

console.log('header fold: 17 assertions passed');
