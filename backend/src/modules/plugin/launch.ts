import { z } from "zod";
import type { Principal } from "../../capabilities/policy.js";
import { CapabilityError } from "../../capabilities/registry.js";
import { pluginResources } from "./ui-resources.js";

/** Host presentation hints are bounded data, never connection or provider authority. */
export const pluginLaunchInput = z
  .object({
    version: z.literal(1),
    resource_uri: z.string().min(1).max(256).optional(),
    presentation: z
      .object({
        theme: z.enum(["light", "dark", "system"]).optional(),
        locale: z
          .string()
          .min(2)
          .max(64)
          .regex(/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/)
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

/** Produce a credential-free launch result from the live server-selected connection. */
export function pluginLaunch(
  principal: Principal,
  input: z.output<typeof pluginLaunchInput>,
  tools: string[],
  uiEnabled: boolean,
) {
  if (principal.via !== "plugin" || !principal.grant_id || !principal.client.id)
    throw new CapabilityError("FORBIDDEN", "A plugin connection is required.");
  const resources = pluginResources(tools, uiEnabled);
  const resource = input.resource_uri
    ? resources.find((item) => item.uri === input.resource_uri)
    : undefined;
  if (input.resource_uri && !resource)
    throw new CapabilityError(
      "FORBIDDEN",
      "This resource is not available to this connection.",
    );
  return {
    version: 1 as const,
    connection: {
      kind: "plugin" as const,
      user_id: principal.user.id,
      grant_id: principal.grant_id,
      client_id: principal.client.id,
    },
    presentation: input.presentation ?? {},
    resources,
    ...(resource ? { selected_resource: resource.uri } : {}),
  };
}
