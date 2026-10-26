import { chatgptConnectionRoutes } from "../modules/auth/chatgpt-routes.js";
import { chatgptExecutorRoutes } from "../modules/auth/chatgpt-executor-routes.js";
import { aiRoutes } from "../modules/ai/routes.js";
import { aiAdminRoutes } from "../modules/ai/admin.js";
import { aiStudyRoutes } from "../modules/ai/study.js";
import { projectChatRoutes } from "../modules/ai/chats.js";
import { aiCaptureRoutes } from "../modules/ai/capture.js";
import { aiRecordingRoutes } from "../modules/ai/recording.js";
import { createService } from "./http.js";

/** Ordered route registration owned by the ai process. */
export const aiModules = [
  chatgptConnectionRoutes,
  chatgptExecutorRoutes,
  aiRoutes,
  aiAdminRoutes,
  aiStudyRoutes,
  projectChatRoutes,
  aiCaptureRoutes,
  // A recording's summary and action items (CAP-10).
  aiRecordingRoutes,
];

export const buildAiService = () => createService("ai", aiModules);
