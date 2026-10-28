/* Smart City Vision Inspector — frontend logic */

const state = {
  images: [],
  results: [],
  knowledge: [],
  providers: {},
  tasks: {},
  presets: [],
  mode: 'standard',
  currentPresetId: null,
  config: { provider: 'deepseek', baseURL: '', model: '', apiKey: '' },
};

const $ = (id) => document.getElementById(id);
const LS_KEY = 'scvi_llm_config_v2';
const PRESET_KEY = 'scvi_presets_v1';

/* ----------------------------- Initialization ----------------------------- */
async function init() {
  await loadProviders();
  loadPresets();
  restoreConfig();
  await loadKnowledge($('kbScene').value);
  bindEvents();
  updateDefaultPrompt();
}

async function loadProviders() {
  try {
    const r = await fetch('/api/providers');
    const d = await r.json();
    state.providers = d.providers || {};
    state.tasks = d.tasks || {};

    const pSel = $('provider');
    pSel.innerHTML = '';
    Object.entries(state.providers).forEach(([k, v]) => {
      const o = document.createElement('option');
      o.value = k; o.textContent = v.label;
      pSel.appendChild(o);
    });

    const tSel = $('task');
    tSel.innerHTML = '';
    Object.entries(state.tasks).forEach(([k, v]) => {
      const o = document.createElement('option');
      o.value = k; o.textContent = v.labelEn || v.name;
      tSel.appendChild(o);
    });

    pSel.onchange = () => applyProviderPreset(pSel.value);
    $('showTextModels').onchange = () => applyProviderPreset(pSel.value);
    $('model').onchange = () => onModelChange();
    $('task').onchange = () => {
      updateDefaultPrompt();
      const t = $('task').value;
      if (t) { $('kbScene').value = t; loadKnowledge(t); }
    };
    $('customPrompt').oninput = () => updateDefaultPrompt();

    applyProviderPreset(pSel.value);
  } catch (e) {
    setMsg('configMsg', 'Cannot reach the local service — please make sure the server is running', 'err');
  }
}

function applyProviderPreset(key) {
  const p = state.providers[key];
  if (!p) return;
  $('baseURL').value = p.baseURL;
  $('providerHint').textContent = p.hint || '';
  state.config.provider = key;
  state.config.temperature = p.temperature != null ? p.temperature : 0.2;
  $('temperature').value = state.config.temperature;
  populateModelDropdown(key);
}

function populateModelDropdown(providerKey) {
  const p = state.providers[providerKey];
  const sel = $('model');
  const showText = $('showTextModels')?.checked;
  const customInput = $('modelCustom');
  sel.innerHTML = '';

  const all = p.models || [];
  const visionModels = all.filter((m) => m.vision);
  const models = showText ? all : (visionModels.length ? visionModels : all);
  if (!visionModels.length) {
    $('providerHint').textContent = (p.hint || '') + ' (Every built-in preset for this provider is a text-only model that cannot read images. For image input, switch to a vision-capable provider such as GLM-4V, Kimi Vision, Tencent Hunyuan hy-vision-2.0-instruct or Alibaba Qwen qwen-vl-max.)';
  }

  models.forEach((m) => {
    const o = document.createElement('option');
    o.value = m.id;
    o.textContent = m.label + (m.vision ? ' · Vision' : ' · Text');
    o.dataset.custom = m.custom ? '1' : '';
    sel.appendChild(o);
  });

  // Select the first vision model by default (or simply the first one)
  const firstVision = models.find((m) => m.vision) || models[0];
  if (firstVision) sel.value = firstVision.id;
  syncModelId();
}

// Mirror the dropdown selection into the "actual model name" field; custom models use their own input
function syncModelId() {
  const sel = $('model');
  const opt = sel.options[sel.selectedIndex];
  const isCustom = opt && opt.dataset.custom === '1';
  if (isCustom) {
    $('modelCustom').hidden = false;
    $('modelId').value = $('modelCustom').value.trim();
  } else {
    $('modelCustom').hidden = true;
    $('modelId').value = opt ? opt.value : '';
  }
}

function onModelChange() {
  syncModelId();
}

function getModel() {
  if (state.mode === 'advanced') {
    return ($('advModel').value.trim() || $('modelId').value.trim());
  }
  const sel = $('model');
  const opt = sel.options[sel.selectedIndex];
  if (opt && opt.dataset.custom === '1') return $('modelCustom').value.trim();
  return $('modelId').value.trim();
}

function isVisionModel() {
  if (state.mode === 'advanced') return $('advVision').checked;
  const sel = $('model');
  const opt = sel.options[sel.selectedIndex];
  if (!opt) return true;
  if (opt.dataset.custom === '1') return true; // Custom models are assumed to support vision
  const p = state.providers[$('provider').value];
  const modelDef = (p?.models || []).find((x) => x.id === opt.value);
  return modelDef ? !!modelDef.vision : true;
}

/* ----------------------------- Prompt / Tasks ----------------------------- */
function getTaskKey() {
  return $('task').value || 'fire';
}

function getEffectivePrompt() {
  const custom = $('customPrompt').value.trim();
  if (custom) return custom;
  const task = state.tasks[getTaskKey()];
  return task ? task.defaultPrompt : state.tasks.custom.defaultPrompt;
}

