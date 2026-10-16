# Global settings import and export

- [Global settings import and export](#global-settings-import-and-export)
  - [Export](#export)
  - [Import](#import)
  - [File contract](#file-contract)

## Export

Use Settings → General → Export global settings. The downloaded `dashboard-global-settings.json` contains current saved global preferences and the global weather location. Export is read-only and works while Local is selected; it never substitutes Local values, unsaved form edits, or browser caches. It does not initialize a global preference row or retrieve provider data.

## Import

Select Global, save/discard current preference/layout edits, and choose a JSON file. File selection validates the file without applying it. **Import global settings** explicitly replaces global preferences and weather location in one SQLite transaction. Two expected live revisions protect both components; an intervening global preference or location change rejects the import without partial writes. Reload shared preferences and retry after reviewing a conflict; the chosen file is retained on failure. Identical imports retain existing revisions. A `null` weather location clears the global location/cache and retires old work.

Successful imports update Global browsers and their shared photo/weather owners. Local records and every browser's saved mode remain unchanged. Import stays disabled in Local mode. A timed-out request can have an uncertain commit outcome: check current global state before repeating it. Provider/service notification failures do not undo an already committed transaction.

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

`preferences` must be a complete current canonical dashboard preference object; the empty object above is a shape illustration, not a valid import. `weatherLocation` is `null` or a validated `{ latitude, longitude, label }` record. Files are capped at 128 KiB of UTF-8 JSON, and canonical inner preferences at 65,536 bytes. Unsupported versions, unknown fields, malformed values, and oversized files are rejected before writes.

Files include both Desktop/Mobile layout profiles and selected opaque bookmark/device identities. Identities from another installation can remain unresolved; importing does not substitute by name or create integrations/devices. Files do not contain browser scope choices, revision counters, account credentials/configuration, managed devices, wake history, NFS paths, temporary image URLs, or provider/browser caches. This is a settings transfer, not a complete server backup. See [settings scope](settings-scope.md).
