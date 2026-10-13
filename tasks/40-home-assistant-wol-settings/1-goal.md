# goal

## command

- add setting tab for
  - home assistant
  - wol

## goal

Add dedicated **Home Assistant** and **Wake-on-LAN** tabs to the existing dashboard Settings dialog. Follow the current tab styling, keyboard navigation, accessible tab/panel relationships, and desktop/mobile layout. Keep the existing settings categories and photo dashboard behavior unchanged.

The Home Assistant tab lets users inspect the saved connection status, configure the instance URL and long-lived access token, connect or update the connection, and disconnect. Reuse the existing `/api/home-assistant` APIs and encrypted server storage. Never return or redisplay the saved token; allow a blank token to retain it only under the existing backend rules. Failed connection changes preserve the last working configuration and show a clear error. Explain that private CA configuration remains a server startup setting, not a browser certificate-verification bypass.

The Wake-on-LAN tab lets users list, add, edit, and delete saved devices using the existing `/api/devices` APIs. Expose the supported name, MAC address, broadcast address, optional IP address, and optional group fields with validation and clear save/error feedback. Preserve existing devices and wake audit records. Device deletion requires confirmation. This task adds configuration screens, not new Home Assistant device controls, sensor widgets, Wake-on-LAN dashboard widgets, or automatic wake actions.

Both tabs manage installation-wide server settings, not browser-local copies. Refresh saved public state when Settings opens and synchronize confirmed changes across browsers consistently with existing integration settings. Preserve unsaved form drafts during refreshes, keep integration actions independent of Save preferences, and do not report success before server confirmation. Clear submitted secrets after successful connection actions and avoid including credentials in messages or logs.

The project already has Home Assistant connection and device APIs, Wake-on-LAN device CRUD and wake APIs, and encrypted credential persistence. `public/index.html` currently exposes General, Time, Weather, Calendar, Bookmarks, and Images tabs only. Reuse these backend capabilities and the current frontend settings patterns rather than restoring the retired widget-layout system or introducing a second configuration store.

Completion means both tabs work on desktop and mobile with keyboard access; saved configuration survives reloads and server restarts and appears in another browser. Cover existing saved data, Home Assistant connect/update/disconnect and blank-token behavior, Wake-on-LAN device CRUD and deletion confirmation, validation failures, network/server errors, draft preservation, and integration with existing Settings synchronization. Retain existing dashboard tests and update README, `docs/dashboard.md`, `docs/home-assistant.md`, and `docs/wake-on-lan.md` to describe the new configuration screens without claiming dashboard controls were added.
