/**
 * Smart City Vision Inspector
 * Backend service: vision-LLM API proxy + regulation knowledge-base retrieval augmentation
 *
 * Design notes:
 *  - The frontend sends the user's own API key to this service via a same-origin request,
 *    which then forwards it to the LLM provider. This avoids browser CORS issues and
 *    keeps the key out of third-party pages.
 *  - The knowledge base is stored as JSON on the server; retrieval scores overlap of
 *    Chinese bigrams + English tokens.
 *  - Multiple scene tasks are supported: fire hazard / security / traffic order /
 *    public order / custom.
 *  - In knowledge-enhanced mode analysis runs in two stages: first identify the scene
 *    and keywords -> retrieve relevant clauses -> ask the LLM to judge against them.
 */

const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const KB_FILE = path.join(DATA_DIR, 'knowledge.json');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

/* Safety net: uncaught exceptions and unhandled promise rejections are only
   logged — the process must never exit. Otherwise a single unexpected error
   (a 401 from the provider, say) would take the whole service down, and the
   frontend would be left with an opaque 502 or a dropped connection. */
process.on('unhandledRejection', (err) => {
  console.error('[Unhandled promise rejection]', err && err.stack ? err.stack : err);
});
process.on('uncaughtException', (err) => {
  console.error('[Uncaught exception]', err && err.stack ? err.stack : err);
});

app.use(express.json({ limit: '60mb' }));
app.use(express.static(path.join(__dirname, 'public')));

/* ----------------------------- Task definitions ----------------------------- */
/* `name` / `defaultPrompt` / `keywords` / `expert` are the Chinese prompts sent
   verbatim to the model (they cite PRC regulations), so they stay as-is;
   `labelEn` is the English display name used by the UI. */
/* Scene profiles.
   `labelEn` is what the UI shows; the rest is sent to the vision model.
   Everything here is English so that the generated report is readable by an
   international audience — the knowledge base cites PRC regulations, whose
   original Chinese names are kept alongside the English gloss. To target another
   jurisdiction, replace these prompts and the seed documents in seedScenes(). */
const TASKS = {
  fire: {
    labelEn: 'Fire Hazard Inspection',
    name: 'Fire hazard inspection',
    defaultPrompt: 'Does this scene contain any fire hazards? If so, describe each hazard in detail — its exact location, the severity of the risk, the clause it violates, and how it should be remediated.',
    keywords: 'fire hazard safety evacuation extinguisher electrical combustible obstruction blocked exit',
    expert: 'fire safety management specialist',
  },
  security: {
    labelEn: 'Security Monitoring',
    name: 'Security monitoring analysis',
    defaultPrompt: 'Does this scene contain any security risks? For example unauthorised entry, suspicious persons, equipment faults, perimeter breaches or unauthorised access.',
    keywords: 'security surveillance intrusion suspicious anomaly perimeter camera access control tailgating',
    expert: 'security surveillance analyst',
  },
  traffic: {
    labelEn: 'Traffic Order',
    name: 'Traffic order analysis',
    defaultPrompt: 'Does this traffic scene contain any order violations? For example illegal parking, congestion, road occupation, collisions, or pedestrians and cyclists running red lights.',
    keywords: 'traffic order violation parking congestion obstruction collision signal wrong-way speeding',
    expert: 'traffic management specialist',
  },
  publicorder: {
    labelEn: 'Public Order Patrol',
    name: 'Public order patrol analysis',
    defaultPrompt: 'Does this scene contain any public-order problems? For example fighting, theft, vandalism of public property, unlawful assembly or generally suspicious behaviour.',
    keywords: 'public order patrol fighting theft vandalism assembly suspicious loitering public property',
    expert: 'public order patrol specialist',
  },
  custom: {
    labelEn: 'Custom Task',
    name: 'Custom inspection task',
    defaultPrompt: 'Examine this image carefully and describe in detail what you see, together with your conclusions.',
    keywords: '',
    expert: 'image analysis specialist',
  },
};

