/**
 * 界面文案。中英双语，跟随 Obsidian 的界面语言（`moment.locale()`）。
 *
 * - `zh` 表用 `as const` 定型，key 集即类型；`en` 表被类型强制逐 key 对齐——
 *   漏译一条编译不过，两边永远不会悄悄漂移。
 * - 只服务 UI 层（main / view / settings）。core 与 doc 抛的错误信息【不】走这里：
 *   本文件 import obsidian，core 的零依赖铁律优先，且那些错误深植于已测透的代码。
 * - `{0}`、`{1}` … 由 `t()` 的参数依次替换。
 */

import { moment } from 'obsidian'

const zh = {
  // ── 入口与命令（main.ts）──
  'ribbon.open': '在侧边栏打开大纲思维导图',
  'menu.openAsMindmap': '打开为导图',
  'menu.openAsNote': '打开为笔记',
  'command.open': '打开导图',
  'command.openInSidebar': '在侧边栏打开导图',
  'command.perfReport': '性能自检',
  'command.followReport': '跟随自检',
  'notice.openMindmapFirst': '请先打开大纲思维导图。',
  'notice.cannotUndo': '笔记没有在编辑器里打开，无法撤销',
  'notice.operationAborted': '导图操作未完成：{0}',
  'notice.listNodesRequired': '列表项已被忽略，目标位置的层级会超过标题的 6 层上限。',
  'notice.copiedToClipboard': '（已复制到剪贴板）',

  // ── 视图（MindmapView）──
  'view.title': '大纲思维导图',
  'view.titleWithNote': '导图：{0}',
  'view.empty': '当前没有可显示的笔记',

  // ── 跟随自检（MindmapView.diagnostics）──
  'diag.title': '导图跟随自检（{0}，本实例已存活 {1}s）',
  'diag.mainArea': '主页面区',
  'diag.sidebar': '侧边栏',
  'diag.activeNote': '· Obsidian 的活动笔记：{0}',
  'diag.showing': '· 导图正在显示：{0}',
  'diag.treeEmpty': '（树是空的）',
  'diag.none': '（无）',
  'diag.switches': '· 固定显示一篇笔记：{0}／单击即跳转：{1}',
  'diag.on': '开',
  'diag.off': '关',
  'diag.trail': '· 同步留痕（最近 {0} 次，早 → 晚）：',
  'diag.noEvents': '    （一次都没有——事件根本没送到这个视图）',
  'trail.switched': '切到 {0}',
  'trail.blockedByPin': '被「固定显示一篇笔记」挡下',
  'trail.noActive': '此刻没有活动笔记，保持原样',
  'trail.sameNote': '与正在显示的是同一篇，无需切换',

  // ── 性能自检（MindmapView.perfReport）──
  'perf.noNote': '导图性能自检：当前没有可显示的笔记。',
  'perf.title': '导图性能自检（{0} 个可见节点）',
  'perf.layout': '· 布局：{0}',
  'perf.cold': '· 首次渲染：{0}（建全部 DOM + 样式与排版）',
  'perf.warm': '· 重绘：{0}（复用现有 DOM）',
  'perf.needsVirtualize': '首次渲染超过 500ms，按手册 M10 需要引入视口虚拟化。',
  'perf.ok': '首次渲染在 500ms 以内。',

  // ── 工具栏（Toolbar）──
  'tool.fit': '适应画布',
  'tool.zoomOut': '缩小',
  'tool.zoomIn': '放大',
  'tool.layout': '布局',
  'tool.expand': '展开全部',
  'tool.collapse': '折叠全部',
  'tool.style': '样式设置',
  'direction.right': '分支向右',
  'direction.left': '分支向左',
  'direction.both': '分支两侧',

  // ── 样式窗口（StyleModal）──
  'style.title': '导图样式',
  'style.titleWithNote': '导图样式：{0}',
  'style.applyGlobal': '应用全局设置',
  'style.applyFile': '应用单篇笔记设置',
  'style.cancel': '取消',
  'style.noNote': '当前没有打开的笔记',
  'style.hGap': '主题间距 · 横向',
  'style.hGapDesc': '父节点与子节点之间的水平距离。',
  'style.vGap': '主题间距 · 纵向',
  'style.vGapDesc': '相邻分支之间的垂直距离。',
  'style.shape': '节点形状',
  'style.branch': '分支样式',
  'style.scheme': '配色方案',
  'style.fontScale': '字号缩放',
  'style.fontScaleDesc': '1.0 表示跟随主题字号。',
  'style.levelColors': '按层级着色',
  'style.levelColorsDesc': '不同层级的节点用不同的颜色显示文字与边框。',
  'shape.rounded': '圆角矩形',
  'shape.pill': '胶囊',
  'shape.underline': '下划线',
  'branch.straight': '直线',
  'branch.curve': '斜线',
  'branch.elbow': '折线',
  'scheme.theme': '跟随主题',
  'scheme.blue': '蓝',
  'scheme.green': '绿',
  'scheme.warm': '暖',

  // ── 设置页（SettingsTab）──
  'settings.clickToJump': '单击即跳转',
  'settings.clickToJumpDesc':
    '单击导图节点时，把笔记滚动到对应标题并高亮。只滚屏幕上已经开着的笔记，' +
    '不会替你新开标签页；笔记没开着（比如用「打开为导图」进来的）时单击只选中节点。',
  'settings.lockFile': '固定显示一篇笔记',
  'settings.lockFileDesc': '开启后导图不再跟着你切换笔记，一直停在打开它时的那一篇。',
  'settings.gracefulAnimation': '优雅动画',
  'settings.gracefulAnimationDesc': '节点位置变化时做一段过渡动画。节点较多时会明显变卡，默认关闭。',
  'settings.strictLineBreak': '严格换行',
  'settings.strictLineBreakDesc': '新增或移动节点时，在相邻的两个标题之间补足 3 个空行。关闭后只写必要的那一行。',
  'settings.listNodes': '把列表项显示为节点',
  'settings.listNodesDesc':
    '开启后，标题下的列表项作为更深层的导图节点（第 7 层起）。' +
    '关闭后列表只算正文，导图仅由标题构成。',
} as const

