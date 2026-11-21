# Outline Mindmap

[中文说明](readme-zh.md) · [Download](https://github.com/cimuyang/outline-mindmap/releases/latest) · [Screenshot](demo1.png)

Turn an Obsidian note’s headings into an editable mind map. Rearrange chapters on the canvas, then open a body card beside a heading to keep writing. The headings, paragraphs and edits all live in the original Markdown file.

![An Obsidian note alongside its editable outline map](demo.gif)

The demo shows an earlier interface. The steps below use the 1.3.11 menu names.

## What makes it useful

- **Edit one note from two views.** Rename a heading in the note and its node updates. Move a branch on the map and its paragraphs and subheadings move with it. Your note stays ordinary Markdown, without extra properties or hidden markers.
- **Write with the outline in view.** Open a section’s body beside its node. Keep several cards open to compare passages, or dock a panel that follows the selected node.
- **Find a passage in context.** Click a sidebar node to reveal its heading in the open note. When you open an Obsidian search result in a map, matching branches can be revealed, with a way back to the source for matches in body text.
- **Choose how each note reads.** Show just the first two heading levels of a long draft, or expand lists and color the branches of a reference note. Save an appearance for one note or make it your default.

## Quick start

1. **Install.** Requires Obsidian 1.7.2 or later. Download `main.js`, `manifest.json` and `styles.css` from [GitHub Releases](https://github.com/cimuyang/outline-mindmap/releases/latest). Place them in your vault’s `.obsidian/plugins/outline-mindmap/` folder, then enable **Outline Mindmap** under **Settings → Community plugins**.
2. **Open a map.** Open a note with headings and click the mind map icon in the left ribbon. The map opens in the right sidebar alongside the note.
3. **Try a two-way edit.** With the note in Editing view, double-click a node, rename it and press `Shift+Enter`. Watch the heading update in the note. Edit that heading in the note to see the change appear on the map.

## Using the map

### Open, follow and navigate

| To… | Do this |
| --- | --- |
| Read the note and map together | Click the ribbon icon. Click a node to scroll the visible note to its source. |
| Open a map in the main workspace | Run **Open mindmap** from the command palette. Under **Opening and following**, choose to follow the active note, keep one fixed or open a map per note. The sidebar has its own setting. |
| Switch the current tab to a map | Choose **Open as mindmap** from the note’s ⋯ menu. Use **Open as note** in the map tab’s menu to return. The plugin can remember the opening view for each note. |
| Navigate a large map | Use the toolbar to fit, zoom, expand or collapse. The menu beside the fold control limits the map to a heading level from H1 to H6. On touch screens, use two fingers to pan and zoom. |
| Browse without editing | Click the toolbar lock. A note in Reading view also locks map edits while keeping folding and navigation available. Switch the note to Editing view to make changes. |

By default, headings from `#` through `######` form the map. To include lists, enable bulleted or numbered nodes separately under **Nodes and editing**. Titles display emphasis, default and colored highlights, inline code, link labels and inline math.

### Edit and move branches

Select a node in an editable map first. Below, `Mod` means `Ctrl` on Windows/Linux and `⌘` on macOS.

| Action | How |
| --- | --- |
| Add a sibling / child | Press `Enter` / `Tab`. Double-click empty canvas space to start another root. |
| Rename a heading | Double-click or press `F2` to edit its Markdown. Press `Shift+Enter` to finish or `Esc` to cancel the title edit. |
| Drag a section | Drop on a node’s top or bottom edge to insert before or after it. Drop in the center to make the branch a child. |
| Move with the keyboard | In plugin settings, open **Interaction → Branch movement hotkeys → Configure**. Assign keys for moving up, moving down, promoting and demoting. All four start unassigned. |
| Copy, cut and paste | `Mod+C` / `Mod+X` copies or cuts the Markdown branch, including its body and folded descendants. `Mod+V` pastes as a child, and `Mod+Shift+V` as a sibling. |
| Delete or undo | `Delete` / `Backspace` removes the selected branch and its body. Use `Mod+Z` to undo and `Mod+Shift+Z` to redo. Undo also works in a map-only tab. |

### Write in body cards

1. In plugin settings, turn on **Body cards → Node body**. Click the body icon beside a node to edit that section, or to preview it in Reading view.
2. Write in Markdown. The card saves after you pause, or immediately with `Mod+S`. Use the header control to switch between reading and editing. If the source changes and conflicts with an edit, the card flags it and keeps your draft on the device.
3. From the card’s **⋯** menu, choose **Keep card open** before opening another passage to compare them. Choose **Dock panel** for a fixed writing area. It docks at the bottom in narrow windows. Drag a floating card by its header or resize it from an edge or corner.

### Style and export

1. In the map toolbar, open **Mindmap → Appearance**. Choose left, right or two-sided branches, then a node shape and connector style. Use **Text only** for a map of labels and lines.
2. Toggle **Color by level** and **Size headings by level** independently. Set the base font size under **Details**, then expand **Customize heading sizes** to adjust H1–H6. List nodes keep the base size. Preview the result, choose **This note** or **Global**, and click **Apply**.
3. Switch to **Export**. Choose the visible branches or expand the entire map, then select a background. More options cover padding, quality and PDF page size. Click PNG, SVG or PDF to export.

## Recent updates

- **1.3.11** · Fixed default highlights and matched all six named colors to the native theme. Added individual H1–H6 sizes with live preview.
- **1.3.10** · Added four assignable branch movement commands, text-only nodes and six-color highlights. Improved title wrapping while renaming.

[Release history](https://github.com/cimuyang/outline-mindmap/releases) · [MIT license](LICENSE)
