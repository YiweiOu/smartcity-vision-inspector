# Sample dataset

This folder contains a privacy-screened sample set that can be run through the
platform immediately after cloning, together with the outputs the platform
produced for those exact images. It allows the result quality to be assessed
without configuring an API key first.

## Contents

```
samples/
├── images/            6 sample photographs across 3 scenes
│   ├── fire/              blocked exit, extinguishers blocked, fire alarm panel
│   ├── traffic/           vehicles parked on the sidewalk
│   └── urban-governance/  street vendors occupying a junction (aerial view)
└── outputs/           the analysis results for those images (JSON + Markdown)
```

Every file in `outputs/` was produced by running the matching image in `images/`
through this platform, using two-stage knowledge-enhanced analysis on
`qwen-vl-max` at `temperature 0.2`. No output has been mocked or hand-edited. The
findings, clause citations, confidence score and token counts are what the model
returned, and the JSON files retain the raw API response, including `usage` and
`retrievedClauses`.

## Privacy screening

Each image was reviewed manually before inclusion:

- images containing **identifiable faces** were excluded;
- images containing **readable licence plates** were included only after the plate
  had been destroyed with mosaic and Gaussian blur (see `traffic/`);
- imagery originating from surveillance or violence datasets was excluded
  entirely. For this reason the sample set contains no security scene, although the
  platform supports one.

| Scene | Files | Processing applied |
|---|---|---|
| Fire hazard | 3 | none required (no people, no plates) |
| Traffic order | 2 | licence plates mosaic-blurred |
| Urban governance | 1 | none required (high-angle view; people occupy a few pixels) |

The same screening should be applied before publishing any additional runs: blur
faces and plates, and use only images whose licence permits redistribution.

## Sources and licensing

The sample photographs were collected from publicly accessible web pages (a
municipal government fire-safety awareness article and public news pages) and are
included here at reduced resolution, strictly as test fixtures. Copyright remains
with the original authors. Rights holders who wish to have an image removed may
open an issue and it will be taken down.

## Reproducing the results

```bash
npm install && npm start          # then open http://localhost:3000
```

Select **Alibaba Qwen**, model `qwen-vl-max`, enter an API key, enable
**knowledge-base enhancement**, and analyse one of the images in
`samples/images/`. Results will be similar but not identical, since sampling is
not fully deterministic.

`samples/reproduce.py` regenerates the whole set from a running instance:

```bash
python samples/reproduce.py <port> <api-key> <model>
```

## Why the reports cite Chinese regulations

The bundled knowledge base references PRC legislation and national standards: the
Fire Protection Law of the PRC (《中华人民共和国消防法》), the Road Traffic Safety
Law of the PRC (《中华人民共和国道路交通安全法》), GB 50140, GB/T 13869 and others.
Findings are cited against those clauses, and each citation keeps the original
Chinese name beside the English gloss so that the reference can be verified
against the source statute.

The interface, the prompts and the report body are in English. To target another
jurisdiction, replace the prompts in `TASKS` and the seed documents in
`seedScenes()`. Both are plain text in `server.js`.
