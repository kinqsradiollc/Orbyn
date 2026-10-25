#!/usr/bin/env python3
"""Check current authored guide links; dated work records retain historical paths."""
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
documents = [ROOT / name for name in ['README.md', 'CONTRIBUTING.md', 'tools/THIRD_PARTY_NOTICES.md']]
documents += [p for p in (ROOT / 'docs').rglob('*.md')
              if not p.is_relative_to(ROOT / 'docs/work')]
errors = []
for document in documents:
    body = re.sub(r'```.*?```', '', document.read_text(), flags=re.S)
    for target in re.findall(r'\[[^\]]*\]\(([^)]+)\)', body):
        target = target.split('#', 1)[0].strip('<>')
        if not target or target.startswith('/') or re.match(r'^[a-zA-Z][a-zA-Z0-9+.-]*:', target):
            continue
        if not (document.parent / target).exists():
            errors.append(f'Broken guide link: {document.relative_to(ROOT)} -> {target}')
if errors:
    print('\n'.join(errors), file=sys.stderr)
    sys.exit(1)
print(f'OK: local link targets in {len(documents)} current guides. No rendered or runtime claim.')
