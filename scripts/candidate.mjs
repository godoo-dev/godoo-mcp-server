import { execFileSync, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const MANDATORY = ["validation"];
export const SUITES = ["source", "installed", "image"];
const BUNDLES = [
  "index.mjs",
  "node.mjs",
  "worker.mjs",
  "quickjs.wasm",
  "code-node.mjs",
  "code-node-isolate.mjs",
  "quickjs-metering.json",
  "code-LICENSES.txt",
];

function output(command, args, options = {}) {
  return execFileSync(command, args, { cwd: ROOT, encoding: "utf8", ...options }).trim();
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: ROOT, stdio: "inherit", ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited unsuccessfully (${result.status})`);
}

export function sha256(file) {
  const digest = createHash("sha256");
  const descriptor = openSync(file, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    for (;;) {
      const length = readSync(descriptor, buffer, 0, buffer.length, null);
      if (!length) return digest.digest("hex");
      digest.update(buffer.subarray(0, length));
    }
  } finally {
    closeSync(descriptor);
  }
}

export function sourceIdentity(root = ROOT) {
  const patch = execFileSync("git", ["diff", "HEAD", "--binary"], { cwd: root });
  const names = execFileSync("git", ["ls-files", "--others", "--exclude-standard", "-z"], {
    cwd: root,
    encoding: "utf8",
  })
    .split("\0")
    .filter(Boolean)
    .sort();
  const untracked = Object.fromEntries(
    names
      .filter((name) => lstatSync(join(root, name)).isFile())
      .map((name) => [name, sha256(join(root, name))]),
  );
  return {
    sha: output("git", ["rev-parse", "HEAD"], { cwd: root }),
    patch_sha256: createHash("sha256").update(patch).digest("hex"),
    untracked,
    dirty: Boolean(
      patch.length || names.length || output("git", ["status", "--porcelain"], { cwd: root }),
    ),
  };
}

export function requireResults(results) {
  if (
    !results ||
    JSON.stringify(Object.keys(results).sort()) !== JSON.stringify([...MANDATORY].sort()) ||
    Object.values(results).some((entry) => entry?.result !== "success")
  )
    throw new Error("Every mandatory CI job must succeed");
}

export function requireJunit(file) {
  const document = readFileSync(file, "utf8");
  const cases = [...document.matchAll(/<testcase(?:\s|>)/g)];
  if (
    !cases.length ||
    !/<testsuites?(?:\s|>)/.test(document) ||
    !/<\/testsuites?>\s*$/.test(document) ||
    /<(?:skipped|failure|error)(?:\s|\/|>)/.test(document)
  )
    throw new Error(`Empty, skipped, malformed or failing required suite: ${basename(file)}`);
  for (const suite of document.matchAll(/<testsuite\b([^>]*)>/g)) {
    for (const attribute of suite[1].matchAll(/\b(errors|failures|skipped)=["']([^"']*)["']/g)) {
      if (!/^0+$/.test(attribute[2]))
        throw new Error(`Required suite did not complete: ${basename(file)}`);
    }
  }
  return cases.length;
}

export function fileRecord(file) {
  return { file: basename(file), sha256: sha256(file) };
}

export function checkFile(directory, record) {
  if (
    !record ||
    typeof record.file !== "string" ||
    basename(record.file) !== record.file ||
    record.file === "." ||
    record.file === ".." ||
    !/^[0-9a-f]{64}$/.test(record.sha256 ?? "")
  )
    throw new Error("Candidate file must be a hash-identified direct child");
  const path = join(directory, record.file);
  if (
    !lstatSync(path).isFile() ||
    lstatSync(path).isSymbolicLink() ||
    sha256(path) !== record.sha256
  )
    throw new Error(`Candidate hash mismatch: ${record.file}`);
  return path;
}

function metadata(root = ROOT) {
  return JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
}
function manifest(directory) {
  return JSON.parse(readFileSync(join(directory, "candidate.json"), "utf8"));
}
function writeManifest(directory, candidate) {
  writeFileSync(join(directory, "candidate.json"), `${JSON.stringify(candidate, null, 2)}\n`);
}
function tarEntry(archive, name, gzip = false) {
  return execFileSync("tar", [gzip ? "-xzOf" : "-xOf", archive, name], {
    maxBuffer: 32 * 1024 * 1024,
  });
}

export function archiveIdentity(directory, image) {
  const archive = checkFile(directory, image.archive);
  const entries = JSON.parse(tarEntry(archive, "manifest.json"));
  if (entries.length !== 1 || JSON.stringify(entries[0].RepoTags) !== JSON.stringify([image.tag]))
    throw new Error("Expected the single tested image tag in archive");
  const config = tarEntry(archive, entries[0].Config);
  const configId = `sha256:${createHash("sha256").update(config).digest("hex")}`;
  const identities = new Set([configId]);
  const names = output("tar", ["-tf", archive]).split("\n");
  if (names.includes("index.json")) {
    const index = JSON.parse(tarEntry(archive, "index.json"));
    if (index.manifests?.length !== 1)
      throw new Error("Expected a single archived image descriptor");
    const digest = index.manifests[0].digest;
    if (!/^sha256:[0-9a-f]{64}$/.test(digest)) throw new Error("Invalid image descriptor digest");
    const payload = tarEntry(archive, `blobs/sha256/${digest.slice(7)}`);
    if (
      `sha256:${createHash("sha256").update(payload).digest("hex")}` !== digest ||
      JSON.parse(payload).config?.digest !== configId
    )
      throw new Error("Archived descriptor/config identity mismatch");
    identities.add(digest);
  }
  if (!identities.has(image.id) || image.config_id !== configId)
    throw new Error("Tested image differs from archive");
  return identities;
}

export function verifyLoadedImage(
  directory,
  candidate,
  inspect = (tag) => output("docker", ["image", "inspect", "--format", "{{.Id}}", tag]),
) {
  const identities = archiveIdentity(directory, candidate.image);
  if (!identities.has(inspect(candidate.image.tag)))
    throw new Error("Loaded image differs from tested archive");
  return candidate.image.tag;
}

export function validateFacts(file, major) {
  const rows = readFileSync(file, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  if (
    !rows.length ||
    rows.some(
      (row) =>
        row.requested_major !== major ||
        row.observed_major !== major ||
        !["base", "mail", "project"].every((module) => row.modules?.includes(module)) ||
        !/^[0-9a-f]{64}$/.test(row.network_id ?? "") ||
        row.containers?.length !== 2 ||
        row.containers.some(
          (container) =>
            !/^[0-9a-f]{64}$/.test(container.id ?? "") ||
            !/^sha256:[0-9a-f]{64}$/.test(container.image_id ?? ""),
        ),
    )
  )
    throw new Error(`Missing observed Odoo${major} facts`);
  return rows;
}

export function validateImageFacts(file, candidate) {
  const rows = readFileSync(file, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  if (
    !rows.length ||
    rows.some(
      (row) =>
        row.expected_image !== candidate.image.id ||
        row.observed_image !== candidate.image.id ||
        !/^[0-9a-f]{64}$/.test(row.container_id ?? "") ||
        !/^[1-9][0-9]*$/.test(String(row.uid)) ||
        row.version !== candidate.version,
    )
  )
    throw new Error("Missing exact image, non-root user or installed-version observations");
  return rows;
}

export function requireReleaseRef(ref, sha, version, root = ROOT) {
  if (
    ref !== `refs/tags/v${version}` ||
    output("git", ["rev-parse", `${ref}^{commit}`], { cwd: root }) !== sha
  )
    throw new Error("Publication requires the matching immutable version tag");
  execFileSync("git", ["merge-base", "--is-ancestor", sha, "origin/main"], { cwd: root });
}

export function verifyCandidate(directory, { root = ROOT, complete = false, releaseRef } = {}) {
  const candidate = manifest(directory);
  const packageMetadata = metadata(root);
  if (
    candidate.schema !== 2 ||
    JSON.stringify(candidate.source) !== JSON.stringify(sourceIdentity(root))
  )
    throw new Error("Candidate source identity differs from checkout");
  if (candidate.version !== packageMetadata.version || candidate.name !== packageMetadata.name)
    throw new Error("Candidate package identity mismatch");
  for (const [path, hash] of Object.entries(candidate.locks ?? {})) {
    if (
      !["pnpm-lock.yaml", "tests/acceptance/uv.lock"].includes(path) ||
      sha256(join(root, path)) !== hash
    )
      throw new Error("Candidate dependency lock mismatch");
  }
  if (Object.keys(candidate.locks ?? {}).length !== 2)
    throw new Error("Missing dependency lock identities");
  const pack = checkFile(directory, candidate.package);
  const packedMetadata = JSON.parse(tarEntry(pack, "package/package.json", true));
  if (packedMetadata.name !== candidate.name || packedMetadata.version !== candidate.version)
    throw new Error("Packed metadata differs from candidate");
  const worker = checkFile(directory, candidate.worker);
  if (
    createHash("sha256")
      .update(tarEntry(pack, "package/dist/worker.mjs", true))
      .digest("hex") !== sha256(worker)
  )
    throw new Error("Worker bundle differs from package");
  for (const name of BUNDLES) {
    if (
      createHash("sha256")
        .update(tarEntry(pack, `package/dist/${name}`, true))
        .digest("hex") !== candidate.bundles?.[name]
    )
      throw new Error("Packed runtime differs from tested bundle");
  }
  if (complete) {
    archiveIdentity(directory, candidate.image);
    if (
      !candidate.odoo_majors?.includes(18) ||
      !candidate.odoo_majors?.includes(19) ||
      candidate.odoo_majors.some((major) => !Number.isInteger(major) || major < 18) ||
      new Set(candidate.odoo_majors).size !== candidate.odoo_majors.length
    )
      throw new Error("Missing supported Odoo qualifications");
    for (const major of candidate.odoo_majors) {
      const qualification = JSON.parse(readFileSync(join(directory, `odoo-${major}.json`), "utf8"));
      if (
        qualification.image_id !== candidate.image.id ||
        qualification.package_sha256 !== candidate.package.sha256 ||
        qualification.worker_sha256 !== candidate.worker.sha256
      )
        throw new Error("Qualification used another candidate");
      if (
        JSON.stringify(Object.keys(qualification.proofs ?? {}).sort()) !==
        JSON.stringify([...SUITES].sort())
      )
        throw new Error("Missing runtime qualification suite");
      for (const suite of SUITES) {
        const proof = qualification.proofs[suite];
        if (requireJunit(checkFile(directory, proof.report)) !== proof.tests)
          throw new Error("Candidate test count mismatch");
        validateFacts(checkFile(directory, proof.facts), major);
        if (suite === "image")
          validateImageFacts(checkFile(directory, proof.image_facts), candidate);
      }
    }
    for (const proof of ["offline", "controls"])
      requireJunit(checkFile(directory, candidate.proofs?.[proof]));
    const offlineIdentity = JSON.parse(
      readFileSync(checkFile(directory, candidate.proofs?.identity), "utf8"),
    );
    if (
      JSON.stringify(offlineIdentity.source) !== JSON.stringify(candidate.source) ||
      JSON.stringify(offlineIdentity.bundles) !== JSON.stringify(candidate.bundles)
    )
      throw new Error("Offline proof used another source or runtime bundle");
  }
  if (releaseRef !== undefined) {
    requireReleaseRef(releaseRef, candidate.source.sha, candidate.version, root);
    if (candidate.source.dirty || candidate.source_ref !== releaseRef)
      throw new Error("Publication requires a clean matching tag candidate");
  }
  return candidate;
}

export function verifyRuntimeBundles(directory, candidate) {
  for (const name of BUNDLES) {
    const path = join(directory, name);
    if (
      !lstatSync(path).isFile() ||
      lstatSync(path).isSymbolicLink() ||
      sha256(path) !== candidate.bundles?.[name]
    )
      throw new Error(`Launched runtime differs from tested bundle: ${name}`);
  }
}

function outside(directory, root = ROOT) {
  const resolved = resolve(directory);
  if (resolved === root || !relative(root, resolved).startsWith(`..${sep}`))
    throw new Error("Candidate/evidence must be outside source checkout");
  return resolved;
}
function cleanEnvironment() {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) =>
        !/^(?:ODOO_|MCP_)/.test(name) &&
        !["PYTHONPATH", "PYTHONHOME", "VIRTUAL_ENV", "DEBUG", "AWS_SESSION_TOKEN"].includes(name),
    ),
  );
}
function quote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function offline(evidence) {
  evidence = outside(evidence);
  mkdirSync(evidence, { recursive: true });
  const source = sourceIdentity();
  run("pnpm", ["install", "--frozen-lockfile"]);
  run("pnpm", ["typecheck"]);
  run("pnpm", ["lint"]);
  run("pnpm", ["build"]);
  run(
    "pnpm",
    [
      "exec",
      "vitest",
      "run",
      "--reporter=default",
      "--reporter=junit",
      `--outputFile.junit=${join(evidence, "offline.xml")}`,
    ],
    { env: cleanEnvironment() },
  );
  run(process.execPath, [
    "--test",
    "--test-reporter=junit",
    `--test-reporter-destination=${join(evidence, "controls.xml")}`,
    join(ROOT, "scripts/candidate.test.mjs"),
  ]);
  requireJunit(join(evidence, "offline.xml"));
  requireJunit(join(evidence, "controls.xml"));
  run(process.execPath, [
    "scripts/http-probe.mjs",
    "--command",
    `${quote(process.execPath)} ${quote(join(ROOT, "dist/node.mjs"))}`,
    "--evidence",
    join(evidence, "http-source"),
  ]);
  if (JSON.stringify(sourceIdentity()) !== JSON.stringify(source)) {
    throw new Error("Source changed during offline verification");
  }
  writeFileSync(
    join(evidence, "offline-identity.json"),
    JSON.stringify({
      source,
      bundles: Object.fromEntries(BUNDLES.map((name) => [name, sha256(join(ROOT, "dist", name))])),
    }),
  );
}

export function packCandidate(directory, sourceRef = "local", evidence) {
  directory = outside(directory);
  const siblingEvidence = join(dirname(directory), "offline");
  if (!evidence && existsSync(join(siblingEvidence, "offline-identity.json")))
    evidence = siblingEvidence;
  if (existsSync(join(directory, "candidate.json")))
    throw new Error("Candidate directory already has an identity");
  mkdirSync(directory, { recursive: true });
  const source = sourceIdentity();
  run("pnpm", ["install", "--frozen-lockfile"]);
  run("pnpm", ["build"]);
  const packed = JSON.parse(
    output("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", directory]),
  );
  if (packed.length !== 1 || basename(packed[0].filename) !== packed[0].filename)
    throw new Error("Expected one packed candidate");
  const packageFile = join(directory, packed[0].filename);
  copyFileSync(join(ROOT, "dist/worker.mjs"), join(directory, "worker.mjs"));
  copyFileSync(join(ROOT, "dist/quickjs.wasm"), join(directory, "quickjs.wasm"));
  const consumer = join(directory, "consumer");
  mkdirSync(consumer);
  writeFileSync(join(consumer, "package.json"), '{"private":true,"type":"module"}\n');
  run("npm", [
    "install",
    "--ignore-scripts",
    "--omit=dev",
    "--package-lock=false",
    "--no-audit",
    "--no-fund",
    "--prefix",
    consumer,
    packageFile,
  ]);
  const installed = join(consumer, "node_modules/@godoo-dev/mcp-server");
  if (lstatSync(installed).isSymbolicLink())
    throw new Error("Installed candidate must not link source");
  const installedMetadata = JSON.parse(readFileSync(join(installed, "package.json"), "utf8"));
  const packageMetadata = metadata();
  if (
    installedMetadata.name !== packageMetadata.name ||
    installedMetadata.version !== packageMetadata.version
  )
    throw new Error("Installed package metadata differs");
  if (
    output(process.execPath, [join(installed, "dist/node.mjs"), "--version"], { cwd: consumer }) !==
    packageMetadata.version
  )
    throw new Error("Installed CLI version differs");
  for (const resource of ["SKILL.md", "PROVENANCE.md", "CC0-1.0.txt"]) {
    if (!readFileSync(join(installed, "src/godoo_mcp_server/skills", resource), "utf8").trim())
      throw new Error("Missing installed guidance/license");
  }
  run(process.execPath, [
    "scripts/http-probe.mjs",
    "--command",
    `${quote(process.execPath)} ${quote(join(installed, "dist/node.mjs"))}`,
    "--evidence",
    join(directory, "http-installed"),
  ]);
  if (JSON.stringify(sourceIdentity()) !== JSON.stringify(source))
    throw new Error("Source changed while building/testing candidate");
  const candidate = {
    schema: 2,
    source,
    source_ref: sourceRef,
    name: packageMetadata.name,
    version: packageMetadata.version,
    locks: Object.fromEntries(
      ["pnpm-lock.yaml", "tests/acceptance/uv.lock"].map((path) => [
        path,
        sha256(join(ROOT, path)),
      ]),
    ),
    package: fileRecord(packageFile),
    worker: fileRecord(join(directory, "worker.mjs")),
    bundles: Object.fromEntries(BUNDLES.map((name) => [name, sha256(join(ROOT, "dist", name))])),
    tools: {
      node: process.version,
      pnpm: output("pnpm", ["--version"]),
      uv: output("uv", ["--version"]),
    },
  };
  if (evidence) {
    candidate.proofs = {};
    for (const name of ["offline", "controls"]) {
      const sourceFile = join(resolve(evidence), `${name}.xml`);
      requireJunit(sourceFile);
      copyFileSync(sourceFile, join(directory, `${name}.xml`));
      candidate.proofs[name] = fileRecord(join(directory, `${name}.xml`));
    }
    const identity = join(resolve(evidence), "offline-identity.json");
    const observed = JSON.parse(readFileSync(identity, "utf8"));
    if (
      JSON.stringify(observed.source) !== JSON.stringify(source) ||
      JSON.stringify(observed.bundles) !== JSON.stringify(candidate.bundles)
    )
      throw new Error("Offline proof used another source or runtime bundle");
    copyFileSync(identity, join(directory, "offline-identity.json"));
    candidate.proofs.identity = fileRecord(join(directory, "offline-identity.json"));
  }
  writeManifest(directory, candidate);
  return verifyCandidate(directory);
}

export function buildImage(directory, majors = [18, 19]) {
  directory = resolve(directory);
  const candidate = verifyCandidate(directory);
  const context = mkdtempSync(join(tmpdir(), "godoo-mcp-image-"));
  const tag = `godoo-mcp-server:candidate-${randomUUID()}`;
  try {
    copyFileSync(join(ROOT, "Dockerfile"), join(context, "Dockerfile"));
    copyFileSync(checkFile(directory, candidate.package), join(context, "package.tgz"));
    run("docker", ["build", "--pull", "--provenance=false", "--tag", tag, context]);
    const id = output("docker", ["image", "inspect", "--format", "{{.Id}}", tag]);
    run("docker", ["save", "--output", join(directory, "image.tar"), tag]);
    const archive = join(directory, "image.tar");
    const entry = JSON.parse(tarEntry(archive, "manifest.json"))[0];
    const configId = `sha256:${createHash("sha256").update(tarEntry(archive, entry.Config)).digest("hex")}`;
    candidate.image = { id, config_id: configId, tag, archive: fileRecord(archive) };
    candidate.odoo_majors = majors;
    writeManifest(directory, candidate);
    verifyLoadedImage(directory, candidate);
    return candidate;
  } catch (error) {
    spawnSync("docker", ["image", "rm", tag], { stdio: "ignore" });
    throw error;
  } finally {
    rmSync(context, { recursive: true, force: true });
  }
}

export function qualifyOdoo(directory, major) {
  directory = resolve(directory);
  const candidate = verifyCandidate(directory);
  if (!candidate.odoo_majors.includes(major))
    throw new Error("Odoo major is not in this candidate");
  if (
    spawnSync("docker", ["image", "inspect", candidate.image.tag], { stdio: "ignore" }).status !== 0
  )
    run("docker", ["load", "--input", checkFile(directory, candidate.image.archive)]);
  verifyLoadedImage(directory, candidate);
  run("uv", ["sync", "--project", "tests/acceptance", "--frozen", "--python", "3.14.7"]);
  const proofs = {};
  for (const suite of SUITES) {
    if (suite !== "image") {
      verifyRuntimeBundles(
        suite === "source"
          ? join(ROOT, "dist")
          : join(directory, "consumer/node_modules/@godoo-dev/mcp-server/dist"),
        candidate,
      );
    }
    const report = join(directory, `odoo-${major}-${suite}.xml`);
    const facts = join(directory, `odoo-${major}-${suite}-facts.jsonl`);
    rmSync(facts, { force: true });
    const env = {
      ...cleanEnvironment(),
      ODOO_VERSION: `${major}.0`,
      MCP_TEST_ODOO_MAJOR: String(major),
      MCP_REQUIRED_TESTS: "1",
      MCP_EXPECTED_VERSION: candidate.version,
      MCP_ODOO_FACTS: facts,
    };
    const imageFacts = join(directory, `odoo-${major}-image-runtime-facts.jsonl`);
    if (suite === "image") {
      rmSync(imageFacts, { force: true });
      env.MCP_CANDIDATE_IMAGE = candidate.image.id;
      env.MCP_IMAGE_FACTS = imageFacts;
    } else
      env.MCP_SERVER_COMMAND = `${quote(process.execPath)} ${quote(suite === "source" ? join(ROOT, "dist/node.mjs") : join(directory, "consumer/node_modules/@godoo-dev/mcp-server/dist/node.mjs"))}`;
    run(
      "uv",
      [
        "run",
        "--project",
        "tests/acceptance",
        "--frozen",
        "pytest",
        "--confcutdir",
        "tests/acceptance",
        "tests/acceptance",
        "--capture=tee-sys",
        "-o",
        "junit_logging=all",
        `--junitxml=${report}`,
        `--basetemp=${join(directory, `odoo-${major}-${suite}-tmp`)}`,
      ],
      { env },
    );
    const tests = requireJunit(report);
    const observations = validateFacts(facts, major);
    for (const row of observations) {
      for (const [kind, id] of [
        ...row.containers.map((container) => ["container", container.id]),
        ["network", row.network_id],
      ]) {
        if (spawnSync("docker", [kind, "inspect", id], { stdio: "ignore" }).status === 0)
          throw new Error(`Owned ${kind} remains after teardown`);
      }
    }
    proofs[suite] = { report: fileRecord(report), tests, facts: fileRecord(facts) };
    if (suite === "image") {
      for (const observation of validateImageFacts(imageFacts, candidate)) {
        if (
          spawnSync("docker", ["container", "inspect", observation.container_id], {
            stdio: "ignore",
          }).status === 0
        )
          throw new Error("Owned MCP container remains after teardown");
      }
      proofs[suite].image_facts = fileRecord(imageFacts);
    }
  }
  writeFileSync(
    join(directory, `odoo-${major}.json`),
    `${JSON.stringify({ image_id: candidate.image.id, package_sha256: candidate.package.sha256, worker_sha256: candidate.worker.sha256, proofs }, null, 2)}\n`,
  );
  return proofs;
}

export function verifyArchive(directory) {
  const candidate = verifyCandidate(directory, { complete: true });
  run("docker", ["load", "--input", checkFile(directory, candidate.image.archive)]);
  verifyLoadedImage(directory, candidate);
  run("docker", ["image", "rm", candidate.image.tag]);
}

async function registryJson(url, init, fetchImpl) {
  try {
    const response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(30000) });
    return { status: response.status, body: await response.json() };
  } catch {
    throw new Error("Registry response could not be verified; publication stopped");
  }
}

export async function registryPreflight(candidate, directory, options = {}) {
  const fetchImpl = options.fetch ?? fetch;
  const repository = options.repository ?? process.env.GHCR_REPOSITORY;
  const user = options.user ?? process.env.GHCR_USER;
  const credential = options.credential ?? process.env.GHCR_TOKEN;
  if (
    !/^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/.test(repository ?? "") ||
    !user ||
    !credential ||
    !/^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,127}$/.test(candidate.version)
  )
    throw new Error("Valid registry identity and read authorization are required");
  const npm = await registryJson(
    `https://registry.npmjs.org/${encodeURIComponent(candidate.name)}`,
    {},
    fetchImpl,
  );
  let packageState;
  if (npm.status === 404 && npm.body.error === "Not found") packageState = "absent";
  else if (npm.status === 200 && npm.body && typeof npm.body.versions === "object") {
    const existing = npm.body.versions[candidate.version];
    if (!existing) packageState = "absent";
    else {
      const integrity = `sha512-${createHash("sha512")
        .update(readFileSync(checkFile(directory, candidate.package)))
        .digest("base64")}`;
      if (
        existing.name !== candidate.name ||
        existing.version !== candidate.version ||
        existing.dist?.integrity !== integrity
      )
        throw new Error("npm version already exists with different or unverifiable bytes");
      packageState = "identical";
    }
  } else throw new Error("npm registry state is unknown; publication stopped");
  const query = new URLSearchParams({ service: "ghcr.io", scope: `repository:${repository}:pull` });
  const token = await registryJson(
    `https://ghcr.io/token?${query}`,
    {
      headers: {
        Authorization: `Basic ${Buffer.from(`${user}:${credential}`).toString("base64")}`,
      },
    },
    fetchImpl,
  );
  if (token.status !== 200 || typeof token.body.token !== "string" || !token.body.token)
    throw new Error("GHCR read-token request failed; registry state is unknown");
  const image = await registryJson(
    `https://ghcr.io/v2/${repository}/manifests/${candidate.version}`,
    {
      headers: {
        Authorization: `Bearer ${token.body.token}`,
        Accept:
          "application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json",
      },
    },
    fetchImpl,
  );
  let imageState;
  if (
    image.status === 404 &&
    image.body.errors?.length === 1 &&
    image.body.errors[0].code === "MANIFEST_UNKNOWN"
  )
    imageState = "absent";
  else if (image.status === 200 && image.body.config?.digest === candidate.image.config_id)
    imageState = "identical";
  else throw new Error("GHCR version exists with different bytes or registry state is unknown");
  return { package: packageState, image: imageState };
}

