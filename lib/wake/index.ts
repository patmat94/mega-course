// The wake module's public surface (WAKE.md § Exports).
export { standardWebhooks, courseHmac } from "./verify.ts";
export type { Verdict, Verifier } from "./verify.ts";
export { ingress } from "./ingress.ts";
export { readLog, writeRow, isoAt } from "./log.ts";
export { consume, delayFor } from "./consume.ts";
export type * from "./types.ts";
