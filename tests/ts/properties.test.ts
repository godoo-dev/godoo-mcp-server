import { OdooAccessError, OdooClient } from "@godoo-dev/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  compileDomain,
  discover,
  type PropertyObject,
  prepareCreate,
  prepareUpdate,
  readProperties,
} from "../../src/ts/properties.ts";

const model = "test.child";
const field = "task_properties";
const definition = (name: string, label: string, type: string, extra = {}): PropertyObject => ({
  name,
  string: label,
  type,
  ...extra,
});

function fixture() {
  const definitions = new Map<number, PropertyObject[]>([
    [
      7,
      [
        definition("opaque-priority", "Priority", "selection", {
          selection: [
            ["opaque-high", "High"],
            ["opaque-normal", "Normal"],
          ],
        }),
        definition("opaque-effort", "Estimated Effort", "float"),
        definition("opaque-tags", "Channels", "tags", {
          tags: [
            ["opaque-email", "E-mail", 1],
            ["opaque-phone", "Phone", 2],
          ],
        }),
        definition("opaque-enabled", "Enabled", "boolean"),
        definition("opaque-notes", "Notes", "char"),
        definition("opaque-separator", "---", "separator"),
      ],
    ],
    [8, [definition("opaque-other", "Other Name", "integer")]],
    [9, [definition("opaque-owner", "Owner", "many2one", { comodel: "res.partner" })]],
  ]);
  const metadata: PropertyObject = {
    id: { type: "integer" },
    name: { type: "char" },
    project_id: { type: "many2one", relation: "test.parent" },
    other_parent_id: { type: "many2one", relation: "test.parent" },
    [field]: {
      type: "properties",
      definition_record: "project_id",
      definition_record_field: "property_definitions",
    },
    other_properties: {
      type: "properties",
      definition_record: "other_parent_id",
      definition_record_field: "other_definitions",
    },
  };
  const entries = (parent: number, values: unknown[]): PropertyObject[] =>
    (definitions.get(parent) ?? [])
      .filter((item) => item.type !== "separator")
      .map((item, index) => ({ ...structuredClone(item), value: values[index] }));
  const rows = new Map<number, PropertyObject>([
    [
      42,
      {
        id: 42,
        name: "First",
        project_id: [7, "Parent"],
        other_parent_id: [9, "Other"],
        [field]: entries(7, ["opaque-high", 0, ["opaque-email"], false, ""]),
        other_properties: entries(9, [[11, "Owner"]]),
      },
    ],
    [
      43,
      {
        id: 43,
        name: "Second",
        project_id: [8, "Parent B"],
        other_parent_id: [9, "Other"],
        [field]: entries(8, [2]),
        other_properties: entries(9, [false]),
      },
    ],
  ]);
  const client = new OdooClient({
    url: "https://example.invalid",
    database: "test",
    username: "test",
    password: "test",
  });
  const calls: { model: string; method: string; args: unknown[]; kwargs: PropertyObject }[] = [];
  let denyParent = false;
  vi.spyOn(client, "call").mockImplementation(async (target, method, args = [], kwargs = {}) => {
    calls.push(structuredClone({ model: target, method, args, kwargs }));
    if (target === "test.parent" && denyParent)
      throw new OdooAccessError("PRIVATE opaque-priority");
    if (method === "fields_get")
      return structuredClone(
        target === model
          ? metadata
          : {
              property_definitions: { type: "properties_definition" },
              other_definitions: { type: "properties_definition" },
            },
      );
    if (method === "read") {
      const ids = args[0] as number[];
      const fields = kwargs.fields as string[] | undefined;
      return ids
        .map((id) => {
          const row =
            target === model
              ? rows.get(id)
              : {
                  id,
                  property_definitions: definitions.get(id),
                  other_definitions: definitions.get(id),
                };
          return row
            ? Object.fromEntries(
                Object.entries(structuredClone(row)).filter(
                  ([key]) => !fields || key === "id" || fields.includes(key),
                ),
              )
            : undefined;
        })
        .filter((row) => row !== undefined);
    }
    throw new Error(`Unexpected mutating RPC ${method}`);
  });
  return {
    client,
    definitions,
    metadata,
    rows,
    calls,
    entries,
    deny: () => {
      denyParent = true;
    },
  };
}

