import { useEffect, useRef } from "react";
import { WebView } from "react-native-webview";
import runtime from "../../assets/mermaid-runtime.json";
const localSource = { html: runtime.html };

export type DiagramSurfaceProps = {
  request: string;
  panRequest?: string;
  height: number;
  onResult: (data: string) => void;
};

/** A local renderer without navigation, file access, cookies or network resources. */
export function DiagramSurface({
  request,
  panRequest,
  height,
  onResult,
}: DiagramSurfaceProps) {
  const view = useRef<WebView>(null);
  const latest = useRef(request);
  latest.current = request;
  useEffect(() => {
    view.current?.postMessage(request);
  }, [request]);
  useEffect(() => {
    if (panRequest) view.current?.postMessage(panRequest);
  }, [panRequest]);
  return (
    <WebView
      ref={view}
      source={localSource}
      style={{ height, backgroundColor: "transparent" }}
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
      onLoadEnd={() => view.current?.postMessage(latest.current)}
      onMessage={(event) => onResult(event.nativeEvent.data)}
      accessibilityLabel="Diagram preview"
    />
  );
}
