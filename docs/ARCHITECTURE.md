# Architecture

This document describes the design of Smart City Vision Inspector: the role of each
component, the reasoning behind the structure, and the failure modes the
implementation accounts for.

## 1. Overall structure

The system consists of three components:

```
Browser (SPA, no framework)  ──►  Express server  ──►  Vision LLM provider
                                        │
                                        └──►  Regulation knowledge base (JSON, on disk)
```

- **No build step.** The frontend is plain HTML/CSS/JS served statically, so
  checkout and startup require two commands.
- **The server is a proxy, not a key store.** It forwards the user's key to the
  selected provider and does not persist any secret.
- **Single process.** Knowledge-base retrieval, prompt assembly and risk scoring
  all reside in `server.js`.

## 2. Request flow for one analysis

```
POST /api/analyze  { image(dataURL), config, options }
  │
  ├─ payload guard        rejects image payloads above 4 MB with a 413
  │
  ├─ [knowledge-enhanced] stage 1: scene naming plus 8-15 keywords
  │                         └─▶ retrieve the top-N clauses for that scene
  ├─ stage 2: system prompt = expert persona + user question + clauses
  │            user message = image + user prompt
  │
  ├─ callLLM()            vision-LLM proxy
  ├─ parseVerdict()       JSON extraction from the model's reply
  ├─ computeRisk()        risk level derived from finding severities
  └─ 200 { findings, verdict, suggestions, riskLevel, elapsedMs, usage, ... }
```

The two-stage split exists because the knowledge base is lexical. Querying it with
the user's raw question ("is there anything wrong here?") scores poorly, whereas
asking the model to name the scene and a set of concrete keywords first produces
terms the retriever can match.

## 3. The knowledge base

`data/knowledge.json` stores documents; each document is chunked into pieces of
roughly 250 characters at load time. Retrieval scores the overlap between chunk and
query using Chinese bigrams plus English tokens, with a scene filter so that a
fire-hazard run cannot cite a traffic clause.

A lexical scorer was chosen over embeddings because it has no additional
dependencies, is fully reproducible, and is adequate when the query is a list of
domain keywords produced by the model. Embedding-based retrieval is on the roadmap
and is isolated inside `retrieve()`.

## 4. Communication with providers

`callLLM(config, messages)` normalises the base URL (appending `/v1` when missing)
and sends `{ model, messages, temperature? }` with `Accept: application/json` and an
explicit `User-Agent`.

Three safeguards surround this call:

1. **`readJSONResponse()`** reads the body as text, checks the content type and only
   then parses it. On failure it raises an error containing the status code, the
   content type, the final URL after redirects and the HTML page title. This is what
   distinguishes "the upstream returned an HTML 502 page" from an unexplained
   `Unexpected token '<'`.
2. **Parameter fallback.** On a parameter or gateway rejection the request is
   retried with `temperature = 1` and then with the parameter omitted.
   Authentication, quota and content-policy errors are never retried.
3. **Process guards.** `unhandledRejection` and `uncaughtException` handlers log
   instead of exiting, so a faulty response from one provider cannot terminate the
   service.

## 5. Image handling

Uploads are downscaled in the browser through a ladder
(1280 px/q0.82 → 1024/q0.72 → 800/q0.62 → 640/q0.55) until the data URL fits a
budget of roughly 450 KB; images already below 200 KB pass through unchanged. Two
reasons motivate this:

- Cloud ingresses reject multi-megabyte bodies before the request reaches the
  application and return an HTML error page the frontend cannot parse.
- Vision APIs bill by image size, so smaller uploads cost proportionally less.

A result above 1.2 MB is flagged in the interface rather than sent silently.

## 6. Risk scoring

`computeRisk()` maps the severities of the parsed findings to `danger`, `warn` or
`safe`. It runs on the server and derives the level from the structured `severity`
values, so a reply whose prose states "no problem" while listing a blocked
evacuation route is still classified as danger. Missing severities are treated
conservatively (`warn` rather than `safe`).

## 7. Known failure modes

| Symptom | Cause | Handled by |
|---|---|---|
| `Unexpected token '<'` | Gateway HTML error page | `readJSONResponse()` and a client-side content-type check |
| Connection test passes but analysis fails | The test sent a small body, the real request a large one | `/api/test` validates the body shape; the client compresses images |
| Server exits after a provider 401 | `catch` block referencing a `try`-scoped variable | Fixed, plus process-level guards |
| Model rejects low temperature | Some newer models only accept `temperature = 1` | Parameter fallback ladder |
| Findings report a blocked exit, verdict states "safe" | Model prose contradicts the structured data | Server-side `computeRisk()` |

## 8. Adding a scene

Add one entry to `TASKS` in `server.js`:

```js
noise: {
  labelEn: 'Noise Nuisance',            // label shown in the UI
  name: 'Noise nuisance inspection',    // used inside the prompt
  defaultPrompt: '…',
  keywords: 'noise construction loudspeaker …',
  expert: 'urban environmental noise specialist',
}
```

Then add matching seed clauses to `seedScenes()` so that knowledge-enhanced
analysis works without extra configuration. The interface picks up both
automatically. Each seed clause should cite a verifiable regulation, since the
model uses those citations verbatim in its findings.
