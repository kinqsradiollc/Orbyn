// Private bounded document renderer. No database or provider credentials are required.
import { env } from "../config/env.js";
import { buildPdfService } from "../modules/docs/pdf-service.js";

const app = buildPdfService({
  key: env.DOC_PDF_KEY,
  executable: env.DOC_PDF_EXECUTABLE,
  limit: env.DOC_PDF_CONCURRENCY,
});
await app.listen({ host: "0.0.0.0", port: env.PORT });
const close = () => void app.close();
process.once("SIGTERM", close);
process.once("SIGINT", close);