/* ----------------------------- Model provider presets ----------------------------- */
const PROVIDERS = {
  deepseek: {
    label: 'DeepSeek',
    baseURL: 'https://api.deepseek.com',
    temperature: 0.2,
    hint: 'Get your API key at platform.deepseek.com. DeepSeek has shipped the multimodal vision model deepseek-v4-flash-vision-exp, which accepts image input (pick it whenever you need image understanding). The remaining models — deepseek-v4-pro / deepseek-v4-flash — are still text-only and cannot read images (they fail with a 400 image_url error). Other vision models work too: GLM-4V, Kimi Vision, Tencent Hunyuan hy-vision-2.0-instruct, Alibaba Qwen qwen-vl-max and more.',
    models: [
      { id: 'deepseek-v4-flash-vision-exp', label: 'DeepSeek-V4-Flash-Vision-Exp (vision · multimodal · new)', vision: true },
      { id: 'deepseek-v4-pro', label: 'DeepSeek-V4 Pro (text-only · reasoning, cannot read images)', vision: false },
      { id: 'deepseek-v4-flash', label: 'DeepSeek-V4 Flash (text-only, cannot read images)', vision: false },
    ],
  },
  kimi: {
    label: 'Kimi (Moonshot)',
    baseURL: 'https://api.moonshot.cn/v1',
    temperature: 1,
    hint: 'Get your API key at platform.moonshot.cn. Users in mainland China should use https://api.moonshot.cn/v1 (https://api.moonshot.ai/v1 is available overseas). Do not use https://api.kimi.com/coding/v1 — that endpoint is reserved for the Kimi CLI / coding product and rejects ordinary HTTP requests. Some Kimi vision models (kimi-k2.6, for example) strictly require temperature=1, which this platform sets by default.',
    models: [
      { id: 'kimi-k3', label: 'Kimi K3 (vision / video, recommended)', vision: true },
      { id: 'kimi-k2.6', label: 'Kimi K2.6 (vision)', vision: true },
      { id: 'kimi-k2.5', label: 'Kimi K2.5 (vision)', vision: true },
      { id: 'kimi-k2.7-code', label: 'Kimi K2.7 Code (vision)', vision: true },
      { id: 'kimi-k2.7-code-highspeed', label: 'Kimi K2.7 Code Turbo (vision)', vision: true },
      { id: 'moonshot-v1-8k-vision-preview', label: 'Moonshot-V1 8K Vision', vision: true },
      { id: 'moonshot-v1-32k-vision-preview', label: 'Moonshot-V1 32K Vision', vision: true },
      { id: 'moonshot-v1-128k-vision-preview', label: 'Moonshot-V1 128K Vision', vision: true },
      { id: 'moonshot-v1-8k', label: 'Moonshot-V1 8K (text-only)', vision: false },
      { id: 'moonshot-v1-32k', label: 'Moonshot-V1 32K (text-only)', vision: false },
      { id: 'moonshot-v1-128k', label: 'Moonshot-V1 128K (text-only)', vision: false },
    ],
  },
  glm: {
    label: 'GLM (Zhipu)',
    baseURL: 'https://open.bigmodel.cn/api/paas/v4',
    // Newer multimodal models such as GLM-5.3-Flash reject low temperature
    // values (0.2 is refused outright by the gateway), so this provider
    // defaults to 1; users can still set another value manually in the UI.
    temperature: 1,
    hint: 'Get your API key at open.bigmodel.cn. For image understanding pick the GLM-4V series and mind the casing of model names (e.g. GLM-4V-Flash). GLM-5.3-Flash and other new-generation multimodal models only accept temperature=1, so this provider defaults to 1 (override it manually in the UI if you need something else).',
    models: [
      { id: 'glm-5.3-flash', label: 'GLM-5.3-Flash (vision / multimodal · new)', vision: true },
      { id: 'glm-4v-plus', label: 'GLM-4V-Plus (vision, recommended)', vision: true },
      { id: 'glm-4v', label: 'GLM-4V (vision)', vision: true },
      { id: 'GLM-4V-Flash', label: 'GLM-4V-Flash (vision, free tier)', vision: true },
      { id: 'glm-4.7', label: 'GLM-4.7 (vision)', vision: true },
      { id: 'glm-4-plus', label: 'GLM-4-Plus (text)', vision: false },
      { id: 'glm-4-air', label: 'GLM-4-Air (text)', vision: false },
      { id: 'glm-4-flash', label: 'GLM-4-Flash (text)', vision: false },
    ],
  },
  hunyuan: {
    label: 'Tencent Hunyuan',
    baseURL: 'https://tokenhub.tencentmaas.com/v1',
    temperature: 0.2,
    hint: 'Tencent Hunyuan has fully migrated to "TokenHub", the Tencent Cloud LLM service platform (console.cloud.tencent.com/tokenhub). Activate it there and get an API key (prefixed with "sk-"); its OpenAI-compatible gateway is fixed at https://tokenhub.tencentmaas.com/v1. For vision / image understanding use hy-vision-2.0-instruct / hunyuan-vision-1.5-instruct / hunyuan-t1-vision-20250916; for text use hunyuan-2.0-instruct / hunyuan-2.0-thinking. Note: the legacy "direct" gateway (api.hunyuan.cloud.tencent.com) and the legacy models are retired on 2026-09-30 — do not use them; Hunyuan 2.0 text models do not accept images, so pick a vision-series model for image input.',
    models: [
      { id: 'hy-vision-2.0-instruct', label: 'hy-vision-2.0-instruct (vision · image understanding, recommended)', vision: true },
      { id: 'hunyuan-vision-1.5-instruct', label: 'hunyuan-vision-1.5-instruct (vision)', vision: true },
      { id: 'hunyuan-t1-vision-20250916', label: 'hunyuan-t1-vision-20250916 (vision · reasoning)', vision: true },
      { id: 'hunyuan-turbos-vision-video-20250728', label: 'hunyuan-turbos-vision-video (video understanding)', vision: true },
      { id: 'hunyuan-2.0-instruct-20251111', label: 'hunyuan-2.0-instruct (text)', vision: false },
      { id: 'hunyuan-2.0-thinking-20251109', label: 'hunyuan-2.0-thinking (text · reasoning)', vision: false },
      { id: 'deepseek-v3.2', label: 'deepseek-v3.2 (text · via TokenHub)', vision: false },
      { id: 'glm-5', label: 'glm-5 (text · via TokenHub)', vision: false },
    ],
  },
  qwen: {
    label: 'Alibaba Qwen',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    temperature: 0.2,
    hint: 'Activate the service and get your API key on the Alibaba Cloud Model Studio platform (dashscope.console.aliyun.com). Its OpenAI-compatible gateway is https://dashscope.aliyuncs.com/compatible-mode/v1. Use qwen-vl-max / qwen-vl-plus for vision; qwen-max / qwen-plus / qwen-turbo / qwen-long for text. New accounts get a free quota (for example 1,000 calls/month for qwen-vl-plus and 1M tokens/month for qwen-turbo, valid indefinitely). Click "Fetch Model List from Provider" to see the models actually available on your account.',
    models: [
      { id: 'qwen-vl-max', label: 'qwen-vl-max (vision · image understanding, recommended)', vision: true },
      { id: 'qwen-vl-plus', label: 'qwen-vl-plus (vision)', vision: true },
      { id: 'qwen-vl-max-latest', label: 'qwen-vl-max-latest (vision · latest)', vision: true },
      { id: 'qwen3-vl-flash', label: 'qwen3-vl-flash (vision · fast)', vision: true },
      { id: 'qwen3-vl-flash-2025-10-15', label: 'qwen3-vl-flash-2025-10-15 (vision · fast)', vision: true },
      { id: 'qwen3-vl-plus', label: 'qwen3-vl-plus (vision)', vision: true },
      { id: 'qwen2.5-vl-max', label: 'qwen2.5-vl-max (vision)', vision: true },
      { id: 'qwen-vl-max-2025-05-10', label: 'qwen-vl-max-2025-05-10 (vision)', vision: true },
      { id: 'qwen-max', label: 'qwen-max (text)', vision: false },
      { id: 'qwen-plus', label: 'qwen-plus (text)', vision: false },
      { id: 'qwen-turbo', label: 'qwen-turbo (text · fast)', vision: false },
      { id: 'qwen-long', label: 'qwen-long (text · long context)', vision: false },
    ],
  },
  openai: {
    label: 'OpenAI-compatible',
    baseURL: 'https://api.openai.com/v1',
    temperature: 0.2,
    hint: 'Any gateway that speaks the OpenAI /v1/chat/completions protocol will work.',
    models: [
      { id: 'gpt-4o', label: 'GPT-4o (vision)', vision: true },
      { id: 'gpt-4o-mini', label: 'GPT-4o-mini (vision)', vision: true },
      { id: 'gpt-4-turbo', label: 'GPT-4 Turbo (vision)', vision: true },
      { id: 'gpt-4', label: 'GPT-4 (text)', vision: false },
      { id: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo (text)', vision: false },
      { id: '__custom__', label: 'Custom model name…', vision: true, custom: true },
    ],
  },
  custom: {
    label: 'Custom Gateway',
    baseURL: '',
    temperature: 0.2,
    hint: 'Enter your own gateway URL and model name.',
    models: [{ id: '__custom__', label: 'Custom model name…', vision: true, custom: true }],
  },
};

// Default provider dropdown order: GLM → Kimi → Tencent Hunyuan → Alibaba Qwen → DeepSeek → OpenAI → Custom
const PROVIDER_ORDER = ['glm', 'kimi', 'hunyuan', 'qwen', 'deepseek', 'openai', 'custom'];

app.get('/api/providers', (req, res) => {
  const ordered = {};
  PROVIDER_ORDER.forEach((k) => { if (PROVIDERS[k]) ordered[k] = PROVIDERS[k]; });
  res.json({ providers: ordered, tasks: TASKS });
});
app.get('/api/health', (req, res) => res.json({ ok: true, time: Date.now() }));

/* Fetch the real model list from the provider (direct call with the user's own
   API key, so what you see really is what you get) */
app.post('/api/models', async (req, res) => {
  try {
    const { baseURL, apiKey } = req.body || {};
    if (!baseURL || !apiKey) return res.status(400).json({ error: 'Enter the endpoint URL and your API key first' });
    const base = normalizeBaseURL(baseURL);
    const url = base + '/models';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const r = await fetch(url, { signal: controller.signal, headers: { Authorization: 'Bearer ' + apiKey } });
      if (!r.ok) {
        const t = await r.text();
        return res.status(r.status).json({ error: 'Failed to fetch: ' + t.slice(0, 300) });
      }
      const d = await r.json();
      const ids = (d.data || []).map((m) => (typeof m === 'string' ? m : m.id)).filter(Boolean);
      res.json({ ok: true, models: ids });
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch the model list: ' + e.message });
  }
});

/* Connectivity test proxied through the server: a direct browser call to the
   provider is blocked by CORS (which surfaces as "Failed to fetch"), so every
   request is relayed by the local service and the provider's real error is
   handed back to the frontend. */
app.post('/api/test', async (req, res) => {
  try {
    const { baseURL, apiKey, model } = req.body || {};
    if (!baseURL || !apiKey || !model) return res.status(400).json({ ok: false, error: 'Enter the endpoint URL, API key and model name first' });
    const base = normalizeBaseURL(baseURL);
    const url = base + '/chat/completions';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);
    try {
      const r = await fetch(url, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
        body: JSON.stringify({ model, messages: [{ role: 'user', content: 'Reply ok' }], max_tokens: 8 }),
      });
      // Note: r.ok alone is not enough — some gateways reject a request with
      // 200 + an HTML error page, which would report a successful connection
      // while any real image analysis would certainly fail. The response body
      // is therefore validated as JSON.
      let ok = false, detail = '';
      if (r.ok) {
        try {
          const j = await readJSONResponse(r);
          ok = !!(j && Array.isArray(j.choices));
          if (!ok) detail = 'The response body is not a valid chat completion: ' + JSON.stringify(j).slice(0, 200);
        } catch (e) {
          detail = e.message;
        }
      } else {
        detail = await r.text().catch(() => '');
      }
      if (ok) return res.json({ ok: true });
      const t = (detail || '').replace(/\s+/g, ' ').slice(0, 300);
      let hint = '';
      if (/invalid_api_key|Incorrect API key|401/i.test(t) && /tokenhub\.tencentmaas\.com/.test(base)) {
        hint = ' Tip: Hunyuan has moved to Tencent Cloud TokenHub. Get your key from console.cloud.tencent.com/tokenhub (prefixed with "sk-"), and check that it is correct and that the model service is activated.';
      }
      if (/<html|<!doctype|Bad Gateway|Service Temporarily|nginx/i.test(t)) {
        hint = ' Tip: the endpoint returned a gateway HTML error page instead of a model response. Check that baseURL is correct (for Kimi use https://api.moonshot.cn/v1, not api.kimi.com/coding/v1).';
      }
      res.status(r.ok ? 502 : r.status).json({ ok: false, error: 'Connection failed: ' + t + hint });
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    res.status(500).json({ ok: false, error: 'Connection failed: ' + e.message });
  }
});

