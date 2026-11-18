import { useState } from "react";
import { t } from "../shared/i18n";
import { X } from "../ui/icons";

// TargetsInput holds several values (email addresses, usernames, URLs) as
// chips. Type one and press Enter, comma, or space, or paste a list; Backspace
// in the empty box removes the last chip. With check, a value that fails is
// not added: it stays in the box with the reason under it.
// invalid marks the whole box; bad marks single chips.
export function TargetsInput({ values, onChange, placeholder, disabled, label, invalid, bad, check }: {
  values: string[];
  onChange: (values: string[]) => void;
  placeholder: string;
  disabled?: boolean;
  label: string;
  invalid?: boolean;
  bad?: (value: string) => boolean;
  check?: (value: string) => string; // what is wrong with a value, or ""
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const add = (raw: string) => {
    const more = raw.split(/[\s,;]+/).map(v => v.trim()).filter(Boolean);
    const good = more.filter(v => !check?.(v));
    const rejected = more.filter(v => check?.(v));
    if (good.length) onChange([...values, ...good.filter(v => !values.includes(v))]);
    setText(rejected.join(" "));
    setError(rejected.length ? check!(rejected[0]!) + (rejected.length > 1 ? ` ${t("(and {n} more)", { n: rejected.length - 1 })}` : "") : "");
  };
  return (
    <div className="min-w-48 flex-1">
      <div aria-invalid={invalid || !!error || undefined} className={`flex min-h-8 flex-wrap items-center gap-1 rounded-control border ${invalid || error ? "border-ember-ink" : "border-rule"} bg-ash px-1.5 py-1 focus-within:border-cinder focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-soot ${disabled ? "opacity-60" : ""}`}>
        {values.map(v => (
          <span key={v} className={`inline-flex max-w-full items-center gap-1 rounded-[4px] py-0.5 pr-1 pl-2 text-xs ${bad?.(v) ? "bg-ember-soft text-ember-ink line-through decoration-ember-ink/40" : "bg-smoke"}`}>
            <span className="truncate">{v}</span>
            {!disabled && <button type="button" className="cursor-pointer rounded-[3px] p-0.5 text-cinder hover:bg-rule-soft hover:text-soot" aria-label={t("Remove {who}", { who: v })} onClick={() => onChange(values.filter(x => x !== v))}><X size={11} /></button>}
          </span>
        ))}
        {!disabled && (
          <input
            aria-label={label}
            className="h-6 min-w-32 flex-1 border-0 bg-transparent px-1 py-0 text-xs text-soot outline-none placeholder:text-cinder focus:ring-0"
            placeholder={values.length ? t("Add another") : placeholder}
            value={text}
            onChange={e => { if (error) setError(""); if (/[\s,;]$/.test(e.target.value)) add(e.target.value); else setText(e.target.value); }}
            onKeyDown={e => {
              if (e.key === "Enter") { e.preventDefault(); add(text); }
              if (e.key === "Backspace" && !text && values.length) onChange(values.slice(0, -1));
            }}
            onPaste={e => { e.preventDefault(); add((error ? `${text} ` : text) + e.clipboardData.getData("text")); }}
            onBlur={() => text.trim() && add(text)}
          />
        )}
      </div>
      {error && <p role="alert" className="mt-1 text-xs text-ember-ink">{error}</p>}
    </div>
  );
}
