# outline-mindmap
Minimalist and intuitive outline mind mapping using only the purest Markdown syntax, leaving no redundant code in your note files. Click to locate instantly, featuring real-time bi-directional synchronization between the mind map and notes. Obsidian 插件：极简直观的思维导图，仅使用最纯粹的 Markdown 语法，笔记文件中不会留下任何冗余代码。点击即可快速定位，思维导图和笔记之间实现实时双向同步。

[英文](https://github.com/cimuyang/outline-mindmap/edit/main/README.md)  [中文](https://github.com/cimuyang/outline-mindmap/blob/main/readme-zh.md)

![](https://github.com/cimuyang/outline-mindmap/blob/main/demo%20animation.gif)

# Outline Mindmap — Obsidian Plugin

> A minimal, intuitive outline mind map built purely on Markdown: no extra code in your files, click any node to locate it, and the map stays in real-time sync with your notes.

## Key Features

- **Strict Markdown, zero note pollution**: Headings and lists become the map automatically — no YAML, no properties, no hidden comments. Your Markdown stays plain Markdown: clean, portable, and yours.
- **Elegant animation (Pro)**: Expanding and collapsing feels like water — smooth, Apple-style easing, and the node you're working on glides right into the center of view. Large trees never shrink into an unreadable blob; distant moves are slow and steady, close ones feel snappy. Speed is adjustable, an optional micro-bounce finish is available, and any interaction interrupts instantly.
- **Two-way real-time sync**: Edit the note, the map follows. Drag the map, the note updates. One write-back, one undo — both sides always in sync.
- **Click to locate**: Click any node to jump straight to its Markdown line with a highlight; double-click to edit the text in place, moving effortlessly between outline and body.
- **Drag to restructure**: Drag nodes to change levels and convert types automatically, with ordered lists renumbering themselves; drag onto blank space to promote a node into a brand-new root.
- **Keyboard-first**: Tab for a child node, Enter for a sibling, Space to collapse, Delete to remove — no mouse required, and Chinese IME composition never triggers shortcuts by accident.
- **Multi-select & batch**: Ctrl-click or marquee-select nodes, then batch delete or batch move to tidy your outline in one shot.
- **Diverse map styles (Pro)**: 8 layouts, 4 line styles, multiple theme templates, and deep customization — all looking great in both light and dark themes.

## Basic Introduction

### What It Is

Outline Mindmap is a desktop Obsidian plugin that renders the current note as a directory-style mind map in real time, editing bidirectionally with Markdown. It doesn't "draw" your note into an image — it translates your headings and list structure directly into a map: H1 becomes the root node, H2–H6 expand level by level, lists go even deeper, and ordinary paragraphs stay put as body text. Think of the map as the structural view of your note; body and map always correspond one-to-one.

### How to Open

- Command palette (Ctrl+P) → **Open Outline Mindmap**: opens in a new tab.
- Command palette → **Open Outline Mindmap in Right Sidebar**: pins the map to the right sidebar, ready whenever you are.
- The view follows your active note by default and switches automatically as you move between notes; click the **pin** button in the title bar to lock the current note.
- The toolbar keeps four buttons: Pin/Follow, Click-to-Jump, Fit to Canvas, and Note Style Settings.

### Syntax & Data Rules: Pure to the Core

- **Markdown is the single source of truth**: Every node, level, and order in the map comes from the note itself. The plugin only stores settings, styles, and view state in its own data file — it never writes properties, YAML, tags, or hidden comments into your note.
- **What becomes a node**: H1–H6 headings; ordered, unordered, and task lists, nested ones included. H1 is the root; multiple H1s mean multiple roots; if there's no H1, the first H2 (or deeper) heading becomes the root.
- **What stays out of the map**: Ordinary paragraphs, quotes, tables, code blocks, callouts, and the like are treated as "hidden body" — attached to the nearest structural node and kept exactly as they are.
- **Level rules**: Heading levels use `#`, and headings must be flush-left, up to 6 levels (H1–H6); level 7 and beyond are expressed with list indentation. When the plugin creates or rewrites lists, it uses Tab indentation (one Tab per level); existing space-indented lines stay untouched unless moved or rewritten.
- **Strict blank lines (on by default)**: Creating or moving a heading automatically reserves 3 blank lines, so you can write body text right between headings; turn this off and only 1 regular blank line is added. Blocks the plugin touches follow "one blank line before a heading, one after, and one between paragraphs," but your existing notes are never reformatted automatically.
- **Task lists**: `- [ ] / - [x]` become nodes directly, with checkbox states preserved and restored exactly on write-back.
- **Frontmatter**: Ignored entirely — it never enters the map and is never modified.
- **Inline Markdown**: Node text supports bold, italics, strikethrough, inline code, standard links, Obsidian wikilinks, highlights `==text==`, bold-italic `***text***`, and nested combinations. You see the raw source while editing and the rendered result after; raw HTML is not allowed in nodes.

### Two-Way Real-Time Sync

- **Note → map**: Editor input is watched with a 16ms debounce, and multiple text changes in one pass are batched into a single lightweight refresh. Structural changes keep the old canvas as a mask while rebuilding, so you never see a flicker.
- **Map → note**: Every add, edit, drag, and batch operation produces standard Markdown. When the note is open in the editor, one transactional write-back equals one undo step; when it isn't open, the file is written directly (no undo).
- **Loop protection**: The plugin's own write-backs never trigger redundant refreshes or re-parse their own output, so both sides always stay consistent.

### Common Operations

- **Locate & highlight**: With Click-to-Jump enabled (on by default), clicking a node jumps to the matching Markdown line after about 300ms and highlights the text (excluding `#`, `-`, and task markers). Double-clicking edits without jumping; clicking anywhere in the Markdown clears the highlight; if the note isn't open, it opens and locates the line for you.
- **Edit**: Double-click or press F2. While editing, Enter confirms, Esc cancels, and Tab confirms and adds a child node. After submitting, the editor cursor stays on the node's line instead of jumping back to the top.
- **Create**: Tab (or the + button beside a node) creates a child, Enter creates a sibling below, Shift+Enter creates a sibling above. Double-clicking blank canvas appends a new H1 root at the end of the file and starts editing right away.
- **Drag**: Drop targets are clearly distinguished — become a child, insert above, or insert below — and types convert automatically: a list node dropped at root or heading level (new depth ≤ 6) becomes the matching H1–H6 heading, while a heading dropped into list levels converts its entire subtree to lists. Invalid targets show a forbidden state and spring back; dragging onto blank space promotes the node to an H1 root at the end of the file.
- **Multi-select & batch**: Ctrl/Command-click to add or remove nodes from the selection, or drag a marquee across blank canvas. Batch delete and batch move preserve relative order, levels, types, hidden body, and ordered numbering in a single write-back.
- **Collapse & canvas**: Nodes collapse and expand subtrees; Ctrl+wheel or Ctrl+= / Ctrl+- zooms, Ctrl+0 fits the canvas, and holding Space while dragging pans. Collapse state, zoom, and pan are remembered per note and restored when you close and reopen it.
- **Delete**: Deleting a node also cleans up its hidden body and extra blank lines, normalizing whitespace around the deletion point.

### Shortcut Reference

| Context | Keys | Action |
| --- | --- | --- |
| Not editing | Tab | Add child node |
| Not editing | Enter | Add sibling below |
| Not editing | Shift+Enter | Add sibling above |
| Not editing | Delete | Delete selected node(s) and subtrees (batch supported) |
| Not editing | F2 / Double-click | Edit node |
| Not editing | Arrow keys | Move selection in the layout direction |
| Not editing | Space | Collapse / expand |
| Not editing | Ctrl/Command+Click | Multi-select / deselect |
| Editing | Enter | Confirm and exit editing |
| Editing | Esc | Cancel and restore |
| Editing | Tab | Confirm and add child node |
| Any | Ctrl+Wheel / Ctrl+= / Ctrl+- | Zoom |
| Any | Ctrl+0 | Fit to canvas |
| Any | Hold Space + drag blank space | Pan canvas |

### Styles & Settings

- **8 layouts**: Branch Right (default), Branch Left, Branch on Both Sides, Tree/Org Chart, Timeline, Timeline 2, Vertical Timeline, Fishbone. The canvas auto-fits after each switch.
- **4 line styles**: Diagonal straight lines, right-angle polylines, rounded straight lines (default), and curves.
- **Theme templates**: Minimal Outline, Classic Mind Map, Card Style, Timeline, and more — plus full customization of layout, line style, node spacing, node shape, fill color, border color, and font size.
- **Global & per-note**: A global default style with per-note overrides (the style modal previews in real time and applies per-note settings when you click outside). Styles live only in plugin data, never in Markdown.
- **Three settings sections**: General (Click-to-Jump, Lock Current Note, Strict Blank Lines), Elegant Animation (Pro: toggle, speed 0.5x–2x, micro-bounce), and Mind Map Styles (Pro). Each section can be reset to defaults independently.
- **Follows the Obsidian theme**: adapts to light and dark themes, and nodes plus the editor use the Obsidian font.

### IME & Performance

- **IME protection**: All shortcuts are disabled during pinyin/Wubi composition, so Enter confirms a candidate instead of adding a node, and Tab switches candidates instead of adding a child.
- **Performance**: Stress-tested with 500/1000/2000-node notes; thousands of nodes stay smooth for editing, zooming, and panning. If a map gets really large, disabling Elegant Animation keeps things fluid.

## Use Cases

- **Outline-first writing (e.g., NoteFlow)**: Sketch the outline as a map first, then fill in the body section by section. NoteFlow made "outline as note" a standalone app; this plugin brings the same experience natively to Obsidian — files stay pure Markdown, with no proprietary format lock-in.
- **Brain-like notes (e.g., Lattics)**: You want outline hierarchy and body content together. Lattics focuses on brain-like knowledge organization; this plugin recreates that core "outline + body" experience in the lightest way — the map shows structure, Markdown holds the body, and neither gets in the way.
- **Mind map + document in one (e.g., 万兴脑图 / Wondershare cloud mind-map notes)**: Organize in the map, write in the document. This plugin does the same inside Obsidian, minus the accounts and cloud dependencies — your notes always stay local and yours.
- **Reading notes & knowledge organization**: Break a book into multi-level headings, keep quotes and thoughts in the body, and see the entire skeleton of the book on one screen.
- **Meeting minutes / project planning / to-dos**: Task lists show up as nodes with completion status at a glance; use multiple H1s for sections like Goals, Progress, and Risks.
- **Long-form & multi-topic notes**: Multiple H1s mean multiple roots, so one file can hold a whole book's chapters or a handful of unrelated topics — the map naturally becomes your table of contents.

## Limitations

- All lists — ordered, unordered, and task — are treated as map nodes, including numbered lists you casually write in body text. That's the deliberate trade-off behind pure syntax: use paragraphs or quotes when you need non-node body text.
- Free placement isn't supported: the layout always follows your Markdown structure automatically, and dragging changes structural hierarchy, not canvas coordinates.
- Node text supports only a whitelist of inline Markdown (bold, italics, strikethrough, inline code, links, wikilinks, highlights, bold-italic, etc.); images, formulas, tables, and raw HTML aren't supported.
- Headings must be flush-left; list hierarchy depends on indentation, and lists created or rewritten by the plugin use Tab indentation.
- The plugin never reformats your existing notes — it only normalizes the blocks it creates, moves, or converts.
- When a note isn't open in the editor, write-back modifies the file directly with no undo.
- Click-to-Jump locates and highlights only; it doesn't provide back/forward history.
- The first release doesn't include node copy/paste, image nodes, summary nodes, relationship lines, or image/PDF export.
- Desktop Obsidian only; no mobile adaptation yet.

## Paid Features (Pro)

### Lifetime License

One purchase, lifetime use on a single device. Pro features are **Elegant Animation** and **Mind Map Styles** (multiple layouts, line styles, and theme templates). Price: ¥22. Purchase link:

https://www.ifdian.net/item/ebbed5ea922311f1a5e85254001e7c00?utm_source=copylink&utm_medium=link

### Activation Steps

1. Click the purchase link and complete your order.
2. Open **Settings → Community plugins → Outline Mindmap → Activation**, and copy your machine code with one click.
3. Send the machine code (and your order number) to the author as described on the purchase page.
4. Wait for the author to send your activation code manually — allow 1–3 business days.
5. Paste the code into the plugin's activation page and activate — all Pro features unlock immediately.

### Privacy & Security

- The machine code is generated by SHA-256 one-way hashing of 5 non-sensitive hardware parameters (OS type & major version, CPU architecture, CPU model, logical core count, memory size).
- The hash is one-way and irreversible: the raw parameters never leave your machine, so the code can't be reverse-engineered into device details or linked to your identity.
- Activation is verified fully offline — no network or server involved — and the license is bound to your device fingerprint, so uninstalling or reinstalling the plugin doesn't affect it.
