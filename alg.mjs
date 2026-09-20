#!/usr/bin/env node

import { createHash, createDecipheriv } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

const SITE = "https://artificialanalysis.ai";
const INDEX_HASH = "artificial-analysis-intelligence-index";
const SCORE_DISPLAY_OFFSET = 0.5;
const SIZE_CLASSES = new Set(["tiny", "small", "medium", "large", "unknown"]);
const LONG_OPTION_NAMES = new Map([
  ["-t", "--top"],
  ["-f", "--filter"],
  ["-l", "--lab"],
  ["-m", "--model"],
  ["-o", "--open"],
  ["-c", "--closed"],
  ["-n", "--min"],
  ["-x", "--max"],
  ["-b", "--before"],
  ["-a", "--after"],
  ["-s", "--size"],
  ["-j", "--json"],
  ["-u", "--url"],
]);
const VALUE_OPTIONS = new Set([
  "--top",
  "--filter",
  "--min",
  "--max",
  "--before",
  "--after",
  "--size",
  "--url",
]);
const CANONICAL_OPTION_ORDER = new Map([
  ["--url", 0],
  ["--filter", 1],
  ["--before", 2],
  ["--after", 3],
  ["--size", 4],
  ["--open", 5],
  ["--closed", 6],
  ["--min", 7],
  ["--max", 8],
  ["--model", 9],
  ["--lab", 10],
  ["--top", 11],
  ["--json", 12],
]);

function printUsage() {
  console.log(`alg - Artificial Analysis Link Generator

Usage:
  node alg.mjs [options]

Options:
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
  -s, --size <string>    Keep only models in the specified AA size classes:
                         tiny, small, medium, large, unknown.
                         Separate alternatives with comma (",") for OR
                         matching. No spaces are allowed in the size string.
                         Some, but not all, closed-source models have a
                         known AA size class.
  -j, --json             Write selected models to a timestamped JSON file.
  -u, --url <url>        Preserve the models from an existing Artificial Analysis URL.
  -h, --help             Show this help.

Without --url, all models in the current Artificial Analysis catalog are used.
With --url, the existing model set is preserved and all other filters are
applied only to that set.

With neither --open nor --closed, both weight classes are included. Supplying both
includes both classes explicitly. Without --lab or --model, no grouping is applied.
--lab and --model are alternative grouping modes; supplying both is redundant and
has the same result as --lab.

With --json, the URL is still printed to stdout. The JSON file path and merge
warnings are printed to stderr. The filename uses a compact local timestamp
and canonical execution-order flag segments; --json is omitted and the --url
value is omitted from the filename but retained in the JSON arguments metadata.
The JSON arguments use full long-form flag names and separate value entries.
The export also records the current Intelligence Index version and its source
changelog entry.`);
}

function isObject(value) {
  return value !== null && typeof value === "object";
}

function walk(value, visitor) {
  if (!isObject(value)) {
    return;
  }

  visitor(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      walk(item, visitor);
    }
    return;
  }

  for (const child of Object.values(value)) {
    walk(child, visitor);
  }
}

function findModelCatalog(payloads) {
  for (const payload of payloads) {
    let catalog;
    walk(payload.value, (value) => {
      if (catalog || !Array.isArray(value.models) || value.models.length < 100) {
        return;
      }

      const modelEntries = value.models.filter(
        (model) =>
          isObject(model) &&
          typeof model.slug === "string" &&
          isObject(model.release) &&
          typeof model.release.slug === "string",
      );
      if (modelEntries.length >= value.models.length * 0.8) {
        catalog = value.models;
      }
    });
    if (catalog) {
      return catalog;
    }
  }
  throw new Error("Could not find the current Artificial Analysis model catalog.");
}

function extractFlightPayloads(html) {
  const payloads = [];
  const pattern =
    /<script>self\.__next_f\.push\(\[1,(.*?)\]\)<\/script>/gs;

  for (const match of html.matchAll(pattern)) {
    let payload;
    try {
      payload = JSON.parse(match[1]);
    } catch {
      continue;
    }

    const separator = payload.indexOf(":");
    if (separator === -1) {
      continue;
    }

    try {
      payloads.push({
        id: payload.slice(0, separator),
        value: JSON.parse(payload.slice(separator + 1)),
      });
    } catch {
      continue;
    }
  }

  if (payloads.length === 0) {
    throw new Error("Could not parse the Artificial Analysis page payload.");
  }
  return payloads;
}

