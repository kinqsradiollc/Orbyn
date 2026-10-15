import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { WebView } from "react-native-webview";
import { Button } from "./Button";
import { saveFile } from "../lib/download";
import { colors } from "../theme";
import { shared } from "../styles";
import runtime from "../../assets/pdf-preview-runtime.json";
export type DocumentPdfPreviewProps = {
  pdf: Blob;
  report: (error: unknown) => void;
};
const source = { html: runtime.html, baseUrl: "about:blank" };
/** The same offline page renderer as web, isolated from navigation and cookies. */
export function DocumentPdfPreview({ pdf, report }: DocumentPdfPreviewProps) {
  const view = useRef<WebView>(null),
    latest = useRef<string | null>(null),
    sequence = useRef(0);
  const [error, setError] = useState("");
  useEffect(() => {
    const reader = new FileReader(),
      id = ++sequence.current;
    let alive = true;
    setError("");
    reader.onload = () => {
      if (!alive || typeof reader.result !== "string") return;
      latest.current = JSON.stringify({
        type: "orbyn-pdf",
        id,
        data: reader.result.slice(reader.result.indexOf(",") + 1),
        palette: {
          surface: colors.surface,
          text: colors.text,
          muted: colors.muted,
          border: colors.border,
        },
      });
      view.current?.postMessage(latest.current);
    };
    reader.onerror = () => {
      if (alive) setError("Couldn’t open this PDF. Try downloading it.");
    };
    reader.readAsDataURL(pdf);
    return () => {
      alive = false;
      if (reader.readyState === 1) reader.abort();
    };
  }, [pdf]);
  useEffect(() => {
    if (!latest.current) return;
    const request = JSON.parse(latest.current);
    request.palette = {
      surface: colors.surface,
      text: colors.text,
      muted: colors.muted,
      border: colors.border,
    };
    latest.current = JSON.stringify(request);
    view.current?.postMessage(latest.current);
  }, [colors.surface, colors.text, colors.muted, colors.border]);
  return (
    <View style={{ flex: 1, minHeight: 220 }}>
      {!!error && (
        <Text accessibilityRole="alert" style={shared.small}>
          {error}
        </Text>
      )}
      <WebView
        ref={view}
        source={source}
        style={{ flex: 1, minHeight: 220, backgroundColor: colors.surface }}
        originWhitelist={["about:blank"]}
        onShouldStartLoadWithRequest={(event) => event.url === "about:blank"}
        allowFileAccess={false}
        allowFileAccessFromFileURLs={false}
        allowUniversalAccessFromFileURLs={false}
        sharedCookiesEnabled={false}
        thirdPartyCookiesEnabled={false}
        javaScriptCanOpenWindowsAutomatically={false}
        setSupportMultipleWindows={false}
        mixedContentMode="never"
        onLoadEnd={() => {
          if (latest.current) view.current?.postMessage(latest.current);
        }}
        accessibilityLabel="LaTeX note"
      />
      <Button
        title="Open PDF"
        onPress={() =>
          void saveFile("document.pdf", pdf, "application/pdf").catch(report)
        }
      />
    </View>
  );
}
