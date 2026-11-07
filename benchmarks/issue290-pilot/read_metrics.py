"""Shared, conservative reference attribution; never execute captured commands.

Filesystem access, mixed shell output and identified reference content are
different metrics. Only paths in the episode's declared document bundle count.
Unknown transformations remain uncertain, rather than being counted as reads.
"""
import hashlib
import re
import shlex

READERS = {'cat', 'sed', 'head', 'tail', 'rg', 'grep', 'get-content', 'gc', 'type'}


def segments(command):
    if not isinstance(command, str):
        return []
    try:
        # Preserve backslashes in PowerShell paths. Quoted shell wrappers are
        # unwrapped before this lexer is used for their actual program.
        command = command.replace('<HARNESS_SOURCE>', '__HARNESS_SOURCE__').replace('<TMP>', '__TMP__')
        lexer = shlex.shlex(command, posix=True, punctuation_chars=';&|()<>')
        lexer.escape = ''
        lexer.whitespace_split = True
        tokens = [token.replace('__HARNESS_SOURCE__', '<HARNESS_SOURCE>').replace('__TMP__', '<TMP>') for token in lexer]
    except (ValueError, TypeError):
        return []
    if tokens and tokens[0].rsplit('/', 1)[-1] in ('sh', 'bash', 'zsh') and len(tokens) == 3 and tokens[1] in ('-c', '-lc'):
        return segments(tokens[2])
    result, current = [], []
    for token in tokens:
        if token and all(c in ';&|()<>' for c in token):
            if current:
                result.append(current)
            current = []
        else:
            current.append(token)
    if current:
        result.append(current)
    return result


def is_content_command(command):
    return any(part and part[0].lower().rsplit('/', 1)[-1] in READERS
               and not (part[0].lower() == 'rg' and '--files' in part)
               for part in segments(command))


def reference_path(value, documents, source=''):
    value = str(value).replace('\\', '/').removeprefix('./')
    for prefix in ('.harness/', '<HARNESS_SOURCE>/', source.rstrip('/') + '/' if source else ''):
        if prefix and value.startswith(prefix):
            relative = value[len(prefix):]
            return relative if relative in documents else None
    # Native Read can supply an absolute workspace/.harness path.
    if '/.harness/' in value:
        relative = value.split('/.harness/', 1)[1]
        return relative if relative in documents else None
    return value if value in documents else None


def observed_read(command, output, documents, source='', native_path=None):
    paths = []
    if native_path is not None:
        relative = reference_path(native_path, documents, source)
        if relative:
            paths.append(relative)
    else:
        for part in segments(command):
            if not part or not is_content_command(shlex.join(part)):
                continue
            for token in part[1:]:
                relative = reference_path(token, documents, source)
                if relative and relative not in paths:
                    paths.append(relative)
    if not paths:
        return None
    remaining = output or ''
    matched = []
    # Match complete line runs or complete files. A numeric wc result, a
    # filename listing, or prose mentioning a path does not identify content.
    # Very short isolated fragments stay uncertain to avoid incidental matches.
    for relative in paths:
        content = documents[relative]
        if not content:
            continue
        if content in remaining:
            remaining = remaining.replace(content, '', 1)
            matched.append({'path': relative, 'bytes': len(content.encode()), 'kind': 'full-file'})
            continue
        lines = remaining.splitlines(keepends=True)
        index = 0
        while index < len(lines):
            end = index + 1
            best = None
            while end <= len(lines):
                fragment = ''.join(lines[index:end])
                if fragment not in content:
                    break
                if len(fragment.strip()) >= 32:
                    best = (end, fragment)
                end += 1
            if best:
                end, fragment = best
                matched.append({'path': relative, 'bytes': len(fragment.encode()), 'kind': 'partial-content'})
                remaining = remaining.replace(fragment, '', 1)
                index = end
            else:
                index += 1
    attributable = sum(item['bytes'] for item in matched)
    total = len((output or '').encode())
    return {'command': command, 'paths': paths, 'filesystem_access_candidates': len(paths),
            'shell_output_bytes': total, 'returned_bytes': attributable,
            'exact_reference_bytes': attributable,
            'uncertain_or_mixed_output_bytes': total - attributable,
            'matched_content': matched,
            'content_sha256': hashlib.sha256((output or '').encode()).hexdigest(),
            'evidence': 'content match against frozen declared bundle; access alone is not returned content'}


def collect_reads(events, documents, source=''):
    reads, commands, errors = [], [], []
    tools = {tool['id']: tool for event in events
             for tool in event.get('message', {}).get('content', [])
             if isinstance(tool, dict) and tool.get('type') == 'tool_use' and tool.get('id')}
    active = 'uncomposed'
    for event in events:
        outputs = []
        item = event.get('item', {})
        if event.get('type') == 'item.completed' and item.get('type') == 'command_execution':
            outputs.append((item.get('command', ''), item.get('aggregated_output', '')))
            if item.get('exit_code') not in (0, None):
                errors.append({'command': item.get('command'), 'exit': item.get('exit_code')})
        result = event.get('tool_use_result')
        if isinstance(result, dict):
            if result.get('type') == 'text' and isinstance(result.get('file'), dict):
                file = result['file']
                read = observed_read('', file.get('content', ''), documents, source, file.get('filePath', ''))
                if read:
                    reads.append({'active_step': active, **read})
            if 'stdout' in result:
                command = ''
                for tool in event.get('message', {}).get('content', []):
                    if isinstance(tool, dict) and tool.get('type') == 'tool_result':
                        command = tools.get(tool.get('tool_use_id'), {}).get('input', {}).get('command', '')
                outputs.append((command, result.get('stdout', '')))
                if result.get('interrupted'):
                    errors.append({'command': command, 'interrupted': True})
        elif isinstance(result, str) and result.startswith('Error:'):
            errors.append({'tool_error': result})
        for command, output in outputs:
            commands.append(command)
            if 'workflow-disposition.js' in command:
                import json
                try:
                    data, _ = json.JSONDecoder().raw_decode(output.lstrip())
                    if isinstance(data, dict):
                        if data.get('activeStep'):
                            active = data['activeStep']['id']
                        elif data.get('activeStages'):
                            active = ','.join(stage.get('stageId', '?') for stage in data['activeStages'])
                except (ValueError, KeyError, TypeError):
                    pass
            read = observed_read(command, output, documents, source)
            if read:
                reads.append({'active_step': active, **read})
    return reads, commands, errors
