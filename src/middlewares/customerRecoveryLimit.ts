import type { Request, Response, NextFunction } from "express";

// Extra per-source ceiling; durable per-account quotas and code attempts live in PostgreSQL.
// Never trust caller-provided X-Forwarded-For. Behind a proxy this ceiling is shared.
const buckets = new Map<string, { count: number; expires: number }>();
export function customerRecoveryLimit(req: Request, res: Response, next: NextFunction) {
  res.set('Cache-Control', 'no-store');
  const now = Date.now();
  for (const [key, bucket] of buckets) if (bucket.expires <= now) buckets.delete(key);
  const key = req.socket.remoteAddress || 'unknown';
  let bucket = buckets.get(key);
  if (!bucket) {
    if (buckets.size >= 10000) return res.status(429).json({ error: "Aguarde antes de tentar novamente." });
    bucket = { count: 0, expires: now + 15 * 60 * 1000 };
    buckets.set(key, bucket);
  }
  if (++bucket.count > 120) return res.status(429).json({ error: "Aguarde antes de tentar novamente." });
  return next();
}
