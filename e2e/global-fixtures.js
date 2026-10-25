import { test as base, firefox } from '@playwright/test';
import { seedScopes } from './category-settings.js';

// Shared-behavior scenarios opt in explicitly; new scope scenarios use Playwright's base test.
const seedGlobal = context => seedScopes(context);
function globalBrowser(browser) {
  return new Proxy(browser, { get(target, name) {
    if (name === 'newContext') return async options => { const context = await target.newContext(options); await seedGlobal(context); return context; };
    if (name === 'newPage') return async options => { const page = await target.newPage(options); await seedGlobal(page.context()); return page; };
    const value = Reflect.get(target, name); return typeof value === 'function' ? value.bind(target) : value;
  } });
}
export const globalTest = base.extend({
  browser: [async ({ browser }, use) => { await use(globalBrowser(browser)); }, { scope: 'worker' }],
  context: async ({ context }, use) => { await seedGlobal(context); await use(context); }
});
export const globalFirefox = { launch: async options => globalBrowser(await firefox.launch(options)) };