function findManifestReferences(payloads) {
  const references = new Map();
  for (const payload of payloads) {
    walk(payload.value, (value) => {
      if (
        typeof value.path === "string" &&
        value.path.startsWith("/data/") &&
        typeof value.key === "string" &&
        /^[0-9a-f]{64}$/i.test(value.key)
      ) {
        references.set(`${value.path}:${value.key}`, {
          path: value.path,
          key: value.key,
        });
      }
    });
  }
  return [...references.values()];
}

async function decryptManifest(reference) {
  const key = Buffer.from(reference.key, "hex");
  const nonce = createHash("sha256").update(key).digest().subarray(0, 12);
  const response = await fetch(`${SITE}${reference.path}`);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }

  const ciphertext = Buffer.from(await response.arrayBuffer());
  if (ciphertext.length <= 16) {
    throw new Error("Manifest payload is too short.");
  }

  const decipher = createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAuthTag(ciphertext.subarray(-16));
  const compressed = Buffer.concat([
    decipher.update(ciphertext.subarray(0, -16)),
    decipher.final(),
  ]);
  return JSON.parse(gunzipSync(compressed).toString("utf8"));
}

async function findScoreManifest(payloads) {
  const references = findManifestReferences(payloads);
  const failures = [];

  for (const reference of references) {
    try {
      const data = await decryptManifest(reference);
      if (
        isObject(data) &&
        Array.isArray(data.models) &&
        data.models.some(
          (model) =>
            isObject(model) &&
            typeof model.slug === "string" &&
            Object.hasOwn(model, "intelligenceIndex"),
        )
      ) {
        return data;
      }
    } catch (error) {
      failures.push(`${reference.path}: ${error.message}`);
    }
  }

  const detail = failures.length ? `\n${failures.join("\n")}` : "";
  throw new Error(`Could not find the Artificial Analysis score manifest.${detail}`);
}

function findIntelligenceIndexMetadata(scoreManifest) {
  const changelogEntries = Array.isArray(scoreManifest.changelog)
    ? scoreManifest.changelog
    : [];
  const changelogEntry = changelogEntries.find(
    (entry) =>
      isObject(entry) &&
      entry.type === "methodologyUpdated" &&
      typeof entry.title === "string",
  );
  const version = changelogEntry?.title.match(/\bv\d+(?:\.\d+)+\b/i)?.[0];
  if (!changelogEntry || !version) {
    throw new Error(
      "Could not determine the Intelligence Index version from the score manifest changelog.",
    );
  }

  return {
    version,
    changelog: { ...changelogEntry },
  };
}

function parseTop(value) {
  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error("--top requires a positive integer.");
  }

  const top = Number(value);
  if (!Number.isSafeInteger(top)) {
    throw new Error("--top is too large.");
  }
  return top;
}

function parseScore(value, option) {
  const score = Number(value);
  if (!value || !Number.isFinite(score)) {
    throw new Error(`${option} requires a finite number.`);
  }
  return score;
}

function isValidIsoDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const isLeapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [
    31,
    isLeapYear ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];

  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth[month - 1];
}

function parseDate(value, option) {
  if (!isValidIsoDate(value)) {
    throw new Error(`${option} requires a valid date in YYYY-MM-DD format.`);
  }
  return value;
}

function parseSizeClasses(value, option) {
  const classes = value.split(",").map((sizeClass) => sizeClass.trim().toLowerCase());
  const invalid = classes.filter((sizeClass) => !SIZE_CLASSES.has(sizeClass));
  if (!value || classes.some((sizeClass) => !sizeClass) || invalid.length) {
    const invalidValues = [...new Set(invalid)].join(", ");
    const detail = invalidValues ? ` Invalid value(s): ${invalidValues}.` : "";
    throw new Error(
      `${option} requires comma-separated size classes: tiny, small, medium, large, unknown.${detail}`,
    );
  }
  return new Set(classes);
}

