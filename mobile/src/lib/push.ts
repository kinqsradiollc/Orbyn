import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { client } from "./api";
import { clearPushToken, getPushToken, savePushToken } from "./session";

/**
 * Ask for permission, fetch the Expo push token and register this device with
 * the server. Throws a user-facing Error when a prerequisite is missing.
 */
export async function enablePush() {
  if (Platform.OS === "android")
    await Notifications.setNotificationChannelAsync("default", {
      name: "Planner reminders",
      importance: Notifications.AndroidImportance.HIGH,
    });
  const permission = await Notifications.requestPermissionsAsync();
  if (permission.status !== "granted")
    throw new Error(
      "Allow notifications in your device settings to receive reminders.",
    );
  const projectId =
    process.env.EXPO_PUBLIC_EAS_PROJECT_ID ||
    Constants.expoConfig?.extra?.eas?.projectId;
  if (!projectId)
    throw new Error(
      "Configure the Expo EAS project ID before enabling push notifications.",
    );
  const push = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  await client.registerDevice(push);
  await savePushToken(push);
  await registerReviewActions();
}

/**
 * The category the server puts on a proposal waiting for review (see
 * backend worker/channels/push.ts): its notification has Approve and
 * Decline, answered here with the signed-in session.
 */
export const REVIEW_CATEGORY = "orbyn-review";
const REVIEW_ACTIONS = ["approve", "decline"] as const;

/** Registers Approve and Decline for review notifications (once per launch). */
export async function registerReviewActions() {
  if (Platform.OS === "web") return;
  await Notifications.setNotificationCategoryAsync(REVIEW_CATEGORY, [
    {
      identifier: "approve",
      buttonTitle: "Approve",
      options: { opensAppToForeground: true },
    },
    {
      identifier: "decline",
      buttonTitle: "Decline",
      options: { isDestructive: true, opensAppToForeground: true },
    },
  ]).catch(() => {});
}

/** What a tapped Approve or Decline answers: a proposal, or an agent's yes/no question. */
export type ReviewAnswer =
  | { proposal: string; decision: "approve" | "decline" }
  | { question: string; decision: "approve" | "decline" };

/** The proposal or question, and the answer, a tapped button stands for. */
export function reviewAction(
  response: Notifications.NotificationResponse,
): ReviewAnswer | null {
  const decision = response.actionIdentifier as (typeof REVIEW_ACTIONS)[number];
  if (!REVIEW_ACTIONS.includes(decision)) return null;
  const ref = String(response.notification.request.content.data?.ref ?? "");
  const proposal = /^proposal:([0-9a-f-]{36})$/.exec(ref)?.[1];
  if (proposal) return { proposal, decision };
  // An agent's yes/no question (ask_person): Approve is yes.
  const question = /^question:([0-9a-f-]{36}):yes_no$/.exec(ref)?.[1];
  return question ? { question, decision } : null;
}

/**
 * Answers from a notification's button, signed in as the person: a
 * proposal (applied or declined), or an agent's question (yes or no). Says
 * how it ended, even when it was already decided.
 */
export async function answerReview(action: ReviewAnswer) {
  if ("question" in action) {
    const q = await client.answerAgentQuestion(
      action.question,
      action.decision === "approve" ? "yes" : "no",
      "push",
    );
    return q.status;
  }
  const { status } = await client.respondToReview(
    action.proposal,
    action.decision,
  );
  return status;
}

/** Unregister this device (when one is registered) and forget the push token. */
export async function disablePush() {
  const push = await getPushToken();
  if (push) await client.removeDevice(push);
  await clearPushToken();
}
