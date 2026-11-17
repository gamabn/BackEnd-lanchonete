import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import type { AuthenticationState, SignalDataTypeMap } from "@whiskeysockets/baileys";
import { BotDiagnosticError } from "./diagnostics";

type SDK = typeof import("@whiskeysockets/baileys");
export interface PersistentAuth {
  state: AuthenticationState;
  saveCreds(): Promise<void>;
  flush(): Promise<void>;
}

/** Same filenames/BufferJSON as Baileys multi-file auth; existing files are reused. */
export async function loadPersistentAuth(sdk: SDK, folder: string): Promise<PersistentAuth> {
  const invalid = () => new BotDiagnosticError("auth_load", "AUTH_FILES_INVALID",
    "Autenticação local ilegível ou incompleta; arquivos preservados. Verifique armazenamento/permissões antes de autenticar novamente.");
  const filename = (name: string) => path.join(folder, name.replace(/\//g, "__").replace(/:/g, "-"));
  async function read(name: string): Promise<unknown> {
    try { return JSON.parse(await fs.readFile(filename(name), "utf8"), sdk.BufferJSON.reviver); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw invalid(); // The SDK's default reader silently treats these errors as missing credentials.
    }
  }
  const entries = await fs.readdir(folder);
  const saved = await read("creds.json");
  if (saved === undefined && entries.some(name => name.endsWith(".json") && name !== ".context.json")) throw invalid();
  if (saved !== undefined && (!saved || typeof saved !== "object" || !("noiseKey" in saved) || !("signedIdentityKey" in saved))) throw invalid();
  // Detect invalid existing keys before allowing any new socket/authentication.
  for (const name of entries.filter(name => name.endsWith(".json") && name !== ".context.json")) await read(name);
  const state: AuthenticationState = { creds: saved as AuthenticationState["creds"] ?? sdk.initAuthCreds(), keys: undefined! };
  let tail: Promise<void> = Promise.resolve();
  let failure: unknown;
  function queue<T>(action: () => Promise<T>): Promise<T> {
    const operation = tail.then(async () => {
      if (failure) throw failure;
      return action();
    });
    tail = operation.then(() => {}, error => { failure ??= error; });
    return operation;
  }
  async function syncDirectory() {
    const directory = await fs.open(folder, "r");
    try { await directory.sync(); } finally { await directory.close(); }
  }
  async function atomicWrite(name: string, json: string) {
    const target = filename(name), temporary = `${target}.${randomUUID()}.tmp`;
    try {
      const file = await fs.open(temporary, "wx", 0o600);
      try { await file.writeFile(json, "utf8"); await file.sync(); }
      finally { await file.close(); }
      await fs.rename(temporary, target);
      await syncDirectory();
    } finally { await fs.unlink(temporary).catch(error => { if (error.code !== "ENOENT") throw error; }); }
  }
  state.keys = {
    get: (type, ids) => queue(async () => {
      const result: { [id: string]: SignalDataTypeMap[typeof type] } = {};
      for (const id of ids) {
        let value = await read(`${type}-${id}.json`);
        if (type === "app-state-sync-key" && value)
          value = sdk.proto.Message.AppStateSyncKeyData.fromObject(value as Record<string, unknown>);
        result[id] = value as SignalDataTypeMap[typeof type];
      }
      return result;
    }),
    set: data => {
      // Snapshot at the call boundary: the SDK may mutate objects before disk I/O finishes.
      const changes = Object.entries(data).flatMap(([type, keys]) => Object.entries(keys ?? {}).map(([id, value]) => ({
        name: `${type}-${id}.json`, json: value ? JSON.stringify(value, sdk.BufferJSON.replacer) : undefined,
      })));
      return queue(async () => {
        for (const {name, json} of changes) {
          if (json !== undefined) await atomicWrite(name, json);
          else await fs.unlink(filename(name)).catch(error => { if (error.code !== "ENOENT") throw error; });
        }
        if (changes.some(change => change.json === undefined)) await syncDirectory();
      });
    },
  };
  return {
    state,
    saveCreds: () => {
      const json = JSON.stringify(state.creds, sdk.BufferJSON.replacer);
      return queue(() => atomicWrite("creds.json", json));
    },
    flush: async () => {
      let observed: Promise<void>;
      do { observed = tail; await observed; } while (observed !== tail);
      if (failure) throw failure;
    },
  };
}
