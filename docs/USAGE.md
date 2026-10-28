# Using the platform

A walkthrough of the interface, from a running server to an exported report.
Deployment instructions are in [DEPLOYMENT.md](DEPLOYMENT.md).

## Before you start

The platform does not perform inference itself. It sends the image to a vision
language model that you connect with your own API key, so you need one key from a
supported provider.

| Provider | Where to get a key | Free tier |
|---|---|---|
| Alibaba Qwen | <https://dashscope.aliyun.com> | yes, monthly token allowance |
| Zhipu GLM | <https://open.bigmodel.cn> | yes, GLM-4V-Flash is free |
| Moonshot Kimi | <https://platform.moonshot.cn> | trial credit |
| Tencent Hunyuan | <https://console.cloud.tencent.com/tokenhub> | trial credit |
| DeepSeek | <https://platform.deepseek.com> | pay as you go |
| OpenAI | <https://platform.openai.com> | pay as you go |

The key is entered in the browser and stored in `localStorage`. It is never
written to disk by the server and is sent only to the provider you selected.

Without a key the interface still loads. You can browse every panel, upload
regulation documents, and read the six real reports in `samples/outputs/`.

## The four panels

The page is arranged as four numbered panels, top to bottom.

### ① Model configuration

- **Standard mode**: choose a provider, then a model from its preset list. Models
  whose names contain `vision`, `vl` or `4v` accept images.
- **Advanced mode**: enter any `baseURL`, any model id, and mark whether the model
  is vision-capable. Presets can be saved, recalled and deleted; they persist in
  `localStorage`, so a newly released model can be used without editing code.
- **Temperature**: most models accept any value. A few recent ones only accept
  `1`; the presets already use safe defaults.
- **Test connection** verifies the key and endpoint before you spend tokens, and
  **Fetch model list** shows the models your account can actually access.

### ② Task and prompt

Select a scene profile:

| Profile | Looks for |
|---|---|
| Fire Hazard Inspection | blocked evacuation routes, extinguisher condition, combustible storage, electrical risks |
| Security Monitoring | unauthorised entry, suspicious behaviour, perimeter damage, equipment faults |
| Traffic Order | illegal parking, road occupation, congestion, signal violations |
| Public Order Patrol | fighting, theft, vandalism, unlawful assembly, unattended items |
| Custom | whatever you write in the prompt box |

The prompt box is pre-filled with the profile's default question. Edit it freely
before analysing; the text is sent to the model verbatim.

### ③ Knowledge base

- Tick **knowledge base enhancement** to have findings cited against regulations.
- Upload regulation documents (`.txt`, `.md`, `.json`, `.csv`, `.pdf`) or paste
  text directly. Documents are chunked and scoped to a scene, so a fire-hazard run
  never cites a traffic clause.
- Four sample clause sets are seeded automatically on first run. Replace them with
  your own regulations to target a different jurisdiction.

With enhancement enabled, analysis runs in two stages: the model first names the
scene and keywords, then those keywords retrieve clauses, and the final judgement
is made against the retrieved clauses. This roughly doubles latency and token
usage, and is what makes the clause citations traceable.

### ④ Images and analysis

- Drag images in, or click to select. Multiple images are analysed sequentially.
- Photographs larger than 200 KB are downscaled in the browser before upload.
- Press **Start analysis**. Each image takes roughly 20 to 40 seconds depending on
  the provider.
- Results appear below as they complete, with a summary at the top.

## Reading a result

Each result card contains:

- **Scene** and a Markdown analysis of what was observed.
- **Findings**, each with a severity badge and three fields:
  - *Evidence*: what was visible in the image;
  - *Explanation*: why it is a risk;
  - *Basis*: the regulation clause it violates.
- **Verdict**, a one-sentence overall judgement.
- **Remediation**, numbered and actionable.
- **Cited clauses**, the knowledge-base chunks the retrieval step selected.
- **Metadata**: risk level, confidence, elapsed time and token usage.

The risk badge (`safe`, `warn`, `danger`) is computed by the server from the
severities of the findings, not from the verdict text. A response whose prose says
"no problem" while listing a high-severity finding is still shown as danger.

## Exporting

Two buttons at the bottom of the results area:

- **Markdown** produces a report suitable for pasting into a ticket or document.
- **JSON** produces the full structured response, including raw findings, token
  usage and the retrieved clauses, for importing into another system.

## Typical workflow for an inspection round

1. Upload the regulations that apply to the sites you are inspecting (once).
2. Select the matching scene profile.
3. Drag in the photographs from the round.
4. Review the results, correct the prompt if the model focuses on the wrong
   things, and re-run.
5. Export as Markdown for the field team and as JSON for the statistics pipeline.

## Cost and latency

Vision models are billed per image and per token, and cost varies widely between
providers. Two things reduce it substantially:

- Images are downscaled before upload, and image tokens scale with image size.
- Disabling knowledge base enhancement halves the number of model calls.

Every run reports its token usage, so providers can be compared on measured
numbers rather than estimates.

## Troubleshooting

| Message | Meaning |
|---|---|
| `Upstream did not return JSON (HTTP 502 ...)` | A gateway, not the provider, rejected the request. Usually an oversized image; the client compresses uploads, so retry. |
| `Model returned 401` | The API key is wrong, expired, or for a different provider. |
| `Current model does not support image input` | Pick a vision model, or tick the vision flag in advanced mode. |
| `Model returned 429` | Rate limit or exhausted credit on the provider account. |
| Result card says *Analysis failed* | Hover the message; it names the failing stage. |
