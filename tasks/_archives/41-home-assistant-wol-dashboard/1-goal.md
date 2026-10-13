# goal

## command

- ha, wol between weather and bookmarks
  - ha takes top half, wol takes bottom half

- ha devices
  - display selected devices to dashboard

- wol
  - display name with `Wake` button only

## goal

Add a dashboard column between the weather/information area and bookmarks. Home Assistant occupies its top half, and Wake-on-LAN occupies its bottom half on desktop. Preserve the photo background, clock, calendar, weather, bookmarks, existing display preferences, and fullscreen behavior. On narrow screens, stack the sections in a readable order without horizontal overflow or inaccessible content. Keep long device lists contained within their sections so they do not overlap neighboring content.

Extend **Settings → Home Assistant** to list devices from the saved connection and let users select which devices appear on the dashboard. Save selection globally on the server using the existing dashboard preference storage and revision-aware synchronization, rather than browser-only state or a second settings store. Existing installations start with no devices selected. Identify selections by stable device IDs, not names or short-lived control tokens, and scope them to the configured Home Assistant instance so changing connections cannot display unrelated devices accidentally. Preserve unsaved selection drafts during background refreshes and keep connection actions independent of Save preferences.

Show only selected Home Assistant devices in the upper section, with their display names and supported sensor readings from the existing device API. Handle devices with no readings, unavailable readings, missing selected devices, an unconfigured connection, and request failures clearly. Refresh confirmed device snapshots while the page is visible and after relevant connection or selection changes; do not present cached readings as live data. This request adds device display and selection, not new Home Assistant control actions or support for additional entity types.

Show saved Wake-on-LAN devices in the lower section. Each device row contains only its name and a button labeled **Wake**; do not expose MAC addresses, IP addresses, broadcast addresses, groups, edit/delete controls, or wake history in dashboard rows. Keep device management in **Settings → Wake-on-LAN**. Clicking Wake invokes the existing wake API for that device, prevents duplicate requests while pending, and presents accessible success, cooldown, and error feedback outside the device row as needed. Never wake automatically or retry a wake request automatically. Success means a magic packet was sent, not that the computer booted.

Reuse the existing Home Assistant connection/device APIs, Wake-on-LAN device/wake APIs, encrypted credentials, and frontend integration patterns. Keep credentials server-side and preserve existing connection, device-management, and wake audit behavior. Refresh saved Wake-on-LAN devices after settings changes and synchronize dashboard data across browsers consistently with existing settings behavior. Failed refreshes retain confirmed data with clear stale/error feedback; late responses from previous connections must not overwrite current dashboard state.

Completion means the desktop column sits between weather and bookmarks with equal upper/lower sections, selected Home Assistant devices persist across reloads and server restarts, and every saved Wake-on-LAN device has a working name-and-Wake row. Cover selection persistence and synchronization, connection changes, missing devices, empty lists, sensor formatting, refresh failures, wake success/cooldown/failure, duplicate-click protection, keyboard access, desktop/mobile layouts, and fullscreen/bookmark visibility without regressions. Update README and the relevant dashboard, Home Assistant, and Wake-on-LAN documentation to describe the new dashboard sections and selection behavior. Implementation code remains unchanged during this goal-writing task.
