# Global settings import and export

- [Global settings import and export](#global-settings-import-and-export)
  - [Export](#export)
  - [Import](#import)
  - [File contract](#file-contract)

## Export

Use Settings → General → Export global settings. The downloaded `dashboard-global-settings.json` contains current saved global preferences and the global weather location. Export is read-only and works independently of category choices, including on all-Local pages; it never substitutes Local values, unsaved form edits, or browser caches. It does not initialize a global preference row or retrieve provider data. General has no Local/Global selector.

## Import

Save/discard every category/layout draft and choose a JSON file in General. File selection validates the file and prepares fresh raw Global preference/weather revisions without applying settings. All-Local pages use a bounded one-shot read, not continuous Global preference polling; pages already synchronizing Global settings reuse their reader. Preparation never changes Local records or category choices. **Import global settings** explicitly replaces all Global category preferences and weather location in one SQLite transaction, not just General. Two captured raw Global revisions protect both components; an intervening Global preference or location change rejects the import without partial writes. The persisted category map and transfer token are rechecked before dispatch, independently of the stored General mode. Identical imports retain existing revisions. A `null` weather location clears the Global location/cache and retires old work.

Import stays disabled until preparation succeeds and conflicting drafts/actions are resolved. If preparation fails or an import conflicts, the chosen file remains selected. Use **Reload** to fetch a fresh baseline after reviewing the error, then explicitly click Import again; background polls do not silently rebase the selected file. Superseded file reads/preparations cannot enable an old import. Successful imports update Global-backed categories and their shared photo/weather owners. Local preferences, saved layout ownership, the `followGlobalPhotos` choice, and every browser's saved category choices remain unchanged. Local Images followers continue tracking the shared slideshow, so imported Global order/interval changes can affect their displayed image without changing Local settings. Local Weather never adopts the imported city. A timed-out request can have an uncertain commit outcome: check current Global state before repeating it. Provider/service notification failures do not undo an already committed transaction.

## File contract

Version 1 has exactly these fields:

```json
{
  "format": "home-web.global-settings",
  "version": 1,
  "preferences": {},
  "weatherLocation": null
}
```

`preferences` must be a complete canonical dashboard preference object; the empty object above is a shape illustration, not a valid import. Earlier complete version-1 exports may omit the six desktop/mobile Bookmarks, Home Assistant, and Wake-on-LAN scales and `imageVisible`; imports default absent scales to 1 and absent image visibility to `true`. Present scales must be valid numbers from 0.5 to 2 in 0.1 steps; present `imageVisible` must be a boolean, preserving explicit `false`. Unrelated required fields cannot be omitted. Current exports include all six scales and image visibility. Importing visibility changes only Global Images presentation; Local Images retain their own visibility, even while following Global's slideshow. `weatherLocation` is `null` or a validated `{ latitude, longitude, label }` record. Files are capped at 128 KiB of UTF-8 JSON, and canonical inner preferences at 65,536 bytes. Unsupported versions, unknown fields, malformed values, and oversized files are rejected before writes.

Files include both Desktop/Mobile layout profiles and selected opaque bookmark/device identities. Identities from another installation can remain unresolved; importing does not substitute by name or create integrations/devices. Files do not contain browser scope/follow choices, revision counters, account credentials/configuration, managed devices, wake history, NFS paths, temporary image URLs, or provider/browser caches. This is a settings transfer, not a complete server backup. See [settings scope](settings-scope.md).
