"""Bounded human output, separate from byte-exact release evidence and authority."""

from collections import deque
import os
import re
import selectors
import socket
import stat
import sys
import threading
import time
import unicodedata
from urllib.parse import unquote, urlsplit


QUEUE_LIMIT = 65536
LINE_LIMIT = 4096
DISPLAY_LIMIT = 1048576
TAIL_LIMIT = 8192
HEARTBEAT_SECONDS = 10
ANSI = re.compile(r"\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[@-_])")


class ConsoleSink:
  """Reopen Linux descriptors: nonblocking writes must not change ancestor flags."""
  def __init__(self, descriptors=(2,), limit=QUEUE_LIMIT):
    self.targets = {}
    self.sockets = {}
    self.pending = deque()
    self.size = 0
    self.limit = limit
    for descriptor in descriptors:
      try:
        self.targets[descriptor] = os.open(f"/proc/self/fd/{descriptor}", os.O_WRONLY | os.O_NONBLOCK | os.O_APPEND)
      except OSError:
        try:
          if stat.S_ISSOCK(os.fstat(descriptor).st_mode):
            connection = socket.socket(fileno=os.dup(descriptor))
            self.sockets[descriptor] = connection
            self.targets[descriptor] = connection.fileno()
        except OSError:
          pass

  def write(self, descriptor, data):
    if descriptor in self.sockets:
      return self.sockets[descriptor].send(data, socket.MSG_DONTWAIT | socket.MSG_NOSIGNAL)
    return os.write(self.targets[descriptor], data)

  def emit(self, data, descriptor=2):
    if descriptor not in self.targets:
      return False
    if not self.pending:
      try:
        count = self.write(descriptor, data)
        if count == len(data):
          return True
        data = data[count:]
      except BlockingIOError:
        pass
      except OSError:
        self.disable(descriptor)
        return False
    if self.size + len(data) <= self.limit:
      self.pending.append((descriptor, data))
      self.size += len(data)
      return True
    return False

  def disable(self, descriptor):
    target = self.targets.pop(descriptor, None)
    if target is not None:
      connection = self.sockets.pop(descriptor, None)
      if connection is not None:
        connection.close()
      else:
        os.close(target)

  def pump(self):
    # Bound each pass even when a producer continuously fills the queue.
    blocked = set()
    for _ in range(len(self.pending)):
      descriptor, data = self.pending.popleft()
      self.size -= len(data)
      target = self.targets.get(descriptor)
      if target is None:
        continue
      if descriptor in blocked:
        self.pending.append((descriptor, data))
        self.size += len(data)
        continue
      try:
        count = self.write(descriptor, data)
        data = data[count:]
      except BlockingIOError:
        pass
      except OSError:
        self.disable(descriptor)
        continue
      if data:
        blocked.add(descriptor)
        self.pending.append((descriptor, data))
        self.size += len(data)

  def close(self):
    for descriptor in list(self.targets):
      self.disable(descriptor)
    self.pending.clear()
    self.size = 0


class ConsoleBoundary:
  """Own every worker/supervisor console write throughout locked execution/cleanup."""
  def __enter__(self):
    self.sink = ConsoleSink((1, 2))
    self.readers = {}
    self.deadline = None
    for descriptor in (1, 2):
      reader, writer = os.pipe()
      os.set_blocking(reader, False)
      self.readers[reader] = descriptor
      os.dup2(writer, descriptor)
      os.close(writer)
    self.thread = threading.Thread(target=self.drain, name="release-console", daemon=True)
    self.thread.start()
    return self

  def drain(self):
    selector = selectors.DefaultSelector()
    try:
      for reader, descriptor in self.readers.items():
        selector.register(reader, selectors.EVENT_READ, descriptor)
      while self.deadline is None or time.monotonic() < self.deadline:
        for key, _ in selector.select(.02):
          try:
            data = os.read(key.fd, 4096)
          except OSError:
            data = b""
          if data:
            self.sink.emit(data, key.data)
          else:
            selector.unregister(key.fd)
        self.sink.pump()
        if self.deadline is not None and not selector.get_map() and not self.sink.pending:
          break
    finally:
      selector.close()
      for reader in self.readers:
        os.close(reader)
      self.sink.close()

  def __exit__(self, *_):
    # Drain remains alive during flush; never restore a blocked external console.
    for stream in (sys.stdout, sys.stderr):
      try:
        stream.flush()
      except OSError:
        pass
    null = os.open(os.devnull, os.O_WRONLY)
    for descriptor in (1, 2):
      os.dup2(null, descriptor)
    os.close(null)
    self.deadline = time.monotonic() + 1.9
    self.thread.join(2)


def message(text):
  """Fixed application-owned status, including standalone exception handlers."""
  sink = ConsoleSink(limit=0)
  try:
    sink.emit((text + "\n").encode("utf-8", "replace"))
  finally:
    sink.close()


