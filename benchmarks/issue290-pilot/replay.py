#!/usr/bin/env python3
"""Rebuild pilot evidence offline, from hash-checked committed inputs only."""
import argparse
import hashlib
import importlib
import json
from pathlib import Path, PurePosixPath
import tarfile
import tempfile

from analyze import inspect_episode
from reporting import paired_rows, report_tables, summarize_groups

HERE = Path(__file__).resolve().parent
exporter = importlib.import_module('export')


def key(row):
    return (row['series'], row['model']['engine'], row['workload'], row['arm'], row['repeat'])


def extract_verified(target):
    inventory = json.loads((HERE/'evidence/inventory.json').read_text())
    expected = {item['path']: item for item in inventory}
    found = set()
    with tarfile.open(HERE/'evidence.tar.gz') as archive:
        for member in archive.getmembers():
            parts = PurePosixPath(member.name).parts
            if not parts or parts[0] != 'evidence' or '..' in parts or member.issym() or member.islnk():
                raise ValueError('unsafe archive member')
            if member.isdir():
                continue
            relative = '/'.join(parts[1:])
            if relative == 'inventory.json':
                continue
            if not member.isfile() or relative not in expected or relative in found:
                raise ValueError('unexpected/duplicate evidence file')
            raw = archive.extractfile(member).read()
            if hashlib.sha256(raw).hexdigest() != expected[relative]['exported_sha256']:
                raise ValueError('exported evidence hash mismatch')
            exporter.validate_no_secrets(raw.decode())
            path = target/relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(raw)
            found.add(relative)
    if found != set(expected):
        raise ValueError('missing exported evidence files')
    return len(found)


