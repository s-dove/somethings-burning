import { useState, type ReactNode } from "react";

export function Card({ title, actions, children }: { title?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-neutral-800 bg-neutral-900/60">
      {(title || actions) && (
        <header className="flex items-center gap-3 border-b border-neutral-800 px-4 py-3">
          <h2 className="text-sm font-semibold text-neutral-300">{title}</h2>
          <div className="ml-auto flex items-center gap-2">{actions}</div>
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

const buttonKinds = {
  primary: "bg-neutral-100 text-neutral-900 hover:bg-white",
  ghost: "border border-neutral-700 text-neutral-300 hover:bg-neutral-800",
  danger: "border border-red-900 text-red-400 hover:bg-red-950",
};

export function Button({
  kind = "ghost",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { kind?: keyof typeof buttonKinds }) {
  return (
    <button
      {...props}
      className={`rounded-md px-3 py-1.5 text-sm font-medium transition disabled:opacity-50 ${buttonKinds[kind]} ${className}`}
    />
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`rounded-md border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm outline-none placeholder:text-neutral-600 focus:border-neutral-400 ${props.className ?? ""}`}
    />
  );
}

export function CopyBox({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-stretch overflow-hidden rounded-md border border-neutral-700">
      <code className="flex-1 overflow-x-auto whitespace-pre bg-neutral-950 px-3 py-2 font-mono text-xs text-neutral-200">
        {value}
      </code>
      <button
        type="button"
        aria-label={label ?? "Copy"}
        className="border-l border-neutral-700 px-3 text-xs text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
        onClick={() => {
          void navigator.clipboard?.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

const levelStyle: Record<string, string> = {
  fatal: "bg-red-600",
  error: "bg-orange-500",
  warning: "bg-amber-400",
  info: "bg-sky-500",
  debug: "bg-neutral-500",
};

export function LevelDot({ level }: { level: string }) {
  return <span title={level} className={`inline-block h-2 w-2 shrink-0 rounded-full ${levelStyle[level] ?? "bg-neutral-500"}`} />;
}

export function ErrorNote({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="rounded-md border border-red-900 bg-red-950/50 px-3 py-2 text-sm text-red-300">{message}</p>;
}
