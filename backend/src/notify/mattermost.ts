// Mattermost sends as a bot: a direct message to a person by username, or a
// post in a channel named "team-name/channel-name". The bot must be a member
// of the channel. Set BURNING_MATTERMOST_URL and BURNING_MATTERMOST_TOKEN.
export interface MattermostSettings {
  url: string;
  token: string;
}

export class Mattermost {
  private botId = "";
  private channels = new Map<string, string>(); // "team/channel" or username -> channel id

  constructor(private s: MattermostSettings) {}

  get enabled(): boolean {
    return !!(this.s.url && this.s.token);
  }

  async dm(username: string, text: string): Promise<void> {
    const key = `@${username.toLowerCase()}`;
    let id = this.channels.get(key);
    if (!id) {
      const me = await this.bot();
      const user = await this.call<{ id: string }>("GET", `/users/username/${encodeURIComponent(username.replace(/^@/, ""))}`);
      id = (await this.call<{ id: string }>("POST", "/channels/direct", [me, user.id])).id;
      this.channels.set(key, id);
    }
    await this.call("POST", "/posts", { channel_id: id, message: text });
  }

  async post(channel: string, text: string): Promise<void> {
    let id = this.channels.get(channel);
    if (!id) {
      const [team, name] = channel.split("/");
      id = (await this.call<{ id: string }>("GET", `/teams/name/${encodeURIComponent(team!)}/channels/name/${encodeURIComponent(name!)}`)).id;
      this.channels.set(channel, id);
    }
    await this.call("POST", "/posts", { channel_id: id, message: text });
  }

  private async bot(): Promise<string> {
    if (!this.botId) this.botId = (await this.call<{ id: string }>("GET", "/users/me")).id;
    return this.botId;
  }

  private async call<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    if (!this.enabled) throw new Error("Mattermost is not configured (BURNING_MATTERMOST_URL, BURNING_MATTERMOST_TOKEN)");
    const res = await fetch(`${this.s.url.replace(/\/$/, "")}/api/v4${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.s.token}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      let msg = detail;
      try { msg = (JSON.parse(detail) as { message?: string }).message ?? detail; } catch { /* plain text */ }
      throw new Error(`Mattermost ${method} ${path}: ${res.status} ${msg.slice(0, 200)}`);
    }
    return (await res.json()) as T;
  }
}
