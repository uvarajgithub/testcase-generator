import type { ServerResponse } from "node:http";

export type ApiSuccess<T> = { ok: true; data: T };
export type ApiFailure = { ok: false; error: { code: string; message: string; details?: unknown } };

export function sendJson<T>(res: ServerResponse, status: number, body: ApiSuccess<T> | ApiFailure) {
  res.writeHead(status, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS",
    "access-control-allow-headers": "content-type"
  });
  res.end(JSON.stringify(body));
}

export function sanitizeFilename(input: string) {
  return input.replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_").replace(/\s+/g, "_").slice(0, 120) || "TestCraft";
}

export async function readJson<T>(req: NodeJS.ReadableStream): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as T;
}