export async function promoteArtifacts(candidate, directory, options = {}) {
  // Reconcile both destinations before the first write, including partial-release resumption.
  const states = await registryPreflight(candidate, directory, options);
  const execute = options.run ?? run;
  if (states.package === "absent")
    execute("npm", [
      "publish",
      checkFile(directory, candidate.package),
      "--provenance",
      "--access",
      "public",
      "--ignore-scripts",
    ]);
  if (states.image === "absent") {
    const repository = options.repository ?? process.env.GHCR_REPOSITORY;
    const user = options.user ?? process.env.GHCR_USER;
    const credential = options.credential ?? process.env.GHCR_TOKEN;
    execute("docker", ["login", "ghcr.io", "--username", user, "--password-stdin"], {
      input: credential,
      stdio: ["pipe", "inherit", "inherit"],
    });
    const destination = `ghcr.io/${repository}:${candidate.version}`;
    execute("docker", ["tag", candidate.image.tag, destination]);
    execute("docker", ["push", destination]);
    execute("docker", ["image", "inspect", "--format", "{{json .RepoDigests}}", destination]);
  }
  return states;
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      directory: { type: "string" },
      evidence: { type: "string" },
      "source-ref": { type: "string", default: "local" },
      major: { type: "string" },
      complete: { type: "boolean" },
      "loaded-image": { type: "boolean" },
      "release-ref": { type: "string" },
    },
  });
  const command = positionals[0];
  const directory = values.directory ? resolve(values.directory) : undefined;
  if (command === "required") requireResults(JSON.parse(process.env.RESULTS ?? "null"));
  else if (command === "offline" && values.evidence) offline(values.evidence);
  else if (command === "package" && directory)
    packCandidate(directory, values["source-ref"], values.evidence);
  else if (command === "image" && directory) buildImage(directory);
  else if (command === "odoo" && directory && values.major)
    qualifyOdoo(directory, Number(values.major));
  else if (command === "archive" && directory) verifyArchive(directory);
  else if (command === "verify" && directory) {
    const candidate = verifyCandidate(directory, {
      complete: values.complete,
      releaseRef: values["release-ref"],
    });
    if (values["loaded-image"]) verifyLoadedImage(directory, candidate);
    console.log(JSON.stringify(candidate, null, 2));
  } else if (command === "resolve-release") {
    if (
      process.env.DISPATCH_REF !== "refs/heads/main" ||
      !/^v\d+\.\d+\.\d+(?:[a-zA-Z0-9.+-]*)$/.test(process.env.RELEASE_TAG ?? "")
    )
      throw new Error("Dispatch an immutable version tag from main");
    const ref = `refs/tags/${process.env.RELEASE_TAG}`;
    const sha = output("git", ["rev-parse", `${ref}^{commit}`]);
    run("git", ["checkout", "--detach", sha]);
    requireReleaseRef(ref, sha, metadata().version);
    if (!process.env.GITHUB_OUTPUT) throw new Error("Missing workflow output destination");
    writeFileSync(process.env.GITHUB_OUTPUT, `sha=${sha}\nref=${ref}\n`, { flag: "a" });
  } else if (["preflight", "promote"].includes(command) && directory && values["release-ref"]) {
    const candidate = verifyCandidate(directory, {
      complete: true,
      releaseRef: values["release-ref"],
    });
    run("docker", ["load", "--input", checkFile(directory, candidate.image.archive)]);
    verifyLoadedImage(directory, candidate);
    console.log(
      JSON.stringify(
        command === "preflight"
          ? await registryPreflight(candidate, directory)
          : await promoteArtifacts(candidate, directory),
      ),
    );
  } else
    throw new Error(
      "Expected candidate command and required --directory/--evidence/--major options",
    );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Candidate operation failed");
    process.exitCode = 1;
  });
}
