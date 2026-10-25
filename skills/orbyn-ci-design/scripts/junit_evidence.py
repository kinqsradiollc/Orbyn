#!/usr/bin/env python3
"""Convert a bounded UTF-8 JUnit subset to streaming CI JSONL; never run report code."""
import argparse
import codecs
import hashlib
import json
from pathlib import Path
import xml.etree.ElementTree as ET

MAX_XML = 32 * 1024 * 1024


class GuardedReader:
    def __init__(self, stream):
        self.stream, self.tail, self.total = stream, b'', 0
        self.hasher = hashlib.sha256()
        self.decoder = codecs.getincrementaldecoder('utf-8')()

    def read(self, size=-1):
        block = self.stream.read(min(size, 65536) if size >= 0 else 65536)
        self.total += len(block)
        if self.total > MAX_XML:
            raise ValueError('Shard XML into files of at most 32 MiB')
        scan = (self.tail + block).upper()
        if b'<!DOCTYPE' in scan or b'<!ENTITY' in scan or b'\x00' in block:
            raise ValueError('DTD, entities and non-UTF-8 XML are unsupported')
        self.decoder.decode(block, final=not block)
        self.tail = scan[-16:]
        self.hasher.update(block)
        return block


def convert(source, destination):
    source, destination = Path(source), Path(destination)
    if destination.exists() or destination.is_symlink():
        raise ValueError('Output must not exist')
    if source.stat().st_size > MAX_XML:
        raise ValueError('Shard XML into files of at most 32 MiB')
    count, counts, normalized_hash = 0, {}, hashlib.sha256()
    # Own this new output only. Remove incomplete conversion without touching input.
    with source.open('rb') as stream, destination.open('x', encoding='utf-8', newline='\n') as output:
        reader = GuardedReader(stream)
        stack = []
        suite_counts = {}
        try:
            for event, node in ET.iterparse(reader, events=('start', 'end')):
                if event == 'start':
                    if not stack and node.tag not in {'testsuite', 'testsuites'}:
                        raise ValueError('Expected unnamespaced JUnit testsuite(s)')
                    if len(stack) >= 128:
                        raise ValueError('XML nesting exceeds supported depth')
                    allowed = {'testsuites','testsuite','testcase','failure','error','skipped',
                               'system-out','system-err','properties','property'}
                    if node.tag not in allowed:
                        raise ValueError('Unsupported JUnit element; use a runner-specific adapter')
                    if node.tag in {'failure','error','skipped'} and (not stack or stack[-1].tag != 'testcase'):
                        raise ValueError('Outcome outside testcase')
                    if node.tag == 'testcase' and (not stack or stack[-1].tag != 'testsuite'):
                        raise ValueError('Testcase must be inside a testsuite')
                    if node.tag in {'testsuite','testsuites'}:
                        suite_counts[node] = dict(tests=0, failures=0, errors=0, skipped=0)
                    stack.append(node)
                    continue
                if node.tag == 'testcase':
                    if node.get('status') not in {None,'run'}:
                        raise ValueError('Unsupported testcase status')
                    name = node.get('name')
                    if not name:
                        raise ValueError('Testcase requires a stable name')
                    suite = [s.get('name', '') for s in stack[:-1] if s.tag == 'testsuite']
                    identity = json.dumps([suite, node.get('classname', ''), name], ensure_ascii=False)
                    outcomes = [n for n in node if n.tag in {'failure', 'error', 'skipped'}]
                    if len(outcomes) > 1:
                        raise ValueError('Ambiguous multiple JUnit outcomes; use a runner-specific adapter')
                    status = {'failure': 'failed', 'error': 'error', 'skipped': 'skipped'}[outcomes[0].tag] if outcomes else 'passed'
                    row = {'test_id': identity, 'status': status}
                    if status in {'failed', 'error'}:
                        issue = outcomes[0]
                        row.update(failure_type=issue.get('type') or issue.tag,
                                   message=issue.get('message') or issue.text or issue.tag)
                        if len(row['message']) > 8192:
                            raise ValueError('Failure message exceeds 8192 characters; supply a deliberate adapter')
                    line = json.dumps(row, ensure_ascii=False)+'\n'
                    if len(identity) > 2048 or len(line.encode()) > 65536:
                        raise ValueError('Test identity or JSONL line exceeds normalized limits')
                    output.write(line)
                    normalized_hash.update(line.encode())
                    for parent in stack[:-1]:
                        if parent in suite_counts:
                            suite_counts[parent]['tests'] += 1
                            category = {'failed':'failures','error':'errors','skipped':'skipped'}.get(status)
                            if category:
                                suite_counts[parent][category] += 1
                    counts[status] = counts.get(status, 0)+1
                    count += 1
                    if len(stack) > 1:
                        stack[-2].remove(node)
                    node.clear()
                elif node.tag in {'testsuite', 'testsuites'}:
                    observed = suite_counts.pop(node)
                    for field, number in observed.items():
                        if field in node.attrib and int(node.attrib[field]) != number:
                            raise ValueError('JUnit counters contradict observed testcase outcomes')
                    if len(stack) > 1:
                        stack[-2].remove(node)
                    node.clear()
                stack.pop()
            if not count:
                raise ValueError('No selected testcases')
        except BaseException:
            destination.unlink()
            raise
    return {'source_sha256': reader.hasher.hexdigest(),
            'normalized_sha256': normalized_hash.hexdigest(),
            'selected': count, 'counts': counts,
            'limits': 'UTF-8 unnamespaced JUnit subset. Suite/class/name identity; retries need separate attempt reports. No provider completeness proof.'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    try:
        print(json.dumps(convert(args.input, args.output)))
    except (OSError, ValueError, ET.ParseError) as error:
        parser.exit(2, f'JUnit conversion failed: {error}\n')


if __name__ == '__main__':
    main()
