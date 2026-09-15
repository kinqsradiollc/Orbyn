import { env } from "../../config/env.js";

const headers = {
  "Content-Type": "application/json",
  ...(env.EXPO_ACCESS_TOKEN
    ? { Authorization: `Bearer ${env.EXPO_ACCESS_TOKEN}` }
    : {}),
};

type Ticket = { status?: string; id?: string; details?: { error?: string } };

export type PushNotification = {
  item_id: string | null;
  destination: string;
  title: string;
  body: string;
  receipt_id: string | null;
  /** What the notice is about, so the app can open the right place. */
  kind?: string;
  ref?: string;
};

export type PushOutcome =
  | { kind: "ticket"; receiptId: string }
  | { kind: "delivered" }
  | { kind: "unregistered" };

/**
 * Send through Expo's push service, or check a previously issued receipt.
 * Throws on transport failure so the caller can retry with backoff.
 */
export async function sendPush(
  n: PushNotification,
  checkingReceipt: boolean,
): Promise<PushOutcome> {
  const response = await fetch(
    `https://exp.host/--/api/v2/push/${checkingReceipt ? "getReceipts" : "send"}`,
    {
      method: "POST",
      headers,
      signal: AbortSignal.timeout(15000),
      body: JSON.stringify(
        checkingReceipt
          ? { ids: [n.receipt_id] }
          : {
              to: n.destination,
              title: n.title,
              body: n.body,
              data: { itemId: n.item_id, kind: n.kind, ref: n.ref },
              sound: "default",
            },
      ),
    },
  );
  if (!response.ok) throw new Error("Push transport failed");
  const result = (await response.json()) as {
    data: Ticket | Record<string, Ticket>;
  };
  const ticket: Ticket | undefined = checkingReceipt
    ? (result.data as Record<string, Ticket>)[n.receipt_id!]
    : (result.data as Ticket);
  if (ticket?.details?.error === "DeviceNotRegistered")
    return { kind: "unregistered" };
  if (!ticket || ticket.status !== "ok")
    throw new Error("Push receipt unavailable or rejected");
  if (checkingReceipt) return { kind: "delivered" };
  if (!ticket.id) throw new Error("Missing push receipt");
  return { kind: "ticket", receiptId: ticket.id };
}
