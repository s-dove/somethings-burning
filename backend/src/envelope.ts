// Sentry envelopes: a JSON header line, then items. Each item is a JSON
// header line and a payload. The payload is `length` bytes when the header
// says so, otherwise it runs to the next newline.
// https://develop.sentry.dev/sdk/data-model/envelopes/

export type EnvelopeItem = { type: string; payload: Buffer };
export type Envelope = { header: Record<string, unknown>; items: EnvelopeItem[] };

const NL = 0x0a;

export function parseEnvelope(body: Buffer): Envelope {
  let pos = 0;

  const readLine = (): Buffer => {
    const end = body.indexOf(NL, pos);
    const line = body.subarray(pos, end < 0 ? body.length : end);
    pos = end < 0 ? body.length : end + 1;
    return line;
  };

  const header = JSON.parse(readLine().toString("utf8") || "{}") as Record<string, unknown>;
  const items: EnvelopeItem[] = [];

  while (pos < body.length) {
    const line = readLine();
    if (line.length === 0) continue;
    const itemHeader = JSON.parse(line.toString("utf8")) as { type?: string; length?: number };
    let payload: Buffer;
    if (typeof itemHeader.length === "number") {
      payload = body.subarray(pos, pos + itemHeader.length);
      pos += itemHeader.length;
      if (body[pos] === NL) pos++;
    } else {
      payload = readLine();
    }
    items.push({ type: itemHeader.type ?? "", payload });
  }

  return { header, items };
}
