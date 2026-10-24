"""Real pre-exit visibility and owned console/confidentiality regressions."""

import fcntl
import importlib.util
import os
from pathlib import Path
import select
import signal
import socket
import subprocess
import sys
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))
from release_progress import ConsoleSink, DISPLAY_LIMIT, LINE_LIMIT, Progress, SafeStream
from temporary import parent


def data_module():
  spec = importlib.util.spec_from_file_location("progress_data", ROOT / "scripts/release-data.py")
  module = importlib.util.module_from_spec(spec)
  spec.loader.exec_module(module)
  return module


class MemorySink:
  def __init__(self):
    self.records = []

  def emit(self, data, descriptor=2):
    self.records.append(data)
    return True

  def text(self):
    return b"".join(self.records).decode()


class ProgressTests(unittest.TestCase):
  def setUp(self):
    self.directory = tempfile.TemporaryDirectory(prefix="release-progress-test-", dir=parent())
    self.addCleanup(self.directory.cleanup)
    self.base = Path(self.directory.name)

  def launch(self, code, *args, **kwargs):
    process = subprocess.Popen([sys.executable, "-B", "-u", "-c", code, *map(str, args)],
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE, **kwargs)
    def cleanup():
      if process.poll() is None:
        process.terminate()
      process.communicate(timeout=20)
    self.addCleanup(cleanup)
    return process

  def until_output(self, process, text, seconds=5):
    result = bytearray()
    deadline = time.monotonic() + seconds
    while text not in result and time.monotonic() < deadline:
      ready, _, _ = select.select([process.stderr], [], [], .05)
      if ready:
        chunk = os.read(process.stderr.fileno(), 65536)
        if not chunk:
          break
        result.extend(chunk)
    self.assertIn(text, result)
    return bytes(result)

  def loader(self):
    return "import importlib.util,sys;from pathlib import Path;sys.path.insert(0," + repr(str(ROOT / "scripts")) + ");spec=importlib.util.spec_from_file_location('verify'," + repr(str(ROOT / "scripts/release-verify.py")) + ");v=importlib.util.module_from_spec(spec);spec.loader.exec_module(v);"

  def test_real_gate_streams_before_exit_and_nonzero_partial_output_is_safe(self):
    for code in (0, 7):
      with self.subTest(code=code):
        release = self.base / ("release-" + str(code))
        child = "import sys,time;from pathlib import Path;print('first safe line',flush=True);p=Path(sys.argv[1]);\nwhile not p.exists(): time.sleep(.01)\nsys.stderr.write('last safe partial');sys.stderr.flush();raise SystemExit(" + str(code) + ")"
        runner = self.loader() + "v.gate('actual gate',[sys.executable,'-u','-c',sys.argv[2],sys.argv[1]],Path(sys.argv[1]).parent,v.verification_environment(Path(sys.argv[1]).parent),8)"
        process = self.launch(runner, release, child)
        before = self.until_output(process, b"first safe line")
        self.assertIsNone(process.poll(), "The line must be visible before the gate can finish")
        release.touch()
        _, after = process.communicate(timeout=10)
        output = before + after
        self.assertIn(b"last safe partial", output)
        self.assertEqual(process.returncode == 0, code == 0)
        self.assertIn(b"completed" if code == 0 else b"failed, exit 7", output)

  def test_real_quiet_child_keeps_heartbeat_after_both_pipes_close(self):
    release = self.base / "quiet-release"
    child = "import os,sys,time;from pathlib import Path;os.close(1);os.close(2);\nwhile not Path(sys.argv[1]).exists(): time.sleep(.01)"
    runner = self.loader() + "v.gate('quiet gate',[sys.executable,'-c',sys.argv[2],sys.argv[1]],Path(sys.argv[1]).parent,v.verification_environment(Path(sys.argv[1]).parent),15)"
    process = self.launch(runner, release, child)
    self.until_output(process, b"still running", seconds=13)
    self.assertIsNone(process.poll())
    release.touch()
    _, after = process.communicate(timeout=3)
    self.assertEqual(process.returncode, 0, after)
    self.assertNotIn(b"still running", after)

  def test_heartbeat_clock_stops_at_finish(self):
    now = [0.0]
    sink = MemorySink()
    progress = Progress("clock", clock=lambda: now[0], sink=sink)
    now[0] = 9.9; progress.tick()
    self.assertNotIn("still running", sink.text())
    now[0] = 10; progress.tick()
    self.assertEqual(sink.text().count("still running"), 1)
    progress.finish("completed")
    now[0] = 100; progress.tick()
    self.assertEqual(sink.text().count("still running"), 1)

  def test_sensitive_state_survives_raw_tail_distance_quota_and_eof(self):
    sink = MemorySink()
    progress = Progress("state", local=True, sink=sink)
    progress.feed("stdout", b"safe prefix\n-----BEGIN PRIVATE KEY-----\n")
    for _ in range(1000):
      progress.feed("stdout", b"PRIVATE_FIXTURE_BODY\n")
    progress.feed("stderr", b"Configuration dump:\nHIDDEN_CONFIG_BODY\n")
    progress.displayed = DISPLAY_LIMIT
    progress.feed("stdout", b"MORE_PRIVATE_BODY")
    progress.finish("failed")
    text = sink.text() + b"".join(progress.tail).decode()
    self.assertIn("safe prefix", text)
    for secret in ("PRIVATE_FIXTURE_BODY", "HIDDEN_CONFIG_BODY", "MORE_PRIVATE_BODY"):
      self.assertNotIn(secret, text)
    self.assertLessEqual(progress.tail_size, 8192)

  def test_real_failed_gate_never_replays_raw_private_key_tail(self):
    child = "print('-----BEGIN PRIVATE KEY-----');\nfor _ in range(1000): print('PRIVATE_GATE_SENTINEL')\nraise SystemExit(9)"
    runner = self.loader() + "v.gate('private failure',[sys.executable,'-c',sys.argv[2]],Path(sys.argv[1]),v.verification_environment(Path(sys.argv[1])),5)"
    result = subprocess.run([sys.executable, '-B', '-c', runner, str(self.base), child], capture_output=True, timeout=8)
    self.assertNotEqual(result.returncode, 0)
    self.assertIn(b'private key omitted', result.stderr)
    self.assertNotIn(b'PRIVATE_GATE_SENTINEL', result.stdout + result.stderr)

  def test_split_utf8_credentials_terminal_controls_and_oversized_markers(self):
    sink = MemorySink()
    progress = Progress("safe", local=True, environment={"HTTPS_PROXY": "http://proxy-user:proxy%2Dpassword@proxy.invalid"}, sink=sink)
    for chunk in (b"good \xe6", b"\x97\xa5\x1b[31m line\x1b[0m\r", b"Author", b"ization: Bearer hidden-fixture\n", b"http://proxy-user:proxy%2D", b"password@proxy.invalid\n", b"decoded proxy-password\n"):
      progress.feed("stdout", chunk)
    progress.feed("stderr", b"x" * LINE_LIMIT + b"-----BEGIN PRIVATE KEY-----\nUNLABELLED_BODY\n")
    progress.finish("failed")
    output = sink.text() + b"".join(progress.tail).decode()
    self.assertIn("good 日 line", output)
    for secret in ("proxy-user", "proxy-password", "proxy%2Dpassword", "hidden-fixture", "UNLABELLED_BODY", "\x1b"):
      self.assertNotIn(secret, output)

  def test_sanitizer_continues_after_display_suppression_and_invalid_text(self):
    sink = MemorySink()
    progress = Progress("quota", local=True, sink=sink)
    progress.displayed = DISPLAY_LIMIT
    progress.feed("stdout", b"-----BEGIN PRIVATE KEY-----\nSECRET_AFTER_QUOTA\n")
    progress.feed("stderr", b"\xff\nUNCLASSIFIED_BODY\n")
    progress.finish("failed")
    output = sink.text() + b"".join(progress.tail).decode()
    self.assertNotIn("SECRET_AFTER_QUOTA", output)
    self.assertNotIn("UNCLASSIFIED_BODY", output)
    self.assertIn("suppressed", output)

  def test_capture_observer_does_not_change_raw_or_extra_streams(self):
    data = data_module()
    sink = MemorySink()
    progress = Progress("machine", sink=sink)
    script = "import os,sys;os.write(1,b'oid\\n');os.write(2,b'private-raw');open(sys.argv[1],'wb').write(b'body-secret');open(sys.argv[2],'wb').write(b'headers-secret')"
    code, result = data.capture([sys.executable, "-c", script, "{body}", "{headers}"], streams={"body": 100, "headers": 100}, progress=progress)
    progress.finish("completed")
    self.assertEqual(code, 0)
    self.assertEqual(result, {"stdout": b"oid\n", "stderr": b"private-raw", "body": b"body-secret", "headers": b"headers-secret"})
    self.assertNotIn("secret", sink.text())
    self.assertNotIn("private-raw", sink.text())

  def test_console_sink_has_independent_flags_bounded_queue_and_closed_reader(self):
    reader, writer = os.pipe()
    try:
      flags = fcntl.fcntl(writer, fcntl.F_GETFL)
      sink = ConsoleSink((writer,))
      self.assertEqual(fcntl.fcntl(writer, fcntl.F_GETFL), flags)
      for _ in range(100):
        sink.emit(b"x" * 4096, writer)
      self.assertLessEqual(sink.size, 65536)
      os.close(reader); reader = None
      sink.pump()
      sink.emit(b"ignored", writer)
      sink.close()
      self.assertEqual(fcntl.fcntl(writer, fcntl.F_GETFL), flags)
    finally:
      if reader is not None:
        os.close(reader)
      os.close(writer)

  def test_socket_sink_uses_per_write_nonblocking_without_parent_flag_changes(self):
    reader, writer = socket.socketpair()
    try:
      flags = fcntl.fcntl(writer.fileno(), fcntl.F_GETFL)
      sink = ConsoleSink((writer.fileno(),), limit=0)
      self.assertTrue(sink.emit(b"safe socket record\n", writer.fileno()))
      self.assertEqual(reader.recv(100), b"safe socket record\n")
      self.assertEqual(fcntl.fcntl(writer.fileno(), fcntl.F_GETFL), flags)
      sink.close()
    finally:
      reader.close(); writer.close()

  def test_slow_reader_preserves_queued_bytes(self):
    reader, writer = os.pipe()
    sink = ConsoleSink((writer,))
    os.set_blocking(reader, False)
    try:
      wanted = b"".join(bytes([index]) * 1000 for index in range(30))
      for index in range(0, len(wanted), 1000):
        self.assertTrue(sink.emit(wanted[index:index + 1000], writer))
      received = bytearray()
      deadline = time.monotonic() + 2
      while len(received) < len(wanted) and time.monotonic() < deadline:
        try:
          received.extend(os.read(reader, 509))
        except BlockingIOError:
          pass
        sink.pump()
      self.assertEqual(bytes(received), wanted)
    finally:
      sink.close(); os.close(reader); os.close(writer)

  def test_progress_wrapper_keeps_machine_stdout_and_output_file_exact(self):
    output = self.base / "command.out"
    result = subprocess.run([sys.executable, "-B", str(ROOT / "scripts/release-data.py"), "run-progress", "1024", "3", str(output), "owned command", sys.executable, "-c", "import sys;print('sha256:fixture');print('AUTHENTICATED_RESPONSE_SENTINEL',file=sys.stderr)"], capture_output=True, timeout=5)
    self.assertEqual(result.returncode, 0, result.stderr)
    self.assertEqual(result.stdout, b"")
    self.assertEqual(output.read_bytes(), b"sha256:fixture\n")
    self.assertIn(b"command completed", result.stderr)
    self.assertNotIn(b"AUTHENTICATED_RESPONSE_SENTINEL", result.stderr)

  def test_timeout_after_pipe_eof_and_signal_cleanup_remain_bounded(self):
    data = data_module()
    sink = MemorySink()
    progress = Progress("EOF timeout", sink=sink)
    with self.assertRaisesRegex(data.CommandFailed, "timed out"):
      data.capture([sys.executable, "-c", "import os,time;os.close(1);os.close(2);time.sleep(30)"], seconds=.1, progress=progress)
    progress.finish("failed: timeout")
    self.assertIn("failed: timeout", sink.text())

  def test_progress_overflow_still_fails_and_silent_capture_stays_silent(self):
    data = data_module()
    sink = MemorySink()
    progress = Progress("overflow", local=True, sink=sink)
    with self.assertRaisesRegex(data.Refusal, "byte limit"):
      data.capture([sys.executable, "-c", "import os;os.write(1,b'x'*1025)"], limit=1024, progress=progress)
    progress.finish("failed")
    runner = self.loader() + "print(v.DATA.command([sys.executable,'-c',\"print('raw')\"]).decode(),end='')"
    result = subprocess.run([sys.executable, "-B", "-c", runner], capture_output=True, timeout=5)
    self.assertEqual(result.stdout, b"raw\n")
    self.assertEqual(result.stderr, b"")

  def test_blocked_progress_signal_reaps_detached_descendant_without_touching_sentinel(self):
    sentinel = subprocess.Popen([sys.executable, "-c", "import time;time.sleep(60)"])
    try:
      for number in (signal.SIGINT, signal.SIGTERM):
        marker = self.base / ("descendant-" + str(number))
        descendant = "import os,time;from pathlib import Path;Path(" + repr(str(marker)) + ").write_text(str(os.getpid()));time.sleep(60)"
        child = "import subprocess,sys,time;subprocess.Popen([sys.executable,'-c',sys.argv[1]],start_new_session=True);time.sleep(60)"
        reader, writer = filled_pipe()
        try:
          process = subprocess.Popen([sys.executable, "-B", str(ROOT / "scripts/release-data.py"), "run-progress", "1024", "30", str(self.base / "signal-out"), "signal gate", sys.executable, "-c", child, descendant], stdout=subprocess.DEVNULL, stderr=writer)
          try:
            wait_for_path(marker)
            process.send_signal(number)
            process.wait(timeout=18)
            self.assertNotEqual(process.returncode, 0)
            self.assertFalse(Path('/proc/' + marker.read_text()).exists())
            self.assertIsNone(sentinel.poll())
          finally:
            if process.poll() is None:
              process.terminate(); process.wait(timeout=18)
        finally:
          os.close(reader); os.close(writer)
    finally:
      sentinel.terminate(); sentinel.wait(timeout=3)


