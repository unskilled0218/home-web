"""Actual runner, temporary-parent, supervision, plugin and remote-smoke contracts."""
import importlib.util
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))
from temporary import parent


def verifier():
  spec = importlib.util.spec_from_file_location("release_verify", ROOT / "scripts/release-verify.py")
  module = importlib.util.module_from_spec(spec)
  spec.loader.exec_module(module)
  return module


class VerificationTests(unittest.TestCase):
  def setUp(self):
    self.temporary = tempfile.TemporaryDirectory(dir=parent())
    self.addCleanup(self.temporary.cleanup)
    self.base = Path(self.temporary.name)
    self.verify = verifier()

  def test_real_gate_runs_pass_fail_timeout_and_overflow(self):
    env = self.verify.verification_environment(self.base)
    for key in ("GIT_TOKEN", "GIT_CONFIG_COUNT", "RELEASE_LOCK_FD", "NODE_OPTIONS", "PYTHONPATH"):
      self.assertNotIn(key, env)
    self.verify.gate("pass", [sys.executable, "-c", "print('passed')"], self.base, env, 3)
    with self.assertRaisesRegex(self.verify.DATA.Refusal, "exit 7"):
      self.verify.gate("failure", [sys.executable, "-c", "raise SystemExit(7)"], self.base, env, 3)
    with self.assertRaisesRegex(self.verify.DATA.Refusal, "timed out"):
      self.verify.gate("timeout", [sys.executable, "-c", "import time;time.sleep(5)"], self.base, env, .1)
    with self.assertRaisesRegex(self.verify.DATA.Refusal, "byte limit"):
      self.verify.gate("overflow", [sys.executable, "-c", "import os;os.write(1,b'x'*16777217)"], self.base, env, 3)

  def test_local_dispatches_complete_release_suite_once_with_fixed_budget(self):
    work = self.base / "work"
    work.mkdir()
    def snapshot(root, commit, destination):
      source = Path(destination)
      shutil.copytree(ROOT / "scripts", source / "scripts")
      notes = json.loads((ROOT / "scripts/release.json").read_text())["notes"]
      for name in ("VERSION", "package.json", "package-lock.json", "README.md", "Dockerfile", ".dockerignore", notes):
        target = source / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT / name, target)
    with patch.object(self.verify.DATA, "snapshot", side_effect=snapshot) as export, \
         patch.object(self.verify.DATA, "command", return_value=b"26.13.0"), \
         patch.object(self.verify, "gate") as gate:
      self.verify.local(ROOT, work, "candidate")
    export.assert_called_once_with(str(ROOT), "candidate", str(work / "verification-source"))
    expected = ["shell syntax " + path.name for path in sorted((ROOT / "scripts").glob("*.sh"))]
    expected += ["locked development dependencies", "JavaScript syntax", "application tests", "release tests", "production packaging"]
    self.assertEqual([call.args[0] for call in gate.call_args_list], expected)
    release = [call for call in gate.call_args_list if call.args[0] == "release tests"]
    self.assertEqual(len(release), 1)
    self.assertEqual(release[0].args[1], ("python3", "-B", "-u", "-m", "unittest", "discover", "-s", "test/release-template", "-v"))
    self.assertEqual(release[0].args[2], work / "verification-source")
    self.assertEqual(release[0].args[3]["HOME"], str(work / "verification-home"))
    self.assertEqual(release[0].args[4], 1800)
    self.assertEqual(release[0].args[4], self.verify.RELEASE_TEST_TIMEOUT_SECONDS)

  def test_gate_timeout_reaps_ready_descendant_and_preserves_unrelated_process(self):
    marker = self.base / "ready"
    sentinel = subprocess.Popen([sys.executable, "-c", "import time;time.sleep(30)"])
    child = "import os,time;from pathlib import Path;Path(" + repr(str(marker)) + ").write_text(str(os.getpid()));time.sleep(30)"
    # Wait for descendant readiness inside the command before keeping its parent alive.
    code = "import subprocess,sys,time;from pathlib import Path;subprocess.Popen([sys.executable,'-c',sys.argv[1]],start_new_session=True);p=Path(sys.argv[2]);\nwhile not p.exists(): time.sleep(.01)\ntime.sleep(30)"
    try:
      with self.assertRaisesRegex(self.verify.DATA.Refusal, "Verification failed \\(release tests\\): Command timed out"):
        self.verify.gate("release tests", [sys.executable, "-c", code, child, str(marker)], self.base,
                         self.verify.verification_environment(self.base), 1)
      self.assertTrue(marker.exists(), "The descendant must start before timeout cleanup is tested")
      self.assertFalse(Path("/proc/" + marker.read_text()).exists())
      self.assertIsNone(sentinel.poll())
    finally:
      sentinel.terminate()
      sentinel.wait(timeout=3)

  def test_supervision_reaps_separate_session_and_double_fork_without_touching_sentinel(self):
    sentinel = subprocess.Popen([sys.executable, "-c", "import time;time.sleep(30)"])
    self.addCleanup(lambda: sentinel.poll() is None and sentinel.terminate())
    self.addCleanup(lambda: None)
    try:
      for double in (False, True):
        marker = self.base / "descendant"
        code = '''import os,sys,time
from pathlib import Path
pid=os.fork()
if pid==0:
  os.setsid()
  if sys.argv[2]=='yes':
    if os.fork(): os._exit(0)
  Path(sys.argv[1]).write_text(str(os.getpid()))
  time.sleep(30)
else:
  time.sleep(30)
'''
        with self.assertRaises(self.verify.DATA.Refusal):
          self.verify.DATA.command([sys.executable, "-c", code, str(marker), "yes" if double else "no"], seconds=.3)
        pid = int(marker.read_text())
        self.assertFalse(Path(f"/proc/{pid}").exists(), "Owned detached descendant must be reaped")
        self.assertIsNone(sentinel.poll(), "Unrelated sentinel must not receive cancellation")
    finally:
      sentinel.terminate()
      sentinel.wait(timeout=3)

  def test_portable_temporary_parent_and_python_fixture_without_harness_directory(self):
    with patch.dict(os.environ, {"RELEASE_TEMP_PARENT": str(self.base)}):
      self.assertEqual(parent(ROOT), str(self.base))
      with tempfile.TemporaryDirectory(dir=parent(ROOT)) as child:
        self.assertTrue(Path(child).is_relative_to(self.base))
      result = subprocess.run([sys.executable, "-B", "-m", "unittest", "test_bash_release.BashInterfaceTests"],
                              cwd=ROOT / "test/release-template", env=os.environ | {"RELEASE_TEMP_PARENT": str(self.base)},
                              capture_output=True, timeout=20)
      self.assertEqual(result.returncode, 0, result.stderr)
    with patch.dict(os.environ, {}, clear=True), patch("temporary.os.access", return_value=False), \
         patch("temporary.tempfile.gettempdir", return_value=str(self.base)):
      self.assertEqual(parent(), str(self.base))
    link = self.base / "link"
    link.symlink_to(self.base, target_is_directory=True)
    with patch.dict(os.environ, {"RELEASE_TEMP_PARENT": str(link)}), self.assertRaises(ValueError):
      parent(ROOT)

  def test_node_temporary_parent_and_actual_fixture_use_owned_parent(self):
    source = "import {temporaryPrefix} from './scripts/temporary.js'; console.log(temporaryPrefix('probe-'))"
    result = subprocess.run(["node", "--input-type=module", "-e", source], cwd=ROOT,
                            env=os.environ | {"RELEASE_TEMP_PARENT": str(self.base)}, capture_output=True, text=True, timeout=5)
    self.assertEqual(result.returncode, 0, result.stderr)
    self.assertEqual(Path(result.stdout.strip()).parent, self.base)
    result = subprocess.run(["node", "--test", "test/dev-supervisor.test.js"], cwd=ROOT,
                            env=os.environ | {"RELEASE_TEMP_PARENT": str(self.base)}, capture_output=True, timeout=30)
    self.assertEqual(result.returncode, 0, result.stderr)

  def test_plugin_pin_preserves_config_local_executable_and_detects_replacement(self):
    plugin = self.base / "original-cli-plugins/docker-buildx"
    plugin.parent.mkdir()
    plugin.write_text("#!/bin/sh\nexit 0\n")
    plugin.chmod(0o700)
    private = self.base / "docker"
    private.mkdir()
    data = self.verify.DATA
    with patch.object(data, "command", return_value=data.canonical([{"Name": "buildx", "Path": str(plugin)}])):
      selected = data.buildx_identity()
    data.write(self.base / "buildx-identity.json", selected)
    data.pin_buildx(self.base)
    pinned = private / "cli-plugins/docker-buildx"
    with patch.object(data, "command", return_value=data.canonical([{"Name": "buildx", "Path": str(pinned)}])):
      data.verify_buildx(self.base)
      plugin.write_text("#!/bin/sh\nexit 1\n")
      with self.assertRaisesRegex(data.Refusal, "executable changed"):
        data.verify_buildx(self.base)

  def test_git_fixture_ignores_ambient_hooks_and_repository_selectors(self):
    hooks = self.base / "hooks"
    hooks.mkdir()
    hook = hooks / "pre-commit"
    marker = self.base / "hook-ran"
    hook.write_text("#!/bin/sh\ntouch " + str(marker) + "\n")
    hook.chmod(0o700)
    env = os.environ | {"GIT_CONFIG_COUNT": "1", "GIT_CONFIG_KEY_0": "core.hooksPath", "GIT_CONFIG_VALUE_0": str(hooks),
                        "GIT_DIR": str(self.base / "not-a-repository"), "GIT_INDEX_FILE": str(self.base / "foreign-index")}
    result = subprocess.run([sys.executable, "-B", "-m", "unittest",
                             "test_bash_release.BashPublicationTests.test_invalid_config_and_local_validation_do_not_read_token"],
                            cwd=ROOT / "test/release-template", env=env, capture_output=True, timeout=15)
    self.assertEqual(result.returncode, 0, result.stderr)
    self.assertFalse(marker.exists())
    self.assertFalse((self.base / "foreign-index").exists())

  def test_parent_cleanup_checks_exact_owned_resources_and_keeps_foreign_sentinels(self):
    work = self.base
    record = {"nonce": "owned", "daemon": "remote-daemon", "resources": [{"kind": "volume", "name": "mine", "id": "mine"}]}
    self.verify.save_manifest(work / "smoke-resources.json", record)
    resource = {"Name": "mine", "Labels": {self.verify.LABEL: "foreign"}}
    with patch.object(self.verify, "daemon_identity", return_value="remote-daemon"), \
         patch.object(self.verify, "inspect_resource", return_value=resource), patch.object(self.verify, "docker") as docker:
      with self.assertRaisesRegex(self.verify.DATA.Refusal, "ownership differs"):
        self.verify.cleanup(work)
      docker.assert_not_called()
      self.assertTrue((work / "smoke-resources.json").exists())
    resource["Labels"][self.verify.LABEL] = "owned"
    with patch.object(self.verify, "daemon_identity", return_value="remote-daemon"), \
         patch.object(self.verify, "inspect_resource", side_effect=[resource, None]), patch.object(self.verify, "docker") as docker:
      self.verify.cleanup(work)
      self.assertEqual(docker.call_args.args[:2], ("volume", "rm"))
      self.assertFalse((work / "smoke-resources.json").exists())

  def test_auth_disposal_removes_context_keys_but_preserves_sanitized_manifest(self):
    private = self.base / 'docker/contexts/tls/test'
    private.mkdir(parents=True)
    (private / 'key.pem').write_text('fixture-private-key')
    for name in ('token', 'api.curl', 'registry.curl', 'bearer.curl'):
      (self.base / name).write_text('fixture-secret')
    manifest = self.base / 'smoke-resources.json'
    manifest.write_text('{"resources": []}')
    self.verify.DATA.discard_auth(self.base)
    self.assertEqual([p.name for p in self.base.iterdir()], ['smoke-resources.json'])

  def test_absent_pending_create_keeps_evidence_instead_of_assuming_no_inflight_request(self):
    manifest = self.base / 'smoke-resources.json'
    self.verify.save_manifest(manifest, {'nonce': 'owned', 'daemon': 'daemon',
                                       'resources': [{'kind': 'volume', 'name': 'intended'}]})
    with patch.object(self.verify, 'daemon_identity', return_value='daemon'), \
         patch.object(self.verify, 'inspect_resource', return_value=None), patch.object(self.verify, 'docker') as docker:
      with self.assertRaisesRegex(self.verify.DATA.Refusal, 'creation outcome unconfirmed'):
        self.verify.cleanup(self.base)
      docker.assert_not_called()
      self.assertTrue(manifest.exists())

  def test_sigint_and_sigterm_reap_nested_session_descendants(self):
    for number in (signal.SIGINT, signal.SIGTERM):
      marker = self.base / ("pid-" + str(number))
      code = "import subprocess,sys,time;subprocess.Popen([sys.executable,'-c',sys.argv[1]],start_new_session=True);time.sleep(30)"
      child = "import os,time;from pathlib import Path;Path(" + repr(str(marker)) + ").write_text(str(os.getpid()));time.sleep(30)"
      process = subprocess.Popen([sys.executable, "-B", str(ROOT / "scripts/release-data.py"), "run", "1024", "30",
                                  str(self.base / "out"), sys.executable, "-c", code, child],
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
      try:
        deadline = time.monotonic() + 5
        while not marker.exists() and time.monotonic() < deadline:
          time.sleep(.02)
        self.assertTrue(marker.exists())
        process.send_signal(number)
        process.communicate(timeout=16)
        self.assertNotEqual(process.returncode, 0)
        self.assertFalse(Path('/proc/' + marker.read_text()).exists())
      finally:
        if process.poll() is None:
          process.terminate()
          process.communicate(timeout=16)

  def test_remote_runtime_smoke_and_lost_create_response_use_only_owned_daemon_resources(self):
    for fault in (None, "lost-create", "runtime", "after-volume", "after-container", "during-stop"):
      with self.subTest(fault=fault):
        resources = {"container": {}, "volume": {}}
        events = []
        index = {"manifests": [{"digest": "sha256:" + str(i) * 64, "platform": {"os": "linux", "architecture": arch}}
                                for i, arch in ((1, "amd64"), (2, "arm64"))]}
        def docker(*args, **kwargs):
          events.append(args)
          self.assertNotIn('--publish', args)
          self.assertNotIn('-p', args)
          self.assertNotIn('--network', args)
          if args[0] == 'pull':
            return ''
          if args[:2] == ('volume', 'create'):
            name = args[-1]
            label = args[args.index('--label') + 1].split('=', 1)[1]
            resources['volume'][name] = {'Name': name, 'Labels': {self.verify.LABEL: label}}
            if fault == 'after-volume':
              raise KeyboardInterrupt('simulated cancellation after volume creation')
            if fault == 'lost-create':
              raise self.verify.DATA.CommandFailed('lost response')
            return name
          if args[0] == 'create':
            mount = args[args.index('--mount') + 1]
            self.assertTrue(mount.startswith('type=volume,src='))
            self.assertNotIn(str(self.base), mount)
            name = args[args.index('--name') + 1]
            label = args[args.index('--label') + 1].split('=', 1)[1]
            resources['container'][name] = {'Id': name, 'Name': '/' + name, 'Config': {'Labels': {self.verify.LABEL: label}},
                                             'State': {'Running': True, 'ExitCode': 0}}
            if fault == 'after-container':
              raise KeyboardInterrupt('simulated cancellation after container creation')
            return name
          if args[0] in ('volume', 'container'):
            kind, action = args[:2]
            if action == 'ls':
              name = next(value[5:] for value in args if value.startswith('name='))
              return name if name in resources[kind] else ''
            if action == 'inspect':
              return json.dumps([resources[kind][args[-1]]])
            if action == 'rm':
              del resources[kind][args[-1]]
              return ''
          if args[0] == 'start':
            return ''
          if args[0] == 'exec':
            self.assertIn('http://127.0.0.1:3000/api/dashboard/settings', args[-2])
            if fault == 'runtime':
              resources['container'][args[1]]['State']['Running'] = False
              raise self.verify.DATA.CommandFailed('runtime failure')
            return ''
          if args[0] == 'inspect':
            return json.dumps([resources['container'][args[-1]]])
          if args[0] == 'stop':
            if fault == 'during-stop':
              raise KeyboardInterrupt('simulated cancellation during stop')
            return ''
          raise AssertionError(args)
        with patch.object(self.verify.DATA, 'image', return_value='sha256:' + '0' * 64), \
             patch.object(self.verify.DATA, 'registry', return_value=('sha256:' + '0' * 64, index)), \
             patch.object(self.verify, 'daemon_identity', return_value='remote-fixture'), \
             patch.object(self.verify, 'docker', side_effect=docker):
          if fault in ('after-volume', 'after-container', 'during-stop'):
            with self.assertRaises(KeyboardInterrupt):
              self.verify.image_smoke(ROOT, self.base, 'sha256:' + '0' * 64, 'a' * 40)
          elif fault == 'runtime':
            with self.assertRaisesRegex(self.verify.DATA.Refusal, 'readiness failed'):
              self.verify.image_smoke(ROOT, self.base, 'sha256:' + '0' * 64, 'a' * 40)
          else:
            self.verify.image_smoke(ROOT, self.base, 'sha256:' + '0' * 64, 'a' * 40)
            self.assertEqual(sum(event[0] == 'exec' for event in events), 2)
          self.assertEqual(resources, {'container': {}, 'volume': {}})
          self.assertFalse((self.base / 'smoke-resources.json').exists())
