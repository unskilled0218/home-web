# Local and Global settings

- [Local and Global settings](#local-and-global-settings)
  - [Choose a scope](#choose-a-scope)
  - [Shared resources](#shared-resources)
  - [Save and resolve conflicts](#save-and-resolve-conflicts)
  - [Weather and photos](#weather-and-photos)
  - [Storage and recovery](#storage-and-recovery)

## Choose a scope

Time, Weather, Calendar, Bookmarks, Home Assistant, Wake-on-LAN, and Images each offer:

- **Local — this browser:** Keep independent settings in this browser profile.
- **Global — shared category:** Use settings shared with other browsers following that category.

New profiles start Local. You can mix Global Time with Local Weather. Switching scopes reads the chosen store; it does not copy values between stores. Tabs in one browser profile share scope choices.

Each category owns its visibility, scale, and fullscreen settings. Time also controls weather/calendar timestamps. Bookmarks and Home Assistant own their selected content. Images owns photo presentation and playback options.

General has no scope selector. It provides Global transfers and recovery. Layouts retain their existing ownership: Local for fresh profiles, Global where already saved that way.

## Shared resources

Credentials, NFS mounts, managed Wake-on-LAN devices, and wake history remain server resources in either scope.

Connecting/disconnecting Calendar, Linkwarden, or Home Assistant requires that category to be Global. Managing Wake-on-LAN devices requires Wake-on-LAN Global. Local categories can still read shared content; normal Wake buttons remain available separately.

Scope is not authentication or server authorization. Keep the dashboard on a trusted LAN.

## Save and resolve conflicts

Save or reload applies only to the selected category. Switching tabs keeps drafts; closing Settings discards unsaved display changes. Connection forms and city selection use separate actions.

Save or discard edits before switching scope. If another tab changes the source, reload before saving. Categories share a revision within each backing store, so saving one can make another draft stale.

Failed saves retain drafts. Global saves need confirmed server state; Local saves can work offline with writable browser storage. A timeout does not prove failure: check saved state before repeating the action.

Global [import/export](settings-import-export.md) works even when every category is Local. Imports replace Global settings, not Local records or scope choices.

## Weather and photos

Local Weather keeps its city in this browser and uses a temporary server cache. Global Weather stores the installation city and refreshes at startup and hourly. Neither adopts the other's city automatically.

Local Images follows Global's slideshow by default while retaining Local presentation. Disable **Show the same image as Global** and save for independent playback from up to 100 eligible files. Following disables Local order/interval controls without deleting their values.

**Show image**, **Show image on mobile**, and **Hide image in fullscreen** follow Images scope independently of playback source. Mobile applies up to and including 600px; fullscreen hiding overrides the active profile until fullscreen ends. Hiding images hides photos, blur, and filenames, not widgets or playback requests. Changing an unrelated category does not restart photos. See [NFS photos](nfs-backgrounds.md).

## Storage and recovery

Scope choices use `dashboard.category-scopes.v1`; Local settings use `dashboard.local-settings.v1`. Valid legacy choices/settings remain readable. Global caches never become Local defaults. Reload older tabs after upgrading.

If the scope map is corrupt, use **General → Reset category scopes to Local** and confirm. This replaces only the corrupt map, preserving preferences, city, credentials, server data, and drafts. Reload retained drafts afterward.

Do not clear all site data to repair the map. If browser storage is blocked, enable it first.

[Back to README](../README.md)