function parseArguments(args) {
  const options = {
    inputUrl: null,
    top: null,
    nameFilter: null,
    lab: false,
    model: false,
    open: false,
    closed: false,
    minScore: null,
    maxScore: null,
    beforeDate: null,
    afterDate: null,
    sizeClasses: null,
    json: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "-u" || arg === "--url") {
      const value = args[index + 1];
      if (!value || value.startsWith("-")) {
        throw new Error("--url requires a URL.");
      }
      options.inputUrl = new URL(value);
      index += 1;
    } else if (arg.startsWith("--url=")) {
      const value = arg.slice("--url=".length);
      if (!value) {
        throw new Error("--url requires a URL.");
      }
      options.inputUrl = new URL(value);
    } else if (arg === "-t" || arg === "--top") {
      const value = args[index + 1];
      if (!value || value.startsWith("-")) {
        throw new Error("--top requires a positive integer.");
      }
      options.top = parseTop(value);
      index += 1;
    } else if (arg.startsWith("--top=")) {
      options.top = parseTop(arg.slice("--top=".length));
    } else if (arg === "-f" || arg === "--filter") {
      const value = args[index + 1];
      if (!value || value.startsWith("-")) {
        throw new Error("--filter requires a string.");
      }
      options.nameFilter = value;
      index += 1;
    } else if (arg.startsWith("--filter=")) {
      const value = arg.slice("--filter=".length);
      if (!value) {
        throw new Error("--filter requires a string.");
      }
      options.nameFilter = value;
    } else if (arg === "-l" || arg === "--lab") {
      options.lab = true;
    } else if (arg === "-m" || arg === "--model") {
      options.model = true;
    } else if (arg === "-o" || arg === "--open") {
      options.open = true;
    } else if (arg === "-c" || arg === "--closed") {
      options.closed = true;
    } else if (arg === "-n" || arg === "--min") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--min requires a finite number.");
      }
      options.minScore = parseScore(value, "--min") - SCORE_DISPLAY_OFFSET;
      index += 1;
    } else if (arg.startsWith("--min=")) {
      options.minScore =
        parseScore(arg.slice("--min=".length), "--min") - SCORE_DISPLAY_OFFSET;
    } else if (arg === "-x" || arg === "--max") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--max requires a finite number.");
      }
      options.maxScore = parseScore(value, "--max") - SCORE_DISPLAY_OFFSET;
      index += 1;
    } else if (arg.startsWith("--max=")) {
      options.maxScore =
        parseScore(arg.slice("--max=".length), "--max") - SCORE_DISPLAY_OFFSET;
    } else if (arg === "-b" || arg === "--before") {
      const value = args[index + 1];
      if (!value || value.startsWith("-")) {
        throw new Error("--before requires a date in YYYY-MM-DD format.");
      }
      options.beforeDate = parseDate(value, "--before");
      index += 1;
    } else if (arg.startsWith("--before=")) {
      options.beforeDate = parseDate(arg.slice("--before=".length), "--before");
    } else if (arg === "-a" || arg === "--after") {
      const value = args[index + 1];
      if (!value || value.startsWith("-")) {
        throw new Error("--after requires a date in YYYY-MM-DD format.");
      }
      options.afterDate = parseDate(value, "--after");
      index += 1;
    } else if (arg.startsWith("--after=")) {
      options.afterDate = parseDate(arg.slice("--after=".length), "--after");
    } else if (arg === "-s" || arg === "--size") {
      const value = args[index + 1];
      if (!value || value.startsWith("-")) {
        throw new Error("--size requires a comma-separated list of size classes.");
      }
      options.sizeClasses = parseSizeClasses(value, "--size");
      index += 1;
    } else if (arg.startsWith("--size=")) {
      options.sizeClasses = parseSizeClasses(arg.slice("--size=".length), "--size");
    } else if (arg === "-j" || arg === "--json") {
      options.json = true;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (
    options.minScore !== null &&
    options.maxScore !== null &&
    options.minScore > options.maxScore
  ) {
    throw new Error("--min cannot be greater than --max.");
  }

  if (
    options.afterDate !== null &&
    options.beforeDate !== null &&
    options.afterDate >= options.beforeDate
  ) {
    throw new Error("--after must be earlier than --before.");
  }

  return options;
}

function indexCatalogModels(requestedSlugs, catalog) {
  const catalogBySlug = new Map(catalog.map((model) => [model.slug, model]));
  const missing = requestedSlugs.filter((slug) => !catalogBySlug.has(slug));
  if (missing.length) {
    throw new Error(
      `The current catalog no longer contains ${missing.length} requested model(s): ${missing.join(", ")}`,
    );
  }
  return catalogBySlug;
}

