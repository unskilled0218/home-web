# goal

## command

- make settings ui prettier
  - left tab
    - Time
    - Weather
    - Calendar
    - Images

## goal

Redesign the photo dashboard's Settings dialog into a polished interface with left-side navigation containing Time, Weather, Calendar, and Images tabs. Show the selected tab's settings in the adjacent content panel, with a clear active state, consistent spacing, readable labels, and coordinated controls that suit the dashboard's dark appearance.

Group the existing clock controls under Time, weather display preferences and location search under Weather, calendar display preferences and Baikal connection controls under Calendar, and slideshow/background preferences and NFS status under Images. Keep the existing information position and overall scale settings accessible as shared display controls without introducing another top-level tab.

Preserve current preference values, browser-local persistence under `dashboard.preferences.v1`, weather location selection, calendar connection/disconnection, and image settings. Switching tabs must retain entered values and must not save preferences or submit connection/search forms. Keep Save preferences, Close, status messages, and errors easy to find; saving must continue to handle preferences across all tabs.

Make tab navigation usable with both pointer and keyboard, expose the selected tab and panel to assistive technology, and keep the dialog usable on desktop and narrow mobile screens without horizontal overflow or inaccessible controls. Preserve modal closing and focus return to the Settings button.

The current Settings interface is a single scrolling dialog in `public/index.html`, styled by `public/dashboard.css`, with form and dialog behavior in `public/dashboard.js`. Completion means the four requested tabs organize all existing settings, the interface is visually coherent and responsive, and saving/searching/connecting still work after navigating between tabs. Verify affected behavior with the existing server/unit checks and browser checks when browser dependencies are available.
