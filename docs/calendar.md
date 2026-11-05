# Baikal calendar

- [Baikal calendar](#baikal-calendar)
  - [Connect](#connect)
  - [Agenda](#agenda)
  - [Private certificates](#private-certificates)

## Connect

1. Open **Settings → Calendar** and choose Global.
2. Under **Baikal calendar**, enter the server URL, username, and password.
3. Connect, then save display preferences separately with **Save Calendar settings**.

Use a server URL such as `https://baikal.example.test`, without `/dav.php/` or a calendar path. Prefer a dedicated, least-privilege account. HTTP Basic and supported HTTP Digest authentication work.

Credentials are shared and encrypted in SQLite. They are never returned to the browser. Leave the password blank only to reuse it with the same normalized URL and username. Failed reconnects keep the working connection. Disconnect deletes saved credentials. Back up the database and encryption key together.

## Agenda

The dashboard discovers up to 20 event calendars and shows at most 10 ordered events from now through 14 days ahead. It supports timed, all-day, multi-day, and server-expanded recurring events.

This integration is read-only. It cannot edit events, handle invitations, show tasks, or run alarms. Baikal must support standard CalDAV discovery and time-range reports.

Time settings control event timezone and format; all-day dates stay unchanged. Events normally refresh every five minutes while visible. Temporary outages retain a marked stale agenda; access or invalid-response errors do not expose cached private events.

If Baikal returns HTTP 500 because `calendar-timezone` contains a name instead of a `VCALENDAR` value, the dashboard retries without recurrence expansion. Fix that server property if recurring instances are missing.

## Private certificates

Copy the public CA/intermediate bundle to `certs/baikal-ca.pem`, then set this in `.env` and restart:

```dotenv
CALDAV_CA_FILE=./certs/baikal-ca.pem
```

Use certificates only, never private keys. Trust applies only to CalDAV; hostname, validity, and chain checks remain enabled. Discovery stays on the configured origin.

Prefer HTTPS. Plain HTTP exposes authentication traffic on the network and is suitable only for a trusted LAN.

[Back to README](../README.md)
