# Global settings transfer

- [Global settings transfer](#global-settings-transfer)
  - [Export](#export)
  - [Import](#import)
  - [File contents](#file-contents)

## Export

Choose **Settings → General → Export global settings**. The download is `dashboard-global-settings.json`.

It contains saved Global preferences and the Global weather location, not Local values, unsaved edits, or browser caches. Export is read-only and works even when all categories are Local.

## Import

1. Save or discard all category and layout drafts.
2. Select a JSON file in General. Selection validates it and reads fresh Global revisions; it does not apply changes.
3. Choose **Import global settings** to replace all Global preferences and the Global weather location together.

If preparation fails or another browser changes Global settings, review the error and choose **Reload**. Then explicitly import again. Background polling does not approve a stale import.

Local preferences, scope choices, layout ownership, and Local photo-follow choices stay unchanged. Global-backed categories update. Local photo followers may display a different image; Local Weather never adopts the imported city.

A `null` weather location clears the Global location and cache. After a timeout, check Global state before retrying: the import may have committed.

## File contents

Version 1 uses these fields:

```json
{
  "format": "home-web.global-settings",
  "version": 1,
  "preferences": {},
  "weatherLocation": null
}
```

This shows the structure only. `preferences` must be a complete valid preference object; `{}` is not importable. `weatherLocation` is `null` or `{ latitude, longitude, label }`.

Files include Desktop/Mobile layouts and selected bookmark/device identities. They exclude credentials, managed devices, wake history, NFS paths, browser choices, and caches. Identities from another installation may remain unresolved; imports do not create matching services or devices.

The maximum file size is 128 KiB; inner preferences are limited to 65,536 bytes. Unknown fields, unsupported versions, and invalid values are rejected before writes. Older complete version-1 exports may omit newer widget scales or image visibility; missing scales default to 1 and missing desktop image visibility defaults on. Missing mobile image visibility inherits desktop visibility; missing fullscreen image hiding defaults off. Explicit choices are preserved.

This is a settings transfer, not a server backup. See [operations](operations.md) and [settings scope](settings-scope.md).
