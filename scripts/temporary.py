"""Portable private temporary parents; never an execution/verification switch."""

import os
from pathlib import Path
import tempfile


def parent(project=None):
  selected = os.environ.get("RELEASE_TEMP_PARENT")
  candidate = Path(selected or ("/tmp/opencode" if os.access("/tmp/opencode", os.W_OK) else tempfile.gettempdir()))
  if selected:
    if not candidate.is_absolute() or candidate.is_symlink() or not candidate.is_dir():
      raise ValueError("Temporary parent must be an existing absolute nonsymlink directory")
    if any(path.is_symlink() for path in candidate.parents):
      raise ValueError("Temporary parent contains a symlink")
    if candidate.stat().st_uid != os.getuid() or not os.access(candidate, os.W_OK):
      raise ValueError("Temporary parent must be owned and writable")
    if project and candidate.resolve().is_relative_to(Path(project).resolve()):
      raise ValueError("Temporary parent must be outside project")
  return str(candidate)