function selectBestByGroup(requestedSlugs, catalogBySlug, scoresBySlug, getGroupKey) {
  const groups = new Map();
  for (const slug of requestedSlugs) {
    const model = catalogBySlug.get(slug);
    const groupKey = getGroupKey(model, scoresBySlug.get(slug));
    const group = groups.get(groupKey) ?? [];
    group.push(model);
    groups.set(groupKey, group);
  }

  const selected = [];
  for (const group of groups.values()) {
    let best = group[0];
    let bestScore = scoresBySlug.get(best.slug)?.intelligenceIndex;
    bestScore = Number.isFinite(bestScore) ? bestScore : Number.NEGATIVE_INFINITY;

    for (const candidate of group.slice(1)) {
      let score = scoresBySlug.get(candidate.slug)?.intelligenceIndex;
      score = Number.isFinite(score) ? score : Number.NEGATIVE_INFINITY;
      if (score > bestScore) {
        best = candidate;
        bestScore = score;
      }
    }
    selected.push(best.slug);
  }

  const requestedOrder = new Map(requestedSlugs.map((slug, index) => [slug, index]));
  selected.sort((a, b) => requestedOrder.get(a) - requestedOrder.get(b));
  return selected;
}

function selectHighestScoringVariants(requestedSlugs, catalogBySlug, scoresBySlug) {
  return selectBestByGroup(
    requestedSlugs,
    catalogBySlug,
    scoresBySlug,
    (model) => model.release?.slug ?? model.slug,
  );
}

function selectHighestScoringLabs(requestedSlugs, catalogBySlug, scoresBySlug) {
  return selectBestByGroup(
    requestedSlugs,
    catalogBySlug,
    scoresBySlug,
    (model, scoreModel) => {
      const creator = scoreModel?.creator ?? model.creator;
      const lab = creator?.slug ?? creator?.id ?? creator?.name;
      if (!lab) {
        throw new Error(`Could not determine the lab for model ${model.slug}.`);
      }
      return lab;
    },
  );
}

function filterByWeight(requestedSlugs, scoresBySlug, options) {
  if (options.open === options.closed) {
    return requestedSlugs;
  }

  const wantedOpenWeight = options.open;
  const unclassified = [];
  const selected = requestedSlugs.filter((slug) => {
    const isOpenWeights = scoresBySlug.get(slug)?.isOpenWeights;
    if (typeof isOpenWeights !== "boolean") {
      unclassified.push(slug);
      return false;
    }
    return isOpenWeights === wantedOpenWeight;
  });

  if (unclassified.length) {
    throw new Error(
      `Could not determine the weight class for ${unclassified.length} requested model(s): ${unclassified.join(", ")}`,
    );
  }

  return selected;
}

function filterByName(requestedSlugs, catalogBySlug, options) {
  if (options.nameFilter === null) {
    return requestedSlugs;
  }

  const filters = options.nameFilter
    .toLowerCase()
    .split(",")
    .map((filter) => filter.trim())
    .filter(Boolean);
  return requestedSlugs.filter((slug) => {
    const name = catalogBySlug.get(slug)?.name;
    return (
      typeof name === "string" &&
      filters.some((filter) => name.toLowerCase().includes(filter))
    );
  });
}

function filterByReleaseDate(requestedSlugs, catalogBySlug, options) {
  if (options.beforeDate === null && options.afterDate === null) {
    return requestedSlugs;
  }

  return requestedSlugs.filter((slug) => {
    const releaseDate = catalogBySlug.get(slug)?.releaseDate;
    if (!isValidIsoDate(releaseDate)) {
      return false;
    }
    return (
      (options.beforeDate === null || releaseDate < options.beforeDate) &&
      (options.afterDate === null || releaseDate >= options.afterDate)
    );
  });
}

function filterBySize(requestedSlugs, scoresBySlug, options) {
  if (options.sizeClasses === null) {
    return requestedSlugs;
  }

  return requestedSlugs.filter((slug) => {
    const sizeClass = scoresBySlug.get(slug)?.sizeClass;
    const normalizedSizeClass =
      typeof sizeClass === "string" ? sizeClass.toLowerCase() : "unknown";
    return options.sizeClasses.has(normalizedSizeClass);
  });
}