function updateDefaultPrompt() {
  const task = state.tasks[getTaskKey()];
  const def = task ? task.defaultPrompt : '';
  $('defaultPromptText').textContent = def || '(Custom task — please enter a prompt above)';
  if (!$('customPrompt').value.trim()) {
    $('customPrompt').placeholder = def;
  }
}

/* ----------------------------- Knowledge base ----------------------------- */
async function loadKnowledge(scene) {
  const sc = scene || $('kbScene').value || 'all';
  const r = await fetch('/api/knowledge?scene=' + encodeURIComponent(sc));
  state.knowledge = await r.json();
  renderKB();
}

function sceneName(s) {
  return ({ fire: 'Fire Hazard', security: 'Security', traffic: 'Traffic', publicorder: 'Public Order', custom: 'Custom', all: 'All' })[s] || s;
}

function renderKB() {
  const ul = $('kbList');
  ul.innerHTML = '';
  if (!state.knowledge.length) {
    ul.innerHTML = '<li><span class="meta">No knowledge-base entries for this scene yet (upload or paste clauses for this scene)</span></li>';
    return;
  }
  state.knowledge.forEach((k) => {
    const li = document.createElement('li');
    const left = document.createElement('div');
    const sceneTag = k.scene && k.scene !== 'all' ? ' · ' + sceneName(k.scene) : '';
    left.innerHTML = `<div>${escapeHtml(k.name)}</div><div class="meta">${k.type} · ${k.chunks} chunks${k.seed ? ' · Sample' : ''}${sceneTag}</div>`;
    const del = document.createElement('button');
    del.className = 'del'; del.textContent = 'Delete';
    del.onclick = () => deleteKB(k.id);
    li.appendChild(left); li.appendChild(del);
    ul.appendChild(li);
  });
}

function bindKB() {
  $('kbScene').onchange = () => loadKnowledge($('kbScene').value);
  $('kbFiles').addEventListener('change', async (e) => {
    const files = e.target.files;
    if (!files.length) return;
    const fd = new FormData();
    [...files].forEach((f) => fd.append('files', f));
    fd.append('scene', $('kbScene').value);
    setMsg('kbUploadMsg', 'Uploading…');
    const r = await fetch('/api/knowledge/upload', { method: 'POST', body: fd });
    const d = await r.json();
    setMsg('kbUploadMsg', d.ok ? 'Added: ' + d.added.join(', ') : 'Failed: ' + (d.error || ''), d.ok ? 'ok' : 'err');
    $('kbFiles').value = '';
    await loadKnowledge($('kbScene').value);
  });
  $('kbAdd').onclick = async () => {
    const name = $('kbName').value.trim();
    const text = $('kbText').value.trim();
    if (!text) { setMsg('kbUploadMsg', 'Please enter some text', 'err'); return; }
    const scene = $('kbScene').value;
    const r = await fetch('/api/knowledge/add', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, text, scene }) });
    const d = await r.json();
    setMsg('kbUploadMsg', d.ok ? 'Text added to the "' + sceneName(scene) + '" knowledge base' : 'Failed: ' + (d.error || ''), d.ok ? 'ok' : 'err');
    $('kbText').value = ''; $('kbName').value = '';
    await loadKnowledge(scene);
  };
}
async function deleteKB(id) {
  await fetch('/api/knowledge/' + id, { method: 'DELETE' });
  await loadKnowledge();
}

/* ----------------------------- Configuration ----------------------------- */
/* ----------------------------- Presets (advanced mode) ----------------------------- */
function loadPresets() {
  try {
    const arr = JSON.parse(localStorage.getItem(PRESET_KEY) || '[]');
    state.presets = Array.isArray(arr) ? arr : [];
  } catch { state.presets = []; }
  renderPresetOptions();
}

function renderPresetOptions(selectedId) {
  const sel = $('presetSel');
  if (!sel) return;
  sel.innerHTML = '';
  const placeholder = document.createElement('option');
  placeholder.value = '__new__';
  placeholder.textContent = '➕ New custom preset…';
  sel.appendChild(placeholder);
  state.presets.forEach((p) => {
    const o = document.createElement('option');
    o.value = p.id; o.textContent = p.name + '（' + p.model + '）';
    sel.appendChild(o);
  });
  if (selectedId && state.presets.some((p) => p.id === selectedId)) sel.value = selectedId;
}

function setMode(mode) {
  state.mode = mode;
  const adv = mode === 'advanced';
  $('standardBlock').hidden = adv;
  $('advancedBlock').hidden = !adv;
  $('modeStandard').classList.toggle('active', !adv);
  $('modeAdvanced').classList.toggle('active', adv);
  if (adv) {
    if (!$('advBaseURL').value && $('baseURL').value) {
      $('advBaseURL').value = $('baseURL').value;
      $('advApiKey').value = $('apiKey').value;
      $('advTemp').value = $('temperature').value;
      $('advModel').value = getModel() || '';
      $('modelId').value = $('advModel').value;
    }
    renderPresetOptions(state.currentPresetId);
    if (state.currentPresetId) applyPreset(state.currentPresetId, true);
  } else if ($('advModel').value) {
    $('modelId').value = $('advModel').value;
  }
}

