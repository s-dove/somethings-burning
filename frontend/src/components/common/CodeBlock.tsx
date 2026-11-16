import { useMemo } from "react";
import Prism from "prismjs";
// Core Prism has clike and javascript. These add the languages Sentry SDKs
// report most; ruby needs clike, typescript needs javascript.
import "prismjs/components/prism-json";
import "prismjs/components/prism-python";
import "prismjs/components/prism-go";
import "prismjs/components/prism-java";
import "prismjs/components/prism-ruby";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-csharp";
import "prismjs/components/prism-rust";
import "./prism.css";
import { redactHtml } from "../Redacted";

// escapeHTML is the fallback for a language Prism has no grammar for.
const escapeHTML = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

// highlight returns Prism's HTML for code, or the escaped text when the
// language is unknown.
export function highlight(code: string, language: string): string {
  const grammar = Prism.languages[language];
  const html = grammar ? Prism.highlight(code, grammar, language) : escapeHTML(code);
  return redactHtml(html);
}

const BY_PLATFORM: Record<string, string> = {
  python: "python", go: "go", java: "java", ruby: "ruby", javascript: "javascript", node: "javascript",
  csharp: "csharp", rust: "rust",
};
const BY_EXTENSION: Record<string, string> = {
  py: "python", go: "go", java: "java", rb: "ruby", js: "javascript", mjs: "javascript", cjs: "javascript",
  jsx: "javascript", ts: "typescript", tsx: "typescript", cs: "csharp", rs: "rust",
};

// languageFor picks the Prism language for a stack frame: the file extension
// first (a Node app can run TypeScript), then the event's platform.
export function languageFor(platform: string, filename: string): string {
  const ext = filename.split(/[?#]/)[0]!.split(".").pop()?.toLowerCase() ?? "";
  return BY_EXTENSION[ext] ?? BY_PLATFORM[platform.toLowerCase()] ?? "none";
}

// CodeBlock highlights code with Prism.
// The colors are Burning's (prism.css). `mono` is needed: Tailwind's
// base styles turn off Recursive's monospace axis on <pre> and <code>.
export function CodeBlock({ code, language = "json", className = "" }: { code: string; language?: string; className?: string }) {
  const html = useMemo(() => highlight(code, language), [code, language]);
  return (
    <pre className={`mono language-${language} ${className}`}>
      <code className="mono" dangerouslySetInnerHTML={{ __html: html }} />
    </pre>
  );
}
