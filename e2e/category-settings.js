import { expect } from '@playwright/test';
import { CATEGORY_IDS, categoryScopes, SETTINGS_CATEGORIES } from '../public/dashboard-settings-categories.js';

export async function seedScopes(context, modes = categoryScopes('global')) {
  await context.addInitScript(scopes => { if (!localStorage.getItem('dashboard.category-scopes.v1')) localStorage.setItem('dashboard.category-scopes.v1', JSON.stringify({ schema: 1, revision: 1, scopes })); }, modes);
}
export async function categoryTab(page, id) { await page.locator(`#settings-tab-${id}`).click(); }
export async function saveCategory(page) {
  const label = await page.locator('[role="tab"][aria-selected="true"]').textContent();
  await page.locator('#save-preferences').click(); await expect(page.locator('#settings-status')).toHaveText(new RegExp(`^${label} settings saved `));
}
export async function setCategoryScope(page, id, mode) {
  await categoryTab(page, id); await page.locator(`#settings-scope-${id}`).selectOption(mode); await expect(page.locator(`#settings-scope-${id}`)).toHaveValue(mode);
  await expect(page.locator('#settings-status')).toHaveText(`${SETTINGS_CATEGORIES[id].label} settings use ${mode === 'local' ? 'Local values for this browser.' : 'Global shared values.'}`);
}
export async function setPreferenceFlags(page, flags) {
  for (const id of CATEGORY_IDS) {
    const fields = Object.entries(flags).filter(([key]) => SETTINGS_CATEGORIES[id].keys.includes(key)); if (!fields.length) continue;
    await categoryTab(page, id);
    for (const [name, value] of fields) await page.locator(`[name="${name}"]`).setChecked(value);
    await saveCategory(page);
  }
}
