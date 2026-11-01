import { Database } from "./database";
import { Storage } from "./storage";
import { System } from "./system";
import { Legal } from "./legal";
import { Agents } from "./agents";
export function Infrastructure({ area }: { area: string }) {
  return area === "database" ? (
    <Database />
  ) : area === "storage" ? (
    <Storage />
  ) : area === "legal" ? (
    <Legal />
  ) : area === "agents" ? (
    <Agents />
  ) : (
    <System />
  );
}
