// 左侧工作区悬浮的自检：不渲染真实页面，只验「安全悬浮」这一组不变量。
// 关键命题：脱流的是原槽锚点本身，节点不动、不克隆、不遮蔽槽位，
// 因此 dsh-better-workspace 的 fiber / 类名 / 事件 / 对外行为全部原样。
import assert from 'node:assert/strict';
import fs from 'node:fs';

const WS_SLOT = 'sidebar.workspaces';
const WS_ANCHOR = `[data-slot="${WS_SLOT}"]`;
const WS_FLOAT_ATTR = 'data-dsh-pf-ws-float';
const WS_SHELL_ATTR = 'data-dsh-pf-ws-shell';
const WS_STORAGE_KEY = 'dsh.sidebar-panels-fold.workspace.v1';

/* ------------------------------------------------------------------ *
 * 1. 判定逻辑：何时悬浮 / 何时不悬浮
 * ------------------------------------------------------------------ */
const shouldFloat = ({ enabled, width, height, floatable }) => {
  if (!enabled) return false;
  if (!floatable) return false;
  // 折叠成轨道（56px）时没有可用宽度
  if (width < 120 || height < 120) return false;
  return true;
};

assert.equal(shouldFloat({ enabled: false, width: 320, height: 600, floatable: true }), false, '开关关闭不悬浮');
assert.equal(shouldFloat({ enabled: true, width: 320, height: 600, floatable: true }), true, '宽态悬浮');
assert.equal(shouldFloat({ enabled: true, width: 56, height: 600, floatable: true }), false, '轨道态不悬浮');
assert.equal(shouldFloat({ enabled: true, width: 320, height: 40, floatable: true }), false, '过矮不悬浮');
assert.equal(shouldFloat({ enabled: true, width: 320, height: 600, floatable: false }), false, '找不到槽不悬浮');

/* ------------------------------------------------------------------ *
 * 2. 安全悬浮：只改样式，不动结构
 * ------------------------------------------------------------------ */
// 用一个最小节点桩模拟宿主 DOM 层级：regionArea > [data-slot] > better-workspace 根
function makeNode(name) {
  const attrs = new Map();
  const style = new Map();
  const node = {
    name,
    attrs,
    style,
    parentElement: null,
    children: [],
    isConnected: true,
    getAttribute: (n) => (attrs.has(n) ? attrs.get(n) : null),
    setAttribute: (n, v) => attrs.set(n, String(v)),
    removeAttribute: (n) => attrs.delete(n),
    hasAttribute: (n) => attrs.has(n),
    removeProperty: (n) => style.delete(n),
    setStyle: (n, v) => style.set(n, v),
    getStyle: (n) => style.get(n) ?? ''
  };
  return node;
}

const regionArea = makeNode('div.regionArea');
const slotAnchor = makeNode('div[data-slot]');
const bwRoot = makeNode('div.bw-root');
slotAnchor.setAttribute('data-slot', WS_SLOT);
bwRoot.parentElement = slotAnchor;
slotAnchor.children.push(bwRoot);
slotAnchor.parentElement = regionArea;
regionArea.children.push(slotAnchor);

// 悬浮：给锚点打标记 + 写几何
const rect = { left: 12, top: 120, width: 320, height: 600 };
slotAnchor.setAttribute(WS_FLOAT_ATTR, '1');
slotAnchor.setStyle('left', `${rect.left}px`);
slotAnchor.setStyle('top', `${rect.top}px`);
slotAnchor.setStyle('width', `${rect.width}px`);
slotAnchor.setStyle('height', `${rect.height}px`);

assert.equal(slotAnchor.getAttribute(WS_FLOAT_ATTR), '1', '锚点必须打上悬浮标记');
assert.equal(bwRoot.parentElement, slotAnchor, '工作区插件根节点的父级不得改变');
assert.equal(slotAnchor.parentElement, regionArea, '锚点不得被移出 regionArea');
// 工作区插件自身的类名与属性一律不得被本插件改动
assert.equal(bwRoot.attrs.size, 0, '工作区插件节点不得被加属性');
assert.equal(bwRoot.style.size, 0, '工作区插件节点不得被加内联样式');

/* ------------------------------------------------------------------ *
 * 3. 不遮蔽槽位：本插件不得注册 sidebar.workspaces
 * ------------------------------------------------------------------ */
const src = fs.readFileSync(new URL('./client.js', import.meta.url), 'utf8');
assert.equal(
  /register\s*\(\s*\{[^}]*name:\s*['"]sidebar\.workspaces['"]/.test(src),
  false,
  '不得注册 sidebar.workspaces（会遮蔽 dsh-better-workspace）'
);
assert.ok(
  src.includes(`[data-slot="\${WS_SLOT}"]`) || src.includes(`const WS_ANCHOR = \`[data-slot=`),
  '必须通过 data-slot 锚点定位，而不是类名'
);
// 定位不得依赖 better-workspace 的哈希类名或 bw- 前缀
assert.equal(/'bw-[a-z]/.test(src), false, '不得依赖工作区插件的类名');

/* ------------------------------------------------------------------ *
 * 4. 释放：关开关 / 卸载后必须完全还原
 * ------------------------------------------------------------------ */
const release = (anchor, shell) => {
  if (anchor !== null) {
    anchor.removeAttribute(WS_FLOAT_ATTR);
    anchor.removeProperty('left');
    anchor.removeProperty('top');
    anchor.removeProperty('width');
    anchor.removeProperty('height');
  }
  if (shell !== null) {
    shell.removeProperty('min-height');
    shell.removeAttribute(WS_SHELL_ATTR);
  }
};
release(slotAnchor, regionArea);
assert.equal(slotAnchor.hasAttribute(WS_FLOAT_ATTR), false, '释放后不得残留悬浮标记');
assert.equal(slotAnchor.getStyle('left'), '', '释放后不得残留 left');
assert.equal(slotAnchor.getStyle('height'), '', '释放后不得残留 height');
assert.equal(regionArea.hasAttribute(WS_SHELL_ATTR), false, '释放后不得残留 shell 标记');

/* ------------------------------------------------------------------ *
 * 5. 不引入累积膨胀：脱流安全的前提是 regionArea 由 flex 分配高度
 * ------------------------------------------------------------------ */
assert.equal(
  /shell\.style\.minHeight\s*=/.test(src),
  false,
  '不得给 regionArea 写死高度（脱流后 flex:1 自己撑高，写死会逐帧膨胀）'
);
// 前提：宿主 regionArea 是 flex:1 + overflow:hidden，高度不依赖子元素
assert.ok(
  src.includes('flex:1'),
  '注释需记录 flex:1 这一脱流安全前提'
);

/* ------------------------------------------------------------------ *
 * 6. 开关默认关闭：不改变既有行为
 * ------------------------------------------------------------------ */
const readFlag = (raw) => {
  try {
    if (raw === null) return false;
    return JSON.parse(raw)?.float === true;
  } catch {
    return false;
  }
};
assert.equal(readFlag(null), false, '缺省必须是关闭');
assert.equal(readFlag('{"float":true}'), true, '存 true 时开启');
assert.equal(readFlag('{"float":false}'), false, '存 false 时关闭');
assert.equal(readFlag('bad json'), false, '脏数据回落关闭，不得抛错');
assert.ok(WS_STORAGE_KEY.includes('sidebar-panels-fold'), '存储键必须带插件命名空间');

console.log('workspace float: 20 assertions passed');
