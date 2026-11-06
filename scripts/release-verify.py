#!/usr/bin/env python3
"""Fixed verification gates and daemon-side smoke. Never publishes registry/Git/API objects."""

import ast
import importlib.util
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import time
import uuid

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
from temporary import parent as temporary_parent
from release_progress import Progress, message


def data_module():
  spec = importlib.util.spec_from_file_location("release_data", Path(__file__).with_name("release-data.py"))
  module = importlib.util.module_from_spec(spec)
  spec.loader.exec_module(module)
  return module


DATA = data_module()
LABEL = "dev.home-web.release-smoke"
RELEASE_TEST_COMMAND = ("python3", "-B", "-u", "-m", "unittest", "discover", "-s", "test/release-template", "-v")
RELEASE_TEST_TIMEOUT_SECONDS = 1800


def verification_environment(work):
  allowed = {"PATH", "LANG", "LC_ALL", "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "no_proxy",
             "SSL_CERT_FILE", "SSL_CERT_DIR", "NODE_EXTRA_CA_CERTS"}
  env = {key: value for key, value in os.environ.items() if key in allowed}
  home = Path(work) / "verification-home"
  home.mkdir(exist_ok=True, mode=0o700)
  temporary = Path(work) / "verification-temp"
  temporary.mkdir(exist_ok=True, mode=0o700)
  env |= {"HOME": str(home), "XDG_CONFIG_HOME": str(home), "TMPDIR": str(temporary),
          "RELEASE_TEMP_PARENT": str(temporary), "PYTHONDONTWRITEBYTECODE": "1",
          "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": "/dev/null", "GIT_TERMINAL_PROMPT": "0",
          "NPM_CONFIG_USERCONFIG": str(home / "npmrc"), "NPM_CONFIG_CACHE": str(home / "npm-cache")}
  return env


def gate(name, arguments, root, env, seconds):
  progress = Progress("Verify: " + name, local=True, environment=env)
  try:
    code, result = DATA.capture(arguments, 16777216, seconds, environment=env, cwd=root, progress=progress)
  except DATA.Refusal as error:
    progress.finish("failed: " + str(error))
    raise DATA.Refusal(f"Verification failed ({name}): {error}") from error
  except BaseException:
    progress.finish("failed or interrupted")
    raise
  progress.finish("completed" if code == 0 else "failed, exit " + str(code))
  if code:
    # Diagnostics already passed through the stateful stream sanitizer, including EOF.
    raise DATA.Refusal(f"Verification failed ({name}), exit {code}; publication did not begin")


def local(root, work, commit):
  root, work = Path(root), Path(work)
  source = work / "verification-source"
  message("Verify: export committed source snapshot")
  DATA.snapshot(str(root), commit, str(source))
  env = verification_environment(work)
  message("Verify: metadata and runtime prerequisites")
  node_version = DATA.command(["node", "-p", "process.versions.node"]).decode().strip()
  DATA.require(int(node_version.split(".")[0]) >= 24, "Install Node 24 or later")
  version = (source / "VERSION").read_text().strip()
  package = DATA.document(source / "package.json")
  lock = DATA.document(source / "package-lock.json")
  config = DATA.settings(source)
  DATA.require(package["version"] == lock["version"] == lock["packages"][""]["version"] == version, "Version metadata drift")
  DATA.require(config["notes"] == f"docs/releases/{version}.md" and
               (source / config["notes"]).read_text().startswith(f"# Release v{version}\n") and
               "Version " + version in (source / "README.md").read_text(), "Notes/README version drift")
  for path in sorted((source / "scripts").glob("*.sh")):
    gate("shell syntax " + path.name, ["bash", "-n", str(path)], source, env, 120)
  for directory in ("scripts", "test"):
    for path in sorted((source / directory).rglob("*.py")):
      ast.parse(path.read_bytes(), filename=str(path))
  gate("locked development dependencies", ["npm", "ci", "--ignore-scripts", "--fetch-retries=0", "--fetch-timeout=60000"], source, env, 300)
  gate("JavaScript syntax", ["npm", "run", "check"], source, env, 120)
  gate("application tests", ["npm", "test", "--", "--test-concurrency=1"], source, env, 1200)
  gate("release tests", RELEASE_TEST_COMMAND, source, env, RELEASE_TEST_TIMEOUT_SECONDS)
  gate("production packaging", ["node", "scripts/check-production.js"], source, env, 180)
  message("Local verification passed; no publication credentials used")


