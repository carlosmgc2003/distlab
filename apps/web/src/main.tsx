import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { createBrowserHost } from "./browser-host.ts";
import { detectLocale, LOCALE_STORAGE_KEY } from "./i18n/locales.ts";
import { applyDocumentLocale, LocaleProvider } from "./i18n/react.tsx";

function storedLocale(): string | null {
  try { return window.localStorage.getItem(LOCALE_STORAGE_KEY); } catch { return null; }
}

// The interface language is presentation state (ADR-007): it is chosen here and never sent to the worker.
const locale = detectLocale({ query: new URLSearchParams(window.location.search).get("lang"), stored: storedLocale(), languages: navigator.languages });
applyDocumentLocale(locale);

const host = createBrowserHost();
const root = createRoot(document.getElementById("root")!);
root.render(<LocaleProvider initial={locale}><App host={host} /></LocaleProvider>);
const close = () => host.dispose();
window.addEventListener("pagehide", close);
if (import.meta.hot) import.meta.hot.dispose(() => {
  window.removeEventListener("pagehide", close);
  root.unmount();
  host.dispose();
});
