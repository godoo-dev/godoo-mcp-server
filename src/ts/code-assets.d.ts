declare module "godoo:code-guest" {
  const source: string;
  export default source;
}
declare module "godoo:sdk-declarations" {
  const declarations: Record<string, string>;
  export default declarations;
}
declare module "godoo:wasm" {
  const wasm: WebAssembly.Module | Uint8Array<ArrayBuffer>;
  export default wasm;
}
declare module "@ungap/url-search-params" {
  const implementation: typeof URLSearchParams;
  export default implementation;
}
