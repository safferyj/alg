# Artificial Analysis Link Generator

This script creates an Artificial Analysis Intelligence Index URL using the
requested model, lab, name, weight-class, and count filters.

## Requirements

- Node.js 18 or newer
- Internet access

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
-f, --filter <string>  Keep only models whose names contain a filter string.
                       Separate alternatives with comma (",") for OR
                       matching. No spaces are allowed in the filter string.
-l, --lab              Keep only the best entry from each lab.
-m, --model            Keep only the best entry from each model.
-o, --open             Include open-weight models.
-c, --closed           Include closed-weight models.
-n, --min <n>          Include entries with a score at least n (adjusted by -0.5).
-x, --max <n>          Include entries with a score at most n (adjusted by -0.5).
-b, --before <date>    Include models released before YYYY-MM-DD (exclusive).
-a, --after <date>     Include models released on or after YYYY-MM-DD.
-u, --url <url>        Use the models from an existing Artificial Analysis URL.
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

## Filter an existing model set

Use `--url` when an existing Artificial Analysis link should act as a
fixed allowlist. Without additional filters, its model set is preserved. Other
filters are then applied only to models from that link; models outside it are
not added.

```bash
# Keep only the best variant for each model in the existing link
node alg.mjs --url "https://artificialanalysis.ai/?models=..." --model

# Get the top 10 entries from the existing link
node alg.mjs --url "https://artificialanalysis.ai/?models=..." --top 10

# Keep only open-weight entries from the existing link
node alg.mjs --url "https://artificialanalysis.ai/?models=..." --open
```

## How it works

1. Fetches the current Artificial Analysis model catalog and Intelligence Index
   scores.
2. Applies the requested release-date, open/closed weight-class, and score-range
   filters.
3. If requested, groups models by release family with `--model` or by lab with
   `--lab`, keeping the entry with the highest numeric Intelligence Index score
   in each group.
4. If `--top` is supplied, sorts the remaining entries by Intelligence Index
   score and keeps the top entries before printing a URL anchored to the
   Intelligence Index section.

If a grouping is requested and a group has no numeric score, the first catalog
entry is retained.
If an input URL refers to a model no longer in the current catalog, the script
stops and reports the missing model instead of silently changing the set.
