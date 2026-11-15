import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "../ui/components/Button";
import { Pencil, Quote, Trash2 } from "../ui/icons";
import { api, type IssueComment } from "../shared/api";
import { ago } from "../shared/format";
import { section, sectionTitle } from "../shared/ui";
import { Markdown } from "../components/Markdown";
import { Tip, TimeTip } from "../components/Tip";

const MAX = 10_000;

// quoteOf turns a comment into a Markdown quote for a reply.
function quoteOf(author: string, body: string): string {
  const lines = [`**${author || "Someone"}** wrote:`, ...body.split("\n")];
  return lines.map((l) => (l ? `> ${l}` : ">")).join("\n") + "\n\n";
}
const initial = (name: string) => (name || "?").slice(0, 1).toUpperCase();
const action = "inline-flex cursor-pointer items-center gap-1 rounded-control px-1.5 py-0.5 text-cinder hover:bg-rule-soft hover:text-soot";

// Comments is the conversation on an issue, oldest first, with a box to add
// to it. Anyone who can see the project can comment and quote; the author can
// edit; the author or an admin can delete.
export function Comments({ projectId, issueId, comments: fromPage }: { projectId: number; issueId: number; comments: IssueComment[] }) {
  const [comments, setComments] = useState(fromPage);
  // The page reloads every 30 seconds; pick up comments from other people.
  useEffect(() => setComments(fromPage), [fromPage]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  const base = `/projects/${projectId}/issues/${issueId}/comments`;

  async function send(path: string, method: string, body?: unknown): Promise<boolean> {
    setBusy(true);
    try {
      setComments(await api<IssueComment[]>(path, { method, body }));
      return true;
    } catch (err) {
      toast.error((err as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  const post = async () => { if (draft.trim() && await send(base, "POST", { body: draft })) setDraft(""); };
  const focusEnd = () => requestAnimationFrame(() => { const el = box.current; if (el) { el.focus(); el.selectionStart = el.selectionEnd = el.value.length; } });
  const quote = (c: IssueComment) => {
    setDraft(d => (d && !d.endsWith("\n") ? d + "\n\n" : d) + quoteOf(c.authorName || c.author, c.body));
    focusEnd();
  };
  // Clicking a name starts a reply that @-mentions them.
  const mention = (username: string) => {
    setDraft(d => `${d}${d && !/\s$/.test(d) ? " " : ""}@${username} `);
    focusEnd();
  };
  // Usernames to display names, for hovering a mention.
  const names = Object.fromEntries(comments.filter(c => c.authorUsername).map(c => [c.authorUsername, c.authorName]));

  return (
    <section className={section} aria-labelledby="comments-title">
      <h2 id="comments-title" className={sectionTitle}>
        Comments {comments.length > 0 && <span className="text-xs font-normal text-cinder">{comments.length}</span>}
      </h2>
      {comments.length > 0 && (
        <ol className="m-0 mb-4 list-none divide-y divide-rule-soft p-0">
          {comments.map(c => (
            <CommentItem key={c.id} comment={c} busy={busy} names={names} onQuote={() => quote(c)} onMention={() => c.authorUsername && mention(c.authorUsername)}
              onSave={body => send(`${base}/${c.id}`, "PATCH", { body })}
              onDelete={() => { if (window.confirm("Delete this comment?")) void send(`${base}/${c.id}`, "DELETE").then(ok => ok && toast("Comment deleted")); }} />
          ))}
        </ol>
      )}
      <form onSubmit={e => { e.preventDefault(); void post(); }}>
        <label htmlFor="comment-draft" className="sr-only">Add a comment</label>
        <Editor id="comment-draft" ref={box} value={draft} onChange={setDraft} onSubmit={() => void post()} placeholder="Add a comment. What you found, what you tried, who is on it." />
        <div className="mt-2 flex items-center justify-between gap-3">
          <Hint length={draft.length} />
          <Button variant="primary" size="sm" type="submit" disabled={busy || !draft.trim()}>{busy ? "Posting…" : "Comment"}</Button>
        </div>
      </form>
    </section>
  );
}

function CommentItem({ comment: c, busy, names, onQuote, onMention, onSave, onDelete }: {
  comment: IssueComment; busy: boolean; names: Record<string, string>; onQuote: () => void; onMention: () => void;
  onSave: (body: string) => Promise<boolean>; onDelete: () => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const save = async () => { if (editing !== null && editing.trim() && await onSave(editing)) setEditing(null); };
  return (
    <li className="group flex gap-3 py-3 first:pt-0">
      <span className="grid size-7 shrink-0 place-items-center rounded-full border border-rule bg-smoke text-xs font-semibold" aria-hidden="true">{initial(c.authorName || c.author)}</span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 text-xs">
          {c.authorUsername
            ? <Tip content={<>{c.author}<br />Click to mention @{c.authorUsername}</>}>
                <button type="button" className="cursor-pointer hover:underline" onClick={onMention}>
                  <span className="font-semibold">{c.authorName || c.author}</span> <span className="text-cinder">@{c.authorUsername}</span>
                </button>
              </Tip>
            : <span className="font-semibold">Someone</span>}
          <TimeTip at={c.createdAt}><span className="text-cinder">{ago(c.createdAt)}</span></TimeTip>
          {c.editedAt > 0 && <TimeTip at={c.editedAt}><span className="text-cinder">· edited {ago(c.editedAt)}</span></TimeTip>}
          {editing === null && (
            <span className="ml-auto flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
              <button type="button" className={action} onClick={onQuote}><Quote size={12} aria-hidden="true" />Quote</button>
              {c.canEdit && <button type="button" className={action} onClick={() => setEditing(c.body)}><Pencil size={12} aria-hidden="true" />Edit</button>}
              {c.canDelete && <Tip content="Delete"><button type="button" className={`${action} hover:text-ember-ink`} aria-label="Delete comment" onClick={onDelete}><Trash2 size={12} /></button></Tip>}
            </span>
          )}
        </div>
        {editing === null ? (
          <div className="mt-1"><Markdown text={c.body} names={names} /></div>
        ) : (
          <div className="mt-1.5">
            <label htmlFor={`edit-${c.id}`} className="sr-only">Edit comment</label>
            <Editor id={`edit-${c.id}`} value={editing} onChange={setEditing} onSubmit={() => void save()} onCancel={() => setEditing(null)} autoFocus />
            <div className="mt-2 flex items-center justify-between gap-3">
              <Hint length={editing.length} editing />
              <span className="flex gap-2">
                <Button size="sm" onClick={() => setEditing(null)}>Cancel</Button>
                <Button size="sm" variant="primary" disabled={busy || !editing.trim() || editing === c.body} onClick={() => void save()}>Save</Button>
              </span>
            </div>
          </div>
        )}
      </div>
    </li>
  );
}

// Editor writes Markdown in a text area; Preview shows it rendered.
function Editor({ id, value, onChange, onSubmit, onCancel, placeholder, autoFocus, ref }: {
  id: string; value: string; onChange: (v: string) => void; onSubmit: () => void; onCancel?: () => void;
  placeholder?: string; autoFocus?: boolean; ref?: React.Ref<HTMLTextAreaElement>;
}) {
  const [preview, setPreview] = useState(false);
  const tab = "cursor-pointer rounded-control px-2.5 py-1 text-xs text-cinder aria-selected:bg-ash aria-selected:font-medium aria-selected:text-soot aria-selected:shadow-sm";
  return (
    <div className="overflow-hidden rounded-control border border-rule bg-ash focus-within:border-cinder">
      <div className="flex gap-1 border-b border-rule-soft bg-smoke p-1" role="tablist" aria-label="Comment">
        <button type="button" role="tab" aria-selected={!preview} className={tab} onClick={() => setPreview(false)}>Write</button>
        <button type="button" role="tab" aria-selected={preview} className={tab} onClick={() => setPreview(true)}>Preview</button>
      </div>
      {preview ? (
        <div className="min-h-20 px-3 py-2.5">{value.trim() ? <Markdown text={value} /> : <span className="text-xs text-cinder">Nothing to preview.</span>}</div>
      ) : (
        <textarea
          id={id} ref={ref} autoFocus={autoFocus} placeholder={placeholder} value={value} maxLength={MAX}
          className="block min-h-20 w-full resize-y border-0 bg-transparent px-3 py-2.5 text-[13px] leading-relaxed text-soot outline-none placeholder:text-cinder focus:ring-0"
          onChange={e => onChange(e.target.value)}
          onKeyDown={e => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); onSubmit(); }
            if (e.key === "Escape" && onCancel) { e.preventDefault(); onCancel(); }
          }}
        />
      )}
    </div>
  );
}

function Hint({ length, editing }: { length: number; editing?: boolean }) {
  return (
    <span className="text-xs text-cinder">
      {length > MAX * 0.9 ? `${(MAX - length).toLocaleString()} characters left` : `Markdown supported. Cmd or Ctrl + Enter to ${editing ? "save" : "post"}${editing ? ", Esc to cancel" : ""}`}
    </span>
  );
}
