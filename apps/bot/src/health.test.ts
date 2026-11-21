import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { startHealthServer } from "./health.ts";

let server: ReturnType<typeof startHealthServer> | undefined;

afterEach(() => {
  server?.close();
});

async function get(path: string, check: () => Promise<boolean>) {
  server = startHealthServer(0, check);
  await new Promise((resolve) => server?.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  return fetch(`http://127.0.0.1:${port}${path}`);
}

describe("health server", () => {
  it("returns 200 when healthy", async () => {
    const res = await get("/health", () => Promise.resolve(true));
    expect(res.status).toBe(200);
  });

  it("returns 503 when the check fails or throws", async () => {
    expect((await get("/health", () => Promise.resolve(false))).status).toBe(503);
    server?.close();
    expect((await get("/health", () => Promise.reject(new Error("db down")))).status).toBe(503);
  });

  it("returns 404 elsewhere", async () => {
    const res = await get("/", () => Promise.resolve(true));
    expect(res.status).toBe(404);
  });
});
