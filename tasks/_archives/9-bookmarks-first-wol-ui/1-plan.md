# Bookmarks-first Wake-on-LAN UI plan

## Goal

Show the Linkwarden bookmarks section before Wake-on-LAN and restyle the Wake-on-LAN area to use the same section hierarchy, spacing, controls, cards, and responsive behavior as Bookmarks.

## Clarified scope

- Treat the trailing `and` in the request as a typo; there is no additional feature requirement.
- This is a presentation and page-structure change. Preserve the existing device, wake, selection, search, Linkwarden connection, collection, refresh, cache, and dialog behavior.
- Keep Bookmarks as the first dashboard feature after the page header and place the complete Wake-on-LAN section beneath it.
- Give Wake-on-LAN an explicit section heading with an eyebrow, title, explanatory copy, and grouped actions equivalent to the existing Bookmarks heading instead of leaving its controls as an unlabelled toolbar beneath a Wake-specific hero.
- Use the existing visual language rather than introducing a new theme: dark blue surfaces, teal emphasis, compact rounded cards, visible focus states, and the current typography remain authoritative.

## Current structure

- `public/index.html` uses a Wake-specific hero, places Bookmarks settings and Add device together in the hero, then renders the device toolbar, device status, grouped device cards, and finally the Bookmarks section.
- Bookmarks already has a clear section heading, eyebrow, account metadata, action group, status region, collection tree, and responsive card grid.
- Device and bookmark cards already share similar border, radius, padding, and background values, but those styles are duplicated and the Wake-on-LAN area has no matching outer section or heading structure.
- `public/app.js` binds controls and render targets by ID, so the relevant elements can move in the document without changing API calls or state behavior as long as IDs, semantic roles, and live regions are retained.
- Existing browser-facing coverage checks the Linkwarden controls and collection tree but does not assert feature order or the Wake-on-LAN section structure.

## Layout and interaction decisions

- Keep a concise top-level hero for dashboard identity, but remove feature action buttons from it so section-specific actions live with their corresponding content. Use neutral copy that does not imply Wake-on-LAN is still the primary first section.
- Retain the Bookmarks heading and collection layout, moving the Bookmarks settings control into its action group alongside Disconnect and Refresh.
- Add a Wake-on-LAN section after Bookmarks using the same shared section and heading classes. Place Add device in the heading action group and keep search plus Wake selected together as the device toolbar below the heading.
- Move the dispatch-only explanation from the Wake-specific hero into the Wake-on-LAN section so it remains visible near wake controls.
- Preserve status semantics: bookmark and wake feedback remain separate `role="status"` live regions, and moving them must not combine or overwrite messages.
- Preserve semantic content order and keyboard order so users encounter Bookmarks controls/content first, then Wake-on-LAN controls/content. Dialogs remain after main page content and keep their current labels and focus behavior.
- Consolidate genuinely shared section, action-row, grid/card, muted-copy, and responsive rules where doing so reduces divergence. Keep feature-specific selectors for collection-tree navigation, device selection, and card actions.
- On narrow screens, stack section headings and action groups without horizontal overflow, allow action buttons to wrap or share available width, collapse the bookmark tree above its cards, and retain usable device-card action targets.

## Implementation sequence

1. Restructure `public/index.html` so the hero is feature-neutral, the complete Bookmarks section is first, and a new labelled Wake-on-LAN section follows it.
2. Move `linkwarden-settings` into the Bookmarks action group and `new-device` into the Wake-on-LAN heading while retaining all IDs, button types, hidden states, labels, status roles, and dialog markup used by `public/app.js`.
3. Keep the existing device search, Wake selected control, wake status, grouped device render target, bookmark status, collection tree, and bookmark render target inside their corresponding sections in logical keyboard and reading order.
4. Refactor `public/styles.css` around shared dashboard-section, section-heading, section-actions, card-surface, grid, and muted-text patterns. Make Wake-on-LAN spacing and device-card surfaces align with Bookmarks without changing selected, destructive, disabled, focus, or error-state distinctions.
5. Add responsive rules for both sections and their action groups at the existing breakpoints, verifying no controls or long account/device content overflow at the minimum supported 320px viewport.
6. Change `public/app.js` only if a selector or state update is required by the new structure; do not rewrite working fetch, rendering, selection, dialog, or wake logic solely for the visual change.
7. Update README wording or screenshots only where the documented page order or control placement is described; do not alter deployment or Linkwarden security guidance.
8. Update the project version according to the existing release convention and record the delivered changes and verification in `3-implemented.md`.

## Automated coverage

- Extend the static browser markup test to assert the Bookmarks section appears before the Wake-on-LAN section in document order.
- Assert each section has an accessible heading relationship and retains its independent live status region.
- Assert Bookmarks settings is inside the Bookmarks action area and Add device is inside the Wake-on-LAN action area while all existing IDs remain unique and available to `public/app.js`.
- Preserve the one-step Linkwarden dialog and collection-tree assertions.
- Preserve all server, Linkwarden encryption/configuration, bookmark loading, device CRUD, packet construction, and wake-delivery tests because this task must not change backend behavior.

## Verification

- Run `npm test` and `node --check public/app.js` plus syntax checks for any other changed JavaScript files.
- Run `git diff --check` and inspect the final diff for accidental API, ID, dialog, or live-region changes.
- At desktop width, verify Bookmarks is encountered first, its settings/Disconnect/Refresh controls are grouped with its heading, and Wake-on-LAN appears below with matching heading and card rhythm.
- At 700px, 620px, and 320px widths, verify collection navigation, bookmark cards, device search, section actions, device cards, and dialogs remain readable without horizontal scrolling or clipped controls.
- Navigate the page using only the keyboard and confirm visible focus, logical Bookmarks-then-Wake tab order, collection selection, Add device, editing/removal, multi-selection, and Wake selected access.
- Exercise unconfigured Linkwarden, empty collections, bookmark load errors, no devices, filtered-empty devices, successful wake, and wake-error states to ensure messages remain in the correct section.
- Confirm Add/Edit/Remove device, single and bulk wake, Linkwarden Connect/Disconnect, collection selection, bookmark refresh, and external bookmark navigation behave exactly as before.

## Acceptance criteria

- Bookmarks is the first functional section and the complete Wake-on-LAN area appears beneath it.
- Wake-on-LAN uses the same section-heading, action grouping, spacing, card surface, and responsive visual system as Bookmarks.
- Bookmarks settings and Add device are located with their respective section controls rather than mixed in the global hero.
- Existing device and Linkwarden functionality, API contracts, element IDs, status announcements, and dialog behavior are preserved.
- The revised layout is usable without horizontal overflow at desktop and 320px mobile widths and maintains a logical keyboard and screen-reader reading order.
