# Moonlight Wake-on-LAN parity implementation

## Delivered

- Send Moonlight-compatible 102-byte magic packets to the configured directed broadcast, limited broadcast, the optional saved host address, and active local interface broadcasts.
- Send each unique destination on Moonlight's static Wake-on-LAN ports: UDP `9` and `47009`.
- Keep the configured `WOL_PORT` as an additional destination port when it is not already one of Moonlight's ports.
- Add deterministic dispatch planning and tests for payloads, destinations, duplicate elimination, ports, socket configuration, and send failures.
- Document the broadcast-address field and Moonlight-compatible dispatch behavior.

## Verification

- `npm test`
- `node --check src/wol.js`
- `node --check src/server.js`
- `node --check public/app.js`
