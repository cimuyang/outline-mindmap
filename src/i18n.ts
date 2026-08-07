// 界面语言模块：中文文案即 key，英文文案按 key 查找。
// 未收录的 key 会回退为中文原文，避免出现空白或乱码。

export type UILanguage = "zh" | "en";
export type LanguageSetting = "auto" | "zh" | "en";

export const EN_TRANSLATIONS: Record<string, string> = {
	// 命令
	"打开大纲思维导图": "Open Outline Mindmap",
	"在右侧边栏打开大纲思维导图": "Open Outline Mindmap in Sidebar",
	"将当前 H7+ 列表转为导图节点": "Convert current H7+ list to a map node",
	"将当前导图节点转回普通正文": "Convert current map node back to body text",

	// 提示
	"请先打开一篇 Markdown 笔记": "Open a Markdown note first",
	"当前行不是 H6 标题下的 H7+ 列表":
		"The current line is not an H7+ list under an H6 heading",
	"当前列表已是导图节点": "This list is already a map node",
	"已转为导图节点": "Converted to a map node",
	"当前列表不是导图节点": "This list is not a map node",
	"已转回普通正文": "Converted back to body text",
	"写回 Markdown 失败，请重试":
		"Failed to write back to Markdown. Please try again",
	"非法移动已被拒绝": "Invalid move rejected",
	"无法提升为根节点": "Could not promote to a root node",
	"无法定位到文章对应位置": "Could not locate the position in the note",
	"笔记已被删除": "Note has been deleted",
	"无法读取笔记内容": "Could not read the note",
	"笔记中没有标题": "The note has no headings",
	"渲染失败，请重试": "Rendering failed. Please try again",
	"解析 Markdown 失败": "Failed to parse Markdown",
	"渲染思维导图失败": "Failed to render the mind map",

	// 视图
	"未打开笔记": "No note open",
	"锁定当前笔记": "Pin current note",
	"跟随活动笔记": "Follow active note",
	"单击即跳转": "Click to jump",
	"适应画布": "Fit to canvas",
	"设置当前笔记样式": "Style current note",
	"“当前笔记样式”为 Pro 专属功能，请先在插件设置中激活。":
		"Note styling is a Pro feature. Activate it in plugin settings first.",
	"双击空白处新建根节点": "Double-click empty space to create a root node",
	"重新加载": "Reload",

	// 单篇样式弹窗
	"单篇笔记样式": "Note Style",
	"操作": "Actions",
	"应用全局设置": "Apply global settings",
	"应用单篇笔记设置": "Apply note-specific settings",
	"取消": "Cancel",
	"应用全局设置失败，请重试":
		"Failed to apply global settings. Please try again",
	"保存单篇笔记样式失败，请重试":
		"Failed to save note-specific styles. Please try again",

	// 设置-常规
	"常规": "General",
	"建议保持开启；开启后单击导图节点会定位到 Markdown 对应行，双击节点直接编辑。":
		"Recommended on. Clicking a node locates the matching line in Markdown; double-click edits the node.",
	"建议保持关闭；开启后新打开或重新打开导图视图会固定到当前笔记，不影响已打开视图。":
		"Recommended off. When on, newly opened mind map views are pinned to the current note; existing views are unaffected.",
	"严格空行": "Strict blank lines",
	"建议保持开启；开启时新建/移动标题会预留正文空行，关闭时只补一个常规空行。":
		"Recommended on. Creating or moving headings reserves a blank line; when off, only a regular blank line is added.",
	"界面语言": "Interface language",
	"默认跟随 Obsidian 语言；可手动固定为中文或 English。":
		"Follows the Obsidian language by default; you can also set Chinese or English manually.",
	"跟随 Obsidian": "Follow Obsidian",
	"中文": "Chinese",
	"English": "English",
	"恢复本分区默认": "Restore defaults",
	"将“{name}”分区恢复为建议值并保存。":
		"Restore the \"{name}\" section to recommended values and save.",
	"恢复": "Restore",

	// 设置-激活
	"激活": "Activate",
	"激活状态": "Activation status",
	"已激活 Pro（终身版）；到期 {expires}，订单 {order}。":
		"Pro activated (lifetime); expires {expires}, order {order}.",
	"未激活；激活后可解锁“优雅动画”与“思维导图样式”。":
		"Not activated. Activate to unlock \"Elegant animation\" and \"Mind map styles\".",
	"机器码": "Machine code",
	"请将机器码连同订单截图发送给作者，以换取激活码。":
		"Send this machine code with your order screenshot to the author to receive a license key.",
	"64 位十六进制机器码": "64-character hexadecimal machine code",
	"（计算中…）": "(calculating…)",
	"复制": "Copy",
	"激活码": "License key",
	"粘贴 PRO- 开头的激活码并点击“激活”。":
		"Paste the PRO- license key and click \"Activate\".",
	"机器码尚未生成，请稍后重试。":
		"The machine code is not ready yet. Please try again shortly.",
	"机器码已复制": "Machine code copied",
	"复制失败，请手动选择复制": "Copy failed. Please select and copy manually",
	"请输入激活码。": "Please enter a license key.",
	"激活成功，Pro 功能已解锁": "Activated successfully. Pro features are now unlocked",
	"激活码格式不正确，请检查后重试。":
		"The license key format is invalid. Please check and try again.",
	"激活码无效或已被篡改，请联系作者。":
		"The license key is invalid or has been tampered with. Contact the author.",
	"激活码档位或版本不受支持。":
		"The license key tier or version is not supported.",
	"激活码与当前设备不匹配（可能设备码已变化），请确认后重试或联系作者换绑。":
		"The license key does not match this device (the machine code may have changed). Check and try again, or contact the author to transfer.",
	"激活码已过期。": "The license key has expired.",
	"激活失败，请重试。": "Activation failed. Please try again.",

	// 设置-Pro 锁定
	"优雅动画": "Elegant animation",
	"优雅动画（Pro）": "Elegant animation (Pro)",
	"思维导图样式": "Mind map styles",
	"思维导图样式（Pro）": "Mind map styles (Pro)",
	"Pro 专属": "Pro feature",
	"“{name}”为 Pro 专属功能，激活后可解锁全部选项。":
		"\"{name}\" is a Pro feature. Activate to unlock all options.",
	"前往激活": "Go to Activation",
	"“{name}”为 Pro 专属，激活后可用。":
		"\"{name}\" is Pro-only. Available after activation.",

	// 设置-优雅动画
	"动画开关": "Animation toggle",
	"建议开启；展开或收起节点时使用更平滑的位移动画，并自动调整视野。节点数量较多时，建议关闭以保证大图流畅。":
		"Recommended on. Expanding or collapsing nodes uses smoother motion and auto-adjusts the view. With many nodes, turn it off for smoother performance.",
	"动画速度": "Animation speed",
	"当前 {speed}x；建议按画面流畅度调整，节点较多时适当降低。":
		"Currently {speed}x. Adjust for smoothness; lower it when the map is large.",
	"微弹性收尾": "Subtle spring finish",
	"建议保持关闭以获得平滑稳定的收尾；需要轻微回弹时再开启。":
		"Recommended off for a smooth, stable finish. Turn on for a slight bounce.",

	// 设置-思维导图样式
	"样式模板": "Style templates",
	"选择模板会填入下方自定义项；点击“保存全局样式”后才会应用到导图。":
		"Selecting a template fills the custom options below; click \"Save global style\" to apply it.",
	"自定义": "Custom",
	"简洁大纲": "Minimal outline",
	"经典思维导图": "Classic mind map",
	"卡片风": "Card style",
	"保存后应用到所有已打开的导图视图；样式只存插件数据，不修改 Markdown。":
		"Applies to all open mind map views. Styles are stored in plugin data only and do not modify Markdown.",
	"保存全局样式": "Save global style",

	// 样式表单
	"布局": "Layout",
	"时间线等布局中，多个 H1 仍全部作为根展示。":
		"In layouts like the timeline, multiple H1 headings are still all shown as roots.",
	"连线样式": "Line style",
	"当前布局使用固定直线连线，仅可选择直角折线或圆角直线。":
		"This layout uses fixed straight lines; you can choose right-angle or rounded lines.",
	"斜向直线、直角折线、圆角直线、曲线。":
		"Diagonal, right-angle, rounded, or curved lines.",
	"连线圆角": "Line corner radius",
	"圆角直线下有效；设为 0 即直角折线。":
		"Applies to rounded straight lines; set to 0 for right angles.",
	"连线宽度": "Line width",
	"连接线的粗细。": "The thickness of the connecting lines.",
	"连线颜色": "Line color",
	"留空自动跟随 Obsidian 当前主题。":
		"Leave empty to follow the current Obsidian theme.",
	"留空自动": "Auto",
	"二级节点水平间距": "Second-level horizontal margin",
	"第一层节点相对中心主题的距离。":
		"The distance of first-level nodes from the central topic.",
	"二级节点垂直间距": "Second-level vertical margin",
	"第一层节点之间的纵向距离。":
		"The vertical distance between first-level nodes.",
	"子节点水平间距": "Child node horizontal margin",
	"第三级及以下节点的水平距离。":
		"The horizontal distance of nodes at level three and below.",
	"子节点垂直间距": "Child node vertical margin",
	"第三级及以下节点的纵向距离。":
		"The vertical distance of nodes at level three and below.",
	"节点形状": "Node shape",
	"节点填充色": "Node fill color",
	"可填写颜色名、HEX、RGB 或 transparent。":
		"Use a color name, HEX, RGB, or transparent.",
	"节点边框色": "Node border color",
	"节点边框宽度": "Node border width",
	"节点边框粗细。": "The thickness of the node border.",
	"节点圆角": "Node corner radius",
	"节点形状的圆角大小。": "The corner radius of the node shape.",
	"字号": "Font size",
	"导图节点文字大小。": "The text size of map nodes.",

	// 布局标签
	"分支向右": "Branches right",
	"分支向左": "Branches left",
	"分支两侧": "Both sides",
	"树状图（组织结构）": "Organization chart",
	"时间线": "Timeline",
	"时间线 2": "Timeline 2",
	"竖向时间线": "Vertical timeline",
	"鱼骨图": "Fishbone",

	// 连线标签
	"斜向直线": "Diagonal line",
	"直角折线": "Right-angle line",
	"圆角直线": "Rounded line",
	"曲线": "Curve",

	// 形状标签
	"矩形": "Rectangle",
	"菱形": "Diamond",
	"平行四边形": "Parallelogram",
	"圆角矩形": "Rounded rectangle",
	"八角矩形": "Octagonal rectangle",
	"外三角矩形": "Outer triangle rectangle",
	"内三角矩形": "Inner triangle rectangle",
	"椭圆": "Ellipse",
	"圆形": "Circle"
};

