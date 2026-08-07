import MindMapLayoutClass from "simple-mind-map/src/layouts/MindMap.js";
import { layoutValueList } from "simple-mind-map/src/constants/constant.js";
import {
	MULTI_ROOT_MIND_MAP_LAYOUT,
	computeMultiRootMindMapLayout,
	toMultiRootLayoutInput
} from "./multiRootMindMapLayout";
import type {
	LayoutSourceNode,
	LayoutNodeResult,
	MultiRootMindMapOptions
} from "./multiRootMindMapLayout";

if (!layoutValueList.includes(MULTI_ROOT_MIND_MAP_LAYOUT)) {
	layoutValueList.push(MULTI_ROOT_MIND_MAP_LAYOUT);
}

const BaseMindMap: any = MindMapLayoutClass;

export class MultiRootMindMapLayout extends BaseMindMap {
	constructor(renderer: unknown, _layout: unknown) {
		super(renderer);
	}

	doLayout(callback: (root: unknown) => void): void {
		this.createNodeInstances();
		const input = toMultiRootLayoutInput(
			this.renderer.renderTree as LayoutSourceNode
		);
		const results = computeMultiRootMindMapLayout(
			input,
			this.getLayoutOptions()
		);
		this.applyLayoutResults(results);
		callback(this.root);
	}

	private createNodeInstances(): void {
		const walk = (
			data: any,
			parent: any,
			isRoot: boolean,
			layerIndex: number,
			index: number,
			ancestors: any[]
		): void => {
			const created = this.createNode(
				data,
				parent,
				isRoot,
				layerIndex,
				index,
				ancestors
			);
			void created;
			if (
				data.data?.expand !== false &&
				data.children &&
				data.children.length > 0
			) {
				data.children.forEach((child: any, childIndex: number) => {
					walk(
						child,
						data,
						false,
						layerIndex + 1,
						childIndex,
						[...ancestors, data]
					);
				});
			}
		};
		walk(this.renderer.renderTree, null, true, 0, 0, []);
	}

	private getLayoutOptions(): MultiRootMindMapOptions {
		return {
			secondMarginX: this.getMarginX(1),
			secondMarginY: this.getMarginY(1),
			nodeMarginX: this.getMarginX(2),
			nodeMarginY: this.getMarginY(2)
		};
	}

	private applyLayoutResults(
		results: Map<string, LayoutNodeResult>
	): void {
		const visit = (data: any): void => {
			const node = data?._node;
			const result = results.get(String(data?.data?.uid ?? ""));
			if (node && result) {
				node.left = result.left;
				node.top = result.top;
				node.dir = result.dir;
			}
			for (const child of data?.children ?? []) {
				visit(child);
			}
		};
		visit(this.renderer.renderTree);
	}
}
