import { expect, test } from '@playwright/test';

test('home integrations initialize and open from current or preceding release controls', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('#home-grid')).toBeVisible();
  await expect(page.locator('#legacy-integration-controls')).toBeHidden();
  expect(await page.evaluate(() => {
    const selectors = ['#new-device', '#search', '#wake-selected', '#home-assistant-settings'];
    return selectors.every((selector) => { const element = document.querySelector(selector); element.addEventListener('click', () => {}); if ('value' in element) element.value = ''; return Boolean(element); });
  })).toBe(true);

  for (const [type, dialog, close] of [['bookmarks', '#linkwarden-dialog', '#linkwarden-close'], ['home-assistant', '#home-assistant-dialog', '#home-assistant-close'], ['wol', '#device-dialog', '#dialog-close']]) {
    await page.locator('#home-settings-open').click();
    await page.locator(`[data-integration="${type}"]`).click();
    await expect(page.locator(dialog)).toHaveAttribute('open', '');
    await page.locator(close).click();
    await expect(page.locator(dialog)).not.toHaveAttribute('open', '');
  }
  expect(errors).toEqual([]);
});

test('edit controls preserve canvas bounds and pixel gestures reach exact geometry', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.goto('/');
  const grid = page.locator('#home-grid');
  await expect(grid).toBeVisible();
  const before = await grid.boundingBox();

  await page.locator('#home-settings-open').click();
  await page.locator('#home-edit').click();
  await expect(page.locator('#home-toolbar-save')).toBeVisible();
  expect(await grid.boundingBox()).toEqual(before);

  const time = page.locator('#home-time'); const resize = time.locator('.widget-resize');
  const initialWidth = await time.evaluate((element) => Number.parseInt(element.style.width, 10));
  const resizeBox = await resize.boundingBox();
  await page.mouse.move(resizeBox.x + resizeBox.width / 2, resizeBox.y + resizeBox.height / 2);
  await page.mouse.down(); await page.mouse.move(resizeBox.x + resizeBox.width / 2 + 1, resizeBox.y + resizeBox.height / 2); await page.mouse.up();
  await expect.poll(() => time.evaluate((element) => Number.parseInt(element.style.width, 10))).toBe(initialWidth + 1);
  await time.locator('.widget-remove').click();
  await expect(time).toBeHidden();

  const calendar = page.locator('#home-calendar'); const move = calendar.locator('.widget-move');
  const calendarTop = await calendar.evaluate((element) => Number.parseInt(element.style.top, 10)); const moveBox = await move.boundingBox();
  await page.mouse.move(moveBox.x + moveBox.width / 2, moveBox.y + moveBox.height / 2);
  await page.mouse.down(); await page.mouse.move(moveBox.x + moveBox.width / 2, moveBox.y + moveBox.height / 2 - calendarTop); await page.mouse.up();
  await expect.poll(() => calendar.evaluate((element) => Number.parseInt(element.style.top, 10))).toBe(0);
  expect(await grid.boundingBox()).toEqual(before);
  const wol = page.locator('#wol-section'); const wolMove = wol.locator('.widget-move'); await wolMove.scrollIntoViewIfNeeded(); const wolTop = await wol.evaluate((element) => Number.parseInt(element.style.top, 10)); const wolMoveBox = await wolMove.boundingBox();
  await page.mouse.move(wolMoveBox.x + wolMoveBox.width / 2, wolMoveBox.y + wolMoveBox.height / 2); await page.mouse.down(); await page.mouse.move(wolMoveBox.x + wolMoveBox.width / 2, wolMoveBox.y + wolMoveBox.height / 2 + 25); await page.mouse.up();
  await expect.poll(() => wol.evaluate((element) => Number.parseInt(element.style.top, 10))).toBe(wolTop + 25); expect((await grid.boundingBox()).height).toBeGreaterThan(before.height); expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeGreaterThan(800);
  await page.locator('#home-toolbar-save').click(); await expect(page.locator('#home-toolbar-save')).toBeHidden(); await page.reload();
  await expect(page.locator('#home-time')).toBeHidden(); await expect.poll(() => calendar.evaluate((element) => Number.parseInt(element.style.top, 10))).toBe(0); await expect.poll(() => wol.evaluate((element) => Number.parseInt(element.style.top, 10))).toBe(wolTop + 25);
});

for (const width of [320, 390]) test(`mobile ${width}px keeps its canvas stable and scrollable while editing`, async ({ page }) => {
  await page.setViewportSize({ width, height: 700 }); await page.goto('/');
  const grid = page.locator('#home-grid'); await expect(grid).toBeVisible(); const before = await grid.boundingBox();
  await page.locator('#home-settings-open').click(); await page.locator('#home-edit').click(); await expect(page.locator('#home-toolbar-save')).toBeVisible();
  expect(await grid.boundingBox()).toEqual(before); expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  const time = page.locator('#home-time'); const resize = time.locator('.widget-resize'); const initialWidth = await time.evaluate((element) => Number.parseInt(element.style.width, 10)); const box = await resize.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 - 1, box.y + box.height / 2); await page.mouse.up();
  await expect.poll(() => time.evaluate((element) => Number.parseInt(element.style.width, 10))).toBe(initialWidth - 1);
  const wol = page.locator('#wol-section'); const move = wol.locator('.widget-move'); await move.scrollIntoViewIfNeeded(); const initialTop = await wol.evaluate((element) => Number.parseInt(element.style.top, 10)); const initialHeight = (await grid.boundingBox()).height; const moveBox = await move.boundingBox();
  await page.mouse.move(moveBox.x + moveBox.width / 2, moveBox.y + moveBox.height / 2); await page.mouse.down(); await page.mouse.move(moveBox.x + moveBox.width / 2, moveBox.y + moveBox.height / 2 + 25); await page.mouse.up();
  await expect.poll(() => wol.evaluate((element) => Number.parseInt(element.style.top, 10))).toBe(initialTop + 25);
  expect((await grid.boundingBox()).height).toBeGreaterThan(initialHeight); expect((await grid.boundingBox()).height).toBeGreaterThan(700);
});