/* ------------------------------- Knowledge base storage ------------------------------- */
function loadKB() {
  try {
    const arr = JSON.parse(fs.readFileSync(KB_FILE, 'utf8'));
    if (!Array.isArray(arr)) return null;
    // Re-chunk on load so chunker improvements always apply to persisted data
    return arr.map((d) => {
      const text = (d.text || (d.chunks || []).map((c) => c.text).join('\n')).trim();
      return { ...d, text, chunks: chunkText(text) };
    });
  } catch {
    return null;
  }
}

function saveKB() {
  fs.writeFileSync(KB_FILE, JSON.stringify(knowledge, null, 2));
}

/* Seed clause texts are domain content in Chinese (they reference PRC codes and
   standards) and are written verbatim into the knowledge base — do not translate. */
function seedScenes() {
  return {
    fire: `1. Evacuation routes and exits: evacuation routes and emergency exits must be kept clear at all times; occupying, blocking or sealing them is strictly prohibited. Exit doors must open in the direction of travel and must not be fitted with thresholds or screens. [Fire Protection Law of the PRC (《中华人民共和国消防法》), Art. 28]
2. Fire extinguishers: extinguishers must be provided and maintained per GB 50140 Code for design of extinguisher distribution in buildings (《建筑灭火器配置设计规范》). Pressure gauges and expiry dates must be checked periodically; units must not be removed, obstructed or corroded.
3. Electrical safety: wiring must be protected by conduit and installed properly. Unauthorised connections and overloaded circuits are prohibited. No combustible material may be stacked around distribution boards or cabinets, which must carry warning signs. [GB/T 13869 General guide for safety of electric user (《用电安全导则》)]
4. Flammable and explosive materials: such materials must be stored separately in dedicated stores away from ignition and heat sources, with ventilation, explosion-proof, lightning-protection and anti-static provisions; incompatible materials must never be co-stored.
5. Fire control room: must be staffed 24 hours a day by certified operators, with complete duty logs and equipment in normal working order.
6. Hot work: hot work requires a permit, a designated supervisor, extinguishers on hand and site clearance; the area must be confirmed free of ignition sources afterwards.
7. Emergency lighting and exit signage: exit signs and emergency lighting must be intact, correctly oriented, unobstructed and functional on power loss.
8. Fire compartmentation: normally-closed fire doors must remain closed and must not be wedged open; fire walls and fire shutters must not be damaged or removed.
9. Fire service access: fire lanes and fire-service access areas must never be occupied, blocked or obstructed, and must maintain the required clear width and height.
10. Key-area inspection: distribution rooms, kitchens, warehouses, workshops and basements must be inspected daily with records retained.`,
    security: `1. Perimeter and access control: fences, railings and access-control systems must be intact with no damage or signs of climbing; entrances must enforce visitor registration and identity verification.
2. Video surveillance: cameras must cover the area with no blind spots and no obstruction; retention must meet requirements (generally no less than 30 days) and timestamps must be accurate.
3. Suspicious persons and behaviour: tailgating, loitering, climbing, lock-picking or impersonation must trigger an alert and be investigated.
4. Protection of critical areas: finance offices, server rooms, warehouses and archives require dual-custody locks and intact anti-theft doors and windows.
5. Key and permission management: access cards and keys must be held by designated staff, audited periodically, and revoked promptly when staff leave.
6. Night-time and unattended areas: night lighting, infrared beams and intrusion alarms must be functional; unattended areas must be patrolled regularly.
7. Control room duty: the monitoring centre must be staffed 24 hours a day, with alarms handled, logged and closed out.
8. Security/fire integration: the security system must interlink with the fire alarm so incidents remain traceable.`,
    traffic: `1. Signal compliance: vehicles and pedestrians must obey traffic lights, signs and markings; running red lights and driving the wrong way are strictly prohibited. [Road Traffic Safety Law of the PRC (《中华人民共和国道路交通安全法》)]
2. Illegal parking: motor vehicles must park orderly within marked bays and must not occupy fire lanes, tactile paving for the blind, intersections or crosswalks. [Road Traffic Safety Law of the PRC (《中华人民共和国道路交通安全法》), Art. 56]
3. Road occupation: setting up stalls or stacking goods on carriageways or footways so as to obstruct passage is strictly prohibited. [Road Traffic Safety Law of the PRC (《中华人民共和国道路交通安全法》), Art. 31]
4. Pedestrians and non-motorised vehicles: pedestrians must use the footway and cross at zebra crossings; cyclists must use cycle lanes, not ride against traffic and not carry passengers unlawfully.
5. Congestion and flow: junctions and the areas around schools and hospitals must be kept clear to avoid prolonged congestion.
6. Road furniture: traffic signs, markings, guardrails and signals must be intact and legible, with defects repaired promptly.
7. Stop order: areas around bus and school-bus stops must remain orderly, with no prolonged kerb occupation for boarding or alighting.
8. Incidents and hazards: collisions, breakdowns and fallen objects must be dealt with or reported immediately, with warning measures put in place.`,
    publicorder: `1. Fighting and assault: physical altercations and armed stand-offs must be stopped immediately and reported to the police. [Public Security Administration Punishment Law of the PRC (《中华人民共和国治安管理处罚法》), Art. 43]
2. Theft and pickpocketing: watch for tailing, lock-picking, window-climbing and bag-snatching; increase patrols during high-risk periods. [Public Security Administration Punishment Law of the PRC (《中华人民共和国治安管理处罚法》), Art. 49]
3. Damage to public property: damaging street lights, guardrails, benches, walls or utility lines is prohibited; report defects for repair promptly. [Public Security Administration Punishment Law of the PRC (《中华人民共和国治安管理处罚法》), Art. 49]
4. Unlawful assembly: noisy gatherings, blockades and distribution of prohibited materials must be dispersed and reported. [Public Security Administration Punishment Law of the PRC (《中华人民共和国治安管理处罚法》), Art. 23]
5. Suspicious items: unattended bags and parcels must be treated as suspicious, must not be moved, and must be reported to specialists.
6. Street vending and begging: vending must be confined to designated areas; setting up stalls on carriageways, footways or near entrances that obstruct passage or gather crowds is prohibited. [Urban Appearance and Environmental Sanitation Administration Regulations (《城市市容和环境卫生管理条例》), Art. 14; Road Traffic Safety Law of the PRC (《中华人民共和国道路交通安全法》), Art. 31]
7. Priority locations: increase patrol density and joint response around plazas, stations, commercial districts and campuses.
8. Night-time safety: back alleys, underground car parks and isolated roads must have lighting and camera coverage to deter property crime.`,
  };
}

