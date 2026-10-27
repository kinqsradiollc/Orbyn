import { env } from "../config/env.js";
import { buildPdfService } from "../modules/documents/pdf-service.js";
import { renderLatexSnapshot } from "../modules/documents/latex-renderer.js";

// Internal compiler: no database/provider credentials and no public port.
const app = buildPdfService({
  key: env.DOC_PDF_KEY,
  executable: "/usr/bin/pdflatex",
  limit: 1,
  sourceKind: "latex",
  render: renderLatexSnapshot,
});
await app.listen({ host: "0.0.0.0", port: env.PORT });
const close = () => void app.close();
process.once("SIGTERM", close);
process.once("SIGINT", close);
