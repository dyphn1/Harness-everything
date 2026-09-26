#!/usr/bin/env python3
"""Noise-gate experiment for #233: separate unclassifiable prompts before tiering.

Question: can a CUA-S1 tinyx scorer tell, from the prompt text alone, whether a
prompt is actionable, or unclassifiable because it is a continuation (only
meaningful with the previous turn) or carries no request (pastes, chatter)?
The goal is a confident split, not a correct tier.

Three independent options (per-option sigmoid, masked BCE):
  actionable    the text alone asks for concrete software work
  continuation  go-ahead, approval, pick or bare directive; needs the previous turn
  no-request    pasted output, notifications, identifiers or chatter

Labels come from the tier labels (Codex + owner overrides) plus
high-precision text rules; a noise row whose subtype no rule decides keeps
its continuation/no-request targets masked. Curriculum: train on rule seeds,
then add ambiguous rows back in stages, most-agreeing first; a control trains
the same final data from scratch. Every round is scored on the full,
fixed validation split. The holdout is never read.

Rules, labels and metrics are stdlib-only; torch and cua_s1 load inside run().
"""
import argparse
import json
import math
from pathlib import Path
import random
import re
import sys
import time

sys.dont_write_bytecode = True
OPTIONS = (
    ('actionable', 'actionable: the text alone asks for concrete software work'),
    ('continuation', 'continuation: go-ahead, approval, pick or bare directive; needs previous turn'),
    ('no-request', 'no request: pasted output, logs, notifications, identifiers or chatter'),
)
A, C, N = 0, 1, 2
# --merge-invalid (owner decision 2026-09-26): the small model sees only the current
# prompt, so continuations and no-request messages are one class, "invalid", handed to
# the host agent, which has the conversation. Two options instead of three.
OPTIONS_MERGED = (
    ('actionable', 'actionable: the text alone asks for concrete software work'),
    ('invalid', 'invalid: text alone has no actionable request; continuation, feedback, paste or chatter'),
)


def merge_invalid(row):
    """Collapse a three-option row to [actionable, invalid]; every row is then fully labeled."""
    a = row['targets'][A]
    return {**row, 'targets': [a, 1.0 - a], 'mask': [1, 1]}

_CONT_WORDS = (
    r'go|gogo|gogogo|go ahead|go on|go next|go next one|gogo next one|go next phase|next|next one|do next|'
    r'continue|keep going|carry on|proceed|yes|yep|yeah|y|ok|okay|okok|sure|right|correct|agreed|agree|lgtm|'
    r'do it|just do it|yes do it|yes go|ok go|ok go next|ok go ahead|try it|try again|retry|again|once again|re-run|rerun|'
    r'apply|approved|good|perfect|great|nice|fine|done|i am ready|ready|start|let\'?s go|pls run|please run|'
    r'好|好的|好了|好喔|好啊|可以|可以了|可行|行|對|對的|是|是的|沒錯|沒問題|同意|採用|符合|確認|收到|了解|嗯|恩|'
    r'繼續|請繼續|繼續吧|接著|接著看|下一個|下一條|下一步|下一個問題|再一次|再來|重來|重試|在一次|再試一次|'
    r'開始|開始吧|開始實作|開始進行|可以開始實作了|直接進行|依序處理|依序進行|照順序處理|依照你建議執行|'
    r'完成了|執行了|完成|做完了|跑完了|好了,跑完了|先這樣|先這樣吧|目前先這些|就這樣|就這樣處理'
)
_CONT = re.compile(r'^(?:ok[, ]*|好[, ]*|yes[, ]*)?(?:' + _CONT_WORDS + r')(?:[ ,]*(?:' + _CONT_WORDS + r'))*$')
# A bare option pick or numbered answer: "A", "2", "A+B", "1, 2", "方案2", "選B", "B 同意".
_PICK = re.compile(r'^(?:ok[ ,]*)?(?:選|走|先選)?\s*(?:方案\s*)?(?:[a-e]|\d{1,2}(?:\.\d+)?|[一二三四五])'
                   r'(?:\s*(?:[,&+、]|and|然後)\s*(?:[a-e]|\d{1,2}))*\.?(?:\s*(?:' + _CONT_WORDS + r'))?$')
