"""Project runner: exposes real discovery counts, including unmatched filters."""
import argparse
import hashlib
import json
from pathlib import Path
import sys
import unittest


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--filter')
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    sys.path.insert(0, str(root))
    loader = unittest.TestLoader()
    if args.filter:
        loader.testNamePatterns = ['*' + args.filter + '*']
    suite = loader.discover(str(root/'tests'))
    count = suite.countTestCases()
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    report = {'selected': count, 'failures': len(result.failures),
              'errors': len(result.errors), 'skipped': len(result.skipped),
              'success': result.wasSuccessful()}
    record = dict(report, source_sha256=hashlib.sha256((root/'src/event_bus.py').read_bytes()).hexdigest(),
                  test_sha256={str(path.relative_to(root)): hashlib.sha256(path.read_bytes()).hexdigest()
                               for path in sorted((root/'tests').glob('test_*.py'))},
                  failure_details=[{'test': str(test), 'traceback': trace}
                                   for test, trace in result.failures+result.errors])
    output = root/'output/check-runs.jsonl'
    output.parent.mkdir(exist_ok=True)
    with output.open('a') as stream:
        stream.write(json.dumps(record)+'\n')
    print(json.dumps(report), flush=True)
    return 0 if result.wasSuccessful() else 1


if __name__ == '__main__':
    sys.exit(main())
