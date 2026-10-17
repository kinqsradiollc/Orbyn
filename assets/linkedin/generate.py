"""Compatibility entry point: regenerate the shared Orbyn brand asset set."""
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]
subprocess.run(["node", str(ROOT / "scripts/generate-brand-assets.mjs")], cwd=ROOT, check=True)
