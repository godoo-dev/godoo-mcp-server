import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  archiveIdentity,
  checkFile,
  fileRecord,
  promoteArtifacts,
  ROOT,
  registryPreflight,
  requireJunit,
  requireReleaseRef,
  SUITES,
  sha256,
  sourceIdentity,
  validateFacts,
  validateImageFacts,
  verifyCandidate,
  verifyLoadedImage,
  verifyRuntimeBundles,
} from "./candidate.mjs";

function temporary(t) {
  const directory = mkdtempSync(join(tmpdir(), "godoo-candidate-check-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

const GOOD_JUNIT =
  '<testsuites><testsuite tests="1" skipped="0" failures="0" errors="0"><testcase name="observed"/></testsuite></testsuites>';

function fixture(t) {
  const directory = temporary(t);
  const root = join(directory, "source");
  const candidateDirectory = join(directory, "candidate");
  const staging = join(directory, "staging");
  mkdirSync(join(root, "tests/acceptance"), { recursive: true });
  mkdirSync(candidateDirectory);
  mkdirSync(join(staging, "package/dist"), { recursive: true });
  const packageMetadata = { name: "@godoo-dev/mcp-server", version: "0.3.0" };
  for (const path of [join(root, "package.json"), join(staging, "package/package.json")])
    writeFileSync(path, JSON.stringify(packageMetadata));
  writeFileSync(join(root, "pnpm-lock.yaml"), "frozen node dependencies");
  writeFileSync(join(root, "tests/acceptance/uv.lock"), "frozen acceptance dependencies");
  writeFileSync(
    join(staging, "package/dist/worker.mjs"),
    "export default {fetch(){return new Response('ok')}};",
  );
  writeFileSync(join(staging, "package/dist/node.mjs"), "console.log('node fixture');");
  writeFileSync(join(staging, "package/dist/index.mjs"), "export const fixture = true;");
  writeFileSync(join(staging, "package/dist/quickjs.wasm"), new Uint8Array([0, 97, 115, 109]));
  for (const name of ["code-node.mjs", "code-node-isolate.mjs", "code-LICENSES.txt"])
    writeFileSync(join(staging, "package/dist", name), "export const fixture = true;");
  writeFileSync(join(staging, "package/dist/quickjs-metering.json"), "{}");
  execFileSync("git", ["init", "-q", "--initial-branch=main"], { cwd: root });
  execFileSync("git", ["config", "core.hooksPath", "/dev/null"], { cwd: root });
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync(
    "git",
    [
      "-c",
      "user.name=Candidate Test",
      "-c",
      "user.email=candidate@example.invalid",
      "commit",
      "-qm",
      "candidate fixture",
    ],
    { cwd: root },
  );
  execFileSync("git", ["update-ref", "refs/remotes/origin/main", "HEAD"], { cwd: root });
  execFileSync("git", ["tag", "v0.3.0"], { cwd: root });
  execFileSync("tar", ["-czf", join(candidateDirectory, "package.tgz"), "-C", staging, "package"]);
  copyFileSync(join(staging, "package/dist/worker.mjs"), join(candidateDirectory, "worker.mjs"));
  const candidate = {
    schema: 2,
    source: sourceIdentity(root),
    source_ref: "refs/tags/v0.3.0",
    ...packageMetadata,
    locks: Object.fromEntries(
      ["pnpm-lock.yaml", "tests/acceptance/uv.lock"].map((path) => [
        path,
        sha256(join(root, path)),
      ]),
    ),
    package: fileRecord(join(candidateDirectory, "package.tgz")),
    worker: fileRecord(join(candidateDirectory, "worker.mjs")),
    bundles: Object.fromEntries(
      [
        "index.mjs",
        "node.mjs",
        "worker.mjs",
        "quickjs.wasm",
        "code-node.mjs",
        "code-node-isolate.mjs",
        "quickjs-metering.json",
        "code-LICENSES.txt",
      ].map((name) => [name, sha256(join(staging, "package/dist", name))]),
    ),
  };
  const save = () =>
    writeFileSync(join(candidateDirectory, "candidate.json"), JSON.stringify(candidate));
  save();
  return { root, directory: candidateDirectory, staging, candidate, save };
}

function addArchive(state, oci = true) {
  const staging = join(state.staging, "archive");
  mkdirSync(staging, { recursive: true });
  const config = Buffer.from('{"rootfs":{"diff_ids":["sha256:fixture-layer"]}}');
  const configId = `sha256:${createHash("sha256").update(config).digest("hex")}`;
  const descriptor = Buffer.from(JSON.stringify({ config: { digest: configId } }));
  const descriptorId = `sha256:${createHash("sha256").update(descriptor).digest("hex")}`;
  const tag = "godoo-mcp-server:candidate-fixture";
  writeFileSync(
    join(staging, "manifest.json"),
    JSON.stringify([{ Config: "config.json", RepoTags: [tag], Layers: [] }]),
  );
  writeFileSync(join(staging, "config.json"), config);
  const files = ["manifest.json", "config.json"];
  if (oci) {
    mkdirSync(join(staging, "blobs/sha256"), { recursive: true });
    writeFileSync(
      join(staging, "index.json"),
      JSON.stringify({ manifests: [{ digest: descriptorId }] }),
    );
    writeFileSync(join(staging, `blobs/sha256/${descriptorId.slice(7)}`), descriptor);
    files.push("index.json", `blobs/sha256/${descriptorId.slice(7)}`);
  }
  execFileSync("tar", ["-cf", join(state.directory, "image.tar"), "-C", staging, ...files]);
  state.candidate.image = {
    tag,
    id: configId,
    config_id: configId,
    archive: fileRecord(join(state.directory, "image.tar")),
  };
  state.save();
  return { configId, descriptorId };
}

function facts(major) {
  return {
    requested_major: major,
    observed_major: major,
    modules: ["base", "mail", "project"],
    network_id: "a".repeat(64),
    containers: ["b", "c"].map((letter) => ({
      id: letter.repeat(64),
      image_id: `sha256:${letter.repeat(64)}`,
    })),
  };
}

function complete(state) {
  addArchive(state);
  state.candidate.odoo_majors = [18, 19];
  for (const major of [18, 19]) {
    const proofs = {};
    for (const suite of SUITES) {
      const report = join(state.directory, `odoo-${major}-${suite}.xml`);
      const observations = join(state.directory, `odoo-${major}-${suite}-facts.jsonl`);
      writeFileSync(report, GOOD_JUNIT);
      writeFileSync(observations, `${JSON.stringify(facts(major))}\n`);
      proofs[suite] = { report: fileRecord(report), facts: fileRecord(observations), tests: 1 };
      if (suite === "image") {
        const runtimeFacts = join(state.directory, `odoo-${major}-image-runtime-facts.jsonl`);
        writeFileSync(
          runtimeFacts,
          JSON.stringify({
            expected_image: state.candidate.image.id,
            observed_image: state.candidate.image.id,
            container_id: "d".repeat(64),
            uid: 1000,
            version: state.candidate.version,
          }),
        );
        proofs[suite].image_facts = fileRecord(runtimeFacts);
      }
    }
    writeFileSync(
      join(state.directory, `odoo-${major}.json`),
      JSON.stringify({
        image_id: state.candidate.image.id,
        package_sha256: state.candidate.package.sha256,
        worker_sha256: state.candidate.worker.sha256,
        proofs,
      }),
    );
  }
  state.candidate.proofs = {};
  for (const name of ["offline", "controls"]) {
    const path = join(state.directory, `${name}.xml`);
    writeFileSync(path, GOOD_JUNIT);
    state.candidate.proofs[name] = fileRecord(path);
  }
  const identity = join(state.directory, "offline-identity.json");
  writeFileSync(
    identity,
    JSON.stringify({ source: state.candidate.source, bundles: state.candidate.bundles }),
  );
  state.candidate.proofs.identity = fileRecord(identity);
  state.save();
}

test("required workflow gate rejects every result except success", () => {
  const workflow = readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf8");
  const command = workflow.split("\n  required:")[1]?.match(/\brun: (.+)/)?.[1];
  assert.ok(command, "Missing required workflow gate");
  const check = (result) =>
    execFileSync("bash", ["-euc", command], {
      env: { ...process.env, VALIDATION_RESULT: result },
    });
  check("success");
  for (const result of ["failure", "skipped", "cancelled", "", "null", "false"])
    assert.throws(() => check(result));
});

test("required JUnit rejects empty, truncated, skipped and errored reports", (t) => {
  const path = join(temporary(t), "report.xml");
  for (const document of [
    '<testsuite tests="0"/>',
    "<testsuite><testcase/>",
    "<testsuite><testcase><skipped/></testcase></testsuite>",
    "<testsuite><testcase><failure/></testcase></testsuite>",
    '<testsuite errors="1"><testcase/></testsuite>',
    '<testsuite skipped="1"><testcase/></testsuite>',
  ]) {
    writeFileSync(path, document);
    assert.throws(() => requireJunit(path));
  }
  writeFileSync(path, GOOD_JUNIT);
  assert.equal(requireJunit(path), 1);
});

test("source identity includes dirty and untracked input bytes", (t) => {
  const state = fixture(t);
  const before = sourceIdentity(state.root);
  writeFileSync(join(state.root, "new-input.txt"), "first");
  const first = sourceIdentity(state.root);
  writeFileSync(join(state.root, "new-input.txt"), "second");
  const second = sourceIdentity(state.root);
  assert.equal(before.dirty, false);
  assert.equal(first.dirty, true);
  assert.notEqual(first.untracked["new-input.txt"], second.untracked["new-input.txt"]);
});

test("candidate rejects traversal, symlinks and changed file bytes", (t) => {
  const directory = temporary(t);
  const path = join(directory, "artifact");
  writeFileSync(path, "bytes");
  const record = fileRecord(path);
  assert.equal(checkFile(directory, record), path);
  assert.throws(() => checkFile(directory, { ...record, file: "../artifact" }));
  symlinkSync(path, join(directory, "linked"));
  assert.throws(() => checkFile(directory, { ...record, file: "linked" }));
  writeFileSync(path, "changed");
  assert.throws(() => checkFile(directory, record), /hash mismatch/);
});

test("packed candidate verifies package identity and exact Worker bytes", (t) => {
  const state = fixture(t);
  assert.equal(verifyCandidate(state.directory, { root: state.root }).version, "0.3.0");
  writeFileSync(join(state.directory, "worker.mjs"), "different worker");
  assert.throws(() => verifyCandidate(state.directory, { root: state.root }), /hash mismatch/);
  state.candidate.worker = fileRecord(join(state.directory, "worker.mjs"));
  state.save();
  assert.throws(
    () => verifyCandidate(state.directory, { root: state.root }),
    /differs from package/,
  );
});

test("candidate refuses changed source and frozen dependency locks", (t) => {
  const state = fixture(t);
  writeFileSync(join(state.root, "pnpm-lock.yaml"), "changed dependency bytes");
  assert.throws(() => verifyCandidate(state.directory, { root: state.root }), /source identity/);
  state.candidate.source = sourceIdentity(state.root);
  state.save();
  assert.throws(() => verifyCandidate(state.directory, { root: state.root }), /lock mismatch/);
});

test("runtime qualification rejects replaced source/installed bundle bytes and links", (t) => {
  const state = fixture(t);
  const runtime = join(state.staging, "package/dist");
  verifyRuntimeBundles(runtime, state.candidate);
  const original = readFileSync(join(runtime, "node.mjs"));
  writeFileSync(join(runtime, "node.mjs"), "console.log('replacement runtime');");
  assert.throws(() => verifyRuntimeBundles(runtime, state.candidate), /Launched runtime differs/);
  writeFileSync(join(runtime, "node.mjs"), original);
  const target = join(state.directory, "linked-node.mjs");
  writeFileSync(target, original);
  rmSync(join(runtime, "node.mjs"));
  symlinkSync(target, join(runtime, "node.mjs"));
  assert.throws(() => verifyRuntimeBundles(runtime, state.candidate), /Launched runtime differs/);
});

for (const oci of [false, true])
  test(`image archive admits matching daemon config and OCI descriptor forms (OCI=${oci})`, (t) => {
    const state = fixture(t);
    const { configId, descriptorId } = addArchive(state, oci);
    for (const recorded of oci ? [configId, descriptorId] : [configId]) {
      for (const loaded of oci ? [configId, descriptorId] : [configId]) {
        state.candidate.image.id = recorded;
        assert.equal(
          verifyLoadedImage(state.directory, state.candidate, () => loaded),
          state.candidate.image.tag,
        );
      }
    }
    assert.throws(
      () => verifyLoadedImage(state.directory, state.candidate, () => `sha256:${"f".repeat(64)}`),
      /Loaded image differs/,
    );
    state.candidate.image.tag += "-other";
    assert.throws(
      () => archiveIdentity(state.directory, state.candidate.image),
      /single tested image tag/,
    );
  });

test("facts require an observed matching major and complete owned-resource identities", (t) => {
  const path = join(temporary(t), "facts.jsonl");
  writeFileSync(path, `${JSON.stringify(facts(18))}\n`);
  assert.equal(validateFacts(path, 18).length, 1);
  assert.throws(() => validateFacts(path, 19), /Odoo19/);
  writeFileSync(path, JSON.stringify({ ...facts(18), observed_major: 19 }));
  assert.throws(() => validateFacts(path, 18));
  writeFileSync(path, "");
  assert.throws(() => validateFacts(path, 18));
});

test("complete candidate requires both majors and all runtime suites for exact artifacts", (t) => {
  const state = fixture(t);
  complete(state);
  verifyCandidate(state.directory, { root: state.root, complete: true });
  const qualificationPath = join(state.directory, "odoo-18.json");
  const qualification = JSON.parse(readFileSync(qualificationPath));
  qualification.image_id = `sha256:${"f".repeat(64)}`;
  writeFileSync(qualificationPath, JSON.stringify(qualification));
  assert.throws(
    () => verifyCandidate(state.directory, { root: state.root, complete: true }),
    /another candidate/,
  );
  qualification.image_id = state.candidate.image.id;
  delete qualification.proofs.installed;
  writeFileSync(qualificationPath, JSON.stringify(qualification));
  assert.throws(
    () => verifyCandidate(state.directory, { root: state.root, complete: true }),
    /runtime qualification/,
  );
});

test("image observations reject wrong bytes, root and wrong installed version", (t) => {
  const state = fixture(t);
  addArchive(state);
  const path = join(state.directory, "image-facts.jsonl");
  const observation = {
    expected_image: state.candidate.image.id,
    observed_image: state.candidate.image.id,
    container_id: "d".repeat(64),
    uid: 1000,
    version: state.candidate.version,
  };
  writeFileSync(path, JSON.stringify(observation));
  validateImageFacts(path, state.candidate);
  for (const changes of [
    { uid: 0 },
    { observed_image: `sha256:${"f".repeat(64)}` },
    { version: "999.0.0" },
    { container_id: "unknown" },
  ]) {
    writeFileSync(path, JSON.stringify({ ...observation, ...changes }));
    assert.throws(() => validateImageFacts(path, state.candidate));
  }
});

test("release requires clean matching version tag on main ancestry", (t) => {
  const state = fixture(t);
  verifyCandidate(state.directory, { root: state.root, releaseRef: "refs/tags/v0.3.0" });
  assert.throws(() =>
    requireReleaseRef("refs/tags/v0.4.0", state.candidate.source.sha, "0.3.0", state.root),
  );
  state.candidate.source_ref = "local";
  state.save();
  assert.throws(
    () => verifyCandidate(state.directory, { root: state.root, releaseRef: "refs/tags/v0.3.0" }),
    /matching tag candidate/,
  );
});

function registries(_state, changes = {}) {
  const seen = [];
  const npmDocument = { status: 200, body: { versions: {} } };
  const tokenDocument = { status: 200, body: { token: "private-read-token" } };
  const imageDocument = {
    status: 404,
    body: { errors: [{ code: "MANIFEST_UNKNOWN", message: "manifest unknown" }] },
  };
  const fixtures = { npm: npmDocument, token: tokenDocument, image: imageDocument, ...changes };
  return {
    seen,
    options: {
      repository: "godoo-dev/godoo-mcp-server",
      user: "user",
      credential: "secret",
      fetch: async (url, init) => {
        seen.push({ url, init });
        const fixture =
          fixtures[
            url.includes("registry.npmjs.org") ? "npm" : url.includes("/token?") ? "token" : "image"
          ];
        return Response.json(fixture.body, { status: fixture.status });
      },
    },
  };
}

test("preflight checks npm and authenticated GHCR before either write", async (t) => {
  const state = fixture(t);
  addArchive(state);
  const { seen, options } = registries(state);
  const effects = [];
  const result = await promoteArtifacts(state.candidate, state.directory, {
    ...options,
    run: (command, args) => {
      assert.equal(seen.length, 3);
      effects.push([command, args]);
    },
  });
  assert.deepEqual(result, { package: "absent", image: "absent" });
  assert.equal(effects[0][0], "npm");
  assert.ok(effects.some(([command, args]) => command === "docker" && args[0] === "push"));
  assert.equal(
    seen[1].init.headers.Authorization,
    `Basic ${Buffer.from("user:secret").toString("base64")}`,
  );
  assert.equal(seen[2].init.headers.Authorization, "Bearer private-read-token");
});

for (const status of [200, 401, 403, 429, 500])
  test(`unknown or conflicting image HTTP${status} prevents both writes`, async (t) => {
    const state = fixture(t);
    addArchive(state);
    const { options } = registries(state, { image: { status, body: {} } });
    const effects = [];
    await assert.rejects(
      promoteArtifacts(state.candidate, state.directory, {
        ...options,
        run: (...args) => effects.push(args),
      }),
    );
    assert.equal(effects.length, 0);
  });

test("unknown npm and denied GHCR token stop before either publication", async (t) => {
  const state = fixture(t);
  addArchive(state);
  for (const changes of [
    { npm: { status: 404, body: { error: "DENIED" } } },
    { token: { status: 403, body: {} } },
    { image: { status: 404, body: { errors: [{ code: "DENIED" }] } } },
  ]) {
    const { options } = registries(state, changes);
    const effects = [];
    await assert.rejects(
      promoteArtifacts(state.candidate, state.directory, {
        ...options,
        run: (...args) => effects.push(args),
      }),
    );
    assert.equal(effects.length, 0);
  }
});

test("partial publication resumes only missing objects after exact byte reconciliation", async (t) => {
  const state = fixture(t);
  addArchive(state);
  const integrity = `sha512-${createHash("sha512")
    .update(readFileSync(join(state.directory, state.candidate.package.file)))
    .digest("base64")}`;
  const existingNpm = {
    status: 200,
    body: {
      versions: {
        "0.3.0": {
          name: state.candidate.name,
          version: state.candidate.version,
          dist: { integrity },
        },
      },
    },
  };
  const existingImage = {
    status: 200,
    body: { config: { digest: state.candidate.image.config_id } },
  };
  for (const [npm, image, expectedNpm, expectedImage] of [
    [existingNpm, undefined, false, true],
    [undefined, existingImage, true, false],
    [existingNpm, existingImage, false, false],
  ]) {
    const changes = { ...(npm ? { npm } : {}), ...(image ? { image } : {}) };
    const { options } = registries(state, changes);
    const effects = [];
    await promoteArtifacts(state.candidate, state.directory, {
      ...options,
      run: (command, args) => effects.push([command, args]),
    });
    assert.equal(
      effects.some(([command]) => command === "npm"),
      expectedNpm,
    );
    assert.equal(
      effects.some(([command, args]) => command === "docker" && args[0] === "push"),
      expectedImage,
    );
  }
  existingNpm.body.versions["0.3.0"].dist.integrity = "sha512-different";
  await assert.rejects(
    registryPreflight(
      state.candidate,
      state.directory,
      registries(state, { npm: existingNpm }).options,
    ),
    /different or unverifiable bytes/,
  );
});