export type MsgKey = keyof typeof zh

const en: Record<MsgKey, string> = {
  // ── Entry & commands (main.ts) ──
  'ribbon.open': 'Open outline mindmap in sidebar',
  'menu.openAsMindmap': 'Open as mindmap',
  'menu.openAsNote': 'Open as note',
  'command.open': 'Open mindmap',
  'command.openInSidebar': 'Open mindmap in sidebar',
  'command.perfReport': 'Performance report',
  'command.followReport': 'Follow report',
  'notice.openMindmapFirst': 'Open a mindmap view first.',
  'notice.cannotUndo': 'The note is not open in an editor, so there is nothing to undo.',
  'notice.operationAborted': 'Mindmap action not completed: {0}',
  'notice.listNodesRequired':
    'List items are ignored, so the target position would exceed the 6-level heading limit.',
  'notice.copiedToClipboard': '(copied to clipboard)',

  // ── View (MindmapView) ──
  'view.title': 'Outline mindmap',
  'view.titleWithNote': 'Mindmap: {0}',
  'view.empty': 'No note to display',

  // ── Follow diagnostics (MindmapView.diagnostics) ──
  'diag.title': 'Mindmap follow diagnostics ({0}, instance alive for {1}s)',
  'diag.mainArea': 'main area',
  'diag.sidebar': 'sidebar',
  'diag.activeNote': '· Obsidian active note: {0}',
  'diag.showing': '· Mindmap is showing: {0}',
  'diag.treeEmpty': ' (tree is empty)',
  'diag.none': '(none)',
  'diag.switches': '· Pin to one note: {0} / Click to jump: {1}',
  'diag.on': 'on',
  'diag.off': 'off',
  'diag.trail': '· Sync trail (last {0}, early → late):',
  'diag.noEvents': '    (none at all — no event ever reached this view)',
  'trail.switched': 'switched to {0}',
  'trail.blockedByPin': 'blocked by "pin to one note"',
  'trail.noActive': 'no active note at this moment, kept as is',
  'trail.sameNote': 'same note already shown, no switch needed',

  // ── Performance report (MindmapView.perfReport) ──
  'perf.noNote': 'Performance report: no note to display.',
  'perf.title': 'Performance report ({0} visible nodes)',
  'perf.layout': '· Layout: {0}',
  'perf.cold': '· First render: {0} (build all DOM + style & layout)',
  'perf.warm': '· Repaint: {0} (reusing existing DOM)',
  'perf.needsVirtualize': 'First render exceeds 500ms; viewport virtualization is required.',
  'perf.ok': 'First render is within 500ms.',

  // ── Toolbar ──
  'tool.fit': 'Fit to canvas',
  'tool.zoomOut': 'Zoom out',
  'tool.zoomIn': 'Zoom in',
  'tool.layout': 'Layout',
  'tool.expand': 'Expand all',
  'tool.collapse': 'Collapse all',
  'tool.style': 'Style settings',
  'direction.right': 'Branches right',
  'direction.left': 'Branches left',
  'direction.both': 'Both sides',

  // ── Style modal (StyleModal) ──
  'style.title': 'Mindmap style',
  'style.titleWithNote': 'Mindmap style: {0}',
  'style.applyGlobal': 'Apply as global style',
  'style.applyFile': 'Apply to this note',
  'style.cancel': 'Cancel',
  'style.noNote': 'No note is open',
  'style.hGap': 'Spacing · horizontal',
  'style.hGapDesc': 'Horizontal distance between a parent and its children.',
  'style.vGap': 'Spacing · vertical',
  'style.vGapDesc': 'Vertical distance between sibling branches.',
  'style.shape': 'Node shape',
  'style.branch': 'Branch style',
  'style.scheme': 'Color scheme',
  'style.fontScale': 'Font scale',
  'style.fontScaleDesc': '1.0 follows the theme font size.',
  'style.levelColors': 'Color by level',
  'style.levelColorsDesc': 'Show node text and border in a color that depends on the level.',
  'shape.rounded': 'Rounded rectangle',
  'shape.pill': 'Pill',
  'shape.underline': 'Underline',
  'branch.straight': 'Straight',
  'branch.curve': 'Curve',
  'branch.elbow': 'Elbow',
  'scheme.theme': 'Follow theme',
  'scheme.blue': 'Blue',
  'scheme.green': 'Green',
  'scheme.warm': 'Warm',

  // ── Settings (SettingsTab) ──
  'settings.clickToJump': 'Click to jump',
  'settings.clickToJumpDesc':
    'Clicking a node scrolls the note to the matching heading and highlights it. ' +
    'Only notes already on screen are scrolled — no new tabs are opened. ' +
    'When the note is not open (e.g. after "Open as mindmap"), clicking only selects the node.',
  'settings.lockFile': 'Pin to one note',
  'settings.lockFileDesc': 'The mindmap stops following note switches and stays on the note it was opened with.',
  'settings.gracefulAnimation': 'Graceful animation',
  'settings.gracefulAnimationDesc': 'Animate node position changes. Noticeably slower with many nodes; off by default.',
  'settings.strictLineBreak': 'Strict line breaks',
  'settings.strictLineBreakDesc': 'When adding or moving nodes, pad to exactly 3 blank lines between adjacent headings. When off, only the necessary line is written.',
  'settings.listNodes': 'Show list items as nodes',
  'settings.listNodesDesc':
    'When on, list items under headings become deeper mindmap nodes (level 7 and beyond). ' +
    'When off, lists count as body text and the map is built from headings only.',
}

/** 当前语言该用的那张表。zh-* 一律归中文，其余归英文。 */
function table(): Record<MsgKey, string> {
  return moment.locale().startsWith('zh') ? zh : en
}

/** 取一条界面文案。`{0}`、`{1}` … 会被参数依次替换。 */
export function t(key: MsgKey, ...args: (string | number)[]): string {
  let s = table()[key]
  for (let i = 0; i < args.length; i++) {
    s = s.replaceAll(`{${i}}`, String(args[i]))
  }
  return s
}