_CHAT = re.compile(r'^(?:hi|hello|heelo|hey|thx|thanks|thank you|謝謝|感謝|夠了 非常感謝|要下班拉|要下班了|晚安|早安|哈+|lol)$')
_MARKER = re.compile(r'<subagent_notification>|^\[request interrupted|^#attachment:|^<email>')
_PASTE_LINE = re.compile(
    r'^```|^\s*traceback|^\s*at \w[\w.$]*\(|\bmingw64\b|^[a-z]:[\\/]|^[\\/]\w+[\\/]|^\$ |>\s*\S+\.exe\b|'
    r'^\d{1,2}/\d{1,2}\s*(?:上午|下午)|^[\w.-]+@[\w.-]+\s|^\s*(?:error|warning|info|debug)\b|^\s*[-=*#]{3,}')
# A line that asks for something: any CJK text, or common English request words.
_REQUEST = re.compile(r'[\u4e00-\u9fff]|\b(?:please|pls|fix|check|why|how|what|can you|could you|help|make|add|remove|'
                      r'update|use|run|show|list|find|look|review|explain|should|need|want|let\'?s|do)\b')
_IDENT = re.compile(r'^(?=.*(?:[._:/\\]|[a-z][A-Z]))[A-Za-z0-9_.:/\\-]+$', re.ASCII)


# Rules v2 (owner decision 2026-09-26): prompts whose tier the text cannot decide.
# A change verb with no concrete object ("修正一下", "優化這段") leaves the scope, and
# so the tier, to the previous turn; so does feedback on earlier work ("還是一樣的錯誤")
# and a pointer to earlier content ("請依照需求實作"). All three are continuations.
_CHANGE_VERB = r'(?:修正|修改|修復|更正|糾正|優化|調整|處理|補上|補齊|補充|實作|實現|重構|重購|改|更新|加上|移除|刪掉|完善|解決|fix|change|update|refactor|improve|implement)'
_BARE = re.compile(r'^(?:ok|好|是的?|yes|請|幫我|先|現在|直接|開始|進行|再|也|都|一併|依序|全部|順便|\s|,|，)*'
                   + _CHANGE_VERB + r'(?:一下|看看|它|他|她|這段|這個|這些|這問題|這部分|上去|掉|起來|進去|吧|喔|了|\s)*$')
_FEEDBACK = re.compile(r'還是|依樣|依然|一樣的|又(?:壞|錯|失敗|卡)|少了|漏掉|沒有(?:更新|產生|修正|加入|補上|出現|作用|處理|拉上去|改到)|'
                       r'不對|錯了|卡住|卡死|失敗了|壞了|跑掉|不見了|畫不出來|看不到|沒反應|\bstill\b|\bnot working\b|'
                       r"\bdoesn'?t work\b|\bis missing\b|\bbroken\b")
_POINTER = re.compile(r'(?:依照|按照|照著|根據)(?:需求|上述|此|這個?|你的?|剛剛|剛才|建議|計畫|指示)|如上|上述的?(?:問題|指示|錯誤)')
_CONCRETE = re.compile(r'[A-Za-z0-9_]+\.[A-Za-z]{1,6}\b|[\\/]|`|\b(?:readme|yml|yaml|json|mermaid|adr|roadmap|csproj|test|e2e|ci)\b', re.I)


def rule_v2(text):
    """rule() plus bare change directives, feedback on earlier work and pointers to it."""
    base = rule(text)
    if base:
        return base
    raw = text.strip()
    t = normalize(text)
    if len(raw) > 40 or '\n' in raw.strip():
        return None
    if _BARE.match(t) or _POINTER.search(t):
        return 'continuation'
    # A question ("A 還是 B?") asks something new; only a stuck-run check stays feedback.
    question = re.search(r'[?？]|嗎', raw) and not re.search(r'卡|還在跑|跑完', raw)
    if _FEEDBACK.search(t) and not _CONCRETE.search(raw) and not question:
        return 'continuation'
    return None


def normalize(text):
    t = text.strip().lower().replace('\r\n', ' ').replace('\n', ' ')
    t = re.sub(r'\s+', ' ', t)
    return re.sub(r'[。！!？?~～…\.]+$', '', t).strip()


