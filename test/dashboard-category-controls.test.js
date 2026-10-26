import test from 'node:test';
import assert from 'node:assert/strict';
import { createCategoryControls } from '../public/dashboard-category-controls.js';
import { CATEGORY_IDS } from '../public/dashboard-settings-categories.js';

test('seven scope selectors render without General while all eight policy categories update safely', () => {
  const nodes = new Map(); const panels = new Map(); const changes = [];
  class Node {
    constructor(tag) { this.tag = tag; this.children = []; this.events = new Map(); }
    set id(value) { this.identifier = value; nodes.set(value, this); }
    get id() { return this.identifier; }
    setAttribute(key, value) { this[key] = value; }
    append(...children) { this.children.push(...children); }
    querySelector() { return { nextSibling: null }; }
    insertBefore(child) { this.children.push(child); }
    addEventListener(name, fn) { this.events.set(name, fn); }
  }
  for (const id of CATEGORY_IDS) panels.set(`settings-panel-${id}`, new Node('section'));
  const document = { createElement: tag => new Node(tag), getElementById: id => panels.get(id) };
  const controls = createCategoryControls({ document, onChange: (...args) => changes.push(args) });
  for (const pending of [false, true]) for (const id of CATEGORY_IDS) controls.update(id, { mode: 'global', pending, mutating: false });
  assert.equal(nodes.has('settings-scope-general'), false); assert.equal(nodes.has('scope-status-general'), false); assert.equal(panels.get('settings-panel-general').children.length, 0);
  assert.equal([...nodes.keys()].filter(id => id.startsWith('settings-scope-')).length, 7);
  for (const id of CATEGORY_IDS.filter(id => id !== 'general')) {
    const select = nodes.get(`settings-scope-${id}`); assert.equal(select.tag, 'select'); assert.equal(select.disabled, true); assert.equal(select.children.length, 2); assert.match(select['aria-label'], /settings scope$/);
    select.value = 'local'; select.events.get('change')();
  }
  assert.deepEqual(changes, CATEGORY_IDS.filter(id => id !== 'general').map(id => [id, 'local']));
});