def docker(*args, seconds=15):
  label = "Docker runtime " + args[0]
  progress = Progress(label)
  try:
    status, result = DATA.capture(["docker", *args], limit=1048576, seconds=seconds, progress=progress)
    if status:
      raise DATA.CommandFailed("Command failed: docker")
  except BaseException:
    progress.finish("failed or interrupted")
    raise
  progress.finish("command completed")
  return result["stdout"].decode().strip()


def daemon_identity():
  value = docker("info", "--format", "{{.ID}}")
  DATA.require(value and "\n" not in value, "Cannot identify selected Docker daemon")
  return value


def save_manifest(path, manifest):
  temporary = path.with_suffix(".next")
  temporary.write_text(json.dumps(manifest))
  temporary.chmod(0o600)
  temporary.replace(path)


def inspect_resource(kind, name, seconds=15):
  # Successful name-scoped enumeration distinguishes absence from an unavailable daemon.
  deadline = time.monotonic() + seconds
  listing = docker(*( ["container", "ls", "-a"] if kind == "container" else ["volume", "ls"] ),
                   "--filter", "name=" + name, "--format", "{{.Name}}" if kind == "volume" else "{{.Names}}", seconds=seconds)
  if name not in listing.splitlines():
    return None
  DATA.require(time.monotonic() < deadline, "Resource inspection deadline exceeded")
  values = json.loads(docker(kind, "inspect", name, seconds=max(.1, deadline - time.monotonic())))
  DATA.require(isinstance(values, list) and len(values) == 1, "Invalid owned resource evidence")
  return values[0]


def owned(record, kind, item, nonce):
  labels = record.get("Config", {}).get("Labels", {}) if kind == "container" else record.get("Labels", {})
  DATA.require(labels and labels.get(LABEL) == nonce, "Resource ownership differs; removal refused")
  DATA.require((record.get("Name", "").lstrip("/")) == item["name"], "Resource name differs")
  if item.get("id"):
    DATA.require((record.get("Id") if kind == "container" else record.get("Name")) == item["id"], "Resource ID differs")


def cleanup(work):
  path = Path(work) / "smoke-resources.json"
  if not path.exists():
    return
  message("Verify runtime: exact owned-resource cleanup")
  manifest = DATA.document(path)
  deadline = manifest.setdefault("cleanup_deadline", time.monotonic() + 60)
  save_manifest(path, manifest)
  DATA.require(time.monotonic() < deadline, "Resource cleanup deadline exceeded; retain ownership evidence")
  for key, value in manifest.get("connection", {}).items():
    if value is None:
      os.environ.pop(key, None)
    else:
      os.environ[key] = value
  DATA.require(daemon_identity() == manifest["daemon"], "Cleanup daemon differs; retain ownership evidence")
  for item in reversed(manifest["resources"]):
    DATA.require(time.monotonic() < deadline, "Resource cleanup deadline exceeded")
    kind = item["kind"]
    record = inspect_resource(kind, item["name"], seconds=max(.1, min(15, deadline - time.monotonic())))
    if record:
      owned(record, kind, item, manifest["nonce"])
      docker(kind, "rm", *(["--force"] if kind == "container" else []), item.get("id", item["name"]),
             seconds=max(1, min(15, deadline - time.monotonic())))
      DATA.require(inspect_resource(kind, item["name"], seconds=max(.1, min(15, deadline - time.monotonic()))) is None,
                   "Owned resource removal not confirmed")
    else:
      DATA.require(item.get("id"), "Resource creation outcome unconfirmed; retain exact intended ownership evidence")
  path.unlink()


