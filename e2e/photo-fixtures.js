import { slideshowSnapshot } from '../test/fixtures/photo-slideshow.js';

export async function mockSlideshow(page, photos = [], onRead = () => {}) {
  let selection = 0; let revision = 1;
  await page.route('**/api/dashboard/slideshow?*', (route) => {
    onRead();
    return route.fulfill({ json: slideshowSnapshot({ version: 2, queueRevision: revision, next: photos.length > 1 ? photos[(selection + 1) % photos.length] : null, revision, count: photos.length, current: photos[selection] ?? null, nextChangeAt: photos.length > 1 ? 1_005_000 : null }) });
  });
  return { select(index) { selection = index; revision++; } };
}