function filterByScore(requestedSlugs, scoresBySlug, options) {
  if (options.minScore === null && options.maxScore === null) {
    return requestedSlugs;
  }

  return requestedSlugs.filter((slug) => {
    const score = scoresBySlug.get(slug)?.intelligenceIndex;
    if (!Number.isFinite(score)) {
      return false;
    }
    return (
      (options.minScore === null || score >= options.minScore) &&
      (options.maxScore === null || score <= options.maxScore)
    );
  });
}

function sortByScore(slugs, scoresBySlug) {
  const requestedOrder = new Map(slugs.map((slug, index) => [slug, index]));
  return [...slugs].sort((a, b) => {
    const scoreA = scoresBySlug.get(a)?.intelligenceIndex;
    const scoreB = scoresBySlug.get(b)?.intelligenceIndex;
    const numericScoreA = Number.isFinite(scoreA) ? scoreA : Number.NEGATIVE_INFINITY;
    const numericScoreB = Number.isFinite(scoreB) ? scoreB : Number.NEGATIVE_INFINITY;

    if (numericScoreA !== numericScoreB) {
      return numericScoreB - numericScoreA;
    }
    return requestedOrder.get(a) - requestedOrder.get(b);
  });
}

function isPlainObject(value) {
  return isObject(value) && !Array.isArray(value);
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (isPlainObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function formatDiagnosticValue(value) {
  const serialized = stableStringify(value);
  return serialized.length > 200 ? `${serialized.slice(0, 197)}...` : serialized;
}

function mergeModelValues(catalogValue, manifestValue, path, warnings) {
  if (isPlainObject(catalogValue) && isPlainObject(manifestValue)) {
    const merged = {};
    const keys = new Set([
      ...Object.keys(catalogValue),
      ...Object.keys(manifestValue),
    ]);

    for (const key of keys) {
      const catalogHasKey = Object.hasOwn(catalogValue, key);
      const manifestHasKey = Object.hasOwn(manifestValue, key);
      const valuePath = path ? `${path}.${key}` : key;

      if (catalogHasKey && manifestHasKey) {
        merged[key] = mergeModelValues(
          catalogValue[key],
          manifestValue[key],
          valuePath,
          warnings,
        );
      } else if (manifestHasKey) {
        merged[key] = manifestValue[key];
      } else {
        merged[key] = catalogValue[key];
      }
    }
    return merged;
  }

  if (stableStringify(catalogValue) !== stableStringify(manifestValue)) {
    warnings.push({
      path,
      catalogValue,
      manifestValue,
    });
  }
  return manifestValue;
}

function mergeSelectedModels(selected, catalogBySlug, scoresBySlug) {
  const warnings = [];
  const models = selected.map((slug) => {
    const catalogModel = catalogBySlug.get(slug);
    const manifestModel = scoresBySlug.get(slug);
    if (!catalogModel || !manifestModel) {
      throw new Error(
        `Could not export model ${slug}: it is missing from the ${!catalogModel ? "catalog" : "manifest"}.`,
      );
    }

    return mergeModelValues(
      catalogModel,
      manifestModel,
      `models[${slug}]`,
      warnings,
    );
  });
  return { models, warnings };
}

function formatLocalTimestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join("-") +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function formatFilenameTimestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join("") +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function sanitizeFilenamePart(value) {
  return value.replace(/[^A-Za-z0-9._=,+@-]+/g, "_");
}

function getCanonicalArguments(args) {
  const entries = [];
  for (let index = 0; index < args.length; index += 1) {
    const rawArg = args[index];
    const equalsIndex = rawArg.indexOf("=");
    const rawName = equalsIndex === -1 ? rawArg : rawArg.slice(0, equalsIndex);
    const optionName = LONG_OPTION_NAMES.get(rawName) ?? rawName;
    const inlineValue = equalsIndex === -1 ? null : rawArg.slice(equalsIndex + 1);
    const endIndex =
      inlineValue === null && VALUE_OPTIONS.has(optionName) ? index + 1 : index;

    entries.push({
      index,
      optionName,
      args: VALUE_OPTIONS.has(optionName)
        ? [optionName, inlineValue ?? args[index + 1]]
        : [optionName],
    });
    index = endIndex;
  }

  entries.sort(
    (left, right) =>
      (CANONICAL_OPTION_ORDER.get(left.optionName) ?? Number.MAX_SAFE_INTEGER) -
        (CANONICAL_OPTION_ORDER.get(right.optionName) ?? Number.MAX_SAFE_INTEGER) ||
      left.index - right.index,
  );
  return entries.flatMap((entry) => entry.args);
}

function getFilenameArguments(args) {
  const filenameArgs = [];
  for (let index = 0; index < args.length; index += 1) {
    const rawArg = args[index];
    const equalsIndex = rawArg.indexOf("=");
    const rawName = equalsIndex === -1 ? rawArg : rawArg.slice(0, equalsIndex);
    const optionName = LONG_OPTION_NAMES.get(rawName) ?? rawName;
    const inlineValue =
      equalsIndex === -1 ? null : rawArg.slice(equalsIndex + 1);

    if (optionName === "--json") {
      continue;
    }
    if (optionName === "--url") {
      filenameArgs.push("--url");
      if (inlineValue === null) {
        index += 1;
      }
      continue;
    }

    if (inlineValue !== null) {
      filenameArgs.push(`--${optionName.slice(2)}-${sanitizeFilenamePart(inlineValue)}`);
    } else if (VALUE_OPTIONS.has(optionName)) {
      const value = args[index + 1];
      filenameArgs.push(`--${optionName.slice(2)}-${sanitizeFilenamePart(value)}`);
      index += 1;
    } else {
      filenameArgs.push(optionName);
    }
  }
  return filenameArgs;
}

function buildJsonFilename(timestamp, args) {
  const filenameArgs = getFilenameArguments(args);
  return `alg-${timestamp}${filenameArgs.join("")}.json`;
}

function formatArgumentsBlock(argumentsList) {
  if (argumentsList.length === 0) {
    return '  "arguments": []';
  }

  const lines = ['  "arguments": ['];
  const entries = [];
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    const values = [JSON.stringify(argument)];
    if (VALUE_OPTIONS.has(argument) && index + 1 < argumentsList.length) {
      values.push(JSON.stringify(argumentsList[index + 1]));
      index += 1;
    }
    entries.push(`    ${values.join(", ")}`);
  }
  lines.push(entries.join(",\n"));
  lines.push("  ]");
  return lines.join("\n");
}

function stringifyJsonExport(payload) {
  const serialized = JSON.stringify(payload, null, 2);
  const defaultArgumentsBlock = JSON.stringify(payload.arguments, null, 2)
    .split("\n")
    .map((line, index) =>
      index === 0 ? `  "arguments": ${line}` : `  ${line}`,
    )
    .join("\n");
  const formattedArgumentsBlock = formatArgumentsBlock(payload.arguments);
  if (!serialized.includes(defaultArgumentsBlock)) {
    throw new Error("Could not format the JSON arguments metadata.");
  }
  return serialized.replace(defaultArgumentsBlock, formattedArgumentsBlock);
}

async function writeJsonExport(
  selected,
  catalogBySlug,
  scoresBySlug,
  scoreManifest,
  args,
) {
  const generatedAtDate = new Date();
  const generatedAt = formatLocalTimestamp(generatedAtDate);
  const canonicalArgs = getCanonicalArguments(args);
  const { models, warnings } = mergeSelectedModels(
    selected,
    catalogBySlug,
    scoresBySlug,
  );
  const intelligenceIndex = findIntelligenceIndexMetadata(scoreManifest);
  const filePath = join(
    process.cwd(),
    buildJsonFilename(formatFilenameTimestamp(generatedAtDate), canonicalArgs),
  );
  const payload = {
    generatedAt,
    arguments: canonicalArgs,
    intelligenceIndex,
    models,
  };
  await writeFile(filePath, `${stringifyJsonExport(payload)}\n`, "utf8");
  return { filePath, warnings };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    printUsage();
    return;
  }

  const options = parseArguments(args);
  const inputUrl = options.inputUrl;
  const page = await fetch(`${SITE}/`);
  if (!page.ok) {
    throw new Error(`Failed to fetch the Artificial Analysis catalog: ${page.status}`);
  }

  const payloads = extractFlightPayloads(await page.text());
  const catalog = findModelCatalog(payloads);
  const scoreManifest = await findScoreManifest(payloads);
  const scoreModels = scoreManifest.models;
  const requestedSlugs = inputUrl
    ? [...new Set((inputUrl.searchParams.get("models") ?? "").split(",").filter(Boolean))]
    : catalog.map((model) => model.slug);

  if (requestedSlugs.length === 0) {
    throw new Error("No models were found. Supply a URL containing a models query parameter.");
  }

  const catalogBySlug = indexCatalogModels(requestedSlugs, catalog);
  const scoresBySlug = new Map(scoreModels.map((model) => [model.slug, model]));
  const nameFiltered = filterByName(requestedSlugs, catalogBySlug, options);
  if (nameFiltered.length === 0) {
    throw new Error("No models remain after applying the name filter.");
  }

  const dateFiltered = filterByReleaseDate(nameFiltered, catalogBySlug, options);
  if (dateFiltered.length === 0) {
    throw new Error("No models remain after applying the release-date filter.");
  }

  const sizeFiltered = filterBySize(dateFiltered, scoresBySlug, options);
  if (sizeFiltered.length === 0) {
    throw new Error("No models remain after applying the size-class filter.");
  }

  const weightFiltered = filterByWeight(sizeFiltered, scoresBySlug, options);
  if (weightFiltered.length === 0) {
    throw new Error("No models remain after applying the weight-class filter.");
  }

  const scoreFiltered = filterByScore(weightFiltered, scoresBySlug, options);
  if (scoreFiltered.length === 0) {
    throw new Error("No models remain after applying the score range filter.");
  }

  let selected = scoreFiltered;
  if (options.model) {
    selected = selectHighestScoringVariants(selected, catalogBySlug, scoresBySlug);
  }
  if (options.lab) {
    selected = selectHighestScoringLabs(selected, catalogBySlug, scoresBySlug);
  }

  const groupedCount = selected.length;
  selected = sortByScore(selected, scoresBySlug);
  if (options.top !== null) {
    selected = selected.slice(0, options.top);
  }
  if (selected.length === 0) {
    throw new Error("No models remain after applying the requested filters.");
  }

  const output = new URL(`${SITE}/`);
  output.searchParams.set("models", selected.join(","));
  output.hash = INDEX_HASH;

  const jsonExport = options.json
    ? await writeJsonExport(
        selected,
        catalogBySlug,
        scoresBySlug,
        scoreManifest,
        args,
      )
    : null;
  const unscored = selected.filter(
    (slug) => !Number.isFinite(scoresBySlug.get(slug)?.intelligenceIndex),
  );
  console.log(output.toString());
  if (jsonExport) {
    console.error(`Wrote JSON export to ${jsonExport.filePath}.`);
    for (const warning of jsonExport.warnings) {
      console.error(
        `Warning: ${warning.path} differs between the catalog and manifest; ` +
          `using the manifest value. Catalog=${formatDiagnosticValue(warning.catalogValue)}; ` +
          `manifest=${formatDiagnosticValue(warning.manifestValue)}.`,
      );
    }
  }
  console.error(`Kept ${selected.length} of ${requestedSlugs.length} requested models.`);
  if (nameFiltered.length < requestedSlugs.length) {
    console.error(
      `Excluded ${requestedSlugs.length - nameFiltered.length} models by name filter.`,
    );
  }
  if (dateFiltered.length < nameFiltered.length) {
    console.error(
      `Excluded ${nameFiltered.length - dateFiltered.length} models by release-date filter.`,
    );
  }
  if (sizeFiltered.length < dateFiltered.length) {
    console.error(
      `Excluded ${dateFiltered.length - sizeFiltered.length} models by size class.`,
    );
  }
  if (weightFiltered.length < sizeFiltered.length) {
    console.error(
      `Excluded ${sizeFiltered.length - weightFiltered.length} models by weight class.`,
    );
  }
  if (scoreFiltered.length < weightFiltered.length) {
    console.error(
      `Excluded ${weightFiltered.length - scoreFiltered.length} models by score range.`,
    );
  }
  if (groupedCount < scoreFiltered.length) {
    console.error(
      `Removed ${scoreFiltered.length - groupedCount} lower-scoring entries during grouping.`,
    );
  }
  if (selected.length < groupedCount) {
    console.error(`Applied the --top limit and removed ${groupedCount - selected.length} models.`);
  }
  if (unscored.length) {
    console.error(
      `${unscored.length} retained model(s) had no numeric Intelligence Index score; ties default to catalog order.`,
    );
  }
}

main().catch((error) => {
  const message = error.message;
  console.error(message.startsWith("No models remain") ? message : `Error: ${message}`);
  process.exitCode = 1;
});