def regenerate():
    with tempfile.TemporaryDirectory(prefix='harness-pilot-replay-') as temporary:
        root = Path(temporary)
        count = extract_verified(root)
        frozen_rows = json.loads((root/'issue290-final-audit/audited-rows.json').read_text())
        frozen = {key(row): row for row in frozen_rows}
        if len(frozen) != 40:
            raise ValueError('frozen audit count/identity mismatch')
        bundle = json.loads((HERE/'frozen-documents.json').read_text())
        rows = []
        for manifest_path in sorted(root.glob('*/*/manifest.json')):
            episode = manifest_path.parent
            manifest = json.loads(manifest_path.read_text())
            identity = {**manifest, 'series': episode.parent.name}
            documents = {}
            for name, digest in manifest['documents'].items():
                document = bundle['documents'][name]
                if document['source_sha256'] != digest or hashlib.sha256(document['content'].encode()).hexdigest() != digest:
                    raise ValueError('document revision differs from episode manifest')
                documents[name] = document['content']
            # The live JS fixture declared ESM, but the original episode
            # exporter retained only the implementation. Restore that pinned
            # launch prerequisite instead of relying on host module detection.
            if manifest['workload'] == 'polyglot-simple-linked-list-staged':
                package = '{"type":"module"}\n'
                if manifest['fixture'].get('package.json') != hashlib.sha256(package.encode()).hexdigest():
                    raise ValueError('unexpected module fixture identity')
                (episode/'package.json').write_text(package)
            row = inspect_episode(episode, offline=True, frozen=frozen[key(identity)], documents=documents)
            row['series'] = episode.parent.name
            # No host reasoning, assistant prose, dispatch arguments, or child
            # transcripts are republished by the derived ledger.
            keep = ('series', 'model', 'workload', 'arm', 'repeat', 'preflight', 'classification',
                    'wall_seconds', 'exit', 'stop_reason', 'budget_failure', 'cost_observability',
                    'api_equivalent_cost_usd', 'api_equivalent_input_cost_usd', 'parent_api_equivalent_cost_usd',
                    'reference_returned_bytes', 'exact_reference_bytes_lower_bound',
                    'reference_filesystem_access_candidates', 'reference_shell_output_bytes',
                    'uncertain_or_mixed_output_bytes', 'observed_reference_reads',
                    'effective_effort_reported', 'input_usage_reconciles', 'usage',
                    'child_usage_observability', 'strategies', 'tdd_quality_gate_name_matched_invocation',
                    'independent_grader', 'telemetry_provenance')
            rows.append({name: row.get(name) for name in keep})
        if len(rows) != 40 or {key(row) for row in rows} != set(frozen):
            raise ValueError('replayed episode identities differ')
        rows.sort(key=key)
        pairs = paired_rows(rows)
        output = {'ledger.json': rows, 'group-summary.json': summarize_groups(rows), 'pairs.json': pairs,
                  'provenance.json': {'verified_exported_files': count,
                    'archive_sha256': hashlib.sha256((HERE/'evidence.tar.gz').read_bytes()).hexdigest(),
                    'pricing_assumptions_sha256': hashlib.sha256((HERE/'pricing-assumptions.json').read_bytes()).hexdigest(),
                    'frozen_documents_sha256': hashlib.sha256((HERE/'frozen-documents.json').read_bytes()).hexdigest(),
                    'recomputed': ['parent-stream content attribution', 'artifact checks', 'gate-name invocation', 'metric denominators', 'paired deltas'],
                    'frozen_not_independently_recovered': ['request usage', 'child dispatch metadata', 'effort', 'usage aggregates'],
                    'irretrievable': ['unobserved worker usage/model identities', 'interrupted final usage'],
                    'unknown_policy': 'non-reconstructable whole-run costs remain null; no host-home reads or model calls'}}
        result = {}
        for name, value in output.items():
            text = json.dumps(value, indent=2, ensure_ascii=False, sort_keys=True)+'\n'
            text = text.replace(str(root), '<REPLAY_ROOT>').replace(str(HERE.parent.parent), '<HARNESS_SOURCE>')
            exporter.validate_no_secrets(text)
            result[name] = text
        result['tables.md'] = report_tables(rows, pairs)
        return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--check', action='store_true', help='compare regenerated data with committed expected values')
    args = parser.parse_args()
    result = regenerate()
    def destination(name):
        return HERE/'evidence'/name if name in ('ledger.json', 'group-summary.json') else HERE/'evidence/replay'/name
    if args.check:
        for name, text in result.items():
            if not destination(name).is_file() or destination(name).read_text() != text:
                if name.endswith('.json') and destination(name).is_file():
                    def differences(expected, actual, path='$'):
                        if type(expected) is not type(actual):
                            yield path+' (type)'
                        elif isinstance(expected, dict):
                            for field in sorted(set(expected) | set(actual)):
                                if field not in expected or field not in actual:
                                    yield path+'.'+field+' (missing)'
                                else:
                                    yield from differences(expected[field], actual[field], path+'.'+field)
                        elif isinstance(expected, list):
                            if len(expected) != len(actual):
                                yield path+' (length)'
                            for index, (left, right) in enumerate(zip(expected, actual)):
                                yield from differences(left, right, f'{path}[{index}]')
                        elif expected != actual:
                            yield path
                    import itertools
                    print('different fields:', ', '.join(itertools.islice(differences(
                        json.loads(destination(name).read_text()), json.loads(text)), 12)))
                raise SystemExit('offline replay differs: '+name)
        readme = (HERE/'README.md').read_text()
        if '<!-- BEGIN REPLAY TABLES -->\n'+result['tables.md']+'<!-- END REPLAY TABLES -->' not in readme:
            raise SystemExit('offline replay differs: README tables')
        print('offline replay PASS: 40 episodes; 621 hashes; ledger, groups, pairs, tables and provenance match')
    else:
        for name, text in result.items():
            path = destination(name)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text)
        readme = HERE/'README.md'
        content = readme.read_text()
        if '<!-- BEGIN REPLAY TABLES -->' in content:
            import re
            content = re.sub(r'<!-- BEGIN REPLAY TABLES -->.*?<!-- END REPLAY TABLES -->',
                             lambda _: '<!-- BEGIN REPLAY TABLES -->\n'+result['tables.md']+'<!-- END REPLAY TABLES -->', content, flags=re.S)
            readme.write_text(content)
        print('regenerated offline evidence:', len(result), 'files')


if __name__ == '__main__':
    main()
