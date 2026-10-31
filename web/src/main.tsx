import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { ConfirmProvider, ToastProvider } from "./ui/kit";
import "./ui/tokens.css";

createRoot(document.getElementById("root")!).render(
  <ToastProvider>
    <ConfirmProvider>
      <App />
    </ConfirmProvider>
  </ToastProvider>,
);
