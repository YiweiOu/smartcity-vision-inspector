"""Run every sample image through the running platform and save the real model output.

Usage: python run_samples.py <port> <apiKey> <model> [provider]
Writes samples/outputs/<slug>.json (raw API response) and <slug>.md (report).
"""
import base64, json, os, sys, time, urllib.request

PORT = sys.argv[1]
KEY = sys.argv[2]
MODEL = sys.argv[3]

JOBS = [
    ('samples/images/fire/blocked-exit-door.jpg', 'fire', 'fire-blocked-exit'),
    ('samples/images/fire/extinguishers-blocked-by-pallet.jpg', 'fire', 'fire-extinguishers-blocked'),
    ('samples/images/fire/fire-alarm-control-panel.jpg', 'fire', 'fire-alarm-panel'),
    ('samples/images/traffic/vehicle-parked-on-sidewalk-1.jpg', 'traffic', 'traffic-sidewalk-parking'),
    ('samples/images/traffic/vehicle-parked-on-sidewalk-2.jpg', 'traffic', 'traffic-sidewalk-parking-2'),
    ('samples/images/urban-governance/street-intersection-aerial.jpg', 'publicorder', 'urban-street-intersection'),
]

CONFIG = {
    'baseURL': 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    'apiKey': KEY,
    'model': MODEL,
    'temperature': 0.2,
}

def analyze(path, task):
    with open(path, 'rb') as f:
        b64 = base64.b64encode(f.read()).decode()
    body = json.dumps({
        'image': 'data:image/jpeg;base64,' + b64,
        'config': CONFIG,
        'options': {'task': task, 'knowledgeEnhanced': True, 'topN': 6},
    }).encode()
    req = urllib.request.Request(
        f'http://127.0.0.1:{PORT}/api/analyze',
        data=body,
        headers={'Content-Type': 'application/json'},
    )
    with urllib.request.urlopen(req, timeout=300) as r:
        return json.loads(r.read().decode())

def to_markdown(slug, img, task, d):
    sev_emoji = {'high': '🔴', 'medium': '🟠', 'low': '🟡'}
    L = []
    L.append(f'# Smart City Vision Inspector — Inspection Report\n')
    L.append(f'> **Sample image:** `{img}`  ')
    L.append(f'> **Task:** {task} · **Knowledge base:** enabled · **Model:** {MODEL}\n')
    L.append('## Scene\n')
    L.append(d.get('scene', '') + '\n')
    L.append('## Overall Analysis\n')
    L.append(d.get('description', '') + '\n')
    L.append('## Findings\n')
    for i, f in enumerate(d.get('findings', []), 1):
        sev = str(f.get('severity', '')).lower()
        L.append(f"### Finding {i} | {f.get('type','')} · severity: **{sev}**\n")
        if f.get('evidence'): L.append(f"- **Evidence**: {f['evidence']}")
        if f.get('explanation'): L.append(f"- **Why it matters**: {f['explanation']}")
        if f.get('regulation'): L.append(f"- **Cited clause**: {f['regulation']}")
        L.append('')
    L.append('## Verdict\n')
    L.append(d.get('verdict', '') + '\n')
    L.append('## Remediation Plan\n')
    for i, s in enumerate(d.get('suggestions', []), 1):
        L.append(f'{i}. {s}')
    L.append('')
    u = d.get('usage') or {}
    L.append('---\n')
    L.append(f"*Risk level: **{d.get('riskLevel','')}** · Confidence: {d.get('confidence','')} · "
             f"Elapsed: {(d.get('elapsedMs',0)/1000):.1f} s · "
             f"Tokens: {u.get('total_tokens','n/a')}*")
    return '\n'.join(L) + '\n'

ok = fail = 0
for path, task, slug in JOBS:
    print(f'--- {slug} ({task}) ---', flush=True)
    try:
        d = analyze(path, task)
    except Exception as e:
        print('  FAILED:', e); fail += 1; continue
    if not d.get('ok'):
        print('  ERROR:', d.get('error')); fail += 1; continue
    d_out = dict(d)
    d_out['image'] = path
    d_out['task'] = task
    d_out['model'] = MODEL
    with open(f'samples/outputs/{slug}.json', 'w', encoding='utf-8') as f:
        json.dump(d_out, f, ensure_ascii=False, indent=2)
    with open(f'samples/outputs/{slug}.md', 'w', encoding='utf-8') as f:
        f.write(to_markdown(slug, path, task, d))
    print(f"  ok — risk={d.get('riskLevel')} findings={len(d.get('findings',[]))} "
          f"tokens={(d.get('usage') or {}).get('total_tokens')} "
          f"{(d.get('elapsedMs',0)/1000):.1f}s", flush=True)
    ok += 1
    time.sleep(2)

print(f'\nDone: {ok} ok, {fail} failed')