function buildSeedDocs() {
  const defs = {
    fire: 'Fire safety — general reference clauses (sample)',
    security: 'Security monitoring — general reference clauses (sample)',
    traffic: 'Traffic order — general reference clauses (sample)',
    publicorder: 'Public order patrol — general reference clauses (sample)',
  };
  const sc = seedScenes();
  return Object.entries(defs).map(([scene, name]) => {
    const text = sc[scene];
    return {
      id: 'seed-' + scene,
      name,
      type: 'seed',
      scene,
      size: text.length,
      chunks: chunkText(text),
      createdAt: Date.now(),
      seed: true,
    };
  });
}

let knowledge = loadKB();
if (knowledge === null) knowledge = [];
// Drop legacy sample docs with random ids so they don't duplicate the new stable-id seeds
knowledge = knowledge.filter((d) => !(d.seed && !String(d.id).startsWith('seed-')));
// Make sure the base seed knowledge base exists for every scene (idempotent; user-added entries are never overwritten)
const seedIds = new Set(knowledge.map((d) => d.id));
buildSeedDocs().forEach((s) => { if (!seedIds.has(s.id)) knowledge.push(s); });
saveKB();

/* ------------------------------- Text chunking ------------------------------- */
function chunkText(text, size = 600, overlap = 80) {
  text = (text || '').replace(/\r\n/g, '\n').trim();
  if (!text) return [];
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const chunks = [];
  // Multi-line documents (e.g. clause lists) -> one chunk per line so each
  // clause is retrieved independently. Long single lines are hard-split.
  if (lines.length > 1) {
    for (const line of lines) {
      if (line.length <= size) {
        chunks.push({ text: line });
        continue;
      }
      let i = 0;
      while (i < line.length) {
        const end = Math.min(i + size, line.length);
        chunks.push({ text: line.slice(i, end) });
        if (end === line.length) break;
        i = Math.max(end - overlap, i + 1);
      }
    }
    return chunks;
  }
  // Single block of text -> size-based sliding window with overlap
  let i = 0;
  while (i < text.length) {
    const end = Math.min(i + size, text.length);
    chunks.push({ text: text.slice(i, end) });
    if (end === text.length) break;
    i = Math.max(end - overlap, i + 1);
  }
  return chunks;
}

