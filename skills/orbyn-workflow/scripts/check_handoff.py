#!/usr/bin/env python3
"""Check a versioned continuation record's consistency, never its factual truth."""
import argparse
import json
from pathlib import Path
import re


def text(value, field):
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f'{field} must be nonempty text')


def texts(value, field, nonempty=False):
    if not isinstance(value, list) or (nonempty and not value):
        raise ValueError(f'{field} must be a list' + (' with evidence' if nonempty else ''))
    for item in value:
        text(item, field)


def fields(value, expected, field):
    if not isinstance(value, dict) or set(value) != set(expected):
        raise ValueError(f'{field} requires exactly: ' + ', '.join(expected))


def validate(record, revision=None, diff_sha256=None):
    fields(record, ['schema_version', 'goal', 'excluded', 'allowed_actions', 'checkout',
                    'owner', 'owned_files', 'status', 'completed', 'verification',
                    'decisions', 'next_action', 'delivery'], 'record')
    if type(record['schema_version']) is not int or record['schema_version'] != 1:
        raise ValueError('Unsupported handoff schema_version')
    for key in ['goal', 'owner']:
        text(record[key], key)
    for key in ['excluded', 'allowed_actions', 'owned_files', 'decisions']:
        texts(record[key], key)
    checkout = record['checkout']
    fields(checkout, ['path', 'revision', 'diff_sha256'], 'checkout')
    text(checkout['path'], 'checkout.path')
    if not isinstance(checkout['revision'], str) or not re.fullmatch(r'[0-9a-f]{40}', checkout['revision']):
        raise ValueError('checkout.revision must be a full Git commit')
    digest = checkout['diff_sha256']
    if digest is not None and (not isinstance(digest, str) or not re.fullmatch(r'[0-9a-f]{64}', digest)):
        raise ValueError('checkout.diff_sha256 must be null or a SHA-256 digest')
    if revision is not None and checkout['revision'] != revision:
        raise ValueError('Stale handoff: checkout revision changed; reconcile before continuing')
    if diff_sha256 is not None and digest != diff_sha256:
        raise ValueError('Stale handoff: dirty diff changed; reconcile before continuing')
    if record['status'] not in ['in_progress', 'blocked', 'complete']:
        raise ValueError('Invalid task status')
    if not isinstance(record['completed'], list):
        raise ValueError('completed must be a list')
    for unit in record['completed']:
        fields(unit, ['result', 'evidence'], 'completed unit')
        text(unit['result'], 'completed.result')
        texts(unit['evidence'], 'completed.evidence', nonempty=True)
    checks = record['verification']
    if not isinstance(checks, list):
        raise ValueError('verification must be a list')
    for check in checks:
        fields(check, ['check', 'required', 'state', 'evidence'], 'verification item')
        text(check['check'], 'verification.check')
        if type(check['required']) is not bool or check['state'] not in ['passed', 'failed', 'unverified']:
            raise ValueError('Invalid verification required/state')
        texts(check['evidence'], 'verification.evidence', nonempty=check['state'] != 'unverified')
    delivery = record['delivery']
    fields(delivery, ['state', 'evidence'], 'delivery')
    if delivery['state'] not in ['local', 'committed', 'pushed', 'merged', 'deployed']:
        raise ValueError('Invalid delivery state')
    texts(delivery['evidence'], 'delivery.evidence', nonempty=delivery['state'] != 'local')
    if record['status'] == 'complete':
        if (record['next_action'] is not None or record['decisions'] or not record['completed']
                or any(c['required'] and c['state'] != 'passed' for c in checks)):
            raise ValueError('Complete requires completed evidence, resolved decisions, no next action and passed required checks')
    else:
        text(record['next_action'], 'next_action')
    return record


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('record', type=Path)
    parser.add_argument('--revision', help='actual current HEAD; mismatch refuses stale continuation')
    parser.add_argument('--diff-sha256', help='actual digest of the retained dirty diff')
    args = parser.parse_args()
    try:
        with args.record.open('rb') as handle:
            content = handle.read(65537)
        if len(content) > 65536:
            raise ValueError('Handoff exceeds 64 KiB; keep evidence in referenced artifacts')
        validate(json.loads(content), args.revision, args.diff_sha256)
        print('Handoff is internally consistent; inspect evidence and authority before acting.')
    except (OSError, ValueError, TypeError) as error:
        parser.exit(1, f'Handoff stopped: {error}\n')


if __name__ == '__main__':
    main()
