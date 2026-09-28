export const MOBILE_LAYOUT_QUERY = '(max-width: 767px)';

export function createLayoutModeOwner({ matchMediaImpl = (query) => globalThis.matchMedia(query), onChange = () => {} } = {}) {
  const media = matchMediaImpl(MOBILE_LAYOUT_QUERY);
  let mode = media.matches ? 'mobile' : 'desktop';
  function change(event) {
    const next = event.matches ? 'mobile' : 'desktop';
    if (next === mode) return;
    mode = next; onChange(mode);
  }
  media.addEventListener('change', change);
  return { getMode: () => mode, dispose: () => media.removeEventListener('change', change) };
}