def filled_pipe():
  reader, writer = os.pipe()
  os.set_blocking(writer, False)
  try:
    while True:
      os.write(writer, b"x" * 4096)
  except BlockingIOError:
    pass
  os.set_blocking(writer, True)
  return reader, writer


def wait_for_path(path, seconds=15):
  deadline = time.monotonic() + seconds
  while not path.exists() and time.monotonic() < deadline:
    time.sleep(.02)
  if not path.exists():
    raise AssertionError("Owned subprocess did not reach handshake: " + str(path))


class PublicationConsoleTests(unittest.TestCase):
  def setUp(self):
    from test_bash_release import BashPublicationTests
    self.fixture = BashPublicationTests("test_platform_refusals_precede_credentials_remote_reads_and_writes")
    self.fixture.setUp()
    self.addCleanup(self.fixture.doCleanups)

  def launch_blocked(self, closed=False, descriptors=(1, 2)):
    pipes = {descriptor: filled_pipe() for descriptor in descriptors}
    try:
      if closed:
        for reader, _ in pipes.values():
          os.close(reader)
      process = subprocess.Popen(["bash", str(self.fixture.root / "scripts/release.sh")], cwd=self.fixture.base,
                                 env=self.fixture.environment, stdout=pipes[1][1] if 1 in pipes else subprocess.DEVNULL,
                                 stderr=pipes[2][1] if 2 in pipes else subprocess.DEVNULL)
      try:
        process.wait(timeout=20)
        return process.returncode
      finally:
        if process.poll() is None:
          process.terminate(); process.wait(timeout=20)
    finally:
      for reader, writer in pipes.values():
        if not closed:
          os.close(reader)
        os.close(writer)

  def assert_lock_free(self):
    with (self.fixture.root / '.template-operation.lock').open() as lock:
      fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)

  def test_unread_and_closed_consoles_do_not_hold_early_failure_lock(self):
    self.fixture.change(unsupported=True)
    for closed, descriptors in ((False, (1,)), (False, (2,)), (False, (1, 2)), (True, (1, 2))):
      with self.subTest(closed=closed, descriptors=descriptors):
        started = time.monotonic()
        self.assertNotEqual(self.launch_blocked(closed, descriptors), 0)
        self.assertLess(time.monotonic() - started, 6)
        self.assert_lock_free()
        self.assertEqual(list(self.fixture.base.glob('home-web-release-*')), [])
        self.assertNotIn('auth', self.fixture.events())

  def test_startup_lock_failure_cannot_block_on_console(self):
    target = self.fixture.base / 'foreign-lock-sentinel'
    target.write_text('untouched')
    (self.fixture.root / '.template-operation.lock').symlink_to(target)
    self.assertNotEqual(self.launch_blocked(), 0)
    self.assertEqual(target.read_text(), 'untouched')
    self.assertEqual(list(self.fixture.base.glob('home-web-release-*')), [])

  def test_gate_trap_cleanup_diagnostics_and_auth_disposal_with_unread_console(self):
    helper = self.fixture.root / 'scripts/release-verify.py'
    helper.write_text("import sys\nif sys.argv[1:2] == ['cleanup']:\n  print('owned cleanup diagnostic',file=sys.stderr)\n  raise SystemExit(1)\n" + helper.read_text())
    self.fixture.commit()
    self.fixture.change(verify_failure='runtime:linux/arm64')
    self.assertNotEqual(self.launch_blocked(), 0)
    self.assert_lock_free()
    retained = list(self.fixture.base.glob('home-web-release-*'))
    self.assertEqual(len(retained), 1)
    for name in ('token', 'login', 'api.curl', 'registry.curl', 'bearer.curl', 'docker'):
      self.assertFalse((retained[0] / name).exists(), name)

  def test_nonzero_local_gate_exits_with_closed_console(self):
    self.fixture.change(verify_failure='verify:application')
    self.assertNotEqual(self.launch_blocked(closed=True), 0)
    self.assert_lock_free()
    self.fixture.assert_no_writes()
    self.assertNotIn('auth', self.fixture.events())

  def test_delayed_build_shows_progress_before_exit_without_raw_authenticated_text(self):
    self.fixture.change(build_wait=True, sensitive_external_output=True)
    process = subprocess.Popen(['bash', str(self.fixture.root / 'scripts/release.sh')], cwd=self.fixture.base,
                               env=self.fixture.environment, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    before = bytearray()
    try:
      deadline = time.monotonic() + 20
      while not (self.fixture.base / 'build-waiting').exists() and time.monotonic() < deadline:
        ready, _, _ = select.select([process.stderr], [], [], .05)
        if ready:
          before.extend(os.read(process.stderr.fileno(), 65536))
      self.assertTrue((self.fixture.base / 'build-waiting').exists(), before)
      self.assertIn(b'staging build and immutable verification', before)
      self.assertIsNone(process.poll())
      (self.fixture.base / 'finish-build').touch()
      stdout, stderr = process.communicate(timeout=30)
      self.assertEqual(process.returncode, 0, stderr)
      self.assertNotIn(b'AUTHENTICATED_RESPONSE_SENTINEL', stdout + before + stderr)
      self.assertIn(b'Publication verified', stdout)
      self.fixture.assert_verification_order()
      self.assert_lock_free()
    finally:
      if process.poll() is None:
        process.terminate(); process.communicate(timeout=20)