/* --------------------------- Chinese tokenization / retrieval --------------------------- */
function tokenize(text) {
  const tokens = new Set();
  const s = (text || '').replace(/\s+/g, '');
  for (let i = 0; i < s.length - 1; i++) {
    const a = s[i];
    const b = s[i + 1];
    if (/[一-鿿]/.test(a) && /[一-鿿]/.test(b)) tokens.add(a + b);
  }
  const words = (text.toLowerCase().match(/[a-z0-9]+/g) || []);
  words.forEach((w) => tokens.add(w));
  return tokens;
}

function overlapScore(qTok, cTok) {
  let hit = 0;
  cTok.forEach((t) => {
    if (qTok.has(t)) hit++;
  });
  if (hit === 0) return 0;
  return hit / Math.sqrt(cTok.size || 1);
}

function retrieve(query, topN = 8, scene = 'all') {
  if (!knowledge.length) return [];
  const qTok = tokenize(query);
  if (qTok.size === 0) return [];
  const scored = [];
  for (const doc of knowledge) {
    const ds = doc.scene || 'all';
    if (scene !== 'all' && ds !== scene && ds !== 'all') continue;
    for (const c of doc.chunks) {
      const score = overlapScore(qTok, tokenize(c.text));
      if (score > 0) scored.push({ doc: doc.name, scene: ds, text: c.text, score });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topN);
}

/* ------------------------------ Model invocation ------------------------------ */
function normalizeBaseURL(base) {
  base = (base || '').replace(/\/+$/, '');
  if (!base) return '';
  if (/\/v\d+$/i.test(base)) return base;
  return base + '/v1';
}

const UA = 'SmartCity-Vision-Inspector/1.0 (+node-fetch)';

/* Parse the response body as JSON, safely.
   Many gateways (nginx / CDN / WAF) return an HTML error page when they reject a
   request, so calling resp.json() directly throws an unreadable
   "Unexpected token '<', "<html>..." error. Read the text first and parse it
   here; on failure report the status code, Content-Type, final URL and page
   title so the cause is obvious at a glance. */
async function readJSONResponse(resp) {
  const ctype = (resp.headers && resp.headers.get('content-type')) || '';
  const text = await resp.text();
  if (!text || !text.trim()) {
    throw new Error('Upstream returned an empty response body (HTTP ' + resp.status + ', Content-Type: ' + (ctype || 'empty') + ')');
  }
  if (!/json/i.test(ctype)) {
    const titleM = text.match(/<title>([^<]{0,120})<\/title>/i);
    const title = titleM ? '"' + titleM[1].trim() + '"' : '';
    const finalUrl = resp.url ? ', final URL ' + resp.url : '';
    throw new Error(
      'Upstream did not return JSON (HTTP ' + resp.status + ', Content-Type: ' + ctype + finalUrl + ')' + title +
      ': ' + text.replace(/\s+/g, ' ').slice(0, 200)
    );
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error('Upstream response is not valid JSON (HTTP ' + resp.status + '): ' + text.replace(/\s+/g, ' ').slice(0, 200));
  }
}

/* Single request: return the result object, or throw an error with context */
async function requestOnce(url, apiKey, payload, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || 120000);
  try {
    const resp = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': UA,
        Authorization: 'Bearer ' + apiKey,
      },
      body: JSON.stringify(payload),
    });
    const data = await readJSONResponse(resp);
    if (!resp.ok) {
      const errMsg = (data && (data.error?.message || data.msg || data.message)) || '';
      throw new Error('Model returned ' + resp.status + ': ' + (errMsg || JSON.stringify(data).slice(0, 300)));
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

/* Call the model.
   Fallback ladder (only continues when the failure looks like a rejected
   parameter / gateway-level rejection):
     1) request exactly as configured
     2) force temperature = 1 (newer models such as GLM-5.3-Flash reject low values)
     3) omit temperature altogether (defer to the provider default)
   Every step surfaces the real last error, so no diagnostic detail is lost. */
async function callLLM(config, messages) {
  const base = normalizeBaseURL(config.baseURL);
  if (!base) throw new Error('Missing baseURL');
  const url = base + '/chat/completions';
  const timeoutMs = config.timeout || 120000;

  const attempts = [];
  const t = config.temperature;
  if (t != null && Number.isFinite(Number(t))) attempts.push({ tag: 'temperature=' + t, temperature: Number(t) });
  if (!(t != null && Math.abs(Number(t) - 1) < 1e-9)) attempts.push({ tag: 'temperature=1', temperature: 1 });
  attempts.push({ tag: 'no temperature', temperature: undefined });

  let lastErr = null;
  for (let i = 0; i < attempts.length; i++) {
    const a = attempts[i];
    const payload = { model: config.model, messages };
    if (a.temperature !== undefined) payload.temperature = a.temperature;
    try {
      const data = await requestOnce(url, config.apiKey, payload, timeoutMs);
      const content = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
      return { content, usage: data.usage || null };
    } catch (e) {
      lastErr = e;
      const m = String(e.message || e);
      // Only retry with degraded parameters on parameter / gateway rejections;
      // authentication, balance and moderation errors are thrown straight away —
      // retrying those is pointless. The Chinese alternatives are kept because
      // third-party gateways may still answer in Chinese.
      const retriable = /temperature|top_p|sampling|invalid_request|not supported|upstream|did not return JSON|empty response|参数|不支持|未返回 JSON|返回空响应|上游/i.test(m)
        && !/(401|403|402|429)|Invalid Authentication|Incorrect API key|invalid_api_key|quota|Insufficient Balance|余额/i.test(m);
      if (!retriable || i === attempts.length - 1) {
        if (i > 0) console.warn('[callLLM] Failed after ' + (i + 1) + ' parameter sets; last error: ' + m);
        throw e;
      }
      console.warn('[callLLM] Attempt ' + (i + 1) + ' (' + a.tag + ') failed, retrying with degraded parameters: ' + m.slice(0, 200));
    }
  }
  throw lastErr || new Error('Failed to call the model');
}

/* ------------------------------- Prompts ------------------------------- */
function scenePrompt(taskKey) {
  const t = TASKS[taskKey] || TASKS.custom;
  return (
    'Identify the scene in this image, then list the focus keywords relevant to "' + t.name + '" for this kind of scene (8-15, comma separated).\n' +
    'Output format (no explanation):\nScene: <place / scene name>\nKeywords: <keyword1,keyword2,...>\n' +
    'Example: Scene: industrial warehouse\nKeywords: combustible storage, electrical wiring, evacuation route, fire extinguisher, obstructed passage'
  );
}

function systemPrompt(taskKey, userPrompt, kbText) {
  const t = TASKS[taskKey] || TASKS.custom;
  return (
    'You are a senior ' + t.expert + ' working with the "Smart City Vision Inspector" urban inspection system.\n' +
    'The user\'s question is: "' + userPrompt + '"\n' +
    'Using the image content and your professional expertise, provide a thorough, professional and structured analysis.\n\n' +
    'Output requirements (respond STRICTLY in this JSON format, with no other text):\n' +
    '{\n' +
    '  "scene": "description of the scene",\n' +
    '  "description": "overall analysis in Markdown, covering the key details observed and how the area is laid out",\n' +
    '  "findings": [\n' +
    '    {"type":"hazard / issue type", "severity":"high|medium|low", "evidence":"visual evidence observed in the image", "explanation":"why this is a risk", "regulation":"the applicable regulation / standard / clause (optional)"}\n' +
    '  ],\n' +
    '  "verdict": "a one-sentence overall judgement",\n' +
    '  "suggestions": ["actionable recommendation 1", "actionable recommendation 2"],\n' +
    '  "confidence": 0.0 to 1.0\n' +
    '}\n\n' +
    'Notes:\n' +
    '- Write the entire response in English. Keep regulation names in their original form and add a short English gloss, e.g. "Fire Protection Law of the PRC (《中华人民共和国消防法》), Art. 28".\n' +
    '- If the image is clear and problems are evident, be specific about location, objects and behaviour. If no problem is found, "findings" may be empty and "verdict" should state that the scene is safe / normal.\n' +
    '- Draw on both the supplied knowledge-base clauses and your own professional judgement.\n' +
    (kbText && kbText.trim()
      ? '\n[Relevant clauses from the knowledge base (for citation)]\n' + kbText + '\n[End of knowledge base]\n'
      : '\n(No knowledge base enabled, or it is empty — analyse against general professional standards and your own knowledge.)\n')
  );
}

/* ----------------------------- Parsing the verdict ----------------------------- */
function parseVerdict(text) {
  if (!text) {
    return { scene: '', description: '', findings: [], verdict: 'Analysis failed', suggestions: [], confidence: 0, raw: text, parseError: true };
  }
  let jsonStr = text.trim();
  const fence = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) jsonStr = fence[1].trim();
  const start = jsonStr.indexOf('{');
  const end = jsonStr.lastIndexOf('}');
  if (start >= 0 && end > start) jsonStr = jsonStr.slice(start, end + 1);
  try {
    const o = JSON.parse(jsonStr);
    const findings = Array.isArray(o.findings)
      ? o.findings
      : Array.isArray(o.hazards)
        ? o.hazards.map((h) => ({ type: h.type, severity: h.severity, evidence: '', explanation: h.description, regulation: h.regulation }))
        : [];
    return {
      scene: o.scene || '',
      description: o.description || '',
      findings,
      verdict: o.verdict || 'Issues / hazards detected',
      suggestions: Array.isArray(o.suggestions) ? o.suggestions : [],
      confidence: typeof o.confidence === 'number' ? o.confidence : 0,
      raw: text,
      parseError: false,
    };
  } catch (e) {
    return { scene: '', description: '', findings: [], verdict: 'Analysis failed', suggestions: [], confidence: 0, raw: text, parseError: true };
  }
}

