import { createServer, type Server } from "node:http";

export type HealthCheck = () => Promise<boolean>;

export function startHealthServer(port: number, check: HealthCheck): Server {
  const server = createServer((req, res) => {
    if (req.url !== "/health") {
      res.writeHead(404).end();
      return;
    }
    void check()
      .catch(() => false)
      .then((ok) => {
        res.writeHead(ok ? 200 : 503, { "content-type": "text/plain" }).end(ok ? "ok" : "unhealthy");
      });
  });
  server.listen(port);
  return server;
}
