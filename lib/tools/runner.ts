/**
 * Parallel runner — fans a query out to many tools concurrently.
 *
 * Per-tool failures are caught and turned into empty finding lists
 * (or a single error finding, depending on which layer failed), so
 * one slow/broken upstream cannot poison a hunt.
 *
 * The concurrency cap defaults to 6 (matches the Python version).
 * Bounded by a per-tool timeout (ToolFunction.per_request_timeout_ms).
 */

import type { Finding, ToolFunction, ToolQuery } from "./base";

export interface RunResult {
  tool: string;
  findings: Finding[];
  duration_ms: number;
  error?: string;
}

export async function runTools(
  tools: ToolFunction[],
  query: ToolQuery,
  concurrency = 6
): Promise<RunResult[]> {
  const results: RunResult[] = [];
  let cursor = 0;
  const next = async (): Promise<void> => {
    const i = cursor++;
    if (i >= tools.length) return;
    const tool = tools[i];
    const t0 = Date.now();
    try {
      const findings = await tool.run(query);
      results.push({
        tool: tool.name,
        findings,
        duration_ms: Date.now() - t0,
      });
    } catch (e) {
      results.push({
        tool: tool.name,
        findings: [],
        duration_ms: Date.now() - t0,
        error: String(e).slice(0, 240),
      });
    }
    await next();
  };
  const workers = Array.from(
    { length: Math.min(concurrency, tools.length) },
    () => next()
  );
  await Promise.all(workers);
  return results;
}
