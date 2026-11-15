import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CodeBlock } from "./common/CodeBlock";
import { Tip } from "./Tip";

// An @mention: @ after a space or the start, then a username. "ana@x.com"
// is not one (GFM turns that into a mailto link anyway).
const MENTION = /(^|[^\w@./-])@([a-zA-Z0-9](?:[\w.-]*[a-zA-Z0-9_])?)/g;

type MdNode = { type: string; value?: string; children?: MdNode[]; data?: Record<string, unknown> };

// remarkMentions turns @username in plain text into a highlighted span. Text
// inside links and code is left alone (code is not a text node).
function remarkMentions(names: Record<string, string>) {
  return () => (tree: MdNode) => {
    const walk = (node: MdNode) => {
      if (!node.children || node.type === "link") return;
      node.children = node.children.flatMap((child): MdNode[] => {
        if (child.type !== "text" || !child.value?.includes("@")) { walk(child); return [child]; }
        const out: MdNode[] = [];
        let last = 0;
        for (const m of child.value.matchAll(MENTION)) {
          const at = m.index + m[1]!.length;
          if (at > last) out.push({ type: "text", value: child.value.slice(last, at) });
          const name = names[m[2]!];
          out.push({
            type: "strong",
            children: [{ type: "text", value: `@${m[2]}` }],
            data: { hName: "span", hProperties: { className: ["mention"], dataName: name ?? undefined } },
          });
          last = at + m[2]!.length + 1;
        }
        if (last === 0) return [child];
        if (last < child.value.length) out.push({ type: "text", value: child.value.slice(last) });
        return out;
      });
    };
    walk(tree);
  };
}

// rehypeTrimAroundBlocks drops the line breaks a list item's text keeps next
// to a block inside it (a code block, a nested list). List items keep line
// breaks (white-space: pre-wrap), so those would show as empty lines.
type HastNode = { type: string; tagName?: string; value?: string; children?: HastNode[] };
const BLOCKS = new Set(["pre", "ul", "ol", "p", "blockquote", "table"]);
function rehypeTrimAroundBlocks() {
  const isBlock = (n?: HastNode) => n?.type === "element" && BLOCKS.has(n.tagName ?? "");
  const walk = (node: HastNode) => {
    const kids = node.children ?? [];
    if (node.type === "element" && node.tagName === "li") {
      kids.forEach((k, i) => {
        if (k.type !== "text" || k.value === undefined) return;
        if (isBlock(kids[i - 1])) k.value = k.value.replace(/^\s*\n/, "");
        if (isBlock(kids[i + 1])) k.value = k.value.replace(/\n\s*$/, "");
      });
    }
    kids.forEach(walk);
  };
  return (tree: HastNode) => walk(tree);
}

// Markdown renders GitHub-flavoured Markdown (tables, task lists,
// strikethrough) with Tailwind's prose styles.
// Raw HTML in the text is not rendered, and links open in a new tab. Fenced
// code is highlighted like the rest of the app's code blocks.
// names maps usernames to display names, shown when hovering a mention.
export function Markdown({ text, names = {} }: { text: string; names?: Record<string, string> }) {
  return (
    <div className="prose prose-sm max-w-none prose-burning">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMentions(names)]}
        rehypePlugins={[rehypeTrimAroundBlocks]}
        components={{
          a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer">{children}</a>,
          // A fenced block arrives as <pre><code class="language-x">; let
          // CodeBlock draw the whole thing.
          pre: ({ children }) => <>{children}</>,
          span: ({ className, children, ...rest }) => {
            const name = (rest as Record<string, unknown>)["data-name"];
            const el = <span className={className}>{children}</span>;
            return className === "mention" && typeof name === "string" ? <Tip content={name}>{el}</Tip> : el;
          },
          code: ({ className, children }) => {
            const text = String(children ?? "");
            const lang = /language-(\S+)/.exec(className ?? "")?.[1];
            if (!lang && !text.includes("\n")) return <code>{children}</code>;
            return <CodeBlock code={text.replace(/\n$/, "")} language={lang ?? "none"} className="not-prose my-3 rounded-control px-3.5 py-2.5" />;
          },
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