def image_smoke(root, work, reference, commit):
  config = DATA.settings(root)
  DATA.require(DATA.image(work, config, reference, commit) == reference, "Smoke image differs")
  _, index = DATA.registry(work, config["gitea"], config["image"], "manifests", reference)
  path = Path(work) / "smoke-resources.json"
  DATA.require(not path.exists(), "Unresolved smoke resources; inspect ownership evidence")
  manifest = {"nonce": uuid.uuid4().hex, "daemon": daemon_identity(), "resources": [],
              "connection": {key: os.environ.get(key) for key in
                             ("DOCKER_CONFIG", "DOCKER_CONTEXT", "DOCKER_HOST", "DOCKER_TLS_VERIFY", "DOCKER_CERT_PATH")}}
  save_manifest(path, manifest)
  try:
    for member in index["manifests"]:
      architecture = member["platform"]["architecture"]
      platform = "linux/" + architecture
      image = config["image"] + "@" + member["digest"]
      message("Verify runtime: " + platform + " pull, readiness and graceful shutdown")
      docker("pull", "--platform", platform, image, seconds=300)
      platform_deadline = time.monotonic() + 120
      resources = {}
      for kind in ("volume", "container"):
        name = "home-web-smoke-" + manifest["nonce"] + "-" + architecture + "-" + kind
        DATA.require(inspect_resource(kind, name) is None, "Smoke name collision; refusing existing resource")
        item = {"kind": kind, "name": name}
        manifest["resources"].append(item)
        save_manifest(path, manifest)
        try:
          if kind == "volume":
            docker("volume", "create", "--label", LABEL + "=" + manifest["nonce"], name)
          else:
            docker("create", "--name", name, "--label", LABEL + "=" + manifest["nonce"], "--platform", platform,
                   "--mount", "type=volume,src=" + resources["volume"] + ",dst=/app/data",
                   "--env", "HOST=127.0.0.1", "--env", "PORT=3000", "--env", "NFS_MOUNT_MODE=off",
                   "--env", "DATABASE_PATH=/app/data/wol.db", image,
                   seconds=max(1, platform_deadline - time.monotonic()))
        except DATA.CommandFailed:
          # Reconcile one lost create response by exact name and ownership, never repeat create.
          pass
        record = inspect_resource(kind, name)
        DATA.require(record is not None, "Smoke creation unconfirmed")
        owned(record, kind, item, manifest["nonce"])
        item["id"] = record["Id"] if kind == "container" else record["Name"]
        resources[kind] = item["id"]
        save_manifest(path, manifest)
      container = resources["container"]
      DATA.require(time.monotonic() < platform_deadline, "Platform startup deadline exceeded")
      docker("start", container, seconds=max(1, platform_deadline - time.monotonic()))
      expected = "x64" if architecture == "amd64" else "arm64"
      probe = '''const fs=require('node:fs');
if(process.arch!==process.argv[1])throw Error('Architecture mismatch');
if(!require.resolve('undici').startsWith('/app/node_modules/'))throw Error('Dependency escaped image');
for(const p of ['/app/test','/app/scripts','/app/.env','/app/node_modules/playwright','/app/node_modules/@playwright/test'])if(fs.existsSync(p))throw Error('Unexpected image file');
if(!fs.existsSync('/app/data/linkwarden-config-encryption.key'))throw Error('Missing key');
fetch('http://127.0.0.1:3000/api/dashboard/settings',{signal:AbortSignal.timeout(3000)}).then(r=>{if(r.status!==200)throw Error('HTTP readiness failed');return r.arrayBuffer()}).catch(()=>process.exit(1));'''
      deadline = platform_deadline
      while True:
        try:
          docker("exec", container, "node", "-e", probe, expected)
          break
        except DATA.CommandFailed:
          state = json.loads(docker("inspect", container))[0]["State"]
          DATA.require(state.get("Running") and time.monotonic() < deadline,
                       "Runtime readiness failed for " + platform + "; check native/QEMU support on Docker host")
          time.sleep(0.2)
      docker("stop", "--time", "15", container, seconds=20)
      state = json.loads(docker("inspect", container))[0]["State"]
      DATA.require(state.get("ExitCode") == 0 and not state.get("OOMKilled"), "Runtime shutdown failed")
  except BaseException:
    # A surviving lock supervisor also reads this manifest if this worker is killed.
    cleanup(work)
    raise
  cleanup(work)


def main():
  action, root, work, *values = sys.argv[1:]
  if action == "local":
    local(root, work, values[0])
  elif action == "image":
    image_smoke(root, work, *values)
  elif action == "cleanup":
    cleanup(work)
  else:
    raise DATA.Refusal("Unsupported verification action")


if __name__ == "__main__":
  def cancelled(*_):
    raise DATA.Refusal("Verification interrupted")
  signal.signal(signal.SIGTERM, cancelled)
  signal.signal(signal.SIGINT, cancelled)
  try:
    main()
  except (DATA.Refusal, OSError, ValueError, RuntimeError, KeyError) as error:
    message("Verification stopped: " + (str(error) if isinstance(error, DATA.Refusal) else "invalid input or cleanup unconfirmed"))
    sys.exit(1)