function applyPreset(id, silent) {
  const p = state.presets.find((x) => x.id === id);
  if (!p) { state.currentPresetId = null; $('advName').value=''; $('advBaseURL').value=''; $('advModel').value=''; $('advApiKey').value=''; $('advTemp').value='0.2'; $('advVision').checked=true; return; }
  state.currentPresetId = id;
  $('advName').value = p.name;
  $('advBaseURL').value = p.baseURL;
  $('advModel').value = p.model;
  $('advApiKey').value = p.apiKey || '';
  $('advTemp').value = (p.temperature != null ? p.temperature : 0.2);
  $('advVision').checked = p.vision !== false;
  $('modelId').value = p.model;
  if (!silent) setMsg('configMsg', 'Preset loaded: ' + p.name, 'ok');
}

function savePreset() {
  const name = $('advName').value.trim();
  const baseURL = $('advBaseURL').value.trim();
  const model = $('advModel').value.trim();
  const apiKey = $('advApiKey').value.trim();
  const temperature = parseFloat($('advTemp').value);
  const vision = $('advVision').checked;
  if (!name) { setMsg('configMsg', 'Please enter a preset name', 'err'); return; }
  if (!baseURL || !model) { setMsg('configMsg', 'Please enter the baseURL endpoint and the model name', 'err'); return; }
  const id = state.currentPresetId || ('p_' + Date.now());
  const preset = { id, name, baseURL, model, apiKey, temperature: Number.isFinite(temperature) ? temperature : 0.2, vision };
  const idx = state.presets.findIndex((x) => x.id === id);
  if (idx >= 0) state.presets[idx] = preset; else state.presets.push(preset);
  state.currentPresetId = id;
  localStorage.setItem(PRESET_KEY, JSON.stringify(state.presets));
  renderPresetOptions(id);
  setMsg('configMsg', 'Preset "' + name + '" saved (' + state.presets.length + ' in total)', 'ok');
}

function deletePreset() {
  if (!state.currentPresetId) { setMsg('configMsg', 'Nothing to delete — you are creating a new preset', 'err'); return; }
  const p = state.presets.find((x) => x.id === state.currentPresetId);
  state.presets = state.presets.filter((x) => x.id !== state.currentPresetId);
  localStorage.setItem(PRESET_KEY, JSON.stringify(state.presets));
  state.currentPresetId = null;
  renderPresetOptions();
  $('advName').value=''; $('advBaseURL').value=''; $('advModel').value=''; $('advApiKey').value=''; $('advTemp').value='0.2';
  setMsg('configMsg', 'Preset deleted' + (p ? ': ' + p.name : ''), 'ok');
}

function syncAdvModel() {
  if (state.mode === 'advanced') $('modelId').value = $('advModel').value.trim();
}

/* ----------------------------- Configuration ----------------------------- */
function restoreConfig() {
  try {
    const s = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
    Object.assign(state.config, s);
    state.currentPresetId = s.presetId || null;
    const mode = s.mode === 'advanced' ? 'advanced' : 'standard';
    state.mode = mode;
    $('standardBlock').hidden = mode === 'advanced';
    $('advancedBlock').hidden = mode !== 'advanced';
    $('modeStandard').classList.toggle('active', mode === 'standard');
    $('modeAdvanced').classList.toggle('active', mode === 'advanced');

    if (s.provider && state.providers[s.provider]) {
      $('provider').value = s.provider;
      applyProviderPreset(s.provider);
    }
    if (s.model) {
      const sel = $('model');
      const exists = [...sel.options].some((o) => o.value === s.model);
      if (exists) sel.value = s.model;
      else {
        $('showTextModels').checked = true;
        applyProviderPreset(s.provider);
        if ([...sel.options].some((o) => o.value === s.model)) sel.value = s.model;
      }
      onModelChange();
      if (s.model === '__custom__' && s.customModelName) $('modelCustom').value = s.customModelName;
    }
    if (s.model) $('modelId').value = s.model;
    if (s.baseURL) $('baseURL').value = s.baseURL;
    if (s.apiKey) $('apiKey').value = s.apiKey;
    if (s.temperature != null) { $('temperature').value = s.temperature; state.config.temperature = s.temperature; }

    if (s.advName != null) $('advName').value = s.advName;
    if (s.advBaseURL != null) $('advBaseURL').value = s.advBaseURL;
    if (s.advModel != null) $('advModel').value = s.advModel;
    if (s.advApiKey != null) $('advApiKey').value = s.advApiKey;
    if (s.advTemp != null) $('advTemp').value = s.advTemp;
    if (s.advVision != null) $('advVision').checked = s.advVision;
    if (mode === 'advanced' && state.currentPresetId) applyPreset(state.currentPresetId, true);

    if (s.kbScene && [...$('kbScene').options].some((o) => o.value === s.kbScene)) $('kbScene').value = s.kbScene;
    if (s.task && state.tasks[s.task]) $('task').value = s.task;
    if (s.customPrompt) $('customPrompt').value = s.customPrompt;
  } catch {}
  updateDefaultPrompt();
}

function readConfig() {
  const c = { provider: '', baseURL: '', model: '', apiKey: '', temperature: 0.2, vision: true };
  if (state.mode === 'advanced') {
    c.provider = $('advName').value.trim() || 'Custom Gateway';
    c.baseURL = $('advBaseURL').value.trim();
    c.model = $('advModel').value.trim() || $('modelId').value.trim();
    c.apiKey = $('advApiKey').value.trim();
    const t = parseFloat($('advTemp').value);
    c.temperature = Number.isFinite(t) ? t : 0.2;
    c.vision = $('advVision').checked;
    c.presetId = state.currentPresetId;
  } else {
    c.provider = $('provider').value;
    c.baseURL = $('baseURL').value.trim();
    c.model = getModel();
    c.apiKey = $('apiKey').value.trim();
    c.customModelName = $('modelCustom').value.trim();
    const t = parseFloat($('temperature').value);
    c.temperature = Number.isFinite(t) ? t : (state.config.temperature != null ? state.config.temperature : 0.2);
    c.vision = isVisionModel();
  }
  return c;
}

