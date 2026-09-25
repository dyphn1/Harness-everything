#!/usr/bin/env python3
"""Single-device RLCD fine-tuning for Laya (#255 Phase 3).

Faithful single-process port of the upstream Kaggle DDP recipe
(notebooks/laya_finetune_typed_decisions_2xT4_kaggle.ipynb, train_ddp.py):
same GRPO + soft cross-entropy objective, same calibration holdout seed,
same temperature fit, same artifact layout. Differences: no NCCL/DDP;
cuda uses fp16+scaler, mps/cpu train fp32 without a scaler.

Input is the reviewable items jsonl from system-one-export-laya.py.
Output is a loadable checkpoint dir (model.safetensors + encoder/ +
tokenizer/ + rl_agent_config.json). Heavy deps import lazily so contract
tests run on stdlib.
"""
import argparse
import json
import random
import sys
import time
from pathlib import Path

try:
    import torch
    _TORCH = True
except ImportError:
    torch = None
    _TORCH = False

CALIB_SEED = 20260922
CALIB_MAX = 400
INTENTS = ['explain', 'discuss', 'git', 'fix', 'edit', 'feature', 'refactor',
           'review', 'test', 'docs', 'plan', 'investigate']


def need_torch():
    if not _TORCH:
        raise RuntimeError('torch is required for training')


def intent_weights(intents, table):
    """Per-item loss multipliers by training intent; unlisted intents weigh 1."""
    import math  # noqa: PLC0415
    table = dict(table or {})
    for intent, weight in table.items():
        if intent not in INTENTS or not isinstance(weight, (int, float)) \
                or not math.isfinite(weight) or weight <= 0:
            raise ValueError(f'intent-weights: bad entry {intent!r}:{weight!r}')
    return [float(table.get(intent, 1.0)) for intent in intents]


