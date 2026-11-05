# Dashboard

- [Dashboard](#dashboard)
  - [Settings](#settings)
  - [Layout and fullscreen](#layout-and-fullscreen)
  - [Photos](#photos)
  - [Weather](#weather)
  - [Connected services](#connected-services)

## Settings

The home page `/` shows enabled widgets over a photo or solid background. Open **Settings** to change them.

- **General:** Global import/export and settings-scope recovery.
- **Time:** Clock, timezone, date, and time format.
- **Weather:** City, units, hourly forecast, and daily forecast.
- **Calendar:** Baikal connection and calendar display.
- **Bookmarks:** Linkwarden connection and selected links.
- **Home Assistant:** Connection and selected devices.
- **Wake-on-LAN:** Saved computers and display options.
- **Images:** Photos, background color, transitions, and NFS status.

Each widget tab has its own **Local/Global** choice. New browsers start Local. Save each category separately; switching tabs keeps drafts, but closing Settings discards unsaved display changes. Connection and device actions save separately. See [settings scope](settings-scope.md).

## Layout and fullscreen

Each widget has separate Desktop/Mobile visibility and scale settings, plus a fullscreen hiding option. Mobile applies at widths up to 600px. Both profiles can be edited on any screen.

Automatic layout uses columns above 1000px and stacked sections below. Hidden sections leave no empty tracks. Use **Edit layout** or hold a widget background for 600ms to move, resize, and layer enabled widgets. Visibility-disabled widgets are omitted from editor controls but keep their saved geometry. See [layout editing](dashboard-layout.md).

**Enter fullscreen** depends on browser support. Escape exits. Fullscreen hiding changes display only; it does not disconnect services or stop photos. If all widgets are hidden, Settings and Exit fullscreen remain available.

## Photos

Enable an NFS source using the [photo setup guide](nfs-backgrounds.md). JPEG, PNG, WebP, and GIF files are supported.

Global Images uses the server slideshow. Local Images follows it by default, with independent display preferences. Turn off **Show the same image as Global** and save for independent Local playback from up to 100 eligible files. The Global slideshow can use the full eligible inventory.

Images has **Show image** for desktop, **Show image on mobile** up to and including 600px, and **Hide image in fullscreen** to override either profile until fullscreen ends. Save to apply. Each follows Images scope. Older records inherit their existing image visibility on mobile; fullscreen hiding defaults off.

Hiding images hides photos, blurred backdrops, and filenames. Widgets and the solid background remain. Playback and image requests continue while hidden; hidden browser pages pause their own work.

The browser prepares only the immediate next image. Temporary failures retain the last good image; a confirmed disabled or empty source clears it. Shared selection does not mean frame-perfect transitions.

## Weather

Search for a city in **Settings → Weather**. **Clear results** clears search results, not the saved city. City search goes directly to Open-Meteo; the server retrieves forecasts and air quality. No API key is needed.

Weather includes current conditions, three-hourly samples for the next 24 hours, seven daily forecasts, and US AQI. Hourly and daily lists can be hidden separately. Time settings control weather and calendar timestamps; Weather settings control units.

**Updated** is the last successful forecast retrieval time, not the observation time. AQI updates separately. Failed refreshes retain same-location data with a stale warning. Global weather refreshes at startup and hourly without viewers; Local weather uses a separate demand-driven cache.

On Node 24.5+, enable Node's environment proxy support explicitly when needed:

```sh
NODE_USE_ENV_PROXY=1 HTTPS_PROXY=http://proxy.lan:3128 npm start
```

`HTTP_PROXY` or `HTTPS_PROXY` alone does not enable routing. Lowercase variables take precedence. `NO_PROXY` supports hosts, suffixes, ports, and wildcards; `*.example.com` includes the domain itself. Bypass changes are read per request. Invalid enabled proxy settings fail rather than silently going direct. TLS checks and bounded request deadlines remain enabled.

## Connected services

- [Baikal](calendar.md): Read-only agenda.
- [Linkwarden](linkwarden.md): Selected links in a flat list.
- [Home Assistant](home-assistant.md): Selected devices and read-only readings.
- [Wake-on-LAN](wake-on-lan.md): Explicit buttons to wake saved computers.

Credentials and managed devices are shared server resources. Connection changes and device management require the owning category to be Global. Local display choices do not create private accounts or server authorization.

Visible pages refresh shared settings and device status about every five seconds. Hidden pages pause browser reads. Failed reads retain confirmed state. After a save timeout, check saved status before retrying: the server may have committed it.

[Back to README](../README.md)