function saveConfig() {
  const c = readConfig();
  const toSave = {
    ...c,
    mode: state.mode,
    presetId: state.mode === 'advanced' ? state.currentPresetId : null,
    advName: $('advName').value.trim(),
    advBaseURL: $('advBaseURL').value.trim(),
    advModel: $('advModel').value.trim(),
    advApiKey: $('advApiKey').value.trim(),
    advTemp: $('advTemp').value,
    advVision: $('advVision').checked,
    task: getTaskKey(),
    kbScene: $('kbScene').value,
    customPrompt: $('customPrompt').value.trim(),
  };
  localStorage.setItem(LS_KEY, JSON.stringify(toSave));
  setMsg('configMsg', 'Configuration saved to this browser', 'ok');
}

async function testConfig() {
  const c = readConfig();
  if (!c.apiKey || !c.baseURL || !c.model) {
    setMsg('configMsg', 'Please select a provider and a model, then enter your API key', 'err');
    return;
  }
  setMsg('configMsg', 'Testing connection…');
  try {
    // Proxy through the local service: a direct browser call to the provider is
    // blocked by CORS (which surfaces as "Failed to fetch")
    const r = await fetch('/api/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseURL: c.baseURL, apiKey: c.apiKey, model: c.model }),
    });
    const d = await r.json();
    if (r.ok && d.ok) {
      setMsg('configMsg', 'Connection successful ✓', 'ok');
    } else {
      const extra = ($('provider').value === 'hunyuan' && /invalid_api_key|Incorrect API key|401/i.test(d.error || ''))
        ? ' Tip: Hunyuan has moved to Tencent Cloud TokenHub. Get your key from console.cloud.tencent.com/tokenhub (prefixed with "sk-"), and check that it is correct and that the model service is activated.'
        : '';
      setMsg('configMsg', 'Connection failed: ' + (d.error || 'Unknown error') + extra, 'err');
    }
  } catch (e) {
    setMsg('configMsg', 'Connection failed: ' + e.message, 'err');
  }
}

// Query the provider directly with the user's own API key and list the models
// genuinely available — what you see is what you get
async function fetchModels() {
  const c = readConfig();
  if (!c.apiKey || !c.baseURL) {
    setMsg('configMsg', 'Enter the endpoint URL and your API key before fetching the model list', 'err');
    return;
  }
  const box = $('modelsBox');
  box.hidden = false;
  box.innerHTML = '<div class="meta">Requesting the model list from the provider…</div>';
  try {
    const r = await fetch('/api/models', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseURL: c.baseURL, apiKey: c.apiKey }),
    });
    const d = await r.json();
    if (!r.ok || !d.ok) {
      const extra = ($('provider').value === 'hunyuan' && /invalid_api_key|Incorrect API key|401/i.test(d.error || ''))
        ? '<br><span style="color:var(--orange)">Tip: Hunyuan has moved to Tencent Cloud TokenHub. Get your key from console.cloud.tencent.com/tokenhub (prefixed with "sk-"), and check that it is correct and that the model service is activated.</span>'
        : '';
      box.innerHTML = '<div class="meta" style="color:var(--red)">Failed to fetch: ' + escapeHtml(d.error || 'Unknown error') + extra + '</div>';
      return;
    }
    const ids = d.models || [];
    if (!ids.length) {
      box.innerHTML = '<div class="meta">The provider returned no model list (some gateways do not support /models).</div>';
      return;
    }
    // Guess which ones are likely to be vision models
    const looksVision = (id) => /vision|vl|v1-.*vision|-v\b|4v|多模态|multimodal|image/i.test(id);
    box.innerHTML = '<div class="meta">Click any model to fill in the "actual model name" (those marked 🖼 most likely support images):</div>';
    const wrap = document.createElement('div');
    wrap.className = 'models-chips';
    ids.forEach((id) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip' + (looksVision(id) ? ' chip-vision' : '');
      b.textContent = (looksVision(id) ? '🖼 ' : '') + id;
      b.onclick = () => {
        $('modelId').value = id;
        // If it matches one of the presets, sync the dropdown as well
        const sel = $('model');
        let matched = false;
        for (const o of sel.options) { if (o.value === id) { sel.value = id; matched = true; break; } }
        if (!matched && sel.options.length && sel.options[sel.selectedIndex] && sel.options[sel.selectedIndex].dataset.custom !== '1') {
          // Not among the presets: keep the custom input
        }
        syncAdvModel();
        setMsg('configMsg', 'Model name filled in: ' + id, 'ok');
      };
      wrap.appendChild(b);
    });
    box.appendChild(wrap);
  } catch (e) {
    box.innerHTML = '<div class="meta" style="color:var(--red)">Request error: ' + escapeHtml(e.message) + '</div>';
  }
}

