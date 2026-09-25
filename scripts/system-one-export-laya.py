#!/usr/bin/env python3
"""Export soft-target RLCD training items for Laya fine-tuning (#255 Phase 3).

Each train prompt with teacher relevance scores becomes 12 `noul` items, one
per owner intent (catalog order, v1 wording shared with system-one-label-laya).
Teacher relevance p maps to gold probabilities {true: p, false: 1-p}, matching
the upstream fine-tune notebook (LocalLLaMA/typed-decisions, noul target
[false, true], qtype 2, label = argmax).

Output is reviewable jsonl (one item per line); the training host converts it
to train_items.pt with torch.save (never commit .pt). Sequence building goes
through laya.common.build_sequence so tokenization matches inference exactly.
Stdlib only at import time; `laya` is imported lazily inside the default
builder so contract tests run without model weights.
"""
import argparse
import hashlib
import importlib.util
import json
import random
import sys
from pathlib import Path

HERE = Path(__file__).resolve()
_label_spec = importlib.util.spec_from_file_location(
    'laya_labeler', HERE.parent / 'system-one-label-laya.py')
_label = importlib.util.module_from_spec(_label_spec)
_label_spec.loader.exec_module(_label)
INTENTS = _label.INTENTS
QUESTIONS_VERSION = _label.QUESTIONS_VERSION
build_questions = _label.build_questions

# laya.common.QTYPES = {"choice": 0, "score": 1, "noul": 2}.
QTYPE_NOUL = 2


def build_item(state_text, instructions, probs, builder):
    """One upstream-format training item from gold {true, false} probabilities."""
    pf, pt = float(probs['false']), float(probs['true'])
    if not (pf >= 0 and pt >= 0 and abs(pf + pt - 1.0) < 1e-6):
        raise ValueError(f'probabilities must sum to 1, got {probs!r}')
    built = builder(state_text, instructions, {'true': pt, 'false': pf})
    if built is None:
        return None
    target = [built['target'][0], built['target'][1]]
    if abs(sum(target) - 1.0) >= 1e-6:
        raise ValueError(f'builder target must sum to 1, got {target!r}')
    return {'ids': built['ids'], 'markers': built['markers'], 'qtype': QTYPE_NOUL,
            'target': target, 'label': target.index(max(target))}


def default_builder_factory(checkpoint='convaiinnovations/laya', subfolder='multilingual'):
    """Real sequence builder through laya.common (lazy import)."""
    from huggingface_hub import snapshot_download  # noqa: PLC0415
    from transformers import AutoTokenizer  # noqa: PLC0415
    from laya.agent import _fix_tokenizer_config  # noqa: PLC0415
    from laya.common import build_sequence, render_options  # noqa: PLC0415

    model_dir = Path(snapshot_download(checkpoint))
    revision = model_dir.name
    base = model_dir / subfolder if subfolder else model_dir
    _fix_tokenizer_config(str(base))
    tok = AutoTokenizer.from_pretrained(str(base / 'tokenizer'))
    cfg = json.loads((base / 'rl_agent_config.json').read_text(encoding='utf-8'))
    questions = build_questions()

    def builder(state_text, instructions, probs):
        question = {'t': 'noul', 'ins': instructions, 'crit': {}}
        seq, markers = build_sequence(tok, state_text, question, cfg['max_len'], cfg['head_max_len'])
        if len(markers) != len(render_options(question)):
            return None
        return {'ids': seq, 'markers': markers,
                'target': [probs['false'], probs['true']]}

    provenance = {'checkpoint': checkpoint, 'revision': revision, 'subfolder': subfolder or 'root',
                  'questions': QUESTIONS_VERSION,
                  'tokenizerDir': str(base / 'tokenizer')}
    return builder, provenance


