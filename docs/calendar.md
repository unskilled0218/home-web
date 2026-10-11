# Baikal calendar

The calendar is optional. On `/`, open **Settings → Calendar → Baikal calendar** and enter only the Baikal server URL, such as `https://baikal.example.test`, plus a username and password. Do not add `/dav.php/` or a calendar path. The dashboard follows Baikal's same-origin CalDAV discovery flow to locate the authenticated principal, calendar home, and up to 20 event-capable calendars. Use a dedicated least-privilege account when practical.

The client supports Baikal installations configured for either HTTP Basic or HTTP Digest authentication. It follows a Digest challenge using MD5, MD5-sess, SHA-256, or SHA-256-sess with `qop=auth`; unsupported challenge modes fail without exposing the password.

The server rediscovers calendars after each cache expiry or explicit refresh, queries discovered calendars with at most four requests in flight, and merges their results into one agenda. Each bounded depth-1 CalDAV `calendar-query` requests events overlapping the current instant through 14 days ahead. The dashboard displays at most 10 ordered events, including timed, all-day, multi-day, and recurring instances expanded by Baikal/SabreDAV. The integration is read-only: it does not select or label individual calendars, create or edit events, process invitations, display tasks, or execute alarms. A server that does not support standard principal/home discovery and the required RFC 4791 time-range and expansion report cannot be connected.

Some Baikal/SabreDAV installations store `calendar-timezone` as a timezone name instead of the required `VCALENDAR` value and return HTTP 500 when expansion is requested. The dashboard retries that calendar query without expansion so non-recurring events remain available. Recurring instances may be incomplete in this fallback mode until the server's calendar-timezone property is corrected.

Timed events are displayed in the dashboard's selected timezone; all-day dates remain calendar dates and do not drift across timezones. The browser refreshes automatically every five minutes while the calendar is visible, pauses while hidden or disabled, and refreshes immediately when active again. A temporary network or server failure retains a clearly marked stale snapshot, but authentication, authorization, malformed-response, and unsupported-report failures do not serve cached private events.

The Baikal password is sent only from the browser to this dashboard during connection, then encrypted in `data/wol.db` with the shared integration-credential key. It is never returned or prefilled. Leave it blank to retain the saved password only when the normalized server URL and username are unchanged; changing either requires the password again. A failed reconnect preserves the previous working configuration, and **Disconnect calendar** deletes the saved URL, username, and encrypted password. Existing exact collection URLs saved by version `0.13.3` are migrated to their server origin without decrypting or rewriting the password. Back up the database and encryption key together.

Normal HTTPS certificate-chain, hostname, and validity checks apply. For a Baikal server using a private CA, place only the public CA/intermediate bundle under `certs/` and configure scoped trust:

```sh
mkdir -p certs
cp /path/to/baikal-ca.pem certs/baikal-ca.pem
printf '\nCALDAV_CA_FILE=./certs/baikal-ca.pem\n' >> .env
npm start
```

`CALDAV_CA_FILE` affects only CalDAV requests and must contain valid certificates without private keys. It does not alter Linkwarden, Home Assistant, Open-Meteo, or other Node trust. Discovery redirects and hrefs must remain on the configured origin. The default `CALDAV_CACHE_SECONDS=300` matches the browser refresh interval. Plain `http://` server URLs are supported only for trusted-LAN deployments and expose authentication traffic to anyone able to observe or alter that network path; prefer HTTPS even on the LAN.

[Back to README](../README.md)
