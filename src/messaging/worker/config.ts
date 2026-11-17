import path from "path";
import { validateRestaurantContext } from "../validation";
import type { RestaurantContext } from "../contracts";
import { BotDiagnosticError } from "./diagnostics";

export interface LocalBotConfig {
  readonly context: RestaurantContext;
  readonly authRoot: string;
  readonly authDir: string;
  readonly realCheckoutEnabled?: boolean;
}

/** Pure parser; entrypoints load dotenv before calling it. Never reads auth files. */
export function readLocalBotConfig(env: NodeJS.ProcessEnv, cwd: string): LocalBotConfig {
  const checkoutFlag = env.WHATSAPP_REAL_CHECKOUT_ENABLED ?? "false";
  if (checkoutFlag !== "true" && checkoutFlag !== "false")
    throw new BotDiagnosticError("configuration", "INVALID_CHECKOUT_FLAG", "WHATSAPP_REAL_CHECKOUT_ENABLED deve ser true ou false.");
  if (env.GAMA_BOT_ENABLED !== "true") throw new BotDiagnosticError("configuration", "BOT_NOT_ENABLED", "Defina GAMA_BOT_ENABLED=true no ambiente efetivo do processo (exports ou .env).");
  let context: RestaurantContext;
  try { context = validateRestaurantContext({ restaurant_id: env.GAMA_BOT_RESTAURANT_ID, session_id: env.GAMA_BOT_SESSION_ID, channel: "whatsapp" }); }
  catch { throw new BotDiagnosticError("configuration", "INVALID_TEST_IDS", "Exporte GAMA_BOT_RESTAURANT_ID e GAMA_BOT_SESSION_ID com UUIDs válidos, iguais ao contexto da pasta."); }
  const authRoot = path.resolve(cwd, ".gama-bot-dev");
  if (!env.GAMA_BOT_AUTH_DIR?.trim()) throw new BotDiagnosticError("configuration", "AUTH_DIR_REQUIRED", "Defina GAMA_BOT_AUTH_DIR dentro de .gama-bot-dev/.");
  const authDir = path.resolve(cwd, env.GAMA_BOT_AUTH_DIR);
  const relative = path.relative(authRoot, authDir);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new BotDiagnosticError("configuration", "AUTH_DIR_OUTSIDE_ROOT", "Diretório de autenticação deve ficar dentro de .gama-bot-dev/.");
  return { context, authRoot, authDir, realCheckoutEnabled: checkoutFlag === "true" };
}
