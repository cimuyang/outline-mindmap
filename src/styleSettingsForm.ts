import { Setting } from "obsidian";
import {
	MIND_MAP_LAYOUTS,
	MIND_MAP_SHAPES,
	getSupportedLineStyles,
	resolveEffectiveMindMapStyle
} from "./style";
import type {
	MindMapLayout,
	MindMapShape,
	MindMapStyle
} from "./style";

export class MindMapStyleSettingsForm {
	private style: MindMapStyle;

	constructor(
		private container: HTMLElement,
		initialStyle: MindMapStyle,
		private onChange: (style: MindMapStyle) => void,
		private locked = false,
		private t: (
			text: string,
			vars?: Record<string, string | number>
		) => string = (text) => text
	) {
		this.style = { ...initialStyle };
	}

	render(): void {
		this.container.empty();

		this.renderLayoutSetting();
		this.renderLineStyleSetting();

		this.addNumberSetting(
			this.t("连线圆角"),
			this.t("圆角直线下有效；设为 0 即直角折线。"),
			this.style.lineRadius,
			0,
			40,
			1,
			this.style.lineStyle !== "straight",
			(value) => {
				this.update({ ...this.style, lineRadius: value });
			}
		);
		this.addNumberSetting(
			this.t("连线宽度"),
			this.t("连接线的粗细。"),
			this.style.lineWidth,
			0,
			8,
			0.5,
			false,
			(value) => {
				this.update({ ...this.style, lineWidth: value });
			}
		);
		this.addTextSetting(
			this.t("连线颜色"),
			this.t("留空自动跟随 Obsidian 当前主题。"),
			this.style.lineColor,
			this.t("留空自动"),
			(value) => {
				this.update({ ...this.style, lineColor: value });
			}
		);

		this.addNumberSetting(
			this.t("二级节点水平间距"),
			this.t("第一层节点相对中心主题的距离。"),
			this.style.secondMarginX,
			20,
			300,
			10,
			false,
			(value) => {
				this.update({ ...this.style, secondMarginX: value });
			}
		);
		this.addNumberSetting(
			this.t("二级节点垂直间距"),
			this.t("第一层节点之间的纵向距离。"),
			this.style.secondMarginY,
			0,
			200,
			5,
			false,
			(value) => {
				this.update({ ...this.style, secondMarginY: value });
			}
		);
		this.addNumberSetting(
			this.t("子节点水平间距"),
			this.t("第三级及以下节点的水平距离。"),
			this.style.nodeMarginX,
			10,
			200,
			5,
			false,
			(value) => {
				this.update({ ...this.style, nodeMarginX: value });
			}
		);
		this.addNumberSetting(
			this.t("子节点垂直间距"),
			this.t("第三级及以下节点的纵向距离。"),
			this.style.nodeMarginY,
			0,
			120,
			2,
			false,
			(value) => {
				this.update({ ...this.style, nodeMarginY: value });
			}
		);

		new Setting(this.container)
			.setName(this.t("节点形状"))
			.addDropdown((dropdown) => {
				for (const shape of MIND_MAP_SHAPES) {
					dropdown.addOption(shape, this.shapeLabel(shape));
				}
				dropdown
					.setValue(this.style.shape)
					.onChange((value) => {
						this.update({
							...this.style,
							shape: value as MindMapShape
						});
					});
			});
		this.addTextSetting(
			this.t("节点填充色"),
			this.t("可填写颜色名、HEX、RGB 或 transparent。"),
			this.style.fillColor,
			"transparent",
			(value) => {
				this.update({ ...this.style, fillColor: value });
			}
		);
		this.addTextSetting(
			this.t("节点边框色"),
			this.t("可填写颜色名、HEX、RGB 或 transparent。"),
			this.style.borderColor,
			"transparent",
			(value) => {
				this.update({ ...this.style, borderColor: value });
			}
		);
		this.addNumberSetting(
			this.t("节点边框宽度"),
			this.t("节点边框粗细。"),
			this.style.borderWidth,
			0,
			8,
			0.5,
			false,
			(value) => {
				this.update({ ...this.style, borderWidth: value });
			}
		);
		this.addNumberSetting(
			this.t("节点圆角"),
			this.t("节点形状的圆角大小。"),
			this.style.borderRadius,
			0,
			40,
			1,
			false,
			(value) => {
				this.update({ ...this.style, borderRadius: value });
			}
		);
		this.addNumberSetting(
			this.t("字号"),
			this.t("导图节点文字大小。"),
			this.style.fontSize,
			10,
			32,
			1,
			false,
			(value) => {
				this.update({ ...this.style, fontSize: value });
			}
		);
		if (this.locked) {
			this.container
				.querySelectorAll<HTMLElement>("input, select, button")
				.forEach((el) => el.setAttribute("disabled", "true"));
		}
	}

