import { colors } from "@orbyn/core";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import "./styles/global.css";

for (const [name, value] of Object.entries(colors))
  document.documentElement.style.setProperty("--color-" + name, value);

createRoot(document.getElementById("root")!).render(<App />);
