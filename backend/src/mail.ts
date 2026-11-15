import net from "node:net";
import tls from "node:tls";

// SMTP settings come from the environment. Leave host empty to send no mail.
// Set tls for STARTTLS (port 587), or ssl for a connection that is TLS from
// the first byte (port 465). With neither, it talks plain SMTP (a relay on 25).
export interface SmtpSettings {
  host: string;
  port: number;
  user: string;
  password: string;
  from: string;
  tls: boolean;
  ssl: boolean;
}

export interface Mail {
  to: string[];
  subject: string;
  text: string;
}

// sendMail delivers one plain-text message. It speaks SMTP itself so the
// server address, port, and credentials stay in the environment.
export async function sendMail(smtp: SmtpSettings, mail: Mail): Promise<void> {
  let sock: net.Socket = smtp.ssl
    ? tls.connect({ host: smtp.host, port: smtp.port, servername: smtp.host })
    : net.connect({ host: smtp.host, port: smtp.port });
  const conn = new SmtpConn(sock);
  try {
    await conn.ready();
    await conn.cmd("EHLO burning");
    if (smtp.tls && !smtp.ssl) {
      await conn.cmd("STARTTLS");
      // Stop reading the plain socket before TLS takes it over, so no
      // handshake bytes reach the SMTP reader; then talk over TLS once the
      // handshake is done.
      conn.detach();
      const secure = tls.connect({ socket: sock, servername: smtp.host });
      await new Promise<void>((resolve, reject) => {
        secure.once("secureConnect", resolve);
        secure.once("error", reject);
      });
      sock = secure;
      conn.attach(secure);
      await conn.cmd("EHLO burning");
    }
    if (smtp.user) {
      const token = Buffer.from(`\0${smtp.user}\0${smtp.password}`).toString("base64");
      await conn.cmd(`AUTH PLAIN ${token}`);
    }
    await conn.cmd(`MAIL FROM:<${address(smtp.from)}>`);
    for (const rcpt of mail.to) await conn.cmd(`RCPT TO:<${address(rcpt)}>`);
    await conn.cmd("DATA");
    await conn.cmd(message(smtp.from, mail));
    await conn.cmd("QUIT");
  } finally {
    sock.end();
  }
}

const address = (value: string): string => {
  const match = value.match(/<([^>]+)>/);
  return (match?.[1] ?? value).trim();
};

const message = (from: string, mail: Mail): string =>
  [
    `From: ${from}`,
    `To: ${mail.to.join(", ")}`,
    `Subject: ${mail.subject.replace(/[\r\n]/g, " ")}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "",
    mail.text.replace(/\r\n/g, "\n").split("\n").map((line) => (line.startsWith(".") ? `.${line}` : line)).join("\r\n"),
    ".",
  ].join("\r\n");

// SmtpConn reads one complete SMTP reply at a time. A reply is one or more
// lines, and only the last line has a space after the status code.
class SmtpConn {
  private buf = "";
  private wait: ((line: string) => void) | null = null;
  private fail: ((err: Error) => void) | null = null;

  private sock: net.Socket;
  private onData = (chunk: Buffer) => {
    this.buf += chunk.toString("utf8");
    this.drain();
  };
  private onTimeout = () => this.fail?.(new Error("smtp timed out"));
  private onError = (err: Error) => this.fail?.(err);

  constructor(sock: net.Socket) {
    this.sock = sock;
    this.attach(sock);
  }

  // attach reads replies from sock. detach removes only these listeners, so
  // whatever else the socket has (TLS, for one) is left alone.
  attach(sock: net.Socket): void {
    this.sock = sock;
    this.buf = "";
    sock.setTimeout(10_000);
    sock.on("data", this.onData);
    sock.on("timeout", this.onTimeout);
    sock.on("error", this.onError);
  }

  detach(): void {
    this.sock.off("data", this.onData);
    this.sock.off("timeout", this.onTimeout);
    this.sock.off("error", this.onError);
    this.sock.setTimeout(0);
  }

  async ready(): Promise<void> {
    const line = await this.next();
    this.check(line);
  }

  async cmd(line: string): Promise<void> {
    this.sock.write(line + "\r\n");
    this.check(await this.next());
  }

  private check(line: string): void {
    if (Number(line.slice(0, 3)) >= 400) throw new Error(`smtp: ${line}`);
  }

  private next(): Promise<string> {
    return new Promise((resolve, reject) => {
      this.wait = resolve;
      this.fail = reject;
      this.drain();
    });
  }

  private drain(): void {
    if (!this.wait) return;
    const lines: string[] = [];
    for (;;) {
      const end = this.buf.indexOf("\r\n");
      if (end < 0) return;
      const line = this.buf.slice(0, end);
      this.buf = this.buf.slice(end + 2);
      lines.push(line);
      if (line[3] !== "-") break;
    }
    const done = this.wait;
    this.wait = null;
    done(lines[lines.length - 1] ?? "");
  }
}
