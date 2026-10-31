import { lazy, type ComponentType, type LazyExoticComponent } from "react";

export type ScreenProps = { params: Record<string, string> };
type Screen = LazyExoticComponent<ComponentType<ScreenProps>>;
export type Route = { path: string; screen: Screen };

const today = lazy(() => import("../screens/today"));
const work = lazy(() => import("../screens/work"));
const projects = lazy(() => import("../screens/projects"));
const views = lazy(() => import("../screens/views"));
const lists = lazy(() => import("../screens/lists"));
const calendar = lazy(() => import("../screens/calendar"));
const library = lazy(() => import("../screens/library"));
const brief = lazy(() => import("../screens/brief"));
const assistant = lazy(() => import("../screens/assistant"));
const background = lazy(() => import("../screens/background"));
const overnight = lazy(() => import("../screens/overnight"));
const review = lazy(() => import("../screens/review"));
const study = lazy(() => import("../screens/study"));
const teams = lazy(() => import("../screens/teams"));
const booking = lazy(() => import("../screens/booking"));
const notifications = lazy(() => import("../screens/notifications"));
const admin = lazy(() => import("../screens/admin"));
const settings = lazy(() => import("../screens/settings"));

/** Every signed-in route. Old links keep working. */
export const APP_ROUTES: Route[] = [
  { path: "/app", screen: today },
  { path: "/app/today", screen: today },
  { path: "/app/home", screen: today },
  { path: "/app/overview", screen: today },
  { path: "/app/tasks", screen: work },
  { path: "/app/task/:id", screen: work },
  { path: "/app/add", screen: work },
  { path: "/app/search", screen: today },
  { path: "/app/projects", screen: projects },
  { path: "/app/project/:id", screen: projects },
  { path: "/app/views", screen: views },
  { path: "/app/view/:id", screen: views },
  { path: "/app/lists", screen: lists },
  { path: "/app/calendar", screen: calendar },
  { path: "/app/docs", screen: library },
  { path: "/app/doc/:id", screen: library },
  { path: "/app/memory", screen: library },
  { path: "/app/agent-notes", screen: library },
  { path: "/app/brief", screen: brief },
  { path: "/app/assistant", screen: assistant },
  { path: "/app/background", screen: background },
  { path: "/app/overnight", screen: overnight },
  { path: "/app/overnight/:id", screen: overnight },
  { path: "/app/review", screen: review },
  { path: "/app/review/:id", screen: review },
  { path: "/app/study", screen: study },
  { path: "/app/teams", screen: teams },
  { path: "/app/booking", screen: booking },
  { path: "/app/notifications", screen: notifications },
  { path: "/app/admin", screen: admin },
  { path: "/app/admin/:section", screen: admin },
  { path: "/app/settings", screen: settings },
  { path: "/app/settings/:section", screen: settings },
  { path: "/app/agents", screen: settings },
  { path: "/app/chatgpt", screen: settings },
];

const landing = lazy(() => import("../screens/public/landing"));
const signIn = lazy(() => import("../screens/public/sign-in"));
const recovery = lazy(() => import("../screens/public/recovery"));
const legal = lazy(() => import("../screens/public/legal"));
const status = lazy(() => import("../screens/public/status"));
const changelog = lazy(() => import("../screens/public/changelog"));
const developers = lazy(() => import("../screens/public/developers"));
const oauth = lazy(() => import("../screens/public/oauth"));
const publicBooking = lazy(() => import("../screens/public/booking"));

/** Every route that works without an account. */
export const PUBLIC_ROUTES: Route[] = [
  { path: "/", screen: landing },
  { path: "/login", screen: signIn },
  { path: "/signup", screen: signIn },
  { path: "/forgot-password", screen: recovery },
  { path: "/reset-password", screen: recovery },
  { path: "/verify-email", screen: recovery },
  { path: "/terms", screen: legal },
  { path: "/privacy", screen: legal },
  { path: "/security", screen: legal },
  { path: "/status", screen: status },
  { path: "/changelog", screen: changelog },
  { path: "/developers/mcp", screen: developers },
  { path: "/oauth/authorize", screen: oauth },
  { path: "/book/:slug", screen: publicBooking },
  { path: "/book/:slug/:event", screen: publicBooking },
  { path: "/rsvp/:token", screen: publicBooking },
  { path: "/invite/:token", screen: publicBooking },
  { path: "/u/:handle", screen: publicBooking },
];
