import "dotenv/config";
import { readLocalBotConfig } from "./config";
import { acquireLocalAuth } from "./localAuth";
import { connectLocalWhatsApp } from "./connection";
import { startConfiguredWhatsApp, type CheckoutHost } from "./checkoutStartup";
import { atStage, BotDiagnosticError, formatDiagnostic } from "./diagnostics";

export async function main(host?: () => Promise<CheckoutHost>) {
  const config = readLocalBotConfig(process.env, process.cwd());
  if (!process.stdout.isTTY || !process.stdin.isTTY)
    throw new BotDiagnosticError(
      "terminal",
      "TTY_REQUIRED",
      "Execute em terminal interativo, sem redirecionar logs ou QR.",
    );
  process.umask(0o077);
  // qrcode-terminal is CommonJS and has no installed TypeScript declarations.
  const qr = await atStage(
    "qr_module",
    () =>
      require("qrcode-terminal") as {
        generate(
          value: string,
          options: { small: boolean },
          callback: (rendered: string) => void,
        ): void;
      },
  );
  const release = await atStage("local_auth", () => acquireLocalAuth(config));
  // libsignal emits session objects directly through console, bypassing SDK logger.
  // This standalone process owns its console; fixed diagnostics use stdout below.
  for (const method of [
    "log",
    "info",
    "warn",
    "error",
    "debug",
    "trace",
    "dir",
  ] as const)
    console[method] = () => {};
  let worker: Awaited<ReturnType<typeof connectLocalWhatsApp>> | undefined;
  let interrupted = false;
  let qrVisible = false;
  const clearQr = () => {
    if (qrVisible) {
      process.stdout.write("\x1b[2J\x1b[3J\x1b[H");
      qrVisible = false;
    }
  };

  const shutdown = () => {
    if (interrupted) return;

    interrupted = true;

    process.stdout.write(
      "\n[bot:shutdown] Encerrando conexão do WhatsApp...\n",
    );

    if (worker) {
      void worker.stop().catch(() => {
        process.stderr.write("[bot:shutdown] Falha ao encerrar a conexão.\n");
      });
    }
  };
  // const shutdown = () => { interrupted = true; if (worker) void worker.stop(); };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  try {
    process.stdout.write(
      "[bot:configuration] OK — ambiente efetivo validado; variáveis exportadas prevalecem sobre .env.\n[bot:local_auth] OK — contexto conferido e lock adquirido.\n",
    );
    worker = await startConfiguredWhatsApp(
      config,
      (value) => {
        if (interrupted) return;
        process.stdout.write("\x1b[2J\x1b[3J\x1b[H");
        qrVisible = true;
        process.stdout.write(
          "QR temporário: WhatsApp > Dispositivos conectados > Conectar dispositivo.\n",
        );
        qr.generate(value, { small: true }, (rendered) =>
          process.stdout.write(rendered + "\n"),
        );
      },
      (text) => {
        clearQr();
        process.stdout.write(text + "\n");
      },
      host,
    );
    if (interrupted) await worker.stop();
    const failure = await worker.done;
    if (failure) throw failure;
  } finally {
    process.removeListener("SIGINT", shutdown);
    process.removeListener("SIGTERM", shutdown);

    try {
      await worker?.stop();
      await atStage("local_auth", release);
    } finally {
      clearQr();
    }
  }
}

if (require.main === module)
  void main().catch((error) => {
    // Do not print SDK errors/stacks; they may include credentials or message data.
    process.stderr.write(formatDiagnostic(error) + "\n");
    process.exitCode = 1;
  });
