import { ConversationMenu } from "../core/conversationMenu";
import type { PersistentWhatsAppCheckout } from "../checkout/whatsappPersistentCheckout";
import type { WASocket } from "@whiskeysockets/baileys";
import { loadBaileys } from "../channels/whatsapp/runtime";
import {
  isIndividualJid,
  LocalMessageProcessor,
} from "../channels/whatsapp/messages";
import type { LocalBotConfig } from "./config";
import { loadPersistentAuth } from "./persistentAuth";
import {
  atStage,
  BotDiagnosticError,
  diagnostic,
  formatDiagnostic,
  safeCause,
} from "./diagnostics";

export function reconnectDelay(attempt: number): number | null {
  return Number.isInteger(attempt) && attempt >= 0 && attempt < 5
    ? Math.min(1000 * 2 ** attempt, 16_000)
    : null;
}

export interface WorkerConnectionEvent {
  state: "connecting" | "connected" | "reconnecting" | "disconnected" | "error";
  code?: string;
}

export async function connectLocalWhatsApp(
  config: LocalBotConfig,
  renderQr: (qr: string) => void,
  log: (text: string) => void,
  load = loadBaileys,
  persistentCheckout?: PersistentWhatsAppCheckout,
  loadAuth = loadPersistentAuth,
  observe?: (event: WorkerConnectionEvent) => void,
) {
  const notify = (event: WorkerConnectionEvent) => { try { observe?.(event); } catch { /* UI observers cannot affect persistence. */ } };
  if (config.realCheckoutEnabled && !persistentCheckout)
    throw new BotDiagnosticError("configuration", "REAL_CHECKOUT_REQUIRED", "Checkout persistente obrigatório; inicialização interrompida.");
  const baileys = await atStage("esm_import", load);
  log("[bot:esm_import] OK — Baileys carregado.");
  const { state, saveCreds, flush } = await atStage("auth_load", () =>
    loadAuth(baileys, config.authDir),
  );
  log(
    state.creds?.me?.id
      ? "[bot:auth_load] OK — identidade vinculada carregada; tentando restaurar a sessão."
      : "[bot:auth_load] OK — sem identidade vinculada local; aguardando QR/pareamento.",
  );
  // SDK logs are entirely disabled: no message bodies, QR payloads or credentials.
  const noop = () => {};
  const silent = {
    level: "silent",
    trace: noop,
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    fatal: noop,
    child() {
      return this;
    },
  };
  const processor = new LocalMessageProcessor(config.context, Date.now(), 10_000,
    new ConversationMenu(undefined, undefined, undefined, undefined, undefined, undefined, persistentCheckout));

  let socket: WASocket | undefined, timer: NodeJS.Timeout | undefined;

  let stopped = false,
    attempts = 0,
    writes = Promise.resolve();

  const processing = new Set<Promise<void>>();

  let stableTimer: NodeJS.Timeout | undefined;

  let finish!: (failure?: BotDiagnosticError) => void;

  const done = new Promise<BotDiagnosticError | undefined>((resolve) => {
    finish = resolve;
  });
  let stopPromise: Promise<void> | undefined;
  let opening: Promise<void> | undefined;
  let authFailure: BotDiagnosticError | undefined;
  const sockets = new Set<WASocket>();

  async function drainAuth() {
    // Include writes queued by close/end handlers and keys.set, not just a snapshot of saveCreds.
    let observed: Promise<void>;
    do {
      observed = writes;
      try {
        await observed;
        await flush();
        await new Promise<void>(resolve => setImmediate(resolve));
        // end/close may enqueue only keys.set, without another creds.update.
        await flush();
      } catch (error) { authFailure ??= diagnostic(error, "auth_save"); throw authFailure; }
    } while (observed !== writes);
    if (authFailure) throw authFailure;
  }

  function stop(failure?: BotDiagnosticError): Promise<void> {
    if (stopPromise) return stopPromise;

    stopped = true;

    stopPromise = (async () => {
      try {
        clearTimeout(timer);
        clearTimeout(stableTimer);
        await opening?.catch(() => {});

        if (socket) {
          socket.ev.removeAllListeners("connection.update");
          socket.ev.removeAllListeners("messages.upsert");
          socket.ev.removeAllListeners("chats.phoneNumberShare");

          socket.end(undefined);
        }

        await Promise.allSettled([...processing]);
        // Capture the final shared creds even if end/close coalesced SDK events.
        writes = writes.then(saveCreds);
        await drainAuth();
      } finally {
        for (const current of sockets) current.ev.removeAllListeners("creds.update");
        finish(authFailure ?? failure);
        notify(authFailure ?? failure ? { state: "error", code: (authFailure ?? failure)!.code } : { state: "disconnected" });
      }
    })();

    return stopPromise;
  }

  function schedule() {
    if (stopped || timer) return;
    notify({ state: "reconnecting" });
    const delay = reconnectDelay(attempts++);
    if (delay === null) {
      const failure = new BotDiagnosticError(
        "reconnect",
        "RETRY_LIMIT",
        "Limite de reconexões atingido. Confira a última causa de conexão antes de reiniciar.",
      );
      log(formatDiagnostic(failure));
      void stop(failure).catch(() => {});
      return;
    }
    log(
      `[bot:reconnect] tentativa ${attempts}/5 — Reconexão em ${delay / 1000}s.`,
    );
    timer = setTimeout(() => {
      timer = undefined;
      const pendingOpen = open();
      opening = pendingOpen;
      void pendingOpen.catch((error) => {
        log(formatDiagnostic(diagnostic(error, "socket")));
        if (authFailure) void stop(authFailure).catch(() => {});
        else schedule();
      }).finally(() => { if (opening === pendingOpen) opening = undefined; });
    }, delay);
  }
  async function open() {
    await Promise.allSettled([...processing]);
    await drainAuth();

    if (stopped) return;
    for (const previous of sockets) previous.ev.removeAllListeners("creds.update");
    sockets.clear();

    const current = await atStage("socket", () =>
      baileys.default({
        auth: state,
        version: [2, 3000, 1043857760],
        logger: silent,
        syncFullHistory: false,
        shouldSyncHistoryMessage: () => false,
        markOnlineOnConnect: false,
        emitOwnEvents: false,
        shouldIgnoreJid: (jid) => !isIndividualJid(jid),
      }),
    );

    log(
      "[bot:socket] OK — socket inicializado; aguardando eventos de conexão.",
    );

    socket = current;
    sockets.add(current);

    current.ev.on("chats.phoneNumberShare", ({ lid, jid }) => {
      if (stopped || current !== socket || !current.user?.id) return;
      const recorded = processor.phoneResolver.recordShare(current.user.id, lid, jid);

      process.stdout.write(
        `[bot:phone_mapping] recebido=${recorded}\n`,
      );
    });

    current.ev.on("creds.update", () => {
      writes = writes.then(saveCreds).catch((error) => {
        const failure = diagnostic(error, "auth_save");
        authFailure ??= failure;
        log(formatDiagnostic(failure));
        void stop(failure).catch(() => {});
      });
    });

    if (stopped) { current.end(undefined); return; }

    current.ev.on("messages.upsert", (batch) => {
      if (stopped || current !== socket || !current.user?.id) return;
      const task = processor
        .process(batch, current.user.id, async (jid, content) => {
          if (stopped || current !== socket)
            throw new Error("Conexão encerrada.");
          return current.sendMessage(jid, content);
        })
        .catch((error) => {
          const failure = diagnostic(error, "processing");
          log(formatDiagnostic(failure));
          void stop(failure).catch(() => {});
        });

      processing.add(task);

      void task.finally(() => processing.delete(task));
    });

    current.ev.on("connection.update", (update) => {
      if (stopped || current !== socket) return;
      if (update.connection === "connecting") {
        notify({ state: "connecting" });
        log("[bot:connection] CONNECTING — estabelecendo conexão.");
      }
      if (update.qr) renderQr(update.qr);
      if (update.connection === "open") {
        notify({ state: "connected" });
        log(
          "[bot:connection] OPEN — WhatsApp conectado. Use outra conta para testar.",
        );
        clearTimeout(stableTimer);
        stableTimer = setTimeout(() => {
          attempts = 0;
        }, 60_000);
      }

      if (update.connection === "close") {
        clearTimeout(stableTimer);
        current.ev.removeAllListeners("messages.upsert");
        current.ev.removeAllListeners("connection.update");
        // Keep credential updates while the closed socket finishes outstanding work.
        socket.ev.removeAllListeners("chats.phoneNumberShare");
        const code = (
          update.lastDisconnect?.error as
            | { output?: { statusCode?: number } }
            | undefined
        )?.output?.statusCode;
        const reason = safeCause(update.lastDisconnect?.error);
        const safeStatus =
          typeof code === "number" &&
          Number.isInteger(code) &&
          code >= 100 &&
          code <= 599
            ? String(code)
            : "UNKNOWN";
        log(`[bot:connection] CLOSED — status=${safeStatus}; causa=${reason}.`);
        if (
          [
            baileys.DisconnectReason.loggedOut,
            baileys.DisconnectReason.badSession,
            baileys.DisconnectReason.connectionReplaced,
            baileys.DisconnectReason.multideviceMismatch,
            baileys.DisconnectReason.forbidden,
          ].includes(code as number)
        ) {
          const failure = new BotDiagnosticError(
            "connection",
            code === baileys.DisconnectReason.connectionReplaced ? "SESSION_REPLACED" : "REAUTH_REQUIRED",
            code === baileys.DisconnectReason.connectionReplaced
              ? "Sessão substituída por outra conexão. Pare a outra instância antes de reiniciar; credenciais preservadas."
              : "Sessão recusada ou invalidada. Verifique os dispositivos vinculados e autorize novo pareamento em diretório separado se necessário; credenciais preservadas.",
          );
          log(formatDiagnostic(failure));
          void stop(failure).catch(() => {});
        } else schedule();
      }
    });
  }
  try { opening = open(); await opening; opening = undefined; }
  catch (error) { await stop(diagnostic(error, "auth_load")).catch(() => {}); throw error; }
  return { stop, done };
}
