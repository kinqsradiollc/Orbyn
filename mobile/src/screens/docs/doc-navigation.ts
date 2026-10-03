import { createContext } from "react";

/** The current page owns fragment navigation and keeps its unsaved draft. */
export const DocNavigationContext = createContext<{
  onFragment: (fragment: string) => void;
  onAppLink: (url: string) => void;
  report: (error: unknown) => void;
} | null>(null);