export function isLanguageSetting(value: unknown): value is LanguageSetting {
	return value === "auto" || value === "zh" || value === "en";
}

export function detectObsidianLanguage(): UILanguage {
	try {
		const stored = window.localStorage.getItem("language");
		if (stored) {
			const lower = stored.toLowerCase();
			if (lower.startsWith("zh")) {
				return "zh";
			}
			if (lower.startsWith("en")) {
				return "en";
			}
		}
	} catch {
		// 忽略：部分环境无 localStorage
	}
	try {
		const anyWindow = window as unknown as {
			moment?: { locale?: () => string };
		};
		const locale = anyWindow.moment?.locale?.() ?? "";
		const lower = locale.toLowerCase();
		if (lower.startsWith("zh")) {
			return "zh";
		}
		if (lower.startsWith("en")) {
			return "en";
		}
	} catch {
		// 忽略
	}
	try {
		const nav = (navigator.language ?? "").toLowerCase();
		if (nav.startsWith("zh")) {
			return "zh";
		}
		if (nav.startsWith("en")) {
			return "en";
		}
	} catch {
		// 忽略
	}
	return "zh";
}

export function resolveUILanguage(setting: LanguageSetting): UILanguage {
	if (setting === "zh" || setting === "en") {
		return setting;
	}
	return detectObsidianLanguage();
}

export function translate(
	text: string,
	lang: UILanguage,
	vars?: Record<string, string | number>,
	enOverride?: string
): string {
	let result =
		lang === "zh" ? text : (enOverride ?? EN_TRANSLATIONS[text] ?? text);
	if (vars) {
		for (const [key, value] of Object.entries(vars)) {
			result = result.split(`{${key}}`).join(String(value));
		}
	}
	return result;
}

export class I18n {
	private lang: UILanguage = "zh";

	setLanguage(lang: UILanguage): void {
		this.lang = lang;
	}

	get language(): UILanguage {
		return this.lang;
	}

	t(
		text: string,
		vars?: Record<string, string | number>,
		enOverride?: string
	): string {
		return translate(text, this.lang, vars, enOverride);
	}
}
