# goal

## command

- safely stop server with ctrl+c
  - current: stop server with ctrl+c show below with creating `core.1234` file
  ```
  ^C
  #  node[24310]: static void node::{anonymous}::FSEventWrap::GetInitialized(const v8::FunctionCallbackInfo<v8::Value>&) at ../src/fs_event_wrap.cc:92
  #  Assertion failed: (wrap) != nullptr

  ----- Native stack trace -----

  \ 1: 0x931db0  [node]
  2: 0x932498 node::Assert(node::AssertionInfo const&) [node]
  3: 0x8946da  [node]
  4: 0x7812d3dcf08d

  ----- JavaScript stack trace -----

  1: FSWatcher.close (node:internal/fs/watchers:348:21)
  2: #unwatch (node:internal/watch_mode/files_watcher:89:20)
  3: clear (node:internal/watch_mode/files_watcher:214:20)
  4: node:internal/main/watch_mode:208:13
  5: emit (node:events:514:28)


  npm error code EACCES
  npm error syscall kill
  npm error path /home/container/workdir/home-web
  npm error errno -13
  npm error Error: kill EACCES
  npm error     at ChildProcess.kill (node:internal/child_process:553:26)
  npm error     at process.handleSignal (/usr/lib/node_modules/npm/node_modules/@npmcli/run-script/lib/signal-manager.js:14:10)
  npm error     at process.emit (node:events:514:28) {
  npm error   errno: -13,
  npm error   code: 'EACCES',
  npm error   syscall: 'kill',
  npm error   cmd: 'sh',
  npm error   args: [ '-c', 'node --watch --env-file-if-exists=.env src/server.js' ],
  npm error   stdout: null,
  npm error   stderr: null,
  npm error   event: 'dev',
  npm error   script: 'node --watch --env-file-if-exists=.env src/server.js',
  npm error   pkgid: 'dashboard@0.17.11',
  npm error   path: '/home/container/workdir/home-web'
  npm error }
  npm error
  npm error The operation was rejected by your operating system.
  npm error It is likely you do not have the permissions to access this file as the current user
  npm error
  npm error If you believe this might be a permissions issue, please double-check the permissions of the file and its containing directories, or try running the command again as root/Administrator.
  npm error A complete log of this run can be found in: /home/container/.npm/_logs/2026-10-13T23_34_06_513Z-debug-0.log
  container@dev:~/workdir/home-web$ Segmentation fault (core dumped)
  ```

## goal

Make Ctrl+C stop the dashboard cleanly, especially when launched through `npm run dev` in the current unprivileged container. A normal stop must return control to the terminal, release the listening port, leave no owned server/watch child running, and avoid the reported native watcher assertion, segmentation fault, core-file creation, and npm `kill EACCES` failure. Support SIGTERM for ordinary server/container shutdown as well. Do not treat hiding error output or disabling core dumps as a shutdown fix.

Investigate application shutdown, Node's watch supervisor, npm's script shell and signal forwarding, and the relevant container restrictions as separate parts of the process lifecycle. `package.json` currently runs dev with `node --watch --env-file-if-exists=.env src/server.js`; the reported stack fails inside `node:internal/watch_mode` and `FSWatcher.close`, not directly inside an application watcher. `src/server.js` already handles SIGINT/SIGTERM with a single shutdown guard, `server.close()`, `weather.stop()`, database closure, and `process.exit(0)`. Establish which layer causes each failure before selecting a project-level remedy; adding another application signal handler alone must not be assumed to fix the native watch-parent crash or npm's permission error.

Provide a reliable supported development launch/stop path without root privileges, sudo, broad permission changes, or new container security privileges. Preserve useful automatic development reload behavior and avoid silently making dev equivalent to start. If the built-in watch supervisor must be replaced or bypassed on this environment, define ownership of watchers and server children, safe restart ordering, and signal forwarding so stopping cannot schedule a replacement child or leave the port occupied. If a runtime/npm update or host/container change is genuinely required, document the evidence and exact prerequisite for the user to install rather than claiming application code fixes an upstream runtime or permission failure.

Keep application shutdown idempotent and bounded. Stop accepting new connections, settle or cancel owned background work safely, close SQLite only after work that uses it has settled, and handle cleanup failures without unhandled promise rejections or an indefinite wait on stalled connections. Repeated shutdown signals must not double-close resources or restart the service. Distinguish intentional interruption from startup/runtime failures, and preserve meaningful failure exit behavior rather than always reporting success. Any forced termination must target only this invocation's owned resources.

Preserve `npm start`, `npm run start:lan`, existing LAN host/origin protections, encrypted credentials, stored preferences/devices, weather persistence, and startup configuration. Keep optional repository-root `.env` loading, process-environment precedence, and startup-time TLS settings such as `NODE_EXTRA_CA_CERTS` working for both development and normal runs. Do not change dashboard features, fix unrelated UI review findings, delete existing core files or logs, or modify `todo.md`.

Completion means the documented development and normal launch paths stop through Ctrl+C/SIGINT and SIGTERM with no watcher crash, permission-error stack, new core artifact, or orphaned process, and the same port can be bound immediately afterward. Verify only processes and temporary resources created by the tests. Cover ordinary idle shutdown, active/stalled requests or background work, repeated signals, development reload followed by shutdown, interruption during startup/restart, cleanup failures, and environment/TLS initialization. Include terminal/process-group signal behavior where supported rather than testing only a direct signal to the HTTP child. State any environment-specific verification limits honestly and retain existing tests. Update the focused local setup/operations documentation with the supported commands and expected stop behavior; keep README simple. This goal-writing task changes no implementation code.
