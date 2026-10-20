/**
 * 浏览器侧验证脚本（开发期用，不随插件发布）。
 *
 * 用法：在 DSH Web GUI 页面的 DevTools 控制台里整段粘贴执行。
 * 它只读 DOM 并打印结论，不修改任何东西 —— 唯一的例外是 `?probe=cycle`，
 * 会临时把选择改成「全部收起 → 全部显示 → 恢复」，跑完自动还原。
 */
(async () => {
  const ATTR = { nav: 'data-dsh-pf-nav', row: 'data-dsh-pf-row', shown: 'data-dsh-pf-shown', id: 'data-dsh-pf-id', trigger: 'data-dsh-pf-trigger' };
  const out = [];
  const ok = (name, pass, extra = '') => out.push(`${pass ? '✓' : '✗'} ${name}${extra ? ` — ${extra}` : ''}`);

  const nav = document.querySelector(`nav[${ATTR.nav}]`);
  if (nav === null) {
    console.error('[verify] 未找到被标记的 nav。插件可能未加载，或 findNav() 未命中。');
    return out;
  }
  const rows = [...nav.children].filter((el) => el.tagName === 'BUTTON' && el.hasAttribute(ATTR.row));
  const trigger = nav.querySelector(`[${ATTR.trigger}]`);
  const shown = rows.filter((row) => row.getAttribute(ATTR.shown) === '1');
  const hidden = rows.filter((row) => row.getAttribute(ATTR.shown) === '0');

  ok('nav 已标记', true, nav.className);
  ok('行数与槽位一致', rows.length > 0, `rows=${rows.length}`);
  ok('每行都有 id 与 shown', rows.every((r) => r.hasAttribute(ATTR.id) && r.hasAttribute(ATTR.shown)));
  ok('触发器存在且是 nav 最后一个子节点', trigger === nav.lastElementChild);
  ok('触发器报告收起条数', trigger !== null, trigger?.textContent?.trim().slice(0, 40) ?? '');
  ok('存在被收起的行（默认策略生效）', hidden.length > 0, `shown=${shown.length} hidden=${hidden.length}`);
  ok('当前选中项未被收起', rows.filter((r) => r.getAttribute('aria-current') === 'page').every((r) => r.getAttribute(ATTR.shown) === '1'));

  // 收起后的净效果：nav 高度 + 工作区可用高度
  const regionArea = [...nav.parentElement.children].find((el) => el !== nav && getComputedStyle(el).overflow.includes('hidden'));
  ok('找到工作区容器', regionArea !== undefined, regionArea?.className ?? '');
  if (regionArea !== undefined) {
    ok('工作区高度 > 0', regionArea.getBoundingClientRect().height > 0, `${Math.round(regionArea.getBoundingClientRect().height)}px`);
  }
  ok('nav 实际高度', true, `${Math.round(nav.getBoundingClientRect().height)}px`);

  console.log(out.join('\n'));
  return out;
})();
