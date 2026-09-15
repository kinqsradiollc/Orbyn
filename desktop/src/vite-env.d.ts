/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** API base URL. Defaults to "/api" on the web and localhost in the native app. */
  readonly VITE_API_URL?: string;
  /** The build's version (short commit), set at Docker build time. Undefined locally. */
  readonly VITE_APP_VERSION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
