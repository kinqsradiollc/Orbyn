import { useEffect, useRef, useState } from "react";
import { View, useWindowDimensions } from "react-native";
import { WebView } from "react-native-webview";
import { colors } from "../theme";
import runtime from "../../assets/latex-html-runtime.json";
const documentSource = { html: runtime.html, baseUrl: "about:blank" };
export function LatexHtmlPreview({
  source,
  fill = false,
}: {
  source: string;
  fill?: boolean;
}) {
  const { fontScale } = useWindowDimensions();
  const [height, setHeight] = useState(160);
  const view = useRef<WebView>(null);
  const latest = useRef("");
  latest.current = JSON.stringify({
    type: "orbyn-latex-source",
    fontScale,
    source,
    palette: {
      surface: colors.surface,
      text: colors.text,
      muted: colors.muted,
      border: colors.border,
    },
  });
  const send = () => view.current?.postMessage(latest.current);
  useEffect(send, [source, colors.surface, colors.text, fontScale]);
  return (
    <View
      style={fill ? { flex: 1, minHeight: 240 } : { height, minHeight: 80 }}
    >
      <WebView
        ref={view}
        source={documentSource}
        onLoadEnd={send}
        onMessage={(event) => {
          try {
            const data = JSON.parse(event.nativeEvent.data);
            if (data.state === "loaded") send();
            if (Number.isFinite(data.height))
              setHeight(Math.max(80, Math.min(2400, data.height)));
          } catch {}
        }}
        originWhitelist={["about:blank"]}
        onShouldStartLoadWithRequest={(request) =>
          request.url === "about:blank"
        }
        javaScriptEnabled
        domStorageEnabled={false}
        setSupportMultipleWindows={false}
        style={{ backgroundColor: colors.surface }}
      />
    </View>
  );
}
