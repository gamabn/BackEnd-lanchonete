
const test = require("node:test");
const assert = require("node:assert/strict");
const { sign } = require("jsonwebtoken");
const express = require("express");
const http = require("node:http");

require("ts-node/register/transpile-only");

const {
  createWhatsAppRouter,
} = require("../src/messaging/http/whatsappRoutes");

const RESTAURANT_ID = "30a56399-e0ad-4584-8474-4be247ab7ab9";

test("worker desabilitado bloqueia conexão WhatsApp", async () => {
  const previousWorker = process.env.WHATSAPP_WORKER_ENABLED;
  const previousSecret = process.env.JWT_SECRET;

  process.env.WHATSAPP_WORKER_ENABLED = "false";
  process.env.JWT_SECRET = "test-only-secret";

  let connectCalled = false;

  const sessions = {
    connect: async () => {
      connectCalled = true;
      return { connected: true };
    },
    disconnect: async () => ({}),
    status: async () => ({}),
    qr: async () => ({}),
  };

  const app = express();
  app.use(express.json());
  app.use("/whatsapp", createWhatsAppRouter(sessions));

  const server = http.createServer(app);

  try {
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

    const address = server.address();

    const token = sign({}, process.env.JWT_SECRET, {
      algorithm: "HS256",
      subject: RESTAURANT_ID,
      expiresIn: "5m",
    });

    const response = await fetch(
      `http://127.0.0.1:${address.port}/whatsapp/connect`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    );

    const body = await response.json();

    assert.equal(response.status, 503);
    assert.deepEqual(body, {
      error: "WHATSAPP_WORKER_DISABLED",
    });
    assert.equal(connectCalled, false);
  } finally {
    await new Promise((resolve) => server.close(resolve));

    if (previousWorker === undefined)
      delete process.env.WHATSAPP_WORKER_ENABLED;
    else process.env.WHATSAPP_WORKER_ENABLED = previousWorker;

    if (previousSecret === undefined)
      delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  }
});
