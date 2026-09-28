import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createCipheriv, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { test } from "node:test";

import {
  extractFlightPayloads,
  filterByDeprecatedStatus,
  filterByName,
  filterByReleaseDate,
  filterByScore,
  filterBySize,
  filterByWeight,
  findIntelligenceIndexMetadata,
  findModelCatalog,
  findPageIntelligenceIndexMetadata,
  findScoreManifest,
  getCanonicalArguments,
  getFilenameArguments,
  mergeSelectedModels,
  normalizeModelCatalog,
  parseArguments,
  run,
  selectHighestScoringLabs,
  selectHighestScoringVariants,
  sortByScore,
  stringifyJsonExport,
} from "../alg.mjs";

const legacyCatalog = JSON.parse(
  await readFile(new URL("./fixtures/catalog-legacy.json", import.meta.url), "utf8"),
);
const currentCatalog = JSON.parse(
  await readFile(new URL("./fixtures/catalog-current.json", import.meta.url), "utf8"),
);
const scoreManifest = JSON.parse(
  await readFile(new URL("./fixtures/score-manifest.json", import.meta.url), "utf8"),
);

function scoresBySlug(models) {
  return new Map(models.map((model) => [model.slug, model]));
}

function catalogBySlug(models) {
  return new Map(models.map((model) => [model.slug, model]));
}

function flightHtml(value, id = "0") {
  const payload = `${id}:${JSON.stringify(value)}`;
  return `<script>self.__next_f.push([1,${JSON.stringify(payload)}])</script>`;
}

function responseFrom(body, status = 200) {
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    async arrayBuffer() {
      return bytes;
    },
    async text() {
      return bytes.toString("utf8");
    },
  };
}

