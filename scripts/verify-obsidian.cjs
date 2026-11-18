// Run only against an isolated test vault, never a personal vault.
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.connectOverCDP(process.env.OBSIDIAN_CDP || 'http://127.0.0.1:9227');
  try {
    const page = browser.contexts()[0].pages()[0];
    const qa = path.resolve(__dirname, '../../.qa-1.3.6');
    const actual = await page.evaluate(() => app.vault.adapter.basePath);
    assert.equal(path.resolve(actual), path.join(qa, 'vault'), 'Refuse a non-test vault');
    await page.evaluate(() => { window.__qaFile = 'Runtime-' + Date.now() + '.md' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.evaluate(async () => { app.setting.close(); await app.plugins.disablePlugin('outline-mindmap') });
    for (const name of ['main.js', 'styles.css', 'manifest.json']) fs.copyFileSync(path.join(__dirname, '..', name), path.join(actual, '.obsidian/plugins/outline-mindmap', name));
    await page.evaluate(async () => {
      for (const leaf of app.workspace.getLeavesOfType('markdown')) leaf.detach();
      await app.plugins.enablePlugin('outline-mindmap');
      const plugin = app.plugins.plugins['outline-mindmap'];
      plugin.settings.nodeBody = true; plugin.settings.listNodes = true; plugin.settings.orderedListNodes = true;
      for (const key of Object.keys(localStorage)) if (key.includes('outline-mindmap:body-draft:')) localStorage.removeItem(key);
      const text = '# Product\nIntro\n\n## Design\nSimple and clear.\n\n- First\n  List body\n- Second\n  More detail\n\nSection tail.\n\n### Read\nRead body\n\n#### Detail\nDetail body\n\n## Reliability\nKeep drafts.';
      let file = app.vault.getAbstractFileByPath(window.__qaFile);
      if (file) await app.vault.modify(file, text); else file = await app.vault.create(window.__qaFile, text);
      await plugin.openAsMindmap(file, app.workspace.getLeaf('tab'));
      const view = app.workspace.getLeavesOfType('outline-mindmap').at(-1).view;
      await view.showFile(file); view.fitToScreen();
    });
    await page.waitForTimeout(450);
    const viewEval = fn => page.evaluate(fn);
    const result = await viewEval(async () => {
      const view = app.workspace.getLeavesOfType('outline-mindmap').at(-1).view;
      const find = title => [...view.tree.byId.values()].find(n => n.text === title);
      view.select(find('Design').id);
      await view.runAction('body');
      return { body: view.bodyCard.value, commands: !!app.commands.commands['outline-mindmap:paste-sibling'] };
    });
    assert(result.body.includes('Section tail.')); assert(result.body.includes('- First')); assert(result.commands);
    assert.equal(await page.locator('.om-body-input').isVisible(), true);
    const input = page.locator('.om-body-input');
    await input.fill('Updated body.\n\n- First\n  List body\n- Second\n  More detail\n\nSection tail.\n');
    for (let attempt = 0; attempt < 40; attempt++) {
      if ((await page.evaluate(() => app.vault.read(app.vault.getAbstractFileByPath(window.__qaFile)))).includes('Updated body.')) break;
      await page.waitForTimeout(150);
    }
    assert((await page.evaluate(() => app.vault.read(app.vault.getAbstractFileByPath(window.__qaFile)))).includes('Updated body.'));
    // Clean editor follows an external body edit without switching nodes.
    await page.evaluate(async () => {
      const view = app.workspace.getLeavesOfType('outline-mindmap').at(-1).view;
      const file = app.vault.getAbstractFileByPath(window.__qaFile);
      await app.vault.process(file, text => text.replace('Updated body.', 'External update.'));

    });
    await page.waitForTimeout(500);
    assert((await input.inputValue()).includes('External update.'));
    // A dirty conflict preserves local text and survives closing/reopening the card.
    await input.fill('Local draft');
    await page.evaluate(async () => {
      const view = app.workspace.getLeavesOfType('outline-mindmap').at(-1).view;
      const file = app.vault.getAbstractFileByPath(window.__qaFile);
      await app.vault.process(file, text => text.replace('External update.', 'Concurrent update.'));

    });
    await page.waitForTimeout(850);
    assert.equal(await input.inputValue(), 'Local draft');
    assert((await page.evaluate(() => app.vault.read(app.vault.getAbstractFileByPath(window.__qaFile)))).includes('Concurrent update.'));
    await page.evaluate(async () => {
      const view = app.workspace.getLeavesOfType('outline-mindmap').at(-1).view;
      view.closeBody();
      await view.openBody([...view.tree.byId.values()].find(n => n.text === 'Design'));
    });
    assert.equal(await input.inputValue(), 'Local draft');
    await page.evaluate(() => {
      const view = app.workspace.getLeavesOfType('outline-mindmap').at(-1).view;
      view.closeBody(); view.chooseLevel(3);
    });
    await page.waitForTimeout(250);
    assert.equal(await page.locator('.workspace-leaf.mod-active .om-node:not(.is-hidden) .om-node-text').filter({ hasText: /^Detail$/ }).count(), 0);
    await page.evaluate(async () => {
      const view = app.workspace.getLeavesOfType('outline-mindmap').at(-1).view;
      view.setAllCollapsed(false);
      await view.openBody([...view.tree.byId.values()].find(n => n.text === 'Read'));
    });
    await page.getByRole('button', { name: '固定正文面板', exact: true }).click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(qa, 'body-pinned.png') });
    const geometry = await page.evaluate(() => {
      const card = document.querySelector('.om-body-card').getBoundingClientRect();
      const vp = document.querySelector('.workspace-leaf.mod-active .om-viewport').getBoundingClientRect();
      return { card: { x: card.x, y: card.y, width: card.width, height: card.height }, viewport: { right: vp.right, bottom: vp.bottom } };
    });
    assert(geometry.card.width > 200);
    assert(geometry.viewport.right <= geometry.card.x + 1 || geometry.viewport.bottom <= geometry.card.y + 1, 'Pinned panel must not cover the map viewport');
    const clipboard = await page.evaluate(async () => {
      const view = app.workspace.getLeavesOfType('outline-mindmap').at(-1).view;
      view.closeBody(); view.canvas.focus();
      const find = title => [...view.tree.byId.values()].find(n => n.text === title);
      view.select(find('Read').id);
      await view.runAction('copy');
      const copied = await navigator.clipboard.readText();
      view.select(find('Reliability').id);
      const before = await view.bridge.readText(view.file);
      await view.runAction('paste');
      await view.bridge.settledText(view.file);
      const after = await view.bridge.readText(view.file);
      await view.runAction('undo');
      const undone = await view.bridge.readText(view.file);
      return { copied, before, after, undone };
    });
    assert(clipboard.copied.includes('Read body'));
    assert(clipboard.after.length > clipboard.before.length);
    assert.equal(clipboard.undone, clipboard.before);
    await page.evaluate(async () => {
      const view = app.workspace.getLeavesOfType('outline-mindmap').at(-1).view;
      await view.openBody([...view.tree.byId.values()].find(n => n.text === 'Read'));
      view.bodyCard.setPinned(true);
      view.contentEl.style.width = '520px';
    });
    await page.waitForTimeout(300);
    const narrow = await page.evaluate(() => {
      const view = app.workspace.getLeavesOfType('outline-mindmap').at(-1).view;
      const card = view.bodyCard.el.getBoundingClientRect(), vp = view.canvas.viewport.getBoundingClientRect();
      return { top: card.top, bottom: vp.bottom, width: card.width };
    });
    assert(narrow.bottom <= narrow.top + 1, 'Narrow panel must dock below the map');
    await page.screenshot({ path: path.join(qa, 'body-narrow.png') });
    await page.evaluate(() => {
      const view = app.workspace.getLeavesOfType('outline-mindmap').at(-1).view;
      view.closeBody(); view.contentEl.style.width = ''; view.fitToScreen();
      view.canvas.zoomBy(1.25);
    });
    await page.waitForTimeout(500);
    const rendering = await page.evaluate(() => {
      const view = app.workspace.getLeavesOfType('outline-mindmap').at(-1).view;
      const css = getComputedStyle(view.canvas.content);
      return { transition: css.transitionDuration, willChange: css.willChange };
    });
    assert.equal(rendering.transition, '0s'); assert.equal(rendering.willChange, 'auto');
    await page.screenshot({ path: path.join(qa, 'zoom-settled.png') });
    const cards = await page.evaluate(async () => {
      const view = app.workspace.getLeavesOfType('outline-mindmap').at(-1).view;
      await view.openBody([...view.tree.byId.values()].find(n => n.text === 'Read'));
      view.bodyCard.el.querySelector('[aria-label="置顶保留卡片"]').click();
      await view.openBody([...view.tree.byId.values()].find(n => n.text === 'Reliability'));
      return view.contentEl.querySelectorAll('.om-body-card').length;
    });
    assert.equal(cards, 2);
    await page.locator('.om-body-input').last().press('Escape');
    assert.equal(await page.locator('.om-body-card').count(), 1);
    await page.evaluate(async () => {
      const view = app.workspace.getLeavesOfType('outline-mindmap').at(-1).view;
      view.closeBody();
      view.host.settings.nodeBody = false; await view.reparse();
      if (view.contentEl.classList.contains('om-body-enabled')) throw Error('Disable did not update DOM');
      view.host.settings.nodeBody = true; await view.reparse();
      if (!view.contentEl.classList.contains('om-body-enabled')) throw Error('Enable did not update DOM');
    });
    await page.evaluate(async () => {
      const view = app.workspace.getLeavesOfType('outline-mindmap').at(-1).view;
      const file = await app.vault.create('Scroll-' + Date.now() + '.md', '# Long note\n' + Array.from({length:300}, (_,i) => 'Paragraph ' + i + '\n').join('\n') + '\n# End\nBody');
      await view.showFile(file);
      const leaf = app.workspace.getLeaf('split'); await leaf.openFile(file, {state:{mode:'source'}});
      window.__scrollView = leaf.view; window.__mapView = view;
      leaf.view.editor.setCursor({line:0,ch:0});
      leaf.view.editor.cm.scrollDOM.scrollTop = 2000;
    });
    await page.waitForTimeout(500);
    await page.evaluate(() => { window.__scrollView.editor.cm.scrollDOM.scrollTop = 2000 });
    await page.waitForTimeout(300);
    const scrollBefore = await page.evaluate(() => window.__scrollView.editor.cm.scrollDOM.scrollTop);
    assert(scrollBefore > 500);
    await page.evaluate(async () => {
      const view = window.__mapView;
      await view.openBody([...view.tree.byId.values()].find(n => n.text === 'End'));
      const input = view.bodyCard.el.querySelector('textarea'); input.value = 'Saved without scrolling'; input.dispatchEvent(new Event('input', {bubbles:true}));
      await view.bodyCard.flush();
    });
    await page.waitForTimeout(500);
    const scrollAfter = await page.evaluate(() => window.__scrollView.editor.cm.scrollDOM.scrollTop);
    assert(Math.abs(scrollBefore - scrollAfter) < 2, `Scroll moved: ${scrollBefore} -> ${scrollAfter}`);
    assert(errors.length === 0, errors.join('\n'));
    fs.writeFileSync(path.join(qa, 'runtime-results.json'), JSON.stringify({ passed: ['body ownership','autosave','external sync','conflict preservation','draft recovery','heading level','pinned surface','command registration','branch clipboard','undo paste','narrow panel','zoom settlement','multiple cards','escape closes active card','live setting toggle','split note scroll preservation'], geometry, narrow, rendering, errors }, null, 2));
    console.log('Runtime checks passed:', 16, JSON.stringify(geometry));
  } finally { await browser.close() }
})().catch(error => { console.error(error); process.exitCode = 1 });
