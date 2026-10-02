import { expect, test } from '@playwright/test';

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
  await page.locator('#home-toolbar-save').click(); await expect(page.locator('#home-toolbar-save')).toBeHidden(); await page.reload();
  await expect(page.locator('#home-time')).toBeHidden(); await expect.poll(() => calendar.evaluate((element) => Number.parseInt(element.style.top, 10))).toBe(0);
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