def calib_split(items, seed=CALIB_SEED, frac=0.1):
    """Deterministic 10% calibration holdout, disjoint from training."""
    order = list(range(len(items)))
    random.Random(seed).shuffle(order)
    n_calib = max(1, min(CALIB_MAX, len(items) // 10 if frac == 0.1 else int(len(items) * frac)))
    calib_idx = set(sorted(order[:n_calib]))
    calib = [items[i] for i in sorted(calib_idx)]
    train = [items[i] for i in range(len(items)) if i not in calib_idx]
    return train, calib


def collate(items, pad_id):
    """Batch upstream-format items into padded tensors."""
    need_torch()
    n, max_len = len(items), max(len(it['ids']) for it in items)
    kmax = max(len(it['markers']) for it in items)
    ids = torch.full((n, max_len), pad_id, dtype=torch.long)
    att = torch.zeros((n, max_len), dtype=torch.long)
    mpos = torch.zeros((n, kmax), dtype=torch.long)
    mmask = torch.zeros((n, kmax), dtype=torch.bool)
    target = torch.zeros((n, kmax), dtype=torch.float32)
    for i, it in enumerate(items):
        ids[i, :len(it['ids'])] = torch.tensor(it['ids'])
        att[i, :len(it['ids'])] = 1
        k = len(it['markers'])
        mpos[i, :k] = torch.tensor(it['markers'])
        mmask[i, :k] = True
        target[i, :len(it['target'])] = torch.tensor(it['target'], dtype=torch.float32)
    return {'input_ids': ids, 'attention_mask': att, 'marker_pos': mpos, 'marker_mask': mmask,
            'target': target,
            'qtype': torch.tensor([it['qtype'] for it in items]),
            'label': torch.tensor([it['label'] for it in items])}


def fit_one_temp(sel):
    """Fit one temperature per question type with LBFGS (upstream recipe)."""
    need_torch()
    if len(sel) < 10:
        return 1.0
    kmax = max(len(z) for z, _ in sel)
    Z = torch.full((len(sel), kmax), -1e4)
    T = torch.zeros((len(sel), kmax))
    for i, (z, t) in enumerate(sel):
        Z[i, :len(z)] = torch.tensor(z)
        T[i, :len(t)] = torch.tensor(t, dtype=torch.float32)
    log_t = torch.zeros(1, requires_grad=True)
    opt = torch.optim.LBFGS([log_t], lr=0.1, max_iter=100)

    def closure():
        opt.zero_grad()
        loss = -(T * torch.log_softmax(Z / log_t.exp(), -1)).sum(-1).mean()
        loss.backward()
        return loss

    opt.step(closure)
    return float(torch.clamp(log_t.exp(), 0.1, 10.0).item())


def pick_device(name):
    need_torch()
    if name == 'auto':
        if torch.cuda.is_available():
            return 'cuda'
        if hasattr(torch, 'backends') and torch.backends.mps.is_available():
            return 'mps'
        return 'cpu'
    return name


def train(args):
    need_torch()
    from safetensors.torch import load_file, save_file  # noqa: PLC0415
    from transformers import AutoTokenizer  # noqa: PLC0415
    from laya.agent import _fix_tokenizer_config  # noqa: PLC0415
    from laya.common import build_model, proper_reward  # noqa: PLC0415

    device = pick_device(args.device)
    use_amp = device == 'cuda'
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    items = [json.loads(line) for line in Path(args.items).read_text(encoding='utf-8').splitlines() if line.strip()]
    train_items, calib_items = calib_split(items, seed=args.calib_seed, frac=args.calib_frac)
    weights_table = json.loads(args.intent_weights)
    intent_weights([], weights_table)  # validate early, before GPU time
    print(json.dumps({'trainItems': len(train_items), 'calibItems': len(calib_items), 'device': device,
                      'intentWeights': weights_table}), flush=True)

    from huggingface_hub import snapshot_download  # noqa: PLC0415
    model_dir = Path(snapshot_download(args.checkpoint))
    base = model_dir / args.subfolder if args.subfolder else model_dir
    _fix_tokenizer_config(str(base))
    with open(base / 'rl_agent_config.json', encoding='utf-8') as fh:
        cfg = json.load(fh)
    cfg['max_tokens_per_batch'] = 4096
    cfg['max_len'] = 1024
    cfg['head_max_len'] = 256
    tok = AutoTokenizer.from_pretrained(str(base / 'tokenizer'))
    model = build_model(cfg, encoder_dir=str(base / 'encoder'))
    model.load_state_dict(load_file(str(base / 'model.safetensors')), strict=True)
    model.encoder.gradient_checkpointing_enable(gradient_checkpointing_kwargs={'use_reentrant': False})
    model.head_checkpointing = True
    model.to(device)
    model.train()

    enc_params = [p for n, p in model.named_parameters() if 'encoder.' in n]
    head_params = [p for n, p in model.named_parameters() if 'encoder.' not in n]
    optimizer = torch.optim.AdamW([
        {'params': enc_params, 'lr': args.lr_encoder},
        {'params': head_params, 'lr': args.lr_head},
    ], weight_decay=0.01)
    updates_per_epoch = max(1, len(train_items) // (args.micro_batch * args.grad_accum))
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(
        optimizer, T_max=max(1, updates_per_epoch * args.epochs), eta_min=1e-6)
    scaler = torch.amp.GradScaler('cuda', enabled=use_amp)

    t0 = time.time()
    for epoch in range(args.epochs):
        rnd = random.Random(42 + epoch)
        rnd.shuffle(train_items)
        sigma = args.sigma_start + (args.sigma_end - args.sigma_start) * (epoch / max(1, args.epochs - 1))
        epoch_loss, n_batches = 0.0, 0
        optimizer.zero_grad(set_to_none=True)
        accum = 0
        for b in range(0, len(train_items), args.micro_batch):
            chunk = train_items[b:b + args.micro_batch]
            batch = collate(chunk, tok.pad_token_id)
            ctx = torch.amp.autocast('cuda', dtype=torch.float16) if use_amp else torch.amp.autocast('cpu', enabled=False)
            with ctx:
                logits, act = model(batch['input_ids'].to(device), batch['attention_mask'].to(device),
                                    batch['marker_pos'].to(device), batch['marker_mask'].to(device),
                                    batch['qtype'].to(device))
            logits = logits.float()
            mask = batch['marker_mask'].to(device)
            k = mask.sum(-1, keepdim=True).float()
            target = batch['target'].to(device)
            eps = torch.randn((args.group_size,) + logits.shape, device=device) * sigma * mask
            eps = (eps - eps.sum(-1, keepdim=True) / k) * mask
            z = logits.detach().unsqueeze(0) + eps
            q = torch.softmax(z.masked_fill(~mask, -1e4), -1)
            with torch.no_grad():
                r = proper_reward(q, target.unsqueeze(0), batch['qtype'].to(device), mask,
                                  w_sph=0.75, w_rps=1.0)
                adv = r - r.mean(0, keepdim=True)
                adv = adv / (adv.std() + 1e-6)
            logp = -(((z - logits.unsqueeze(0)) ** 2) * mask).sum(-1) / (2 * sigma ** 2)
            sample_w = torch.tensor(
                intent_weights([it.get('intent') for it in chunk], weights_table),
                dtype=torch.float32, device=device)
            loss_rl = (-(adv * logp).mean(0) * sample_w).mean()
            loss_ce = ((-(target * torch.log_softmax(logits.masked_fill(~mask, -1e4), -1)).sum(-1)) * sample_w).mean()
            loss = (loss_rl + loss_ce) / args.grad_accum + 0.0 * act.sum()
            scaler.scale(loss).backward()
            accum += 1
            if accum % args.grad_accum == 0 or (b + args.micro_batch) >= len(train_items):
                scaler.unscale_(optimizer)
                torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
                scaler.step(optimizer)
                scaler.update()
                scheduler.step()
                optimizer.zero_grad(set_to_none=True)
            epoch_loss += loss.item() * args.grad_accum
            n_batches += 1
            if n_batches % 50 == 0:
                print(json.dumps({'epoch': epoch + 1, 'step': n_batches,
                                  'loss': round(loss.item() * args.grad_accum, 4),
                                  'reward': round(r.mean().item(), 3)}), flush=True)
        ckpt = out_dir / 'checkpoint_latest'
        ckpt.mkdir(exist_ok=True)
        ckpt_sd = {k: v.half().contiguous().cpu() for k, v in model.state_dict().items()}
        save_file(ckpt_sd, str(ckpt / 'model.safetensors'))
        model.encoder.config.save_pretrained(str(ckpt / 'encoder'))
        tok.save_pretrained(str(ckpt / 'tokenizer'))
        (ckpt / 'checkpoint_meta.json').write_text(json.dumps(
            {'epoch': epoch + 1, 'totalEpochs': args.epochs,
             'avgLoss': epoch_loss / max(1, n_batches)}), encoding='utf-8')
        print(json.dumps({'epochDone': epoch + 1, 'avgLoss': round(epoch_loss / max(1, n_batches), 4),
                          'elapsedS': round(time.time() - t0, 1)}), flush=True)
        if device in ('cuda', 'mps'):
            getattr(torch, device).empty_cache()

    print(json.dumps({'fittingTemperatures': True}), flush=True)
    del optimizer, scaler, scheduler
    if device == 'cuda':
        torch.cuda.empty_cache()
    model.eval()
    calib_preds = []
    with torch.no_grad():
        for c in range(0, len(calib_items), 16):
            chunk = calib_items[c:c + 16]
            cb = collate(chunk, tok.pad_token_id)
            ctx = torch.amp.autocast('cuda', dtype=torch.float16) if use_amp else torch.amp.autocast('cpu', enabled=False)
            with ctx:
                l_sub, _ = model(cb['input_ids'].to(device), cb['attention_mask'].to(device),
                                 cb['marker_pos'].to(device), cb['marker_mask'].to(device),
                                 cb['qtype'].to(device))
            l_np = l_sub.float().cpu().numpy()
            for r, it in enumerate(chunk):
                k = len(it['markers'])
                calib_preds.append((it['qtype'], l_np[r, :k], it['target']))
    fitted = [1.2, 1.2, 1.2]
    try:
        for qt in range(3):
            sel = [(z, t) for q_type, z, t in calib_preds if q_type == qt]
            if sel:
                fitted[qt] = fit_one_temp(sel)
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({'temperatureFallback': str(exc)}), flush=True)
    sd = {k: v.half().contiguous().cpu() for k, v in model.state_dict().items()}
    save_file(sd, str(out_dir / 'model.safetensors'))
    model.encoder.config.save_pretrained(str(out_dir / 'encoder'))
    tok.save_pretrained(str(out_dir / 'tokenizer'))
    cfg['fine_tuned'] = True
    cfg['model_name'] = args.model_name
    cfg['temperature'] = fitted
    cfg.pop('temperature_by_options', None)
    (out_dir / 'rl_agent_config.json').write_text(json.dumps(cfg, indent=2), encoding='utf-8')
    print(json.dumps({'done': True, 'out': str(out_dir), 'temperatures': [round(t, 3) for t in fitted],
                      'elapsedS': round(time.time() - t0, 1)}), flush=True)
    return 0


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--items', required=True, help='items jsonl from system-one-export-laya.py')
    parser.add_argument('--out', required=True, help='checkpoint output dir')
    parser.add_argument('--checkpoint', default='convaiinnovations/laya')
    parser.add_argument('--subfolder', default='multilingual')
    parser.add_argument('--model-name', default='laya-harness-intent-s1')
    parser.add_argument('--device', default='auto', choices=['auto', 'cuda', 'mps', 'cpu'])
    parser.add_argument('--epochs', type=int, default=2)
    parser.add_argument('--micro-batch', type=int, default=2)
    parser.add_argument('--grad-accum', type=int, default=8)
    parser.add_argument('--group-size', type=int, default=4)
    parser.add_argument('--lr-encoder', type=float, default=2.5e-5)
    parser.add_argument('--lr-head', type=float, default=1e-4)
    parser.add_argument('--sigma-start', type=float, default=0.4)
    parser.add_argument('--sigma-end', type=float, default=0.1)
    parser.add_argument('--calib-seed', type=int, default=CALIB_SEED)
    parser.add_argument('--calib-frac', type=float, default=0.1)
    parser.add_argument('--intent-weights', default='{}', help='JSON {intent: multiplier} for loss weighting')
    args = parser.parse_args(argv)
    return train(args)


if __name__ == '__main__':
    sys.exit(main())
