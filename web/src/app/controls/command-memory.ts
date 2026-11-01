import {
  readMemory,
  recordCommand,
  togglePinned,
  type CommandMemory,
} from "@orbyn/core";
import { useRef, useState } from "react";
import { getSessionVersion } from "../../lib/session";
export function useCommandMemory(userId: string) {
  const [generation] = useState(getSessionVersion);
  const key = `orbyn-command-memory:${userId}`;
  const [memory, setMemory] = useState(() => {
    try {
      return readMemory(localStorage.getItem(key));
    } catch {
      return readMemory(null);
    }
  });
  const latest = useRef(memory);
  latest.current = memory;
  const [error, setError] = useState("");
  const put = (next: CommandMemory) => {
    if (!userId || generation !== getSessionVersion()) return;
    latest.current = next;
    setMemory(next);
    try {
      localStorage.setItem(key, JSON.stringify(next));
      setError("");
    } catch {
      setError(
        "Command pins and recents are kept for this visit. This browser couldn't save them.",
      );
    }
  };
  return {
    memory,
    error,
    record: (id: string) => put(recordCommand(latest.current, id)),
    pin: (id: string) => put(togglePinned(latest.current, id)),
  };
}
