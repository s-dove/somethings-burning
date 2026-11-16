import { toast } from "sonner";
import { t } from "./i18n";

// copyText puts text on the clipboard and says so in a toast. Plain http (the
// preview) has no Clipboard API, so it falls back to a hidden textarea. Inside
// a modal, pass the modal as `within`: everything outside it is inert, and a
// textarea there cannot be selected.
export async function copyText(text: string, within?: HTMLElement | null): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(text);
    else {
      const area = document.createElement("textarea");
      area.value = text;
      area.style.position = "fixed";
      area.style.opacity = "0";
      (within ?? document.body).appendChild(area);
      area.select();
      const ok = document.execCommand("copy");
      area.remove();
      if (!ok) throw new Error("Copy unavailable");
    }
    toast(t("Copied"));
    return true;
  } catch {
    toast.error("Could not copy. Select and copy the text manually.");
    return false;
  }
}