def proxy_secrets(environment):
  values = set()
  for key in ("HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"):
    value = environment.get(key, "")
    try:
      parsed = urlsplit(value)
      if parsed.username is not None or parsed.password is not None:
        values.add(value)
        for credential in (parsed.username, parsed.password):
          if credential:
            values.update((credential, unquote(credential)))
    except ValueError:
      # Invalid credential-bearing proxy strings are never a reason to echo them.
      if value:
        values.add(value)
  return sorted(values, key=len, reverse=True)


class SafeStream:
  def __init__(self, emit, secrets=()):
    self.emit = emit
    self.secrets = secrets
    self.pending = bytearray()
    self.opaque = False
    self.private_key = False

  def feed(self, data, eof=False):
    if self.opaque:
      return
    pieces = re.split(b"[\r\n]", data)
    for index, piece in enumerate(pieces):
      if len(self.pending) + len(piece) > LINE_LIMIT:
        self.pending.clear()
        self.opaque = True
        self.emit("[unsafe or oversized stream omitted through EOF]")
        return
      self.pending.extend(piece)
      if index < len(pieces) - 1 or eof:
        self.record()
        if self.opaque:
          return

  def record(self):
    try:
      text = self.pending.decode("utf-8")
    except UnicodeDecodeError:
      self.opaque = True
      self.pending.clear()
      self.emit("[invalid text omitted through EOF]")
      return
    self.pending.clear()
    text = ANSI.sub("", text)
    text = "".join(char for char in text if char == "\t" or unicodedata.category(char) not in ("Cc", "Cf"))
    if self.private_key:
      if re.search(r"-----END .*PRIVATE KEY-----", text):
        self.private_key = False
      return
    if re.search(r"-----BEGIN .*PRIVATE KEY-----", text):
      self.private_key = True
      self.emit("[private key omitted]")
      return
    if re.search(r"^\s*(?:environment|env|configuration|config)(?:\s+dump)?\s*[:={]", text, re.I) or re.match(r"^\s*(?:[A-Z_][A-Z0-9_]*\s*=|[\[{]\s*$)", text):
      self.opaque = True
      self.emit("[configuration dump omitted through EOF]")
      return
    if re.search(r"(?:authorization|password|passwd|token|secret|credential)[\w\s\"'-]*\s*[:=]|\b(?:Bearer|Basic)\s+\S+", text, re.I):
      self.emit("[sensitive record omitted]")
      return
    for secret in self.secrets:
      text = text.replace(secret, "[redacted]")
    text = re.sub(r"(https?://)[^\s/@]+@", r"\1[redacted]@", text)
    text = re.sub(r"SENTINEL_[A-Z_]+", "[redacted]", text)
    if text:
      self.emit(text)


class Progress:
  def __init__(self, label, local=False, environment=None, clock=time.monotonic, sink=None):
    self.label = re.sub(r"[^\w .:/()-]", "?", label)[:120]
    self.local = local
    self.clock = clock
    self.started = self.last = clock()
    self.closed = False
    self.displayed = 0
    self.suppressed = False
    self.dropped = False
    self.tail = deque()
    self.tail_size = 0
    self.sink = sink or ConsoleSink(limit=0)
    self.owns_sink = sink is None
    secrets = proxy_secrets(environment or {})
    self.streams = {name: SafeStream(lambda text, name=name: self.record(name, text), secrets) for name in ("stdout", "stderr")}
    self.status("started")

  def status(self, state):
    self.sink.emit(f"[{self.label} +{self.clock() - self.started:.1f}s] {state}\n".encode())

  def record(self, stream, text):
    data = f"[{self.label} +{self.clock() - self.started:.1f}s {stream}] {text}\n".encode()
    self.tail.append(data)
    self.tail_size += len(data)
    while self.tail_size > TAIL_LIMIT:
      self.tail_size -= len(self.tail.popleft())
    if self.displayed + len(data) <= DISPLAY_LIMIT:
      self.displayed += len(data)
      if not self.sink.emit(data):
        self.dropped = True
    elif not self.suppressed:
      self.suppressed = True
      self.status("additional child logs suppressed; verification continues")
    self.last = self.clock()

  def feed(self, name, data):
    if self.local and not self.closed and name in self.streams:
      self.streams[name].feed(data)

  def eof(self, name):
    if self.local and not self.closed and name in self.streams:
      self.streams[name].feed(b"", eof=True)

  def tick(self):
    if not self.closed and self.clock() - self.last >= HEARTBEAT_SECONDS:
      self.status("still running")
      self.last = self.clock()

  def finish(self, state):
    if self.closed:
      return
    for name in self.streams:
      self.eof(name)
    self.closed = True
    if self.local and self.dropped and state.startswith("failed"):
      self.status("sanitized failure context; undelivered console records may be omitted")
      for data in self.tail:
        if self.displayed + len(data) <= DISPLAY_LIMIT:
          self.displayed += len(data)
          self.sink.emit(data)
    self.status(state)
    if self.owns_sink:
      self.sink.close()