/* Aggregate token usage across model calls; returns null when a gateway omits usage */
function mergeUsage(usages) {
  if (!usages || !usages.length) return null;
  let prompt = 0, completion = 0, total = 0;
  usages.forEach((u) => {
    prompt += (u.prompt_tokens || 0);
    completion += (u.completion_tokens || 0);
    total += (u.total_tokens || ((u.prompt_tokens || 0) + (u.completion_tokens || 0)));
  });
  return { prompt_tokens: prompt, completion_tokens: completion, total_tokens: total };
}

/* Derive the authoritative risk level from finding severities rather than from the
   verdict text alone, which is easy to misread */
function computeRisk(findings) {
  const sevs = (findings || []).map((f) => String(f.severity || '').toLowerCase());
  if (sevs.includes('high') || sevs.includes('medium')) return 'danger';
  if (sevs.includes('low')) return 'warn';
  // Findings exist but the severity was not recognized: report "needs attention"
  // conservatively rather than missing it as "safe"
  if ((findings || []).length) return 'warn';
  return 'safe';
}

/* ------------------------------ Analysis endpoint ------------------------------ */
app.post('/api/analyze', async (req, res) => {
  try {
    const { image, config, options } = req.body || {};
    if (!image) return res.status(400).json({ error: 'Missing image data' });
    // Size guard: when the request body is too large, the cloud gateway (nginx)
    // returns an HTML 502/503 page before the request ever reaches the app, and
    // the frontend blows up on res.json() with an untraceable
    // "Unexpected token '<'" error. Intercept it here and return actionable
    // guidance. The frontend already compresses by default — this is a backstop.
    const imgBytes = Buffer.byteLength(String(image), 'utf8');
    if (imgBytes > 4 * 1024 * 1024) {
      return res.status(413).json({
        error: 'The image data is too large (about ' + (imgBytes / 1024 / 1024).toFixed(1) + ' MB) and may be blocked outright by the cloud gateway. ' +
          'Please re-select the image in the page (the frontend compresses it to a safe size automatically), or resize it locally before uploading.',
      });
    }
    if (!config || !config.apiKey || !config.baseURL || !config.model) {
      return res.status(400).json({ error: 'Complete the model configuration in the page first (provider / model / API key)' });
    }

    const opts = options || {};
    const taskKey = opts.task || 'fire';
    const userPrompt = (opts.prompt || TASKS[taskKey]?.defaultPrompt || TASKS.custom.defaultPrompt).trim();
    let finalText;
    let usedKnowledge = false;
    let retrievedClauses = [];
    const t0 = Date.now();
    const usages = [];

    if (opts.knowledgeEnhanced && knowledge.length) {
      const sceneRes = await callLLM(config, [
        { role: 'user', content: [{ type: 'image_url', image_url: { url: image } }, { type: 'text', text: scenePrompt(taskKey) }] },
      ]);
      if (sceneRes.usage) usages.push(sceneRes.usage);
      const sceneInfo = sceneRes.content;
      const task = TASKS[taskKey] || TASKS.custom;
      const query = sceneInfo + ' ' + (opts.focus || '') + ' ' + task.keywords;
      const ctx = retrieve(query, opts.topN || 8, taskKey);
      retrievedClauses = ctx.map((c) => ({ doc: c.doc, text: c.text, score: c.score }));
      const kbText = ctx.map((c) => '【' + c.doc + '】\n' + c.text).join('\n\n');
      usedKnowledge = ctx.length > 0;
      const finalRes = await callLLM(config, [
        { role: 'system', content: systemPrompt(taskKey, userPrompt, kbText) },
        { role: 'user', content: [{ type: 'image_url', image_url: { url: image } }, { type: 'text', text: userPrompt }] },
      ]);
      if (finalRes.usage) usages.push(finalRes.usage);
      finalText = finalRes.content;
    } else {
      const finalRes = await callLLM(config, [
        { role: 'system', content: systemPrompt(taskKey, userPrompt, '') },
        { role: 'user', content: [{ type: 'image_url', image_url: { url: image } }, { type: 'text', text: userPrompt }] },
      ]);
      if (finalRes.usage) usages.push(finalRes.usage);
      finalText = finalRes.content;
    }

    const parsed = parseVerdict(finalText);
    const elapsedMs = Date.now() - t0;
    const usage = mergeUsage(usages);
    res.json({ ok: true, usedKnowledge, retrievedClauses, elapsedMs, usage, riskLevel: computeRisk(parsed.findings), ...parsed });
  } catch (e) {
    // Note: the catch block must not reference `config`, which is destructured
    // with const inside the try block — once the provider returns a 401 this
    // would throw a ReferenceError, Express would never receive a response, and
    // on Node 22 the unhandled rejection would kill the whole process. Read it
    // from req.body instead and guard against nulls.
    const cfg = (req.body && req.body.config) || {};
    let msg = e.message || 'Analysis failed';
    if (/image_url|unknown variant|vision|multimodal|expected.*text/i.test(msg)) {
      msg += '. Tip: the current model does not support image input. DeepSeek V4 is a text-only model and cannot read images; switch to a model marked "vision" / "Vision", such as glm-4v-plus, kimi-k3, hy-vision-2.0-instruct, qwen-vl-max or GPT-4o. Click "Fetch Model List from Provider" to see the models actually available on your account.';
    }
    if (/invalid_api_key|Incorrect API key|401/i.test(msg) && /tokenhub\.tencentmaas\.com/.test(cfg.baseURL || '')) {
      msg += '. Tip: Hunyuan has moved to Tencent Cloud TokenHub. Get your key from console.cloud.tencent.com/tokenhub (prefixed with "sk-"), and check that it is correct and that the model service is activated.';
    }
    if (/did not return JSON|empty response|未返回 JSON|返回空响应/i.test(msg)) {
      msg += '. Tip: this usually means the endpoint URL is wrong, or the request was blocked by a gateway (cloud gateways return an HTML error page when the image is too large).';
    }
    res.status(500).json({ error: msg });
  }
});