describe("friendly property contracts through the published client scope", () => {
  let memory: ReturnType<typeof fixture>;
  beforeEach(() => {
    memory = fixture();
  });

  it("discovers all containers using fixed language and public aliases", async () => {
    const result = await discover(memory.client, model, 42);
    expect(result[field]).toEqual([
      {
        name: "priority",
        label: "Priority",
        type: "selection",
        values: [
          { name: "high", label: "High" },
          { name: "normal", label: "Normal" },
        ],
      },
      { name: "estimated_effort", label: "Estimated Effort", type: "float" },
      {
        name: "channels",
        label: "Channels",
        type: "tags",
        values: [
          { name: "e_mail", label: "E-mail" },
          { name: "phone", label: "Phone" },
        ],
      },
      { name: "enabled", label: "Enabled", type: "boolean" },
      { name: "notes", label: "Notes", type: "char" },
    ]);
    expect(result.other_properties).toEqual([
      { name: "owner", label: "Owner", type: "many2one", comodel: "res.partner" },
    ]);
    expect(JSON.stringify(result)).not.toContain("opaque");
    expect(
      memory.calls.every((call) => JSON.stringify(call.kwargs.context) === '{"lang":"en_US"}'),
    ).toBe(true);
  });

  it("discovers explicit parents without child reads", async () => {
    expect(await discover(memory.client, model, undefined, field, 8)).toEqual({
      [field]: [{ name: "other_name", label: "Other Name", type: "integer" }],
    });
    expect(memory.calls.some((call) => call.model === model && call.method === "read")).toBe(false);
  });

  it.each([
    [undefined, undefined, undefined],
    [0, undefined, undefined],
    [42, field, 7],
    [undefined, field, undefined],
    [undefined, field, -1],
  ])("rejects ambiguous discovery scope %s %s %s", async (record, container, parent) => {
    await expect(discover(memory.client, model, record, container, parent)).rejects.toThrow(
      "positive",
    );
    expect(memory.calls).toHaveLength(0);
  });

  it("reads parent-specific names, ordered rows and selective projections", async () => {
    const result = await readProperties(
      memory.client,
      model,
      [43, 42],
      ["name", `properties.${field}`, "properties.other_properties.owner"],
    );
    expect(result).toEqual([
      {
        id: 43,
        name: "Second",
        properties: { [field]: { other_name: 2 }, other_properties: { owner: null } },
      },
      {
        id: 42,
        name: "First",
        properties: {
          [field]: {
            priority: "high",
            estimated_effort: 0,
            channels: ["e_mail"],
            enabled: false,
            notes: "",
          },
          other_properties: { owner: 11 },
        },
      },
    ]);
    expect(
      await readProperties(memory.client, model, [42], [`properties.${field}.priority`]),
    ).toEqual([{ id: 42, properties: { [field]: { priority: "high" } } }]);
  });

  it.each([
    "properties.",
    "properties.a.b.c",
    "properties..x",
  ])("rejects malformed path before RPC %s", async (path) => {
    await expect(readProperties(memory.client, model, [42], [path])).rejects.toThrow(
      "Use properties",
    );
    expect(memory.calls).toHaveLength(0);
  });

  it("keeps raw reads unchanged and empty friendly reads empty", async () => {
    expect(await readProperties(memory.client, model, [], [`properties.${field}`])).toEqual([]);
    expect(memory.calls).toHaveLength(0);
    expect((await readProperties(memory.client, model, [42], [field]))[0][field]).toEqual(
      memory.rows.get(42)?.[field],
    );
  });

  it("prepares all sparse update containers without dispatch or mutating input", async () => {
    const patch = {
      [field]: { priority: "normal", estimated_effort: null, channels: [] },
      other_properties: { owner: 12 },
    };
    const snapshot = structuredClone(patch);
    const values = { name: "Changed" };
    expect(await prepareUpdate(memory.client, model, 42, patch, values)).toEqual({
      name: "Changed",
      [field]: {
        "opaque-priority": "opaque-normal",
        "opaque-effort": false,
        "opaque-tags": [],
        "opaque-enabled": false,
        "opaque-notes": "",
      },
      other_properties: { "opaque-owner": 12 },
    });
    expect(patch).toEqual(snapshot);
    expect(values).toEqual({ name: "Changed" });
    expect(memory.calls.every((call) => ["read", "fields_get"].includes(call.method))).toBe(true);
  });

  it("encodes false, zero, empty values and explicit clears distinctly", async () => {
    expect(
      (
        await prepareUpdate(
          memory.client,
          model,
          42,
          {
            [field]: {
              enabled: false,
              estimated_effort: 0,
              notes: "",
              priority: null,
              channels: null,
            },
          },
          {},
        )
      )[field],
    ).toEqual({
      "opaque-priority": false,
      "opaque-effort": 0,
      "opaque-tags": [],
      "opaque-enabled": false,
      "opaque-notes": "",
    });
  });

  it.each([
    ["estimated_effort", false],
    ["estimated_effort", true],
    ["estimated_effort", Number.NaN],
    ["estimated_effort", Number.POSITIVE_INFINITY],
    ["notes", false],
    ["enabled", 0],
    ["priority", "opaque-high"],
    ["priority", []],
    ["channels", "phone"],
    ["channels", ["Phone"]],
    ["channels", ["opaque-phone"]],
    ["opaque-priority", "high"],
  ])("rejects malformed patch %s and sanitizes diagnostics", async (name, value) => {
    const result = prepareUpdate(memory.client, model, 42, { [field]: { [name]: value } }, {});
    await expect(result).rejects.toThrow();
    await expect(result).rejects.not.toThrow(/opaque/);
  });

  it.each([
    {},
    { [field]: {} },
    { [field]: [] },
  ])("rejects empty patches before RPC", async (patch) => {
    await expect(prepareUpdate(memory.client, model, 42, patch, {})).rejects.toThrow("nonempty");
    expect(memory.calls).toHaveLength(0);
  });

  it.each([
    { project_id: 8 },
    { [field]: {} },
    { other_properties: [] },
  ])("rejects parent moves and raw mixing before record reads", async (values) => {
    await expect(
      prepareUpdate(memory.client, model, 42, { [field]: { priority: "normal" } }, values),
    ).rejects.toThrow();
    expect(memory.calls.some((call) => call.method === "read")).toBe(false);
  });

  it.each([
    "missing",
    "duplicate",
    "kind",
    "value",
    "option",
    "extra",
  ])("rejects malformed untouched values: %s", async (corruption) => {
    const entries = memory.rows.get(42)?.[field] as PropertyObject[];
    if (corruption === "missing") entries.splice(1, 1);
    if (corruption === "duplicate") entries.push(structuredClone(entries[1]));
    if (corruption === "kind") entries[1].type = "integer";
    if (corruption === "value") entries[1].value = "bad";
    if (corruption === "option") entries[0].value = "unmapped-private-option";
    if (corruption === "extra")
      entries.push({ ...definition("private-new", "New", "json"), value: null });
    const result = prepareUpdate(memory.client, model, 42, { [field]: { notes: "Changed" } }, {});
    await expect(result).rejects.toThrow("all current values");
    await expect(result).rejects.not.toThrow(/private|opaque/);
  });

  it.each([
    false,
    true,
    0,
    -1,
    "7",
    [7, "Parent"],
  ])("requires explicit positive create parent %s", async (parent) => {
    await expect(
      prepareCreate(
        memory.client,
        model,
        { [field]: { priority: "high" } },
        { project_id: parent },
      ),
    ).rejects.toThrow("positive definition-parent");
  });

  it("preflights all create containers and returns one sparse raw payload", async () => {
    const result = await prepareCreate(
      memory.client,
      model,
      {
        [field]: { priority: "high", estimated_effort: 0, enabled: false, notes: "" },
        other_properties: { owner: null },
      },
      { name: "New", project_id: 7, other_parent_id: 9 },
    );
    expect(result).toEqual({
      name: "New",
      project_id: 7,
      other_parent_id: 9,
      [field]: {
        "opaque-priority": "opaque-high",
        "opaque-effort": 0,
        "opaque-enabled": false,
        "opaque-notes": "",
      },
      other_properties: { "opaque-owner": false },
    });
    expect(memory.calls.some((call) => call.method === "create")).toBe(false);
  });

  it("permits unicode and leading-digit aliases without language alias restrictions", async () => {
    memory.definitions.set(7, [
      definition("aa", "1 Priority", "selection", { selection: [["bb", "class"]] }),
      definition("cc", "État", "char"),
    ]);
    expect(
      await prepareCreate(
        memory.client,
        model,
        { [field]: { "1_priority": "class", état: "ok" } },
        { project_id: 7 },
      ),
    ).toEqual({ project_id: 7, [field]: { aa: "bb", cc: "ok" } });
  });

  it.each([
    ["CAFÉ", "cafe\u0301"],
    ["A-B", "A B"],
    ["---", "Other"],
    ["Straße", "STRASSE"],
  ])("rejects empty or colliding aliases %s %s", async (first, second) => {
    memory.definitions.set(7, [definition("aa", first, "char"), definition("bb", second, "char")]);
    await expect(discover(memory.client, model, undefined, field, 7)).rejects.toThrow(
      "empty or duplicate",
    );
  });

  it("compiles parent-scoped native domains without changing input or reading child rows", async () => {
    const domain = [
      ["project_id", "=", 7],
      ["other_parent_id", "=", 9],
      [`properties.${field}.priority`, "in", ["high", "normal"]],
      [`properties.${field}.estimated_effort`, ">=", 0],
      ["properties.other_properties.owner", "=", 11],
    ];
    const snapshot = structuredClone(domain);
    expect(await compileDomain(memory.client, model, domain)).toEqual([
      ["project_id", "=", 7],
      ["other_parent_id", "=", 9],
      [`${field}.opaque-priority`, "in", ["opaque-high", "opaque-normal"]],
      [`${field}.opaque-effort`, ">=", 0],
      ["other_properties.opaque-owner", "=", 11],
    ]);
    expect(domain).toEqual(snapshot);
    expect(memory.calls.some((call) => call.model === model && call.method === "read")).toBe(false);
  });

  it.each([
    { scope: [] },
    { scope: [["project_id", "in", [7]]] },
    { scope: [["project_id", "=", true]] },
    { scope: [["project_id", "=", 0]] },
    {
      scope: [
        ["project_id", "=", 7],
        ["project_id", "=", 8],
      ],
    },
    { scope: [["project_id", "!=", 7]] },
  ])("refuses missing or ambiguous parent scope", async ({ scope }) => {
    await expect(
      compileDomain(memory.client, model, [
        ...scope,
        [`properties.${field}.priority`, "=", "high"],
      ]),
    ).rejects.toThrow("positive definition-parent");
  });

  it.each(["|", "&", "!"])("rejects friendly boolean expression %s before RPC", async (prefix) => {
    await expect(
      compileDomain(memory.client, model, [
        prefix,
        ["project_id", "=", 7],
        [`properties.${field}.priority`, "=", "high"],
      ]),
    ).rejects.toThrow("conjunction");
    expect(memory.calls).toHaveLength(0);
  });

  it("rejects nested friendly predicates and preserves unrelated raw values", async () => {
    await expect(
      compileDomain(memory.client, model, [
        [
          "children",
          "any",
          [
            ["project_id", "=", 7],
            [`properties.${field}.priority`, "=", "high"],
          ],
        ],
      ]),
    ).rejects.toThrow("conjunction");
    const raw = ["|", ["name", "in", ["properties.example", "=", "literal"]], ["id", "=", 1]];
    expect(await compileDomain(memory.client, model, raw)).toBe(raw);
    expect(memory.calls).toHaveLength(0);
  });

  it.each([
    ["channels", "in", ["e_mail"]],
    ["channels", "=", []],
    ["priority", "ilike", "high"],
    ["priority", "in", []],
    ["priority", "in", "high"],
    ["estimated_effort", ">", null],
  ])("rejects unsupported predicate %s %s", async (name, operator, value) => {
    await expect(
      compileDomain(memory.client, model, [
        ["project_id", "=", 7],
        [`properties.${field}.${name}`, operator, value],
      ]),
    ).rejects.toThrow();
  });

  it("normalizes relation display tuples on read and validates scalar date kinds", async () => {
    memory.definitions.set(8, [
      definition("integer", "Count", "integer"),
      definition("date", "Due", "date"),
      definition("datetime", "Started", "datetime"),
      definition("owner", "Owner", "many2one", { comodel: "res.partner" }),
      definition("watchers", "Watchers", "many2many", { comodel: "res.partner" }),
    ]);
    const row = memory.rows.get(43) as PropertyObject;
    row[field] = memory.entries(8, [
      0,
      "2026-10-30",
      "2026-10-30 12:00:00",
      [11, "Display"],
      [
        [11, "Display"],
        [12, "Other"],
      ],
    ]);
    expect(await readProperties(memory.client, model, [43], [`properties.${field}`])).toEqual([
      {
        id: 43,
        properties: {
          [field]: {
            count: 0,
            due: "2026-10-30",
            started: "2026-10-30 12:00:00",
            owner: 11,
            watchers: [11, 12],
          },
        },
      },
    ]);
    for (const patch of [
      { count: true },
      { count: 1.5 },
      { due: "2026-02-30" },
      { started: "yesterday" },
      { owner: [11, "Display"] },
      { owner: 0 },
      { watchers: [[11, "Display"]] },
      { watchers: [true] },
    ]) {
      await expect(
        prepareUpdate(memory.client, model, 43, { [field]: patch }, {}),
      ).rejects.toThrow();
    }
    expect(
      (
        await prepareUpdate(
          memory.client,
          model,
          43,
          { [field]: { due: "2028-02-29", started: null, watchers: [] } },
          {},
        )
      )[field],
    ).toEqual({ integer: 0, date: "2028-02-29", datetime: false, owner: 11, watchers: [] });
  });

  it("keeps parent access failures for the central safe Odoo error mapper", async () => {
    memory.deny();
    await expect(discover(memory.client, model, undefined, field, 7)).rejects.toBeInstanceOf(
      OdooAccessError,
    );
  });

  it("accepts supported ISO dates and timezone datetimes without rewriting their values", async () => {
    memory.definitions.set(8, [
      definition("date", "Due", "date"),
      definition("datetime", "Started", "datetime"),
      definition("boolean", "Enabled", "boolean"),
    ]);
    const row = memory.rows.get(43) as PropertyObject;
    row[field] = memory.entries(8, ["2026-10-30", "2026-10-30T12:30:45.123+02:00", null]);
    expect((await readProperties(memory.client, model, [43], [`properties.${field}`]))[0]).toEqual({
      id: 43,
      properties: {
        [field]: { due: "2026-10-30", started: "2026-10-30T12:30:45.123+02:00", enabled: false },
      },
    });
    for (const due of ["20261030", "2026-W44-5", "2026W445"]) {
      const result = await prepareUpdate(
        memory.client,
        model,
        43,
        { [field]: { due, started: "20261030T123045Z" } },
        {},
      );
      expect(result[field]).toEqual({ date: due, datetime: "20261030T123045Z", boolean: false });
    }
    for (const due of ["0000-01-01", "2026-02-29", "2026-W54-1"]) {
      await expect(
        prepareUpdate(memory.client, model, 43, { [field]: { due } }, {}),
      ).rejects.toThrow();
    }
  });

  it.each(["selection", "tags"])("rejects colliding %s option aliases", async (type) => {
    memory.definitions.set(7, [
      definition("private", "Choice", type, {
        [type]:
          type === "selection"
            ? [
                ["a", "A-B"],
                ["b", "A B"],
              ]
            : [
                ["a", "A-B", 1],
                ["b", "A B", 2],
              ],
      }),
    ]);
    await expect(discover(memory.client, model, undefined, field, 7)).rejects.toThrow(
      "Option labels produce empty or duplicate",
    );
  });

  it("rejects raw mixed reads and inaccessible containers", async () => {
    await expect(
      readProperties(memory.client, model, [42], ["other_properties", `properties.${field}`]),
    ).rejects.toThrow("friendly properties paths");
    await expect(
      readProperties(memory.client, model, [42], ["properties.private_opaque"]),
    ).rejects.toThrow("container");
    await expect(
      readProperties(memory.client, model, [42], [`properties.${field}.opaque_priority`]),
    ).rejects.toThrow("Unknown property name");
  });
});