def rule(text):
    """High-precision subtype rule: 'continuation', 'no-request' or None.

    continuation: needs the previous turn (go-ahead, approval, pick, or a bare
    identifier or path that answers the thread). no-request: chatter, host
    markers, or pasted multi-line output with no line that asks for anything.
    """
    raw = text.strip()
    t = normalize(text)
    if not t:
        return 'no-request'
    if _CONT.match(t) or _PICK.match(t):
        return 'continuation'
    if _CHAT.match(t) or _MARKER.search(raw.lower()):
        return 'no-request'
    lines = [ln for ln in raw.lower().splitlines() if ln.strip()]
    if len(lines) == 1 and _IDENT.match(raw) and len(raw) >= 4 and raw.lower() not in (
            'upgrade', 'commit', 'init', 'test', 'build', 'dry-run', 'git status', 'git pull'):
        return 'continuation'
    if len(lines) > 1 and any(_PASTE_LINE.search(ln) for ln in lines) and not any(
            _REQUEST.search(ln) and not _PASTE_LINE.search(ln) for ln in lines):
        return 'no-request'
    return None


def label_rows(prompts, tier_labels, excluded, seed_min_chars=20, rules=1):
    """One row per prompt: targets [A, C, N], mask, seed flag and bucket."""
    rows = []
    for p in prompts:
        if p['id'] in excluded or p['id'] not in tier_labels:
            continue
        tier, r = tier_labels[p['id']], (rule_v2 if rules == 2 else rule)(p['text'])
        if r == 'continuation':
            targets, mask, bucket = [0.0, 1.0, 0.0], [1, 1, 1], 'rule-continuation'
        elif r == 'no-request':
            targets, mask, bucket = [0.0, 0.0, 1.0], [1, 1, 1], 'rule-no-request'
        elif tier is None:
            targets, mask, bucket = [0.0, 0.0, 0.0], [1, 0, 0], 'null-unruled'
        elif len(p['text'].strip()) >= seed_min_chars:
            targets, mask, bucket = [1.0, 0.0, 0.0], [1, 1, 1], 'tier-long'
        else:
            targets, mask, bucket = [1.0, 0.0, 0.0], [1, 1, 1], 'tier-short'
        rows.append({'id': p['id'], 'split': p['split'], 'text': p['text'], 'tier': tier, 'targets': targets,
                     'mask': mask, 'bucket': bucket, 'seed': bucket in ('rule-continuation', 'rule-no-request', 'tier-long')})
    return rows


def auroc(scores, labels):
    """Probability that a random positive outranks a random negative (ties count half)."""
    pos = [s for s, y in zip(scores, labels) if y]
    neg = [s for s, y in zip(scores, labels) if not y]
    if not pos or not neg:
        return None
    order = sorted(range(len(scores)), key=lambda i: scores[i])
    ranks, i = [0.0] * len(scores), 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and scores[order[j + 1]] == scores[order[i]]:
            j += 1
        for k in range(i, j + 1):
            ranks[order[k]] = (i + j) / 2 + 1
        i = j + 1
    rsum = sum(r for r, y in zip(ranks, labels) if y)
    return (rsum - len(pos) * (len(pos) + 1) / 2) / (len(pos) * len(neg))


def ece(probs, labels, bins=10):
    total, err = len(probs), 0.0
    for b in range(bins):
        idx = [i for i, p in enumerate(probs) if min(int(p * bins), bins - 1) == b]
        if idx:
            err += abs(sum(probs[i] for i in idx) - sum(labels[i] for i in idx))
    return err / total if total else None


def gate_metrics(rows, probs, confident=0.8):
    """Noise-gate metrics on a fixed row set. probs: [pA, pC, pN] per row."""
    noise = [r['targets'][A] == 0.0 for r in rows]
    s = [1 - p[A] for p in probs]
    out = {'n': len(rows), 'noise': sum(noise), 'auroc': auroc(s, noise), 'eceActionable': ece([p[A] for p in probs], [not y for y in noise])}
    for tau in (0.5,):
        pred = [x >= tau for x in s]
        tp = sum(1 for p_, y in zip(pred, noise) if p_ and y)
        out[f'noisePrecision@{tau}'] = tp / max(1, sum(pred))
        out[f'noiseRecall@{tau}'] = tp / max(1, sum(noise))
    out['confidentNoise'] = sum(1 for x, y in zip(s, noise) if y and x >= confident) / max(1, sum(noise))
    out['confidentActionable'] = sum(1 for p, y in zip(probs, noise) if not y and p[A] >= confident) / max(1, len(rows) - sum(noise))
    out['meanNoiseScoreOnNoise'] = sum(x for x, y in zip(s, noise) if y) / max(1, sum(noise))
    out['meanNoiseScoreOnActionable'] = sum(x for x, y in zip(s, noise) if not y) / max(1, len(rows) - sum(noise))
    sub = [(p, r) for p, r in zip(probs, rows) if r['bucket'] in ('rule-continuation', 'rule-no-request')]
    if sub and len(sub[0][0]) > N:
        ok = sum(1 for p, r in sub if len(p) > N and (p[C] >= p[N]) == (r['bucket'] == 'rule-continuation'))
        out['subtypeAccuracyOnRuleRows'] = ok / len(sub)
    return out