	setStyle(style: MindMapStyle): void {
		this.style = { ...style };
		this.render();
	}

	getStyle(): MindMapStyle {
		return { ...this.style };
	}

	private renderLayoutSetting(): void {
		new Setting(this.container)
			.setName(this.t("布局"))
			.setDesc(
				this.t("时间线等布局中，多个 H1 仍全部作为根展示。")
			)
			.addDropdown((dropdown) => {
				for (const layout of MIND_MAP_LAYOUTS) {
					dropdown.addOption(layout, this.layoutLabel(layout));
				}
				dropdown
					.setValue(this.style.layout)
					.onChange((value) => {
						this.update(
							resolveEffectiveMindMapStyle({
								...this.style,
								layout: value as MindMapLayout
							})
						);
					});
			});
	}

	private renderLineStyleSetting(): void {
		const supported = getSupportedLineStyles(this.style.layout);
		new Setting(this.container)
			.setName(this.t("连线样式"))
			.setDesc(this.getLineStyleDescription())
			.addDropdown((dropdown) => {
				if (supported.includes("direct")) {
					dropdown.addOption("direct", this.t("斜向直线"));
				}
				if (supported.includes("straight")) {
					dropdown.addOption("straight:0", this.t("直角折线"));
					dropdown.addOption("straight:8", this.t("圆角直线"));
				}
				if (supported.includes("curve")) {
					dropdown.addOption("curve", this.t("曲线"));
				}
				dropdown
					.setValue(this.getLineStyleOptionValue())
					.onChange((value) => {
						this.update({
							...this.style,
							...this.applyLineStyleOption(value)
						});
					});
			});
	}

	private addNumberSetting(
		name: string,
		desc: string,
		value: number,
		min: number,
		max: number,
		step: number,
		disabled: boolean,
		onChange: (value: number) => void
	): void {
		new Setting(this.container)
			.setName(name)
			.setDesc(desc)
			.addSlider((slider) =>
				slider
					.setLimits(min, max, step)
					.setValue(value)
					.setDisabled(disabled)
					.onChange(onChange)
			);
	}

	private addTextSetting(
		name: string,
		desc: string,
		value: string,
		placeholder: string,
		onChange: (value: string) => void
	): void {
		new Setting(this.container)
			.setName(name)
			.setDesc(desc)
			.addText((text) =>
				text
					.setPlaceholder(placeholder)
					.setValue(value)
					.onChange(onChange)
			);
	}

	private update(next: MindMapStyle): void {
		if (this.locked) {
			return;
		}
		const layoutChanged = this.style.layout !== next.layout;
		const lineStyleChanged = this.style.lineStyle !== next.lineStyle;
		this.style = { ...next };
		this.onChange({ ...this.style });
		if (layoutChanged || lineStyleChanged) {
			this.render();
		}
	}

	private getLineStyleOptionValue(): string {
		if (this.style.lineStyle === "direct") {
			return "direct";
		}
		if (this.style.lineStyle === "curve") {
			return "curve";
		}
		return this.style.lineRadius > 0 ? "straight:8" : "straight:0";
	}

	private applyLineStyleOption(value: string): Partial<MindMapStyle> {
		if (value === "direct") {
			return { lineStyle: "direct", lineRadius: 0 };
		}
		if (value === "straight:0") {
			return { lineStyle: "straight", lineRadius: 0 };
		}
		if (value === "curve") {
			return { lineStyle: "curve", lineRadius: 8 };
		}
		return { lineStyle: "straight", lineRadius: 8 };
	}

	private getLineStyleDescription(): string {
		const supported = getSupportedLineStyles(this.style.layout);
		if (supported.length === 1 && supported[0] === "straight") {
			return this.t(
				"当前布局使用固定直线连线，仅可选择直角折线或圆角直线。"
			);
		}
		return this.t("斜向直线、直角折线、圆角直线、曲线。");
	}

	private layoutLabel(layout: MindMapLayout): string {
		const labels: Record<MindMapLayout, string> = {
			logicalStructure: "分支向右",
			logicalStructureLeft: "分支向左",
			mindMap: "分支两侧",
			organizationStructure: "树状图（组织结构）",
			timeline: "时间线",
			timeline2: "时间线 2",
			verticalTimeline: "竖向时间线",
			fishbone: "鱼骨图"
		};
		return this.t(labels[layout]);
	}

	private shapeLabel(shape: MindMapShape): string {
		const labels: Record<MindMapShape, string> = {
			rectangle: "矩形",
			diamond: "菱形",
			parallelogram: "平行四边形",
			roundedRectangle: "圆角矩形",
			octagonalRectangle: "八角矩形",
			outerTriangularRectangle: "外三角矩形",
			innerTriangularRectangle: "内三角矩形",
			ellipse: "椭圆",
			circle: "圆形"
		};
		return this.t(labels[shape]);
	}
}
