const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.TEST_API_BASE_URL || 'http://127.0.0.1:3001';
(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  const evidence = path.resolve(__dirname, '../../reports/task-browser'); fs.mkdirSync(evidence, { recursive: true });
  try {
    for (const [name, width, height, requirements] of [['desktop', 1280, 900, '正文宋体小四，1.5倍行距。'], ['mobile', 390, 844, '']]) {
      const context = await browser.newContext({ viewport: { width, height } });
      const page = await context.newPage(); page.setDefaultTimeout(60000);
      const errors = []; page.on('pageerror', e => errors.push(e.message));
      await page.goto(base + '/#workspace');
      await page.locator('input[type=file]').setInputFiles(path.resolve(__dirname, '../../samples/input.docx'));
      await page.getByLabel('格式要求（选填）', { exact: true }).fill(requirements);
      await page.getByRole('button', { name: '下一步', exact: true }).click();
      await page.getByRole('heading', { name: '确认格式', exact: true }).waitFor();
      const current = (await (await context.request.get(base + '/api/tasks')).json()).task;
      assert.equal(current.status, 'review');
      const outsider = await browser.newContext(); await outsider.request.get(base + '/api/session');
      assert.equal((await outsider.request.get(base + '/api/tasks/' + current.id)).status(), 404);
      assert.equal((await outsider.request.delete(base + '/api/tasks/' + current.id)).status(), 409);
      await page.reload();
      await page.getByRole('heading', { name: '确认格式', exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: '确认并修改 Word' }).isDisabled(), true);
      if (requirements) {
        await page.getByText('修改格式要求', { exact: true }).click();
        await page.getByLabel('修改格式要求', { exact: true }).fill('正文宋体五号，1.5倍行距。');
        await page.getByRole('button', { name: '重新分析', exact: true }).click();
        await page.getByRole('heading', { name: '确认格式', exact: true }).waitFor();
        await page.getByText(/字号：10.5/).waitFor();
      }
      await page.getByRole('checkbox', { name: '查看全部结构' }).check();
      assert.equal(await page.locator('.structure-review-row').count(), current.review.items.length);
      await page.getByRole('checkbox', { name: '我已确认格式要求和需核对的内容' }).check();
      await page.locator('.structure-confirm').scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(evidence, name + '-review.png') });
      await page.getByRole('button', { name: '确认并修改 Word' }).click();
      const link = page.getByRole('link', { name: '下载修改后的 Word' }); await link.waitFor();
      const url = base + await link.getAttribute('href');
      assert.equal((await context.request.get(url)).status(), 200);
      assert.equal((await outsider.request.get(url)).status(), 404);
      await page.reload(); await link.waitFor();
      await page.locator('#output').scrollIntoViewIfNeeded();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.screenshot({ path: path.join(evidence, name + '-done.png') });
      page.once('dialog', d => d.accept());
      await page.getByRole('button', { name: '删除文件并重新开始' }).click();
      await page.getByRole('button', { name: '下一步', exact: true }).waitFor();
      assert.equal((await context.request.get(url)).status(), 404);
      assert.equal((await context.request.get(base + '/api/tasks/' + current.id)).status(), 404);
      assert.deepEqual(errors, []);
      await outsider.close(); await context.close();
    }
    console.log('Task flow: desktop/mobile, rules/default, confirmation, reload, owner isolation, download and deletion passed.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
