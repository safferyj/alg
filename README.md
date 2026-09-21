# Artificial Analysis Link Generator

This script creates an Artificial Analysis Intelligence Index URL using the
requested model, lab, name, release-date, size-class, weight-class, and count
filters. It can also export the selected models as merged JSON data.

## Requirements

- Node.js 18 or newer
- Internet access
- Network requests time out after 30 seconds.

No npm packages are required.

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
-t, --top <n>          Return the top n entries by Intelligence Index score.
-f, --filter <string>  Include only models whose names contain a filter string.
                       Separate alternatives with comma (",") for OR
                       matching. No spaces are allowed in the filter string.
-l, --lab              Include only the best entry from each lab.
-m, --model            Include only the best entry from each model.
-o, --open             Include open-weight models.
-c, --closed           Include closed-weight models.
-n, --min <n>          Include entries with a score at least n (adjusted by -0.5).
-x, --max <n>          Include entries with a score at most n (adjusted by -0.5).
-b, --before <date>    Include models released before YYYY-MM-DD (exclusive).
-a, --after <date>     Include models released on or after YYYY-MM-DD.
-s, --size <string>    Include only models in the specified AA size classes:
                       tiny, small, medium, large, unknown.
                       Separate alternatives with comma (",") for OR
                       matching. No spaces are allowed in the size string.
                       Some, but not all, closed-source models have a
                       known AA size class.
-d, --deprecated       Include only models marked as deprecated.
-r, --current          Include only models not marked as deprecated.
-j, --json             Write selected models to a timestamped JSON file.
-u, --url <url>        Use the models from an existing Artificial Analysis URL.
-h, --help             Show this help.
```

Without `--url`, all models in the current Artificial Analysis catalog are used.
With `--url`, the existing model set is preserved and all other filters are
applied only to that set.

`--filter` is a case-insensitive substring filter on model names. Separate
multiple alternatives with comma (`,`) to match any of them. **Do not include
spaces in the filter string.** For example:

```bash
node alg.mjs --filter qwen3.8,qwen3.6
```

The filter can be combined with every other option, including `--url`.

Without `--open` or `--closed`, both weight classes are included. Supplying both
includes both classes explicitly. Without `--lab` or `--model`, no grouping is
applied and the full requested model list is retained. `--lab` and `--model` are
alternative grouping modes; supplying both is redundant and has the same result
as `--lab`.

`--min` and `--max` are inclusive. Each user-supplied threshold is reduced by
`0.5` before it is compared with the raw decimal Intelligence Index score, to
align filtering with AA's rounded display. For example, `--min 40 --max 50`
uses raw thresholds of `39.5` and `49.5`. The flags can be combined:

```bash
node alg.mjs --min 40 --max 50 --model --top 10
```

Entries without a numeric score are excluded when either threshold is supplied.

`--before` is an exclusive release-date filter and `--after` is inclusive. Both
require a valid ISO calendar date in `YYYY-MM-DD` format. They can be combined
to define a release-date range:

```bash
node alg.mjs --after 2025-01-01 --before 2026-01-01
```

`--size` is case-insensitive. Separate multiple alternatives with comma (`,`) to
match any of them. **Do not include spaces in the size string.** Accepted values
are `tiny`, `small`, `medium`, `large`, and `unknown`. `unknown` includes models
for which AA does not provide a size class. Some, but not all, closed-source
models have a known AA size class, so closed-source models can appear in the
named classes as well as in `unknown`:

```bash
node alg.mjs --size large,medium
```

With neither `--deprecated` nor `--current`, no deprecation-status filtering
is applied. Supplying both includes both statuses explicitly. `--deprecated`
includes only models where `deprecated` is `true`; `--current` includes only
models where it is `false`. Here, current means that Artificial Analysis has
not marked the model as deprecated:

```bash
node alg.mjs --current --top 10
```

`--json` writes a merged JSON export in the current working directory while
continuing to print the Artificial Analysis URL to standard output. The
generated file path and any merge warnings are printed to standard error. The
export contains the final selected models, in descending Intelligence Index
order:

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
hard-coded. The matching source changelog entry is retained under
`intelligenceIndex.changelog`.

Each exported model is joined by slug from the catalog and manifest. Shared
fields appear only once. The manifest supplies shared values and richer nested
fields; catalog-only fields such as `effort` are added. If a shared value ever
differs, the manifest value is retained and a warning is written to standard
error. The filename uses the compact local timestamp format
`YYYYMMDD-HHmmss`, followed by long-form flag segments such as
`--lab--top-10`. The `--json` flag is omitted, as is the `--url` value. The
complete invocation flags and values, including a full `--url` value, are
retained in `arguments` metadata. The filename segments and `arguments` array
use this canonical execution order:
`--url`, `--filter`, `--before`, `--after`, `--size`, `--deprecated`,
`--current`, `--open`, `--closed`, `--min`, `--max`, `--model`, `--lab`,
`--top`, `--json`. Every argument uses
the full flag name, and value-taking flags are represented as separate
flag/value entries. For readability, each flag/value pair is formatted on one
line in the file; the parsed JSON remains the same flat argument array.
If the generated filename already exists, a numeric suffix such as `-1` or `-2`
is added instead of overwriting the existing export.

## Filter an existing model set

Use `--url` when an existing Artificial Analysis link should act as a
fixed allowlist. Without additional filters, its model set is preserved. Other
filters are then applied only to models from that link; models outside it are
not added.

```bash
# Include only the best variant for each model in the existing link
node alg.mjs --url "https://artificialanalysis.ai/?models=..." --model

# Get the top 10 entries from the existing link
node alg.mjs --url "https://artificialanalysis.ai/?models=..." --top 10

# Include only open-weight entries from the existing link
node alg.mjs --url "https://artificialanalysis.ai/?models=..." --open
```

## How it works

1. Fetches the current Artificial Analysis model catalog and Intelligence Index
   scores.
2. Applies the requested release-date, size-class, deprecated/current,
   open/closed weight-class, and score-range filters.
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
