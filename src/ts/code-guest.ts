import * as sdk from "@godoo-dev/client/portable";
import * as formatters from "@godoo-dev/introspection/formatters";
import * as introspection from "@godoo-dev/introspection/portable";
import structuredClone from "@ungap/structured-clone";
import URLSearchParams from "@ungap/url-search-params";

// This entire module executes inside QuickJS. No host objects cross this boundary.
const guest = globalThis as typeof globalThis & {
  __hostCall(value: string): Promise<string>;
  __hostLog(value: string): void;
  __identity: { uid: number };
};
globalThis.structuredClone = structuredClone as typeof globalThis.structuredClone;
globalThis.URLSearchParams = URLSearchParams;
const call = guest.__hostCall;
const log = guest.__hostLog;
const client = sdk.createBoundClient({
  session: guest.__identity,
  safety: null,
  async rpc<T>(model: string, method: string, args: sdk.RpcArg[], kwargs: Record<string, unknown>) {
    const response = JSON.parse(await call(JSON.stringify({ model, method, args, kwargs })));
    if (response.ok) return response.value as T;
    const { message, category } = response.error;
    let error: Error;
    if (category === "access_denied") error = new sdk.OdooAccessError(message);
    else if (category === "missing_record") error = new sdk.OdooMissingError(message);
    else if (category === "auth_failed") error = new sdk.OdooAuthError(message);
    else if (category === "odoo_rejected") error = new sdk.OdooValidationError(message);
    else if (category === "policy_denied") {
      error = new sdk.OdooSafetyError({ name: "rpc", model, level: "WRITE", description: message });
    } else error = new sdk.OdooProtocolError(message);
    Object.assign(error, { category });
    throw error;
  },
});
Object.assign(globalThis, {
  client,
  sdk,
  introspection,
  formatters,
  introspect: new introspection.Introspector(client),
  console: Object.fromEntries(
    ["log", "warn", "error", "info", "debug"].map((name) => [
      name,
      (...values: unknown[]) => log(values.map(String).join(" ")),
    ]),
  ),
});
delete (guest as Partial<typeof guest>).__hostCall;
delete (guest as Partial<typeof guest>).__hostLog;
delete (guest as Partial<typeof guest>).__identity;
