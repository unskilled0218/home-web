"""Linux-only ownership of nested verification processes, including new sessions."""

import ctypes
import os
from pathlib import Path
import signal
import time


def identity(pid):
  try:
    fields = Path(f"/proc/{pid}/stat").read_text().rsplit(") ", 1)[1].split()
    return fields[19], fields[1], fields[0]
  except (OSError, IndexError):
    return None


def children(pid):
  try:
    return [int(value) for value in Path(f"/proc/{pid}/task/{pid}/children").read_text().split()]
  except OSError:
    return []


class TreeOwner:
  def __init__(self):
    if not Path("/proc/self/task").is_dir() or ctypes.CDLL(None, use_errno=True).prctl(36, 1, 0, 0, 0) != 0:
      raise RuntimeError("Linux child-subreaper supervision is required")
    self.baseline = {pid: record[0] for pid in children(os.getpid()) if (record := identity(pid))}
    self.owned = {}
    self.signaled = set()

  def collect(self):
    pending = [pid for pid in children(os.getpid()) if (record := identity(pid)) and self.baseline.get(pid) != record[0]]
    pending.extend(self.owned)
    seen = set()
    while pending:
      pid = pending.pop()
      if pid in seen:
        continue
      seen.add(pid)
      record = identity(pid)
      if record is None or (pid in self.owned and self.owned[pid] != record[0]):
        continue
      self.owned[pid] = record[0]
      pending.extend(children(pid))

  def signal(self, number):
    self.collect()
    for pid, stamp in self.owned.items():
      record = identity(pid)
      key = (pid, stamp, number)
      if record and record[0] == stamp and record[2] != "Z" and key not in self.signaled:
        try:
          os.kill(pid, number)
          self.signaled.add(key)
        except ProcessLookupError:
          pass

  def remaining(self, process=None):
    self.collect()
    if process is not None:
      process.poll()
    remaining = []
    for pid, stamp in self.owned.items():
      record = identity(pid)
      if not record or record[0] != stamp:
        continue
      if record[2] == "Z" and (process is None or pid != process.pid):
        try:
          os.waitpid(pid, os.WNOHANG)
        except ChildProcessError:
          pass
        record = identity(pid)
      if record and record[0] == stamp:
        remaining.append(pid)
    return remaining

  def cleanup(self, process=None):
    for number, seconds in ((signal.SIGTERM, 10), (signal.SIGKILL, 5)):
      deadline = time.monotonic() + seconds
      while self.remaining(process):
        self.signal(number)
        if time.monotonic() >= deadline:
          break
        time.sleep(0.02)
      if not self.remaining(process):
        return
    raise RuntimeError("Owned process cleanup unconfirmed: " + ",".join(map(str, self.remaining(process))))