function encryptManifest(manifest, keyHex) {
  const key = Buffer.from(keyHex, "hex");
  const nonce = createHash("sha256").update(key).digest().subarray(0, 12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const compressed = gzipSync(Buffer.from(JSON.stringify(manifest)));
  return Buffer.concat([cipher.update(compressed), cipher.final(), cipher.getAuthTag()]);
}

function buildRunFixture() {
  const models = [...currentCatalog.models];
  const releases = [...currentCatalog.releases];
  for (let index = 0; index < 97; index += 1) {
    const slug = `fixture-model-${index}`;
    const releaseSlug = `${slug}-release`;
    models.push({
      slug,
      name: `Fixture Model ${index}`,
      releaseSlug,
      creator: { slug: `fixture-lab-${index}` },
    });
    releases.push({
      slug: releaseSlug,
      releaseDate: "2025-01-01",
      deprecated: false,
    });
  }

  const key = "11".repeat(32);
  const pageValue = {
    models,
    releases,
    manifestReference: {
      path: "/data/fixture-manifest",
      key,
    },
    pageMetadata:
      "Artificial Analysis Intelligence Index v4.3.2 " +
      "/articles/artificial-analysis-intelligence-index-v4-3",
  };
  const html = flightHtml(pageValue);
  const encryptedManifest = encryptManifest(scoreManifest, key);
  const fetchImpl = async (url) => {
    if (url === "https://fixture.test/") {
      return responseFrom(html);
    }
    if (url === "https://fixture.test/data/fixture-manifest") {
      return responseFrom(encryptedManifest);
    }
    throw new Error(`Unexpected fixture URL: ${url}`);
  };

  return { fetchImpl, html, models, releases };
}

test("parses aliases, inline values, and canonical argument order", () => {
  const args = [
    "-2",
    "-j",
    "-x",
    "50",
    "-n",
    "50",
    "-m",
    "-l",
    "-u",
    "https://artificialanalysis.ai/?models=one,two",
    "-f",
    "Qwen,Claude",
    "-s",
    "Large,medium",
    "-o",
    "-c",
    "-a",
    "2025-01-01",
    "-b",
    "2026-01-01",
    "-t",
    "10",
  ];
  const options = parseArguments(args);

  assert.equal(options.top, 10);
  assert.equal(options.nameFilter, "Qwen,Claude");
  assert.deepEqual([...options.sizeClasses], ["large", "medium"]);
  assert.equal(options.minScore, 50);
  assert.equal(options.maxScore, 50);
  assert.equal(options.model, true);
  assert.equal(options.lab, true);
  assert.equal(options.json, true);
  assert.equal(options.two, true);
  assert.equal(options.inputUrl.searchParams.get("models"), "one,two");
  assert.deepEqual(getCanonicalArguments(args), [
    "--url",
    "https://artificialanalysis.ai/?models=one,two",
    "--filter",
    "Qwen,Claude",
    "--before",
    "2026-01-01",
    "--after",
    "2025-01-01",
    "--size",
    "Large,medium",
    "--open",
    "--closed",
    "--min",
    "50",
    "--max",
    "50",
    "--model",
    "--lab",
    "--top",
    "10",
    "--json",
    "--two",
  ]);
  assert.deepEqual(getFilenameArguments(getCanonicalArguments(args)), [
    "--url",
    "--filter-Qwen,Claude",
    "--before-2026-01-01",
    "--after-2025-01-01",
    "--size-Large,medium",
    "--open",
    "--closed",
    "--min-50",
    "--max-50",
    "--model",
    "--lab",
    "--top-10",
  ]);
});

test("rejects invalid values and contradictory ranges", () => {
  assert.throws(
    () => parseArguments(["--top", "0"]),
    /--top requires a positive integer/,
  );
  assert.throws(
    () => parseArguments(["--min", "not-a-number"]),
    /--min requires a finite number/,
  );
  assert.throws(
    () => parseArguments(["--after", "2025-02-30"]),
    /--after requires a valid date/,
  );
  assert.throws(
    () => parseArguments(["--size", "medium,"]),
    /--size requires comma-separated size classes/,
  );
  assert.throws(
    () => parseArguments(["--min", "51", "--max", "50"]),
    /--min cannot be greater than --max/,
  );
  assert.throws(
    () => parseArguments(["--after", "2025-01-01", "--before", "2025-01-01"]),
    /--after must be earlier than --before/,
  );
});

test("selects every model displaying 50 for equal score bounds", () => {
  const slugs = ["below", "lower-edge", "middle", "upper-edge", "above", "missing"];
  const scores = scoresBySlug([
    { slug: "below", intelligenceIndex: 49.49 },
    { slug: "lower-edge", intelligenceIndex: 49.5 },
    { slug: "middle", intelligenceIndex: 50 },
    { slug: "upper-edge", intelligenceIndex: 50.499999 },
    { slug: "above", intelligenceIndex: 50.5 },
    { slug: "missing", intelligenceIndex: null },
  ]);
  const options = parseArguments(["--min", "50", "--max", "50"]);

  assert.deepEqual(filterByScore(slugs, scores, options), [
    "lower-edge",
    "middle",
    "upper-edge",
  ]);
});

test("normalizes legacy and current Artificial Analysis catalog records", () => {
  const legacy = normalizeModelCatalog(legacyCatalog);
  const current = normalizeModelCatalog(currentCatalog);

  assert.equal(legacy[0].release.slug, "legacy-alpha-release");
  assert.equal(legacy[0].release.releaseDate, "2024-01-15");
  assert.equal(current[0].release.slug, "current-alpha-release");
  assert.equal(current[0].release.releaseDate, "2024-02-10");
  assert.equal(current[1].release.deprecated, true);
});

test("finds the current catalog and ignores unrelated model arrays", () => {
  const currentModels = Array.from({ length: 100 }, (_, index) => ({
    slug: `model-${index}`,
    name: `Model ${index}`,
    releaseSlug: `release-${index}`,
  }));
  const releases = currentModels.map((model) => ({
    slug: model.releaseSlug,
    releaseDate: "2025-01-01",
    deprecated: false,
  }));
  const catalog = findModelCatalog([
    { value: { models: [{ slug: "unrelated" }] } },
    { value: { models: currentModels, releases } },
  ]);

  assert.equal(catalog.length, 100);
  assert.equal(catalog[42].release.slug, "release-42");
});

test("finds legacy catalogs with nested release records", () => {
  const models = Array.from({ length: 100 }, (_, index) => ({
    slug: `legacy-model-${index}`,
    name: `Legacy Model ${index}`,
    release: {
      slug: `legacy-release-${index}`,
    },
  }));
  const catalog = findModelCatalog([{ value: { models } }]);

  assert.equal(catalog.length, 100);
  assert.equal(catalog[42].release.slug, "legacy-release-42");
});

test("applies name, date, size, weight, and deprecation filters", () => {
  const catalog = normalizeModelCatalog(currentCatalog);
  const catalogMap = catalogBySlug(catalog);
  const scores = scoresBySlug(scoreManifest.models);
  const slugs = catalog.map((model) => model.slug);
  const options = parseArguments([
    "--filter",
    "alpha,gamma",
    "--after",
    "2024-01-01",
    "--before",
    "2026-01-01",
    "--size",
    "small,medium",
    "--open",
    "--current",
  ]);

  const named = filterByName(slugs, catalogMap, options);
  const dated = filterByReleaseDate(named, catalogMap, options);
  const sized = filterBySize(dated, scores, options);
  const weighted = filterByWeight(sized, scores, options);
  const current = filterByDeprecatedStatus(weighted, catalogMap, options);

  assert.deepEqual(current, ["current-alpha", "current-gamma"]);
});

test("supports flat and nested release metadata in status filters", () => {
  const catalog = catalogBySlug([
    {
      slug: "flat",
      name: "Flat",
      releaseDate: "2025-01-01",
      deprecated: false,
    },
    {
      slug: "nested",
      name: "Nested",
      release: {
        releaseDate: "2024-01-01",
        deprecated: true,
      },
    },
  ]);
  const scores = scoresBySlug([
    { slug: "flat", intelligenceIndex: 40, isOpenWeights: true },
    { slug: "nested", intelligenceIndex: 41, isOpenWeights: true },
  ]);
  const currentOptions = parseArguments([
    "--after",
    "2024-01-01",
    "--current",
  ]);
  const deprecatedOptions = parseArguments(["--deprecated"]);

  assert.deepEqual(
    filterByReleaseDate(["flat", "nested"], catalog, currentOptions),
    ["flat", "nested"],
  );
  assert.deepEqual(
    filterByDeprecatedStatus(["flat", "nested"], catalog, currentOptions),
    ["flat"],
  );
  assert.deepEqual(
    filterByDeprecatedStatus(["flat", "nested"], catalog, deprecatedOptions),
    ["nested"],
  );
  assert.deepEqual(
    filterByWeight(
      ["flat", "nested"],
      scores,
      parseArguments(["--open"]),
    ),
    ["flat", "nested"],
  );
});

test("groups by release and lab while preserving ties in requested order", () => {
  const catalog = normalizeModelCatalog(currentCatalog);
  const catalogMap = catalogBySlug(catalog);
  catalogMap.get("current-gamma").release = {
    ...catalogMap.get("current-gamma").release,
    slug: "current-alpha-release",
  };
  const scores = scoresBySlug([
    { slug: "current-alpha", intelligenceIndex: 50, creator: { slug: "lab-a" } },
    { slug: "current-beta", intelligenceIndex: 49, creator: { slug: "lab-b" } },
    { slug: "current-gamma", intelligenceIndex: 50, creator: { slug: "lab-a" } },
  ]);
  const requested = ["current-gamma", "current-alpha", "current-beta"];

  assert.deepEqual(
    selectHighestScoringVariants(requested, catalogMap, scores),
    ["current-gamma", "current-beta"],
  );
  assert.deepEqual(
    selectHighestScoringLabs(requested, catalogMap, scores),
    ["current-gamma", "current-beta"],
  );
  assert.deepEqual(
    sortByScore(["current-gamma", "current-alpha", "current-beta"], scores),
    ["current-gamma", "current-alpha", "current-beta"],
  );
});

test("extracts page payloads and decrypts a score manifest fixture", async () => {
  const key = "22".repeat(32);
  const manifest = {
    models: [{ slug: "fixture", intelligenceIndex: 50 }],
  };
  const payloads = extractFlightPayloads(
    flightHtml({
      reference: { path: "/data/manifest", key },
      nested: { label: "fixture" },
    }),
  );
  const encrypted = encryptManifest(manifest, key);
  const found = await findScoreManifest(
    payloads,
    "https://fixture.test",
    async (url) => {
      assert.equal(url, "https://fixture.test/data/manifest");
      return responseFrom(encrypted);
    },
  );

  assert.deepEqual(found, manifest);
});

test("selects manifest metadata first and page metadata as a fallback", () => {
  const manifestMetadata = findIntelligenceIndexMetadata(
    {
      changelog: [
        {
          dateLa: "2025-01-01",
          type: "methodologyUpdated",
          title: "Artificial Analysis Intelligence Index v4.2.0",
          url: "/methodology/old",
        },
        {
          dateLa: "2025-02-01",
          type: "methodologyUpdated",
          title: "Artificial Analysis Intelligence Index v4.3.0",
          url: "/methodology/new",
        },
      ],
    },
    [],
    "",
  );
  const pageMetadata = findPageIntelligenceIndexMetadata(
    [{ value: { text: "Artificial Analysis Intelligence Index v4.3.2" } }],
    "/articles/artificial-analysis-intelligence-index-v4-3",
  );
  const fallback = findIntelligenceIndexMetadata(
    { changelog: [{ type: "modelUpdated", title: "Model update" }] },
    [{ value: { text: "Artificial Analysis Intelligence Index v4.3.2" } }],
    "/articles/artificial-analysis-intelligence-index-v4-3",
  );

  assert.equal(manifestMetadata.version, "v4.3.0");
  assert.equal(manifestMetadata.changelog.url, "/methodology/new");
  assert.equal(pageMetadata.version, "v4.3.2");
  assert.equal(
    pageMetadata.changelog.url,
    "/articles/artificial-analysis-intelligence-index-v4-3",
  );
  assert.equal(fallback.version, "v4.3.2");
  assert.throws(
    () => findIntelligenceIndexMetadata({ changelog: [] }, [], ""),
    /Could not determine the Intelligence Index version/,
  );
});

test("merges catalog and manifest models and records conflicting values", () => {
  const merged = mergeSelectedModels(
    ["current-alpha"],
    new Map([
      [
        "current-alpha",
        {
          slug: "current-alpha",
          effort: "high",
          nested: { source: "catalog" },
        },
      ],
    ]),
    new Map([
      [
        "current-alpha",
        {
          slug: "current-alpha",
          intelligenceIndex: 49.5,
          nested: { source: "manifest" },
        },
      ],
    ]),
  );

  assert.equal(merged.models[0].effort, "high");
  assert.equal(merged.models[0].intelligenceIndex, 49.5);
  assert.equal(merged.models[0].nested.source, "manifest");
  assert.equal(merged.warnings.length, 1);
  assert.equal(merged.warnings[0].path, "models[current-alpha].nested.source");
});

test("formats JSON exports with readable argument metadata", () => {
  const serialized = stringifyJsonExport({
    generatedAt: "2026-01-02T03:04:05",
    arguments: ["--min", "50", "--max", "50", "--json"],
    intelligenceIndex: { version: "v4.3.2" },
    models: [],
  });

  assert.match(serialized, /"arguments": \[\n    "--min", "50",\n    "--max", "50",\n    "--json"\n  \]/);
  assert.deepEqual(JSON.parse(serialized).arguments, [
    "--min",
    "50",
    "--max",
    "50",
    "--json",
  ]);
});

test("runs the full deterministic CLI path with injected network and file adapters", async () => {
  const fixture = buildRunFixture();
  const stdout = [];
  const stderr = [];
  const writes = [];
  const result = await run(
    ["--max", "50", "--min", "50", "--json", "--two"],
    {
      site: "https://fixture.test",
      fetchImpl: fixture.fetchImpl,
      cwd: "/tmp/alg-test",
      now: () => new Date(2026, 0, 2, 3, 4, 5),
      writeFileImpl: async (filePath, content, options) => {
        writes.push({ filePath, content, options });
      },
      stdout: (...values) => stdout.push(values.join(" ")),
      stderr: (...values) => stderr.push(values.join(" ")),
    },
  );

  assert.deepEqual(result.selected, [
    "current-gamma",
    "current-beta",
    "current-alpha",
  ]);
  assert.equal(stdout.length, 4);
  assert.equal(stdout[0], result.outputUrl);
  assert.equal(stdout[1], "");
  assert.equal(stdout[2], result.modelsOutputUrl);
  assert.equal(stdout[3], "");
  assert.equal(writes.length, 1);
  assert.match(writes[0].filePath, /alg-20260102-030405--min-50--max-50\.json$/);
  assert.equal(writes[0].options.flag, "wx");
  const exportPayload = JSON.parse(writes[0].content);
  assert.equal(exportPayload.intelligenceIndex.version, "v4.3.2");
  assert.deepEqual(exportPayload.arguments, [
    "--min",
    "50",
    "--max",
    "50",
    "--json",
    "--two",
  ]);
  assert.match(stderr.join("\n"), /Wrote JSON export/);
  assert.match(stderr.join("\n"), /Kept 3 of 100 requested models/);
});

test("keeps the executable help path working in a child process", () => {
  const result = spawnSync(process.execPath, ["alg.mjs", "--help"], {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8",
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /alg - Artificial Analysis Link Generator/);
  assert.equal(result.stderr, "");
});
