export interface CodePort {
  dispatch(encoded: string): Promise<string>;
  close(reason: string): void;
  signal: AbortSignal;
}
export interface ExecutionResult {
  ok: boolean;
  result?: unknown;
  error?: string;
  logs: string[];
  elapsed_ms: number;
  wasm_bytes: number;
}
export const CODE_LIMITS = Object.freeze({
  source_bytes: 65536,
  final_bytes: 1024 * 1024,
  log_bytes: 4096,
  log_entries: 128,
  heap_bytes: 16 * 1024 * 1024,
  wasm_bytes: 32 * 1024 * 1024,
  stack_bytes: 512 * 1024,
  deadline_ms: 10000,
  burst_ms: 50,
  cpu_ms: 500,
  wasm_fuel: 20000000,
  concurrent_executions: 2,
});
