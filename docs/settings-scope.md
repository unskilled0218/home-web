# Settings scope

- [Settings scope](#settings-scope)
  - [Choose a scope per category](#choose-a-scope-per-category)
  - [Category ownership](#category-ownership)
  - [Saving and conflicts](#saving-and-conflicts)
  - [Storage and recovery](#storage-and-recovery)
  - [Weather and images](#weather-and-images)
  - [Installation resources and transfers](#installation-resources-and-transfers)

## Choose a scope per category

Each Settings panel has its own **Local — this browser** or **Global — shared category** selector. Mix Global Time with Local Weather, or choose any other combination across General, Time, Weather, Calendar, Bookmarks, Home Assistant, Wake-on-LAN, and Images. Changing one choice does not change another category or another browser profile. Tabs in the same profile share these choices through storage events.

Fresh profiles default every category to Local. Without a new category map, a valid old `dashboard.settings-scope.v1` choice seeds all categories with that mode; absent/invalid old modes default to Local. Reads never copy Local values into Global or rewrite either preference record. Switching to Global reads existing server values, and switching back restores Local values. Global caches are never Local defaults. Reload all open tabs after upgrading; older clients do not understand mixed scopes.

## Category ownership

- General: retained position/overall scale values and both Desktop/Mobile widget layouts, including geometry and layer order. Direct layout editing follows General scope. Position and Overall scale no longer have controls in Settings; saved values and transfer compatibility remain unchanged.
- Time: clock visibility/scales, timezone, date style, 12-hour format, seconds, and fullscreen hiding. Effective Time timezone/format also governs weather/calendar timestamps, regardless of their scopes.
- Weather: visibility/scales, hourly/daily forecast display, temperature/wind/precipitation units, fullscreen hiding, and saved city.
- Calendar: visibility/scales and fullscreen hiding. Calendar connection data remains a shared server resource.
- Bookmarks: Desktop/Mobile visibility and scales, fullscreen hiding, selected links, and the retained mobile display compatibility preference. Linkwarden credentials remain shared.
- Home Assistant: Desktop/Mobile visibility and scales, fullscreen hiding, and selected devices. Its connection remains shared.
- Wake-on-LAN: Desktop/Mobile visibility and scales, and fullscreen hiding. Managed devices and wake history remain shared.
- Images: order, interval, transitions, filename display, opacity, background, color, and blur. Local Images also retains its separate **Show the same image as Global** option.

Visibility and fullscreen controls now live in each widget's own panel, not General. Both Desktop/Mobile profiles can be edited from any screen; the mobile breakpoint remains 600px inclusive.

## Saving and conflicts

The footer saves or reloads only the selected category. Tab switches retain unsaved drafts without applying them; invalid fields in another category do not block the selected category's Save. Connection forms and city selection remain separate explicit actions. Closing/reopening Settings discards unsaved display drafts. Reloading one category does not clear another category's draft or integration credentials.

Save or discard a category's edits before changing its scope. Category reload discards display edits without clearing connection credentials; Home Assistant also provides **Discard connection draft**, and Wake-on-LAN provides **Cancel edit**. A storage event that changes its source keeps a dirty draft but disables Save until reload. Scope-only changes in unrelated categories preserve valid tokens and runtime owners. There is still one preference revision per backing store: saving any category to that same store can stale another captured draft. Reload explicitly rather than silently rebasing. Failed persistence keeps confirmed values and the unsaved draft.

Every scoped mutation rereads the persisted category map immediately before dispatch, including when storage events are delayed. Invalid/unreadable maps block writes. This is not an atomic cross-tab lock: truly simultaneous storage writes use last-successful-write semantics, and a scope change after admission cannot roll back a server request. An aborted/timed-out request may already have committed. Local categories can save offline or while unrelated Global work is pending; Global categories require confirmed server state.

## Storage and recovery

`dashboard.category-scopes.v1` stores `{ schema: 1, revision, scopes }` with exactly eight Local/Global choices. The old scope key is retained for migration but no longer written by new clients; once the new map exists, legacy scope-key changes do not redefine it. `dashboard.local-settings.v1` still stores Local preferences, weather location, and `followGlobalPhotos`. Existing valid `dashboard.preferences.v1` data restores Local preferences/city when the newer Local record is absent, and is removed only after a successful explicit Local save.

Saved Local records and confirmed Global caches from before widget-scale support remain readable. Absent Bookmarks, Home Assistant, and Wake-on-LAN desktop/mobile scales default to 1 without rewriting storage or advancing revisions on read. Existing preferences, city, image-follow choice, and explicit scales remain unchanged. Invalid present scale values are rejected rather than silently repaired; current saves still require complete canonical preferences. Reload older open clients before saving after an upgrade.

Corrupt scope-map data keeps the last confirmed choices for preview, or Local preview on startup, but is not write authority. **General → Reset category scopes to Local** requires confirmation and replaces only the corrupt category map. It preserves Local preferences, city, Images follow choice, legacy keys, credentials, server data, and unsaved drafts. Reload retained drafts after recovery. An observed concurrent repair or failed storage operation prevents overwrite/success reporting. Do not clear all site data just to repair this map. Blocked browser storage must first be enabled by the browser/user; unreadable storage cannot safely be overwritten.

## Weather and images

Weather Local keeps its city in browser storage and queries `/api/weather/local`, a bounded volatile server cache without changing Global location/cache records. Weather Global uses the persisted installation location and startup/hourly provider retrieval. Time scope can change display/provider timezone without changing Weather's city or owning store. Units reproject successful data without another provider retrieval. No Local city means no Local query.

Global Images follows the server slideshow. Local Images follows that same selection by default, even if every category is Local, without polling Global preferences. Disable **Show the same image as Global** and save Images for independent Local playback of a stable subset of up to 100 eligible images. The follow choice defaults on for old records without it and preserves explicit off values. Local presentation remains independent; Local order/interval are retained but disabled while following.

Only Images source changes or an Images follow toggle replace the photo player; changing Time/Weather/General scope does not reset it. Replacement clears the old frame until a new image decodes. Transient failures within an unchanged source retain the last-good image; confirmed disabled/empty sources clear it. Shared selection is not frame-perfect synchronized transitions. Hidden pages pause browser work and resume the current source. See [NFS backgrounds](nfs-backgrounds.md).

## Installation resources and transfers

Calendar, Linkwarden, and Home Assistant credentials, NFS mounts, managed Wake-on-LAN devices, and wake history remain server resources. Mutation controls require Global for their owning category: Calendar, Bookmarks, Home Assistant, or Wake-on-LAN. Local categories can still read shared content and keep independent display selections. Normal dashboard Wake buttons retain their separate explicit behavior. This UI scope is not server authorization or a per-user account system.

Export always reads raw Global settings, not mixed effective settings. Import requires General Global, fresh raw Global revisions, and no conflicting drafts/actions; it explicitly replaces all Global preferences/location rather than only General. Local records and category choices stay unchanged, while Global-backed categories and Local Images followers can change presentation/selection. See [Global import/export](settings-import-export.md) and [dashboard preferences](dashboard.md).