/* ----------------------------- Image upload ----------------------------- */
function bindImages() {
  const dz = $('dropZone');
  const input = $('imgInput');
  dz.onclick = () => input.click();
  input.onchange = (e) => { handleFiles(e.target.files); input.value = ''; };
  ['dragover', 'dragenter'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('drag'); }));
  dz.addEventListener('drop', (e) => handleFiles(e.dataTransfer.files));

  $('optFocus').onchange = (e) => { $('focusInput').disabled = !e.target.checked; };
  $('analyzeBtn').onclick = analyzeAll;
  $('clearBtn').onclick = clearAll;
}

/* ---------------------------------------------------------------------------
   Image compression: shrink phone / camera originals (often 3-10 MB) down to a
   safe size before uploading.
   Why: base64 inflates the payload by roughly another 33%, and oversized request
   bodies are rejected by the cloud gateway (nginx) before they ever reach the
   app, which returns a 502/503 HTML error page — the frontend then blows up on
   res.json() with a completely untraceable
   "Unexpected token '<', "<html>..." error.
   The side effect is a welcome one: far fewer image tokens, so analysis runs
   faster and costs less.
   --------------------------------------------------------------------------- */
const COMPRESS_STEPS = [
  { maxEdge: 1280, quality: 0.82 },
  { maxEdge: 1024, quality: 0.72 },
  { maxEdge: 800, quality: 0.62 },
  { maxEdge: 640, quality: 0.55 },
];
// Goal: keep the compressed dataURL under ~450 KB (about 460 KB of JSON request
// body once base64-encoded) — far below the ~1.3 MB threshold at which the cloud
// gateway starts returning 502, leaving plenty of headroom.
const TARGET_BYTES = 450 * 1024;
// Originals below 200 KB are used as-is, to avoid needless re-encoding quality loss
const PASSTHROUGH_BYTES = 200 * 1024;

function compressToDataUrl(file, maxEdge, quality) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width: w, height: h } = img;
      const scale = Math.min(1, maxEdge / Math.max(w, h));
      w = Math.max(1, Math.round(w * scale));
      h = Math.max(1, Math.round(h * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      try { resolve(canvas.toDataURL('image/jpeg', quality)); } catch (e) { reject(e); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Failed to read the image')); };
    img.src = url;
  });
}

/* Step down the ladder until the size lands in the safe range; always return the smallest result produced */
async function compressImage(file) {
  const origSize = file.size;
  let best = null;
  for (const step of COMPRESS_STEPS) {
    let dataUrl;
    try { dataUrl = await compressToDataUrl(file, step.maxEdge, step.quality); } catch { break; }
    const size = Math.round((dataUrl.length - dataUrl.indexOf(',') - 1) * 0.75);
    if (!best || size < best.size) best = { dataUrl, size, maxEdge: step.maxEdge };
    if (size <= TARGET_BYTES) break;
  }
  if (!best) return null;
  best.origSize = origSize;
  return best;
}

