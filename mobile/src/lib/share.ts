import { Platform, Share } from "react-native";
import { appUrl, type LinkTarget } from "@orbyn/core";
import { showToast } from "../components/Toast";
import { webOrigin } from "./api";
import { downloadDoc } from "./download";

/**
 * Sharing out of Orbyn from a phone's ⋯ menus: a page, task or project's
 * link (it opens in the web app, and in the app where links are set up),
 * or a page as a file. The system share sheet does the rest.
 */

/** The link to a page, task or project. */
export const linkTo = (target: LinkTarget) => appUrl(webOrigin, target);

/**
 * Hand a link to the share sheet. In a browser with no share sheet of its
 * own, the link is copied instead, and a toast says so.
 */
export async function shareLink(
  target: LinkTarget,
  title: string,
): Promise<void> {
  const url = linkTo(target);
  if (Platform.OS === "web") {
    const nav = globalThis.navigator as Navigator | undefined;
    if (nav?.share) {
      try {
        await nav.share({ title, url });
      } catch {
        // Closed without sharing: nothing to say.
      }
      return;
    }
    await nav?.clipboard?.writeText(url);
    showToast({ text: "Link copied" });
    return;
  }
  // iOS shares a link as a link; Android only has the message to put it in.
  await Share.share(
    Platform.OS === "ios" ? { url, title } : { message: url, title },
  );
}

/** A page as a Markdown or PDF file, handed to the share sheet. */
export const sharePageFile = (docId: string, format: "md" | "pdf") =>
  downloadDoc(docId, format);
