# Settings scope

- [Settings scope](#settings-scope)
  - [Choose Local or Global](#choose-local-or-global)
  - [Storage and switching](#storage-and-switching)
  - [Weather and photos](#weather-and-photos)
  - [Installation resources](#installation-resources)

## Choose Local or Global

Open Settings → General → Settings scope. **Local — this browser** is the default. Each browser profile independently remembers its mode. Changing A to Local does not change B/C's mode: browsers already using Global continue using Global and synchronizing with each other.

Local owns time format/timezone, weather city/units, visibility/fullscreen options, selected bookmarks/devices, both layout profiles, and image order/interval/presentation. Local changes do not publish global settings. **Global — all Global browsers** uses the existing server-side preference record and revision conflicts. Joining Global reads current shared settings; it does not copy Local values into them. Returning to Local restores the profile's local values.

## Storage and switching

The mode lives in `dashboard.settings-scope.v1`; Local preferences and weather location live separately in `dashboard.local-settings.v1`. Both belong to this dashboard origin in the browser profile. Tabs in the same profile share those values through storage events; independent profiles/contexts do not. Clearing site data removes them. Private browsing/storage restrictions can prevent persistent saves; failures retain the previous confirmed state and draft rather than reporting success. A Local preview works without a healthy global settings endpoint.

Without a Local record, valid legacy `dashboard.preferences.v1` values can restore the old browser configuration, including its city. Global caches are never used as Local defaults. Legacy values are retained until an explicit Local save succeeds. Updated Global clients no longer automatically publish legacy preferences into an uninitialized server record. Existing global SQLite settings are preserved.

Save or discard edits before changing scope in the same tab. If another tab changes scope while a form/layout draft is open, reload/discard that draft before saving it; old-source drafts cannot write into the new scope even when revision numbers coincide. Global writes already admitted by the server may still commit after a tab changes scope. Aborting a browser wait does not roll back SQLite. Local read-before-write revision checks catch already-changed drafts, but truly simultaneous multi-tab writes use last-successful-write semantics because browser storage has no transactional compare-and-swap.

## Weather and photos

Local city choices remain in browser storage. `/api/weather/local` queries data for those coordinates/timezone without changing the global saved location or persisted weather cache. The server keeps at most 16 volatile Local keys and 512 KiB of normalized data, admits at most two provider requests, and retries retained keys hourly, including failed attempts. Inactive keys can be evicted. Pending data is polled every five seconds and settled data every minute while visible. Units change presentation without another provider retrieval. No Local location means no Local weather query. Coordinates reach the server for retrieval; this is not a private server account or a persistent server-side per-browser configuration.

Local photos use `/api/dashboard/photos/local`, independently ordering/rotating the eligible shared image library in that browser. Hidden pages pause playback and discovery; resume refreshes the manifest. Global photos follow `/api/dashboard/slideshow` and the independently advancing server selection, including with no viewers. Scope changes activate only one player and retire old decodes. Presentation updates keep the current layer; failures retain a previous good background, and confirmed disabled/empty sources clear it. See [NFS backgrounds](nfs-backgrounds.md) for source limits and failure states.

Global weather continues persisted startup/hourly retrieval, even when all viewers are closed or Local. Its location and photo cursor do not change because a Local browser chooses another city, image order, or interval.

## Installation resources

Integration credentials/accounts, NFS mounts, managed Wake-on-LAN devices, and wake history remain server resources. Local can read shared integration content with independent display selections; connection/device-management controls require Global mode. This UI scope is not a server authorization role. Normal Wake buttons retain their separate explicit action behavior.

See [global settings import/export](settings-import-export.md) for portable settings files and [dashboard features](dashboard.md) for display controls.