function fmtSize(n) {
  if (n >= 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
  return Math.max(1, Math.round(n / 1024)) + ' KB';
}

/* Approximate byte size of a decoded dataURL (every 4 base64 chars = 3 bytes) */
function dataUrlBytes(dataUrl) {
  const i = String(dataUrl).indexOf(',');
  return Math.round(((dataUrl.length - i - 1) * 3) / 4);
}

async function handleFiles(files) {
  // Warn above this size: the cloud gateway starts returning 502 HTML error
  // pages once the request body reaches roughly 1.3 MB
  const WARN_BYTES = 1.2 * 1024 * 1024;

  for (const f of [...files]) {
    if (!f.type.startsWith('image/')) continue;
    const readRaw = () => new Promise((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.readAsDataURL(f);
    });

    // Images already inside the safe size range are used as-is, to avoid
    // needless re-encoding quality loss
    if (f.size <= PASSTHROUGH_BYTES) {
      const dataUrl = await readRaw();
      state.images.push({ id: crypto.randomUUID(), name: f.name, dataUrl, origSize: f.size, size: f.size, compressed: false });
      renderPreview();
      continue;
    }

    const c = await compressImage(f);
    if (c) {
      state.images.push({
        id: crypto.randomUUID(), name: f.name, dataUrl: c.dataUrl,
        origSize: c.origSize, size: c.size, compressed: true, maxEdge: c.maxEdge,
        oversized: c.size > WARN_BYTES,
      });
    } else {
      // Decoding failed (e.g. iPhone HEIC, corrupt file): the only option is to
      // fall back to the original image, so flag it in red explicitly —
      // otherwise the "gateway returned an HTML page" failure returns silently.
      const dataUrl = await readRaw();
      const bytes = dataUrlBytes(dataUrl);
      state.images.push({
        id: crypto.randomUUID(), name: f.name, dataUrl,
        origSize: f.size, size: bytes, compressed: false,
        decodeFailed: true, oversized: bytes > WARN_BYTES,
      });
    }
    renderPreview();
  }
}

function renderPreview() {
  const g = $('preview');
  g.innerHTML = '';
  state.images.forEach((img) => {
    const div = document.createElement('div');
    div.className = 'preview-item';
    const meta = img.compressed
      ? `${escapeHtml(img.name)}<span class="pz">${fmtSize(img.origSize)} → ${fmtSize(img.size)}</span>`
      : img.decodeFailed
        ? `${escapeHtml(img.name)}<span class="pz pz-warn">Could not compress · ${fmtSize(img.size)}</span>`
        : escapeHtml(img.name);
    div.innerHTML = `<img src="${img.dataUrl}" alt=""><div class="name">${meta}</div>`;
    // Anything still oversized is flagged in red right on the card, so users
    // don't only discover the failure after clicking Analyze
    if (img.oversized) {
      const w = document.createElement('div');
      w.className = 'pz-alert';
      w.textContent = 'Oversized — may fail';
      w.title = 'This image is still over 1.2 MB after compression and may be blocked outright by the cloud gateway. Try reducing its resolution locally, or convert it to JPG and upload it again.';
      div.appendChild(w);
    }
    const rm = document.createElement('button');
    rm.className = 'rm'; rm.textContent = '×'; rm.title = 'Remove';
    rm.onclick = () => { state.images = state.images.filter((x) => x.id !== img.id); renderPreview(); };
    div.appendChild(rm);
    g.appendChild(div);
  });
  $('analyzeBtn').disabled = state.images.length === 0;
}

/* ----------------------------- Analysis ----------------------------- */
/* Send an analysis request. Key point: never call res.json() directly — when the
   request body is too large or the service is busy, the cloud gateway (nginx)
   returns a 502/503 HTML page, and parsing that yields the untraceable
   "Unexpected token '<', "<html>..." error. Read the text first, branch on the
   status code and Content-Type, surface a clear message, and retry gateway
   errors (502 / 503 / 504) once automatically. */
async function postAnalyze(payload) {
  const send = async () => {
    let r;
    try {
      r = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch (e) {
      const err = new Error('Network request failed: ' + (e.message || e) + '. Check that the service is running and that your network connection is healthy.');
      err.retriable = true;
      throw err;
    }
    const ctype = (r.headers.get('content-type') || '').toLowerCase();
    const text = await r.text();
    if (ctype.includes('json')) {
      let d;
      try { d = JSON.parse(text); } catch {
        throw new Error('The service returned unparseable JSON (HTTP ' + r.status + '): ' + text.replace(/\s+/g, ' ').slice(0, 200));
      }
      if (d && d.ok) return d;
      throw new Error(d && d.error ? d.error : 'Analysis failed (HTTP ' + r.status + ')');
    }
    // Not JSON: almost certainly a gateway error page
    const titleM = text.match(/<title>([^<]{0,120})<\/title>/i);
    const title = titleM ? titleM[1].trim() : (text.replace(/\s+/g, ' ').slice(0, 80) || 'empty response');
    const kb = (BufferLen(JSON.stringify(payload)) / 1024).toFixed(0);
    const err = new Error(
      'The gateway returned an HTML error page instead of analysis results (HTTP ' + r.status + ' · ' + title + '). ' +
      'This request was about ' + kb + ' KB: ' +
      (/50[234]/.test(String(r.status))
        ? 'this usually means the image is too large or the service is scaling up. Images are compressed automatically, so please retry in a moment; if it keeps failing, analyze fewer images at a time.'
        : 'check that the service address is correct and that the service is running.')
    );
    err.retriable = /50[234]/.test(String(r.status));
    throw err;
  };

  try {
    return await send();
  } catch (e) {
    if (!e.retriable) throw e;
    await new Promise((r) => setTimeout(r, 1500));
    return await send();
  }
}

function BufferLen(s) {
  return new Blob([s]).size;
}

async function analyzeAll() {
  const config = readConfig();
  if (!config.apiKey || !config.baseURL || !config.model) {
    setMsg('progressText', 'Please complete the model configuration in section ① first', 'err');
    return;
  }
  if (!isVisionModel()) {
    const pv = state.mode === 'standard' ? $('provider').value : '';
    const msg = pv === 'deepseek'
      ? 'DeepSeek V4 is a text-only model and cannot read images. Switch to deepseek-v4-flash-vision-exp (vision) or another vision model such as GLM-4V, Kimi Vision, Tencent Hunyuan hy-vision-2.0-instruct or Alibaba Qwen qwen-vl-max, then run the analysis again.'
      : 'The selected model does not support image input. Pick a model marked "Vision", or in Advanced mode tick "This model supports vision / image input".';
    setMsg('progressText', msg, 'err');
    return;
  }
  const options = {
    task: getTaskKey(),
    prompt: getEffectivePrompt(),
    knowledgeEnhanced: $('optKb').checked,
    focus: $('optFocus').checked ? $('focusInput').value.trim() : '',
    topN: 8,
  };
  $('analyzeBtn').disabled = true;
  $('result-card').hidden = false;
  state.results = [];
  const total = state.images.length;
  for (let i = 0; i < total; i++) {
    const img = state.images[i];
    setProgress(i, total, 'Analyzing ' + (i + 1) + '/' + total + ': ' + img.name);
    try {
      const d = await postAnalyze({ image: img.dataUrl, config, options });
      state.results.push({ image: img, result: d });
    } catch (e) {
      state.results.push({ image: img, result: { error: e.message, parseError: true, raw: '' } });
    }
    renderResults();
  }
  setProgress(total, total, 'Analysis complete: ' + total + ' images');
  $('analyzeBtn').disabled = false;
}

function setProgress(done, total, text) {
  $('progressBar').style.width = (done / total * 100) + '%';
  $('progressText').textContent = text;
}

function verdictClass(result) {
  // Prefer the authoritative risk level computed server-side from finding severities
  if (result && result.riskLevel && ['safe', 'warn', 'danger'].includes(result.riskLevel)) return result.riskLevel;
  const findings = (result && result.findings) || [];
  if (findings.length) {
    const sevs = findings.map((f) => String(f.severity || '').toLowerCase());
    if (sevs.includes('high') || sevs.includes('medium')) return 'danger';
    if (sevs.includes('low')) return 'warn';
    return 'warn';
  }
  const v = String((result && result.verdict) || '');
  // Bilingual: the report language follows the prompt language, so match both.
  if (/安全|正常|无隐患|未见|良好|无明显|无异常/i.test(v)) return 'safe';
  if (/\b(safe|normal|no hazard|no issue|no problem|compliant|satisfactory|acceptable)\b/i.test(v)) return 'safe';
  if (/注意|轻微|一般|需要关注|建议|部分/i.test(v)) return 'warn';
  if (/\b(caution|attention|minor|moderate|should|monitor|partial)\b/i.test(v)) return 'warn';
  return 'danger';
}
function sevClass(s) { return ['low', 'medium', 'high'].includes(s) ? s : 'medium'; }
function formatNum(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
function resultMeta(r) {
  const parts = [];
  if (r.elapsedMs != null) parts.push('⏱ ' + (r.elapsedMs / 1000).toFixed(1) + 's');
  if (r.usage && r.usage.total_tokens != null) parts.push('🪙 ' + formatNum(r.usage.total_tokens) + ' tokens');
  return parts.length ? '<span class="res-meta">' + parts.join(' · ') + '</span>' : '';
}

function renderResults() {
  renderSummary();
  const box = $('results');
  box.innerHTML = '';
  state.results.forEach(({ image, result }) => {
    const div = document.createElement('div');
    div.className = 'result-item';
    if (result.error && !result.raw) {
      div.innerHTML = `<div class="result-head"><img src="${image.dataUrl}"><div><div class="title">${escapeHtml(image.name)}</div><div class="scene" style="color:var(--red)">Analysis failed: ${escapeHtml(result.error)}</div></div></div>`;
      box.appendChild(div); return;
    }
    const v = result.verdict || 'Issues / hazards detected';
    const findings = result.findings || [];
    const hz = findings.length
      ? `<div class="findings">${findings.map((h, idx) =>
          `<div class="finding">
            <div class="f-head"><span class="f-no">${idx + 1}</span><span class="f-type">${escapeHtml(h.type || 'Issue')}</span><span class="sev ${sevClass(h.severity)}">${escapeHtml(h.severity || '-')}</span></div>
            <div class="f-row"><b>Evidence:</b> ${escapeHtml(h.evidence || '-')}</div>
            <div class="f-row"><b>Explanation:</b> ${escapeHtml(h.explanation || '-')}</div>
            ${h.regulation ? `<div class="f-row"><b>Basis:</b> ${escapeHtml(h.regulation)}</div>` : ''}
          </div>`).join('')}</div>`
      : '<p class="scene">No obvious issues or hazards detected.</p>';
    const sug = (result.suggestions || []).length ? `<ul class="suggestions">${result.suggestions.map((s) => `<li>${escapeHtml(s)}</li>`).join('')}</ul>` : '';
    const desc = result.description ? `<div class="description markdown">${renderMarkdown(result.description)}</div>` : '';

    let kbRefs = '';
    if (result.usedKnowledge && result.retrievedClauses && result.retrievedClauses.length) {
      kbRefs =
        `<div class="kb-refs">
          <div class="kb-refs-title">🔎 Knowledge-base clauses cited (${result.retrievedClauses.length})</div>
          <ul>${result.retrievedClauses.map((c) => `<li><b>${escapeHtml(c.doc || 'Knowledge base')}</b>: ${renderMarkdown(c.text)}</li>`).join('')}</ul>
        </div>`;
    }

    div.innerHTML =
      `<div class="result-head">
        <img src="${image.dataUrl}" alt="">
        <div><div class="title">${escapeHtml(image.name)}</div><div class="scene">Scene: ${escapeHtml(result.scene || '-')}</div></div>
        <span class="badge ${verdictClass(result)}">${escapeHtml(v)}</span>
        ${result.confidence ? `<span class="sev">Confidence ${Math.round(result.confidence * 100)}%</span>` : ''}
        ${resultMeta(result)}
      </div>
      ${result.parseError ? '<p class="scene" style="color:var(--orange)">⚠ The model did not return standard JSON; the original output has been kept — expand to read it</p>' : ''}
      ${desc}${kbRefs}${hz}${sug}
      <details class="raw"><summary>View raw model output</summary><pre>${escapeHtml(result.raw || '')}</pre></details>`;
    box.appendChild(div);
  });
}

function renderSummary() {
  const total = state.results.length;
  let safe = 0, warn = 0, danger = 0, fail = 0;
  state.results.forEach(({ result }) => {
    if (result.error && !result.raw) { fail++; return; }
    const vc = verdictClass(result);
    if (vc === 'safe') safe++; else if (vc === 'warn') warn++; else danger++;
  });
  $('summary').innerHTML =
    `<div class="stat"><div class="n">${total}</div><div class="l">Analyzed</div></div>
     <div class="stat"><div class="n" style="color:var(--green)">${safe}</div><div class="l">Normal / Safe</div></div>
     <div class="stat"><div class="n" style="color:var(--orange)">${warn}</div><div class="l">Needs Attention</div></div>
     <div class="stat"><div class="n" style="color:var(--red)">${danger}</div><div class="l">Issues / Hazards Found</div></div>
     ${fail ? `<div class="stat"><div class="n" style="color:var(--muted)">${fail}</div><div class="l">Analysis Failed</div></div>` : ''}`;
}

function clearAll() {
  state.images = []; state.results = [];
  renderPreview(); renderResults();
  $('result-card').hidden = true;
  setProgress(0, 1, '');
}

/* ----------------------------- Markdown rendering ----------------------------- */
function renderMarkdown(md) {
  if (!md) return '';
  const lines = md.split('\n');
  const out = [];
  let inList = false;
  let listType = 'ul';
  for (let line of lines) {
    // Escape first, then apply simple formatting
    let h = escapeHtml(line);
    h = h.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    h = h.replace(/`([^`]+)`/g, '<code>$1</code>');

    if (/^#{1,6}\s+/.test(line)) {
      closeList();
      const level = line.match(/^#+/)[0].length;
      const text = h.replace(/^#{1,6}\s+/, '');
      out.push(`<h${level + 2}>${text}</h${level + 2}>`);
    } else if (/^[\*\-]\s+/.test(line)) {
      openList('ul');
      out.push(`<li>${h.replace(/^[\*\-]\s+/, '')}</li>`);
    } else if (/^\d+\.\s+/.test(line)) {
      openList('ol');
      out.push(`<li>${h.replace(/^\d+\.\s+/, '')}</li>`);
    } else {
      closeList();
      out.push(h ? `<p>${h}</p>` : '<br>');
    }
  }
  closeList();
  return out.join('');

  function openList(type) {
    if (!inList) { out.push(type === 'ol' ? '<ol>' : '<ul>'); inList = true; listType = type; }
    else if (listType !== type) { closeList(); openList(type); }
  }
  function closeList() {
    if (inList) { out.push(listType === 'ol' ? '</ol>' : '</ul>'); inList = false; }
  }
}

/* ----------------------------- Export ----------------------------- */
function bindExport() {
  $('exportMd').onclick = () => download('SmartCity-Vision-Inspection-Report.md', buildMarkdown(), 'text/markdown');
  $('exportJson').onclick = () => download('SmartCity-Vision-Inspection-Report.json', JSON.stringify(state.results, null, 2), 'application/json');
}
function buildMarkdown() {
  const taskName = state.tasks[getTaskKey()]?.labelEn || state.tasks[getTaskKey()]?.name || 'Vision Inspection';
  let md = '# Smart City Vision Inspector — ' + taskName + ' Report\n\nGenerated at: ' + new Date().toLocaleString() + '\n\n';
  state.results.forEach(({ image, result }, i) => {
    md += `## ${i + 1}. ${image.name}\n`;
    if (result.error && !result.raw) { md += `> Analysis failed: ${result.error}\n\n`; return; }
    md += `- **Scene**: ${result.scene || '-'}\n- **Verdict**: ${result.verdict || '-'}\n`;
    if (result.elapsedMs != null || (result.usage && result.usage.total_tokens != null)) {
      let meta = [];
      if (result.elapsedMs != null) meta.push('latency ' + (result.elapsedMs / 1000).toFixed(1) + 's');
      if (result.usage && result.usage.total_tokens != null) meta.push('usage ' + result.usage.total_tokens + ' tokens');
      md += `- **Latency / Usage**: ${meta.join(' · ')}\n`;
    }
    if (result.description) md += `- **Overall analysis**:\n${result.description.split('\n').map((l) => '  ' + l).join('\n')}\n`;
    if (result.findings && result.findings.length) {
      md += '- **Issues / hazards found**:\n';
      result.findings.forEach((h) => {
        md += `  - **${h.type || 'Issue'}** (severity: ${h.severity || '-'})\n`;
        md += `    - Evidence: ${h.evidence || '-'}\n`;
        md += `    - Explanation: ${h.explanation || '-'}\n`;
        if (h.regulation) md += `    - Basis: ${h.regulation}\n`;
      });
    } else md += '- No obvious issues or hazards detected.\n';
    if (result.suggestions && result.suggestions.length) { md += '- **Recommended actions**:\n' + result.suggestions.map((s) => `  - ${s}`).join('\n') + '\n'; }
    md += '\n';
  });
  return md;
}
function download(name, content, type) {
  const blob = new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  URL.revokeObjectURL(a.href);
}

/* ----------------------------- Utilities ----------------------------- */
function setMsg(id, text, cls) {
  const el = $(id); if (!el) return;
  el.textContent = text; el.className = 'msg' + (cls ? ' ' + cls : '');
}
function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ----------------------------- Event binding ----------------------------- */
function bindEvents() {
  $('saveConfig').onclick = saveConfig;
  $('testConfig').onclick = testConfig;
  $('fetchModels').onclick = fetchModels;

  $('modeStandard').onclick = () => setMode('standard');
  $('modeAdvanced').onclick = () => setMode('advanced');
  $('presetSel').onchange = () => {
    const v = $('presetSel').value;
    if (v === '__new__') {
      state.currentPresetId = null;
      $('advName').value = ''; $('advBaseURL').value = ''; $('advModel').value = '';
      $('advApiKey').value = ''; $('advTemp').value = '0.2'; $('advVision').checked = true;
      setMsg('configMsg', 'Started a new preset — fill in the fields and click "Save Preset"', 'ok');
    } else {
      applyPreset(v);
    }
  };
  $('savePreset').onclick = savePreset;
  $('delPreset').onclick = deletePreset;
  $('advModel').oninput = syncAdvModel;

  bindKB();
  bindImages();
  bindExport();
}

init();
