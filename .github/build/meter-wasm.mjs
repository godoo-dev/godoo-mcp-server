import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import binaryen from "binaryen";

let prepared;
/** Instrument the pinned engine itself, including native BigInt/string/regex loops. */
export function meteredWasm() {
  prepared ??= prepare();
  return prepared;
}
async function prepare() {
  const original = await readFile(
    new URL(import.meta.resolve("@jitl/quickjs-wasmfile-release-sync/wasm")),
  );
  if (
    createHash("sha256").update(original).digest("hex") !==
    "105c3bed22d457e43e3d1c3c1c6959fda62a8fe06f0fc8a985303c3a2be72232"
  )
    throw new Error("Unqualified QuickJS WASM");
  const module = binaryen.readBinary(original);
  module.setFeatures(
    binaryen.Features.MVP |
      binaryen.Features.SignExt |
      binaryen.Features.NontrappingFPToInt |
      binaryen.Features.BulkMemory |
      binaryen.Features.BulkMemoryOpt,
  );
  const children = new Map();
  for (const [name, fields] of Object.entries({
    Block: ["children"],
    If: ["condition", "ifTrue", "ifFalse"],
    Loop: ["body"],
    Break: ["condition", "value"],
    Switch: ["condition", "value"],
    Call: ["operands"],
    CallIndirect: ["target", "operands"],
    LocalGet: [],
    LocalSet: ["value"],
    GlobalGet: [],
    GlobalSet: ["value"],
    Load: ["ptr"],
    Store: ["ptr", "value"],
    Const: [],
    Unary: ["value"],
    Binary: ["left", "right"],
    Select: ["condition", "ifTrue", "ifFalse"],
    Drop: ["value"],
    Return: ["value"],
    Nop: [],
    Unreachable: [],
    MemorySize: [],
    MemoryGrow: ["delta"],
    MemoryInit: ["dest", "offset", "size"],
    DataDrop: [],
    MemoryCopy: ["dest", "source", "size"],
    MemoryFill: ["dest", "value", "size"],
    RefNull: [],
    RefFunc: [],
    RefIsNull: ["value"],
    TableGet: ["index"],
    TableSet: ["index", "value"],
    TableSize: [],
    TableGrow: ["value", "delta"],
  }))
    children.set(binaryen[`${name}Id`], fields);
  const fuel = "__godoo_fuel";
  // Instantiation can run the WASM start function before host exports are available.
  module.addGlobal(fuel, binaryen.i32, true, module.i32.const(20000000));
  let loops = 0;
  let functions = 0;
  const seen = new Set();
  function charge(body) {
    return module.block(
      null,
      [
        module.if(module.i32.eqz(module.global.get(fuel, binaryen.i32)), module.unreachable()),
        module.global.set(
          fuel,
          module.i32.sub(module.global.get(fuel, binaryen.i32), module.i32.const(1)),
        ),
        body,
      ],
      binaryen.getExpressionType(body),
    );
  }
  function visit(expression) {
    if (!expression || seen.has(expression)) return;
    seen.add(expression);
    const id = binaryen.getExpressionId(expression);
    const fields = children.get(id);
    if (!fields) throw new Error(`Unqualified WASM expression ${id}`);
    if (fields.length === 0) return;
    const info = binaryen.getExpressionInfo(expression);
    for (const field of fields) {
      const value = info[field];
      if (Array.isArray(value)) for (const child of value) visit(child);
      else if (typeof value === "number") visit(value);
      else if (value) throw new Error("Unexpected WASM child expression");
    }
    if (id === binaryen.LoopId) {
      binaryen.Loop.setBody(expression, charge(info.body));
      loops += 1;
    }
    if (id === binaryen.MemoryCopyId)
      binaryen.MemoryCopy.setSize(
        expression,
        module.call("__godoo_charge_bytes", [info.size], binaryen.i32),
      );
    if (id === binaryen.MemoryFillId)
      binaryen.MemoryFill.setSize(
        expression,
        module.call("__godoo_charge_bytes", [info.size], binaryen.i32),
      );
    if (id === binaryen.MemoryInitId)
      binaryen.MemoryInit.setSize(
        expression,
        module.call("__godoo_charge_bytes", [info.size], binaryen.i32),
      );
  }
  try {
    const count = module.getNumFunctions();
    for (let i = 0; i < count; i++) {
      const fn = module.getFunctionByIndex(i);
      const body = binaryen.getFunctionInfo(fn).body;
      if (!body) continue;
      visit(body);
      binaryen.Function.setBody(fn, charge(body));
      functions += 1;
    }
    module.addFunction(
      "__godoo_charge_bytes",
      binaryen.i32,
      binaryen.i32,
      [],
      module.block(
        null,
        [
          module.if(
            module.i32.gt_u(
              module.local.get(0, binaryen.i32),
              module.global.get(fuel, binaryen.i32),
            ),
            module.block(null, [
              module.global.set(fuel, module.i32.const(0)),
              module.unreachable(),
            ]),
          ),
          module.global.set(
            fuel,
            module.i32.sub(
              module.global.get(fuel, binaryen.i32),
              module.local.get(0, binaryen.i32),
            ),
          ),
          module.local.get(0, binaryen.i32),
        ],
        binaryen.i32,
      ),
    );
    module.addFunction(
      "__godoo_set_fuel",
      binaryen.i32,
      binaryen.none,
      [],
      module.global.set(fuel, module.local.get(0, binaryen.i32)),
    );
    module.addFunctionExport("__godoo_set_fuel", "__godoo_set_fuel");
    module.addFunction(
      "__godoo_get_fuel",
      binaryen.none,
      binaryen.i32,
      [],
      module.global.get(fuel, binaryen.i32),
    );
    module.addFunctionExport("__godoo_get_fuel", "__godoo_get_fuel");
    if (!module.validate()) throw new Error("Invalid metered WASM");
    const bytes = module.emitBinary();
    if (!WebAssembly.validate(bytes)) throw new Error("Host rejected metered WASM");
    const originalModule = await WebAssembly.compile(original);
    const transformedModule = await WebAssembly.compile(bytes);
    if (
      JSON.stringify(WebAssembly.Module.imports(originalModule)) !==
      JSON.stringify(WebAssembly.Module.imports(transformedModule))
    )
      throw new Error("Metering changed WASM imports");
    if (
      JSON.stringify(WebAssembly.Module.exports(originalModule)) !==
      JSON.stringify(
        WebAssembly.Module.exports(transformedModule).filter(
          (item) => !["__godoo_set_fuel", "__godoo_get_fuel"].includes(item.name),
        ),
      )
    )
      throw new Error("Metering changed WASM exports");
    // A changed upstream module needs renewed transform and hostile-program qualification.
    if (functions !== 1321 || loops !== 1079 || seen.size !== 186684)
      throw new Error("QuickJS metering coverage changed");
    return {
      bytes,
      manifest: {
        schema: 1,
        source_sha256: createHash("sha256").update(original).digest("hex"),
        sha256: createHash("sha256").update(bytes).digest("hex"),
        functions,
        loops,
        expressions: seen.size,
        binaryen: "125.0.0",
      },
    };
  } finally {
    module.dispose();
  }
}
