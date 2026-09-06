// Vercel serverless entry point.
//
// server.js's http.createServer callback already does URL parsing, static file
// serving from public/, /api routing, and the outer try/catch -> 500. Re-invoke
// that exact listener with server.emit("request", ...) rather than duplicating
// it. Never call server.listen() here.
//
// Importing server.js runs its module-scope config, including the
// SESSION_COOKIE_SECRET guard — so a misconfigured deployment fails the function
// import (500) instead of running on a world-known cookie key.
//
// The returned Promise resolves when the response is finished so Vercel does not
// freeze the function mid-response.
import { server } from "../server.js";

export default function handler(req, res) {
  return new Promise((resolve) => {
    res.on("finish", resolve);
    res.on("close", resolve);
    server.emit("request", req, res);
  });
}
