# Artificial Analysis Link Generator

This script creates an Artificial Analysis Intelligence Index URL using the
requested model, lab, name, release-date, size-class, weight-class, and count
filters. It can also export the selected models as merged JSON data.

## Requirements

- Node.js 18 or newer
- Internet access
- Network requests time out after 30 seconds.

No npm packages are required.

```text
Usage:
  node alg.mjs [options]
```

## Linux: invoke as `alg`

From this directory, make the script executable and add a persistent Bash
alias:

```bash
chmod +x alg.mjs
echo "alias alg='$PWD/alg.mjs'" >> ~/.bashrc
source ~/.bashrc
```

You can then invoke it directly:

```bash
alg --model --top 10
```

## Generate a link for the current catalog

From this directory:

```bash
node alg.mjs
```

The filtered URL is printed to standard output. The summary reports how many
models were retained and which filters reduced the set.

## Options

```text
-o, --open             Include open-weight models.
-c, --closed           Include closed-weight models.
-g, --reasoning        Include reasoning models.
-i, --instruct         Include non-reasoning (instruct) models.
-r, --current          Include only models not marked as deprecated.
-d, --deprecated       Include only models marked as deprecated.
-b, --before <date>    Include models released before YYYY-MM-DD (exclusive).
-a, --after <date>     Include models released on or after YYYY-MM-DD.
-n, --min <n>          Include entries with a displayed score at least n.
-x, --max <n>          Include entries with a displayed score at most n.
-s, --size <string>    Include only models in the specified AA size classes:
                       tiny, small, medium, large, unknown.
                       Separate alternatives with comma (",") for OR
                       matching. No spaces are allowed in the size string.
                       Some, but not all, closed-source models have a
                       known AA size class.
-f, --filter <string>  Include only models whose names contain a filter string.
                       Separate alternatives with comma (",") for OR
                       matching. No spaces are allowed in the filter string.
-m, --model            Include only the best entry from each model.
-l, --lab              Include only the best entry from each lab.
-t, --top <n>          Return the top n entries by Intelligence Index score.
-u, --url <url>        Use the models from an existing Artificial Analysis URL.
-2, --two              Print two URLs, both the main entry page URL and
                       additionally the Models page URL.
-j, --json             Write selected models to a timestamped JSON file.
-h, --help             Show this help.
```

If neither `--open` nor `--closed` is specified, both weight classes are
included. Supplying both includes both classes explicitly.
When `--open` or `--closed` is active and a model has no weight-class data, the
model is excluded from that filter and a warning is printed.

If neither `--reasoning` nor `--instruct` is specified, both model response
styles are included. Supplying both includes both styles explicitly. `--reasoning`
includes only reasoning models, while `--instruct` includes only non-reasoning
models.
These flags use Artificial Analysis's `isReasoning` score-manifest field; if that
field is unavailable for a requested model, the model is excluded from the
filter and a warning is printed rather than guessing.

If neither `--current` nor `--deprecated` is specified, no deprecation-status
filtering is applied. Supplying both includes both statuses explicitly.
`--current` includes only models where `deprecated` is `false`; `--deprecated`
includes only models where it is `true`. Here, current means that Artificial
Analysis has not marked the model as deprecated:

```bash
node alg.mjs --current --top 10
```

When an active current/deprecated filter encounters a model without deprecation
data, the model is excluded from that filter and a warning is printed.

`--before` is an exclusive release-date filter and `--after` is inclusive. Both
require a valid ISO calendar date in `YYYY-MM-DD` format. They can be combined
to define a release-date range:

```bash
node alg.mjs --after 2025-01-01 --before 2026-01-01
```

Models without a valid release date are excluded from an active `--before` or
`--after` filter and a warning is printed.

`--min` and `--max` are inclusive against AA's rounded display score. To align
the raw decimal Intelligence Index score with that display, `--min n` uses a
raw lower bound of `n - 0.5`, while `--max n` uses an exclusive raw upper bound
of `n + 0.5`. For example, `--min 40 --max 50` includes raw scores from
`39.5` (inclusive) up to `50.5` (exclusive). Therefore, `--min 50 --max 50`
selects all models whose displayed score is 50. The flags can be combined:

```bash
node alg.mjs --min 40 --max 50 --model --top 10
```

Entries without a numeric score are excluded when either threshold is supplied.
When a score is missing while either threshold is active, a warning is printed.

`--size` is case-insensitive. Separate multiple alternatives with comma (`,`) to
match any of them. **Do not include spaces in the size string.** Accepted values
are `tiny`, `small`, `medium`, `large`, and `unknown`. `unknown` includes models
for which AA does not provide a size class. Some, but not all, closed-source
models have a known AA size class, so closed-source models can appear in the
named classes as well as in `unknown`:

```bash
node alg.mjs --size large,medium
```

When `--size` is active and a model has no size-class data, a warning is printed
and the model is treated as `unknown`.

`--filter` is a case-insensitive substring filter on model names. Separate
multiple alternatives with comma (`,`) to match any of them. **Do not include
spaces in the filter string.** For example:

