# Outline Mindmap

**English** · [中文](readme-zh.md) · [插件介绍（可在 Obsidian 里直接打开的演示笔记）](插件介绍.md)

Render the heading outline of a Markdown note as a mindmap, with **two-way live editing**.

Edit a node in the map and you are editing that line of the note; type a character in the note
and the map follows immediately. They are two views of one piece of data — there is no third
copy of the state.

![](https://github.com/cimuyang/outline-mindmap/blob/main/demo.mp4)

## Features

1. **Plain Markdown in, clean Markdown out**: Headings and lists become a mindmap on their own — no YAML, no injected properties, no hidden comments. Every setting lives in the plugin's own `data.json`. Your Markdown stays Markdown, and stays usable anywhere.
2. **Two-way live sync**: Edit the note and the map follows; drag a node and the note updates. Write-back replaces only that line — every byte outside it is untouched — and one action is one undo, so the two sides never drift apart.
3. **Click to locate**: Click a node and the note scrolls to the matching line and highlights it; double-click to rename. After you add, rename or drag a node, the note stays right where you were working — outline and prose, no seam in between.
4. **Drag to rearrange**: Drop on a node's top or bottom edge to insert before or after, drop in the middle to make it a child, drop on empty space to start a new root. Cross the 6th level and headings and list items convert automatically — with the body text underneath moving along.
5. **Keyboard-first**: `Enter` for a sibling, `Tab` for a child, arrow keys to move around, `Delete` to remove a whole subtree, `Esc` to abandon anything without writing a byte. Your hands never leave the keys.
6. **Styles worth looking at**: Shape, colours, font size and spacing are all yours to tune; edges can be straight, diagonal or elbow; branches can grow right, left, or split evenly to both sides. Global and per-note levels, live preview as you drag a slider, and Cancel puts it all back.
7. **Smooth animation, if you want it**: Node movement, layout changes and expand/collapse can all glide. It ships off — that smoothness is your call. What never changes: after a collapse, the node you just clicked is still dead centre.

## Three lines that will never be crossed

1. **Never writes frontmatter, never writes tags.** Every setting and style lives in the
   plugin's own `data.json`. Not one extra byte goes into your note.
2. **Never rewrites a file wholesale.** Every write-back is a minimal replacement of a specific
   line range; every byte outside that range stays identical — your hand-made blank lines,
   indentation and line endings (LF / CRLF) are preserved exactly.
3. **One action = one undo.** All writes go through editor transactions, so `Ctrl+Z` takes you
   straight back.

## Install

Not in the community plugin browser yet, so install manually:

1. Copy `main.js`, `manifest.json` and `styles.css` into
   `<your vault>/.obsidian/plugins/outline-mindmap/`
2. Enable **大纲思维导图 / Outline Mindmap** under *Settings → Community plugins*

`main.js` is committed in this repository, so you can download the three files directly —
no build step required.

Building from source:

```bash
npm install
npm run build     # type-check + bundle into main.js
```

## Usage

Three ways to open the map:

- The mindmap icon in the left ribbon → opens in the **right sidebar**
- Command palette → *打开大纲思维导图* (Open outline mindmap) → opens as a **tab in the main area**
- Command palette → *在侧边栏打开大纲思维导图* (Open outline mindmap in the sidebar)

Both forms can be open at the same time without interfering. The map follows the active note by
default; turn on **锁定当前笔记** (Pin current note) in the settings to keep it on one note.

### How a note becomes a map

| In the note | Level in the map |
| --- | --- |
| `# Heading` … `###### Heading` | Levels 1–6 |
| `- list item` (one level = 4 spaces or one tab of indent) | Level 7 and deeper |
| Body paragraphs under a heading | Not shown, but **move together with their heading** |
| A `#` inside a fenced code block | Not a heading, never appears in the map |

Inline markup in node text — `**bold**`, `*italic*`, `` `code` ``, `[link]()`, `==highlight==` —
is rendered as such.

### Keyboard

| Key | Action |
| --- | --- |
| `↑` `↓` | Previous / next node: siblings first, then out to the enclosing level |
| `→` (the "go in" direction) | Expand a collapsed branch, or enter its first child if already expanded |
| `←` (the "go back" direction) | Collapse an expanded branch, or go to the parent if already collapsed |
| `Enter` | Add a sibling after the current node |
| `Tab` | Add a child to the current node |
| `F2` / double-click a node | Rename |
| `Delete` / `Backspace` | Delete the selected node and its whole subtree |
| `Ctrl/⌘ + Z` | Undo (forwarded to the editor) |
| `Esc` | Abandon the current edit or drag — not a single character is written |
| Double-click empty space | Create a new free root node |
| `Ctrl/⌘ + click` | Add to / remove from the selection (for deleting a batch) |
| Drag a node | Reorder: drop on a node's top/bottom edge = insert before / after, drop in the middle = become its child, drop on empty space = become a new root |
| Wheel | Pan; hold `Ctrl/⌘` to zoom around the pointer |

Left and right on the arrow keys are interpreted **relative to the direction the node grows**:
when a branch runs leftwards, `←` is the key that takes you *into* its children.

### Toolbar

Fit to canvas · Zoom out · Zoom in · Layout (branches right / left / both sides) ·
Expand all · Collapse all · Style settings.

*Branches on both sides* splits the root's branches into two balanced columns **by subtree size**.

## Settings

| Toggle | Default | What it does |
| --- | --- | --- |
| 单击即跳转 (Click to jump) | On | Clicking a node scrolls the editor to the matching heading and highlights it; after you create / rename / delete / drag a node in the map, the note also stays at that node. Turn it off and a click only selects — the editor never scrolls |
| 锁定当前笔记 (Pin current note) | Off | The map stops following the active note |
| 优雅动画 (Smooth animation) | **Off** | Smooth transitions for node movement, layout switching and the viewport follow on expand/collapse. Noticeably slower with many nodes |
| 严格换行 (Strict blank lines) | On | When adding / moving nodes, pad adjacent headings to 3 blank lines apart |

Styles — shape, colour scheme, font size, horizontal and vertical gaps, branch style
(**straight / diagonal / elbow**) — come in two levels, **global** and **per-note**: a note with
no style of its own uses the global one. While the style window is open, dragging a slider
previews live, and *Cancel* restores. Per-note styles are keyed by file path and are migrated or
cleaned up automatically when you rename, move or delete a note.

## Performance

Every stage is designed for 1000 nodes: text measurement goes through an offscreen canvas
(never a per-node `offsetWidth` read), node DOM is claimed and released rather than rebuilt, all
edges are merged into a single `<path>`, pan and zoom write one container `transform`, and every
event is delegated to the layer (17 DOM listeners for the whole view, independent of node count).

The repository ships a 1000-node stress note (`bench/1000节点压力测试笔记.md` — 1000 nodes over
8 levels: 6 heading levels plus 2 list levels, with long headings, inline markup, body text and
code blocks), generated deterministically by `node scripts/gen-stress-note.mjs`.

`npm test` runs the pure-computation part against that corpus (measured on Windows 11 / Node 22):

| Stage | 1000 nodes |
| --- | --- |
| Parse (`parse`) | ≈ 0.6ms |
| Reconcile (`reconcile`, keeps ids and collapsed state) | ≈ 0.3ms |
| Layout (each of the three directions) | ≈ 0.2–0.3ms |
| Opening a note end to end | ≈ 0.6–1.3ms |
| Building 1000 edges (straight / diagonal / elbow) | ≈ 0.2–0.3ms |
| Ten `Enter` presses in a row (each on the previous text) | ≈ 2ms each |

The DOM half can only be measured for real inside Obsidian: open the stress note as a map and
run the command **导图性能自检** (Mindmap self-check), which reports how many milliseconds
layout, first render (rebuilding all DOM) and redraw actually took.

## Known limitations

- Text-only maps: no summaries, no free-form connections, no images, notes or formulas.
- Collapsed state is not persisted; switching notes resets it.
- Task list items `- [ ]` are treated as plain text; ordered lists are read fine but written
  back as `-`.
- Multi-select (`Ctrl/⌘ + click`) is for batch deletion only, not batch drag.
- All of the above are deliberately deferred to v2, not oversights.

## Development

```bash
npm run dev        # watch build
npm run typecheck  # strict type-check
npm test           # 460 unit tests
```

The directory layering is a hard constraint: `core/` (parsing, serialisation, structural
operations) and `layout/` (the layout algorithm) **must not import any Obsidian API** — they are
pure functions with unit tests. Only `doc/DocumentBridge.ts` touches file I/O, and only `view/`
touches the DOM.

## License

MIT — see [LICENSE](LICENSE).
