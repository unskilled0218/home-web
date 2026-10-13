export function createSettingsTabs(dialog, { onSelect = () => {} } = {}) {
  const tablist = dialog.querySelector('[role="tablist"]');
  const tabs = [...tablist.querySelectorAll('[role="tab"]')];
  const panels = tabs.map((tab) => dialog.querySelector(`#${tab.getAttribute('aria-controls')}`));
  const scroller = dialog.querySelector('.settings-panels');

  function select(id, focus = false) {
    const index = tabs.findIndex((tab) => tab.id === id);
    if (index === -1) return;
    tabs.forEach((tab, position) => {
      const selected = position === index;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      panels[position].hidden = !selected;
    });
    scroller.scrollTop = 0;
    if (focus) tabs[index].focus();
    onSelect(id);
  }

  tablist.addEventListener('click', (event) => {
    const tab = event.target.closest('[role="tab"]');
    if (tabs.includes(tab)) select(tab.id);
  });
  tablist.addEventListener('keydown', (event) => {
    const index = tabs.indexOf(event.target);
    if (index === -1 || event.altKey || event.ctrlKey || event.metaKey) return;
    let next;
    if (event.key === 'ArrowUp') next = (index + tabs.length - 1) % tabs.length;
    else if (event.key === 'ArrowDown') next = (index + 1) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    else return;
    event.preventDefault();
    select(tabs[next].id, true);
  });

  return {
    select,
    reveal(control) {
      const index = panels.indexOf(control.closest('[role="tabpanel"]'));
      if (index !== -1) select(tabs[index].id);
    }
  };
}
