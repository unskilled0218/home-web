# goal

## command

- remove current widget things from `/`. and `/dashboard` to `/`

## goal

Replace the current widget home page at `/` with the existing photo dashboard from `/dashboard`. Make `/` the primary dashboard entry point and remove the old widget canvas, widget catalog, layout editing, and widget settings interface.

Preserve the photo dashboard's backgrounds, clock, weather forecasts, optional Baikal calendar, fullscreen controls, and settings. Keep its existing browser-local preferences so the route change retains saved preferences. Remove the obsolete Home link, which would point back to the same page.

Redirect `/dashboard` and `/dashboard/` to `/` so existing bookmarks reach the new home page. Remove frontend assets used only by the retired widget interface after checking dependencies. Preserve stored integration credentials and data; this page replacement does not require deleting database records or unrelated integration APIs.

The current route mapping is in `src/app.js`. The replacement interface is in `public/dashboard.html`, `public/dashboard.css`, and `public/dashboard*.js`; the retired entry point is `public/index.html` with `public/app.js` and the `public/home-*.js` modules. Update affected routing and UI tests, browser checks, and README instructions to describe the photo dashboard at `/`.

Completion means `/` renders the photo dashboard without the old widget interface, legacy dashboard URLs reach `/`, and dashboard features and saved preferences still work. Verify affected behavior with `npm test`, `npm run check`, and relevant browser checks adapted to the new home page.