def export(data_dir, split, out_path, manifest_path, builder, seed=0, forbid_path=None,
           teacher_file='labels-intent-scores.jsonl', provenance=None):
    """Export one prompts.jsonl split to upstream-format items."""
    if split not in ('train', 'validation'):
        raise ValueError(f'split must be train or validation, got {split!r}')
    data_dir, out_path, manifest_path = Path(data_dir), Path(out_path), Path(manifest_path)
    prompts_raw = (data_dir / 'prompts.jsonl').read_text(encoding='utf-8')
    teacher_raw = (data_dir / teacher_file).read_text(encoding='utf-8')
    teacher = {r['id']: r for r in
               (json.loads(line) for line in teacher_raw.splitlines() if line.strip())}
    rows = sorted((r for r in (json.loads(line) for line in prompts_raw.splitlines() if line.strip())
                   if r.get('split') == split), key=lambda r: r['id'])
    if forbid_path is not None:
        forbidden = set(json.loads(Path(forbid_path).read_text(encoding='utf-8')))
        clash = sorted({r['id'] for r in rows} & forbidden)
        if clash:
            raise ValueError(f'overlap with forbidden ids: {clash[:5]} (n={len(clash)})')
    if seed:
        random.Random(seed).shuffle(rows)
    questions = build_questions()
    items, skipped_no_teacher, skipped_markers = 0, 0, 0
    with out_path.open('w', encoding='utf-8') as fh:
        for prompt in rows:
            trow = teacher.get(prompt['id'])
            if trow is None:
                skipped_no_teacher += 1
                continue
            for intent in INTENTS:
                p = float(trow['scores'].get(intent, 0.0))
                item = build_item(prompt['text'], questions[intent]['instructions'],
                                  {'true': p, 'false': 1.0 - p}, builder)
                if item is None:
                    skipped_markers += 1
                    continue
                fh.write(json.dumps({'promptId': prompt['id'], 'intent': intent, **item}) + '\n')
                items += 1
    manifest = {'split': split, 'seed': seed, 'questions': QUESTIONS_VERSION,
                'builder': provenance or {'builder': 'injected'},
                'items': items, 'prompts': len(rows),
                'skippedNoTeacher': skipped_no_teacher, 'skippedMarkers': skipped_markers,
                'promptsSha256': hashlib.sha256(prompts_raw.encode('utf-8')).hexdigest(),
                'teacherSha256': hashlib.sha256(teacher_raw.encode('utf-8')).hexdigest(),
                'teacherFile': teacher_file,
                'outputSha256': hashlib.sha256(out_path.read_bytes()).hexdigest()}
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    return {'items': items, 'skippedNoTeacher': skipped_no_teacher,
            'skippedMarkers': skipped_markers, 'manifest': manifest}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data-dir', required=True, help='private corpus dir')
    parser.add_argument('--split', choices=['train', 'validation'], default='train')
    parser.add_argument('--out', required=True, help='output items jsonl')
    parser.add_argument('--manifest', required=True, help='provenance manifest json')
    parser.add_argument('--checkpoint', default='convaiinnovations/laya')
    parser.add_argument('--subfolder', default='multilingual')
    parser.add_argument('--seed', type=int, default=0, help='0 keeps id order; nonzero shuffles')
    parser.add_argument('--forbid', default=None, help='json list of forbidden ids (overlap guard)')
    parser.add_argument('--teacher', default='labels-intent-scores.jsonl')
    parser.add_argument('--limit', type=int, default=0, help='export only the first N prompts (0 = all)')
    args = parser.parse_args(argv)
    builder, provenance = default_builder_factory(args.checkpoint, args.subfolder)
    print(json.dumps({'builder': provenance}))
    # --limit applies before export by staging a filtered view; export() keeps split semantics.
    if args.limit > 0:
        import tempfile  # noqa: PLC0415
        data_dir = Path(args.data_dir)
        prompts_raw = (data_dir / 'prompts.jsonl').read_text(encoding='utf-8')
        rows = [json.loads(line) for line in prompts_raw.splitlines() if line.strip()]
        todo = sorted((r for r in rows if r.get('split') == args.split), key=lambda r: r['id'])[:args.limit]
        with tempfile.TemporaryDirectory() as tmp:
            view = Path(tmp) / 'view'
            view.mkdir()
            (view / 'prompts.jsonl').write_text(
                '\n'.join(json.dumps(r) for r in todo) + '\n', encoding='utf-8')
            (view / args.teacher).write_text((data_dir / args.teacher).read_text(encoding='utf-8'), encoding='utf-8')
            summary = export(view, args.split, args.out, args.manifest, builder,
                             seed=args.seed, forbid_path=args.forbid, teacher_file=args.teacher,
                             provenance=provenance)
    else:
        summary = export(args.data_dir, args.split, args.out, args.manifest, builder,
                         seed=args.seed, forbid_path=args.forbid, teacher_file=args.teacher,
                         provenance=provenance)
    print(json.dumps({k: v for k, v in summary.items() if k != 'manifest'}))
    return 0


if __name__ == '__main__':
    sys.exit(main())
