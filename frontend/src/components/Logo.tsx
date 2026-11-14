// The flame is both the logo and the favicon.
export function LogoMark({ size = "md" }: { size?: "md" | "lg" }) {
  return (
    <img
      src="/favicon.svg"
      width={48}
      height={48}
      className={`shrink-0 ${size === "lg" ? "size-12" : "size-10"}`}
      alt=""
      aria-hidden="true"
    />
  );
}

export function Logo({ size = "md", tagline = true }: { size?: "md" | "lg"; tagline?: boolean }) {
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <LogoMark size={size} />
      <span className="flex min-w-0 flex-col gap-1.5">
        <span className={`brand-wordmark block text-soot ${size === "lg" ? "text-[34px]" : "text-[27px]"}`}>
          burning
        </span>
        {tagline && <span className="block whitespace-nowrap text-[10px] leading-tight text-cinder">Something’s burning.</span>}
      </span>
    </span>
  );
}
