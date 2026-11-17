import { createHash } from "crypto";

/** Explicit next purchase only. Same completed order always leads to the same next scope. */
export function nextCheckoutScope(sessionId: string, orderId: string): string {
  const bytes = createHash("sha256").update(JSON.stringify(["gama:next-checkout:v1", sessionId, orderId])).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 15) | 80;
  bytes[8] = (bytes[8]! & 63) | 128;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