```bash
node alg.mjs --filter qwen3.8,qwen3.6
```

The filter can be combined with every other option, including `--url`.
Models without a name are excluded from an active `--filter` and a warning is
printed.

Without `--model` or `--lab`, no grouping is applied and the full requested model
list is retained. `--model` and `--lab` are alternative grouping modes; supplying
both is redundant and has the same result as `--lab`.

When `--model` encounters a model without release data, it prints a warning and
retains that model as an ungrouped entry.

When `--lab` encounters a model without lab data, it prints a warning and
retains that model as an ungrouped entry.

Without `--url`, all models in the current Artificial Analysis catalog are used.

Use `--url` when an existing `alg` generated Artificial Analysis link should act
as a fixed allowlist. Without additional filters, its model set is preserved.
Other filters are then applied only to models from that link; models outside it
are not added:

```bash
# Include only the best variant for each model in the existing link
node alg.mjs --url "https://artificialanalysis.ai/?models=..." --model

# Get the top 10 entries from the existing link
node alg.mjs --url "https://artificialanalysis.ai/?models=..." --top 10

# Include only open-weight entries from the existing link
node alg.mjs --url "https://artificialanalysis.ai/?models=..." --open
```

`--two` prints the main entry page URL, followed by a blank line and a Models
page URL containing the same selected models. The two pages have some sections
in common, but they also have differences in their page-specific sections and
presentation:

```text
https://artificialanalysis.ai/?models=...#intelligence

https://artificialanalysis.ai/models?models=...#intelligence

```

`--json` writes a merged JSON export in the current working directory. When
`--json` is used, the resulting Artificial Analysis URL or URLs are still
printed to standard output. The JSON file path and any merge warnings are
printed to standard error. The export contains the final selected models, in
descending Intelligence Index order:

```json
{
  "generatedAt": "2026-09-20T12:35:47",
  "arguments": [
    "--top", "10",
    "--json"
  ],
  "intelligenceIndex": {
    "version": "v4.3.2",
    "changelog": {
      "dateLa": "2026-09-19",
      "type": "methodologyUpdated",
      "title": "Artificial Analysis Intelligence Index v4.3.2",
      "url": "/methodology/intelligence-benchmarking"
    }
  },
  "models": []
}
```

The `intelligenceIndex.version` value is extracted from the latest
`methodologyUpdated` entry in the downloaded score manifest rather than being
hard-coded. If the manifest does not include a methodology entry, the current
Artificial Analysis page metadata is used instead. The source or derived
metadata is retained under `intelligenceIndex.changelog`.

Each exported model is joined by slug from the catalog and manifest. Shared
fields appear only once. The manifest supplies shared values and richer nested
fields; catalog-only fields such as `effort` are added. If a shared value ever
differs, the manifest value is retained and a warning is written to standard
error. The filename uses the compact local timestamp format
`YYYYMMDD-HHmmss`, followed by long-form flag segments such as
`--lab--top-10`. The `--json` and `--two` flags are omitted, as is the `--url`
value. The complete invocation flags and values, including a full `--url`
value, are retained in `arguments` metadata. The filename segments and
`arguments` array use this canonical execution order:
`--open`, `--closed`, `--reasoning`, `--instruct`, `--current`, `--deprecated`,
`--before`, `--after`, `--min`, `--max`, `--size`, `--filter`, `--model`,
`--lab`, `--top`, `--url`, `--two`, `--json`, `--help`. Every argument uses
the full flag name, and value-taking flags are represented as separate
flag/value entries. For readability, each flag/value pair is formatted on one
line in the file; the parsed JSON remains the same flat argument array.
If the generated filename already exists, a numeric suffix such as `-1` or `-2`
is added instead of overwriting the existing export.

## How it works

1. Fetches the current Artificial Analysis model catalog and Intelligence Index
   scores.
2. Applies the requested release-date, size-class, deprecated/current,
   open/closed weight-class, instruct/reasoning response-style, and score-range
   filters.
3. If requested, groups models by release family with `--model` or by lab with
   `--lab`, keeping the entry with the highest numeric Intelligence Index score
   in each group.
4. Sorts the remaining entries by descending Intelligence Index score.
5. If `--top` is supplied, keeps the top entries before printing a URL anchored
   to the Intelligence Index section.
6. If `--json` is supplied, joins the final selected models and writes the
   merged JSON export before printing the URL.

If a grouping is requested and a group has no numeric score, the first catalog
entry is retained.

If an input URL refers to a model no longer in the current catalog, the script
stops and reports the missing model instead of silently changing the set.

## Testing

Run the deterministic unit, fixture, and CLI integration tests with:

```bash
npm test
```

These tests use checked-in synthetic Artificial Analysis payloads and do not
need network access. The live smoke test is separate because it makes a network
request and the catalog and page schema can change:

```bash
npm run test:live
```

The live test checks only stable invariants such as successful catalog
discovery, a non-empty result, and a valid Artificial Analysis URL. GitHub
Actions runs the deterministic suite on Node.js 18 and 22; it does not depend
on Artificial Analysis availability.
