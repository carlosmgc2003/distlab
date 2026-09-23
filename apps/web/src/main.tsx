import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { createBrowserHost } from "./browser-host.ts";

const host = createBrowserHost();
const root = createRoot(document.getElementById("root")!);
root.render(<App host={host} />);
const close = () => host.dispose();
window.addEventListener("pagehide", close);
if (import.meta.hot) import.meta.hot.dispose(() => {
  window.removeEventListener("pagehide", close);
  root.unmount();
  host.dispose();
});
