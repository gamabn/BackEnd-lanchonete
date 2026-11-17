export type BotStage = "configuration" | "terminal" | "qr_module" | "local_auth" | "esm_import" | "auth_load" | "socket" | "connection" | "reconnect" | "auth_save" | "processing" | "shutdown";

export class BotDiagnosticError extends Error {
  constructor(readonly stage: BotStage, readonly code: string, message: string) {
    super(message);
    this.name = "BotDiagnosticError";
  }
}

/** Allowlist only: never include SDK messages, stacks, paths or payload values. */
export function safeCause(error: unknown): string {
  const allowed = ["EAI_AGAIN", "ENOTFOUND", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EHOSTUNREACH", "ENETUNREACH", "EACCES", "EPERM", "ENOENT", "ENOSPC", "EEXIST", "ERR_MODULE_NOT_FOUND", "MODULE_NOT_FOUND", "ERR_REQUIRE_ESM", "ERR_REQUIRE_ASYNC_MODULE", "ERR_TLS_CERT_ALTNAME_INVALID", "CERT_HAS_EXPIRED", "UNABLE_TO_VERIFY_LEAF_SIGNATURE"];
  let current = error;
  for (let depth = 0; depth < 4 && current && typeof current === "object"; depth++) {
    const data = current as { code?: unknown; message?: unknown; cause?: unknown; output?: { statusCode?: unknown } };
    if (typeof data.code === "string" && allowed.includes(data.code)) return data.code;
    // Baileys may wrap a network error in Boom's message. Extract only a known
    // token, never its surrounding text (which may include URLs or credentials).
    if (typeof data.message === "string") {
      const token = data.message.match(/\b(?:EAI_AGAIN|ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH)\b/)?.[0];
      if (token) return token;
    }
    const status = data.output?.statusCode;
    if (typeof status === "number" && Number.isInteger(status) && status >= 100 && status <= 599) return `STATUS_${status}`;
    current = data.cause;
  }
  if (error instanceof SyntaxError) return "INVALID_JSON_OR_MODULE";
  return "UNKNOWN";
}

export function diagnostic(error: unknown, stage: BotStage): BotDiagnosticError {
  return error instanceof BotDiagnosticError ? error : new BotDiagnosticError(stage, safeCause(error), "Falha nesta etapa; consulte o código seguro da causa.");
}

export async function atStage<T>(stage: BotStage, action: () => T | Promise<T>): Promise<T> {
  try { return await action(); } catch (error) { throw diagnostic(error, stage); }
}

export function formatDiagnostic(error: unknown): string {
  const failure = diagnostic(error, "shutdown");
  return `[bot:${failure.stage}] ${failure.code}: ${failure.message}`;
}
