import { createRoot } from "react-dom/client";
import { watchSystemTheme } from "./components/ThemeSwitch";
import "./styles.css";
import { loadDictionary } from "./shared/i18n";
import { startSentry } from "./shared/sentry";

startSentry();
watchSystemTheme();

// The dictionary loads before the app's modules do: labels made when a
// module loads go through t() then, so they are translated as well.
void loadDictionary()
  .then(() => import("./App"))
  .then(({ App }) => createRoot(document.getElementById("root")!).render(<App />));
