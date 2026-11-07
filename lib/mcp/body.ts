// Request bodies read with a size cap, for the routes that take input from anyone on the internet
// (open client registration, the MCP endpoint).

// Reads a request body as text, giving up as soon as it passes `limit` bytes, so an oversized body
// is refused without being held in memory. Returns null when it is too large.
export async function readCappedText(request: Request, limit: number): Promise<string | null> {
  if (Number(request.headers.get("content-length") ?? 0) > limit) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

// The same request with a body that has already been read.
export function withBody(request: Request, body: string): Request {
  const headers = new Headers(request.headers);
  headers.delete("content-length");
  return new Request(request.url, { method: request.method, headers, body });
}
