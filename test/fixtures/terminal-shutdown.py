import errno
import json
import os
import pty
import select
import sys
import time

settings = json.loads(sys.argv[1])
try:
  pid, descriptor = pty.fork()
except OSError as error:
  print(json.dumps({"unsupported": str(error)}))
  sys.exit(0)
if pid == 0:
  os.chdir(settings["cwd"])
  os.execvpe(settings["command"][0], settings["command"], settings["environment"])

output = bytearray()
sent = False
status = None
drained = False
deadline = time.monotonic() + settings.get("timeoutMs", 45000) / 1000
while time.monotonic() < deadline:
  readable, _, _ = select.select([] if drained else [descriptor], [], [], 0.05)
  if readable:
    try:
      chunk = os.read(descriptor, 65536)
    except OSError as error:
      if error.errno != errno.EIO:
        raise
      chunk = b""
    if chunk:
      output.extend(chunk)
      if settings.get("sendCtrlC", True) and not sent and b"dashboard listening at" in output:
        os.write(descriptor, b"\x03")
        sent = True
    else:
      drained = True
  if status is None:
    waited, value = os.waitpid(pid, os.WNOHANG)
    if waited:
      status = value
  if status is not None and drained:
    break
timed_out = status is None or not drained
os.close(descriptor)
# Only wait for this invocation's cooperative child; never signal a process group.
cleanup_deadline = time.monotonic() + 5
while status is None and time.monotonic() < cleanup_deadline:
  waited, value = os.waitpid(pid, os.WNOHANG)
  if waited:
    status = value
  else:
    time.sleep(0.01)
print(json.dumps({
  "pid": pid,
  "sentCtrlC": sent,
  "code": os.waitstatus_to_exitcode(status) if status is not None else None,
  "exitCode": os.WEXITSTATUS(status) if status is not None and os.WIFEXITED(status) else None,
  "signal": os.WTERMSIG(status) if status is not None and os.WIFSIGNALED(status) else None,
  "timedOut": timed_out,
  "drained": drained,
  "reaped": status is not None,
  "output": output.decode("utf-8", errors="replace")
}))
