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
deadline = time.monotonic() + 45
while time.monotonic() < deadline:
  readable, _, _ = select.select([descriptor], [], [], 0.1)
  if readable:
    try:
      chunk = os.read(descriptor, 65536)
    except OSError as error:
      if error.errno != errno.EIO:
        raise
      chunk = b""
    if chunk:
      output.extend(chunk)
      if not sent and b"dashboard listening at" in output:
        os.write(descriptor, b"\x03")
        sent = True
  waited, value = os.waitpid(pid, os.WNOHANG)
  if waited:
    status = value
    break
os.close(descriptor)
print(json.dumps({"sentCtrlC": sent, "code": os.waitstatus_to_exitcode(status) if status is not None else None, "output": output.decode("utf-8", errors="replace")}))