def report(rows, probs):
    by = {'all': list(range(len(rows)))}
    for r_i, r in enumerate(rows):
        by.setdefault('seed' if r['seed'] else 'ambiguous', []).append(r_i)
        by.setdefault(r['bucket'], []).append(r_i)
    return {k: gate_metrics([rows[i] for i in v], [probs[i] for i in v]) for k, v in sorted(by.items())}


def run(args):
    import torch
    from cua_s1.model import ChoiceExample, make_system, save_checkpoint
    here = Path(__file__).resolve().parent
    sys.path.insert(0, str(here))
    trainer = __import__('system-one-train')
    random.seed(args.seed)
    torch.manual_seed(args.seed)
    torch.set_num_threads(max(1, args.threads))
    data = Path(args.data_dir)
    load = trainer.load_jsonl
    tiers = {r['id']: r['gold'] for r in load(data / 'labels.jsonl')}
    for r in load(data / 'owner-overrides.jsonl'):
        tiers[r['id']] = r['gold']
    excluded = {r['id'] for r in load(data / 'owner-excluded.jsonl')}
    rows = label_rows(load(data / 'prompts.jsonl'), tiers, excluded, rules=args.rules)
    train_rows = [r for r in rows if r['split'] == 'train']
    val_rows = [r for r in rows if r['split'] == 'validation']
    options = OPTIONS_MERGED if args.merge_invalid else OPTIONS
    if args.merge_invalid:
        rows = [merge_invalid(r) for r in rows]
        train_rows = [r for r in rows if r['split'] == 'train']
        val_rows = [r for r in rows if r['split'] == 'validation']
    option_texts = tuple(t for _, t in options)
    config = {'encoder': 'tinyx', 'width': args.width, 'rank': args.width, 'layers': args.layers, 'heads': 4,
              'dropout': 0.1, 'context_tokens': args.context_tokens, 'option_tokens': 96}
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    def lengths(rs):
        return [min(len(r['text'].encode('utf-8')), args.context_tokens) or 1 for r in rs]

    def examples(rs):
        return [ChoiceExample(context=r['text'], options=option_texts, label=0) for r in rs]

    def score(model, collator, rs):
        model.eval()
        probs = [None] * len(rs)
        xs = examples(rs)
        with torch.no_grad():
            for batch in trainer.make_batches(lengths(rs), args.token_budget):
                p = model(collator([xs[i] for i in batch])).sigmoid()
                for k, i in enumerate(batch):
                    probs[i] = p[k].tolist()
        return probs

    def fit(model, collator, rs, epochs, label):
        opt = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=0.01)
        xs = examples(rs)
        tg = torch.tensor([r['targets'] for r in rs])
        mk = torch.tensor([r['mask'] for r in rs], dtype=torch.float32)
        batches = trainer.make_batches(lengths(rs), args.token_budget)
        for epoch in range(epochs):
            model.train()
            random.shuffle(batches)
            total = 0.0
            for b in batches:
                logits = model(collator([xs[i] for i in b]))
                loss = torch.nn.functional.binary_cross_entropy_with_logits(logits, tg[b], weight=mk[b], reduction='sum')
                loss = loss / mk[b].sum().clamp_min(1)
                opt.zero_grad()
                loss.backward()
                torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
                opt.step()
                total += loss.item() * len(b)
            print(f'  [{label}] epoch {epoch + 1}/{epochs} loss {total / max(1, len(rs)):.4f}', flush=True)

    rounds = []

    def record(name, model, collator, train_n, started):
        probs = score(model, collator, val_rows)
        rec = {'round': name, 'trainRows': train_n, 'seconds': round(time.time() - started, 1), 'validation': report(val_rows, probs)}
        rounds.append(rec)
        v = rec['validation']['all']
        print(f"{name}: train={train_n} auroc={v['auroc']:.3f} confNoise={v['confidentNoise']:.3f} "
              f"confAct={v['confidentActionable']:.3f} P={v['noisePrecision@0.5']:.3f} R={v['noiseRecall@0.5']:.3f}", flush=True)
        return probs

    started = time.time()
    model, collator = make_system(config, 'cpu')
    seeds = [r for r in train_rows if r['seed']]
    fit(model, collator, seeds, args.seed_epochs, 'R0 seeds')
    record('R0-seeds', model, collator, len(seeds), started)
    pool = [r for r in train_rows if not r['seed']]
    pp = score(model, collator, pool)
    # Most-agreeing first: the model already believes these labels.
    agree = [abs((1 - p[A]) - (1 - r['targets'][A])) for p, r in zip(pp, pool)]
    order = [pool[i] for i in sorted(range(len(pool)), key=lambda i: agree[i])]
    current = list(seeds)
    step = math.ceil(len(order) / args.stages)
    for k in range(args.stages):
        current += order[k * step:(k + 1) * step]
        fit(model, collator, current, args.stage_epochs, f'R{k + 1}')
        record(f'R{k + 1}-mix{k + 1}of{args.stages}', model, collator, len(current), started)
    curriculum_probs = score(model, collator, val_rows)
    save_checkpoint(out / 'curriculum.safetensors', model, config, {'domain': 'harness-noise-gate-exp', 'options': [o for o, _ in options]})

    started = time.time()
    torch.manual_seed(args.seed)
    control, ccollator = make_system(config, 'cpu')
    fit(control, ccollator, train_rows, args.seed_epochs + args.stages * args.stage_epochs, 'control')
    record('control-all-at-once', control, ccollator, len(train_rows), started)

    counts = {}
    for r in rows:
        counts.setdefault(r['split'], {}).setdefault(r['bucket'], 0)
        counts[r['split']][r['bucket']] += 1
    json.dump({'schemaVersion': 1, 'config': config, 'args': {k: v for k, v in vars(args).items() if k not in ('data_dir', 'out')},
               'options': [o for o, _ in options], 'counts': counts, 'rounds': rounds},
              open(out / 'report.json', 'w'), indent=2)
    # Private review sheet: validation rows where the final curriculum model is most unsure or disagrees.
    review = sorted(range(len(val_rows)), key=lambda i: -abs((1 - curriculum_probs[i][A]) - (1 - val_rows[i]['targets'][A])))[:60]
    with open(out / 'review-private.md', 'w', encoding='utf-8') as fh:
        fh.write('| noise score | pC | pN | label bucket | tier | text |\n|---|---|---|---|---|---|\n')
        for i in review:
            p, r = curriculum_probs[i], val_rows[i]
            text = r['text'].strip().replace('\n', ' ').replace('|', '\\|')[:80]
            rest = ' | '.join(f'{x:.2f}' for x in (p[1:] + [0.0])[:2])
            fh.write(f"| {1 - p[A]:.2f} | {rest} | {r['bucket']} | {r['tier']} | {text} |\n")


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('--data-dir', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--seed', type=int, default=0)
    ap.add_argument('--threads', type=int, default=8)
    ap.add_argument('--width', type=int, default=128)
    ap.add_argument('--layers', type=int, default=2)
    ap.add_argument('--context-tokens', type=int, default=1024)
    ap.add_argument('--token-budget', type=int, default=16384)
    ap.add_argument('--lr', type=float, default=1e-3)
    ap.add_argument('--seed-epochs', type=int, default=6)
    ap.add_argument('--stages', type=int, default=3)
    ap.add_argument('--stage-epochs', type=int, default=3)
    ap.add_argument('--rules', type=int, choices=[1, 2], default=1, help='2 adds bare directives, feedback and pointers')
    ap.add_argument('--merge-invalid', action='store_true', help='two options: actionable vs invalid')
    ap.add_argument('--labels-only', action='store_true', help='print label bucket counts and exit (no torch)')
    args = ap.parse_args(argv)
    if args.labels_only:
        here = Path(__file__).resolve().parent
        sys.path.insert(0, str(here))
        trainer = __import__('system-one-train')
        data = Path(args.data_dir)
        tiers = {r['id']: r['gold'] for r in trainer.load_jsonl(data / 'labels.jsonl')}
        for r in trainer.load_jsonl(data / 'owner-overrides.jsonl'):
            tiers[r['id']] = r['gold']
        excluded = {r['id'] for r in trainer.load_jsonl(data / 'owner-excluded.jsonl')}
        rows = label_rows(trainer.load_jsonl(data / 'prompts.jsonl'), tiers, excluded, rules=args.rules)
        counts = {}
        for r in rows:
            counts.setdefault(r['split'], {}).setdefault(r['bucket'], 0)
            counts[r['split']][r['bucket']] += 1
        print(json.dumps(counts, indent=2))
        return
    run(args)


if __name__ == '__main__':
    main()