/* ------------------------------ Knowledge base endpoints ------------------------------ */
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

app.post('/api/knowledge/upload', upload.array('files'), async (req, res) => {
  try {
    const files = req.files || [];
    const scene = (req.body && req.body.scene) || 'all';
    const added = [];
    for (const f of files) {
      let text = '';
      const ext = path.extname(f.originalname).toLowerCase();
      if (ext === '.pdf') {
        try {
          const pdfParse = require('pdf-parse');
          const out = await pdfParse(f.buffer);
          text = out.text || '';
        } catch {
          text = f.buffer.toString('utf8');
        }
      } else {
        text = f.buffer.toString('utf8');
      }
      const chunks = chunkText(text);
      if (!chunks.length) continue;
      knowledge.push({
        id: crypto.randomUUID(),
        name: f.originalname,
        type: ext.slice(1) || 'text',
        scene,
        size: f.size,
        chunks,
        createdAt: Date.now(),
      });
      added.push(f.originalname);
    }
    saveKB();
    res.json({ ok: true, added, count: knowledge.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/knowledge/add', (req, res) => {
  try {
    const { name, text, scene } = req.body || {};
    if (!text || !text.trim()) return res.status(400).json({ error: 'The text is empty' });
    knowledge.push({
      id: crypto.randomUUID(),
      name: name && name.trim() ? name.trim() : 'Text-' + new Date().toLocaleString(),
      type: 'text',
      scene: scene || 'all',
      size: text.length,
      chunks: chunkText(text),
      createdAt: Date.now(),
    });
    saveKB();
    res.json({ ok: true, count: knowledge.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/knowledge', (req, res) => {
  let list = knowledge;
  const sc = req.query.scene;
  if (sc && sc !== 'all') list = list.filter((k) => (k.scene || 'all') === sc);
  res.json(list.map((k) => ({ id: k.id, name: k.name, type: k.type, scene: k.scene || 'all', size: k.size, chunks: k.chunks.length, createdAt: k.createdAt, seed: !!k.seed })));
});

app.delete('/api/knowledge/:id', (req, res) => {
  const before = knowledge.length;
  knowledge = knowledge.filter((k) => k.id !== req.params.id);
  saveKB();
  res.json({ ok: true, removed: before - knowledge.length });
});

function startOn(port) {
  const srv = app.listen(port, '0.0.0.0', () => {
    console.log('[Smart City Vision Inspector] Server running: http://localhost:' + port);
    console.log('[Tip] If the browser did not open automatically, visit the address above yourself (keep this window open — closing it stops the service).');
  });
  srv.on('error', (err) => {
    if (err.code === 'EADDRINUSE' && port < 3999) {
      console.log('[Tip] Port ' + port + ' is already in use, switching to ' + (port + 1));
      startOn(port + 1);
    } else {
      console.error('[Error] Failed to start the service: ' + err.message);
      process.exit(1);
    }
  });
}
startOn(PORT);
