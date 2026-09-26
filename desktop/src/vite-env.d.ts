/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** API base URL. Defaults to "/api" on the web and localhost in the native app. */
  readonly VITE_API_URL?: string;
  /**
   * The web app's address, for links the desktop app copies (it runs from
   * disk). Defaults to the API's address without /api.
   */
  readonly VITE_WEB_URL?: string;
  /** The build's version (short commit), set at Docker build time. Undefined locally. */
  readonly VITE_APP_VERSION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  /**
   * The desktop app's bridge (desktop/preload.cjs): orbyn:// links the app
   * was opened with. Absent in a browser.
   */
  orbynDesktop?: {
    /** Calls back with each link; returns a function that stops listening. */
    onOpenLink: (fn: (url: string) => void) => () => void;
  };
}
