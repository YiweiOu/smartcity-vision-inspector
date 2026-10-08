# Contributing

Issues and pull requests are welcome.

## Reporting a problem

Please open an issue and include:

- the steps taken: provider, model, scene, and whether knowledge enhancement was
  enabled;
- the exact error text. Error messages in this project are written to name the
  failing stage, so the text usually identifies the cause directly;
- for parsing problems, the raw response if it can be shared.

## Adding a scene profile

Scene profiles are defined in `TASKS` in `server.js`. A complete contribution
consists of:

1. a `labelEn`, `name`, `defaultPrompt`, `keywords` and `expert` entry;
2. matching seed clauses in `seedScenes()`, each citing a verifiable regulation or
   standard;
3. one privacy-screened sample image, with no identifiable faces and no readable
   licence plates;
4. the output the platform produced for that image, committed as JSON and Markdown
   under `samples/outputs/`.

Outputs must not be fabricated. Run the image through the platform and commit what
it returned. The JSON files retain the raw response so that results remain
auditable.

## Code style

- The frontend has no build step and no framework; please keep it that way.
- Server-side changes must pass `node --check server.js`.
- Comments explain the reasoning behind a decision, not the syntax of the code.

## Privacy

Anything added to `samples/` must be safe to publish. Blur faces and licence
plates, use only images whose licence permits redistribution, and record the
source of each image in `samples/README.md`.
