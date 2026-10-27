/**
 * Server-side helper: builds the same Actor the API routes see, from the
 * request cookie headers available inside a server component.
 */
import { headers } from "next/headers";
import { resolveActor } from "@/lib/core/auth";
import type { Actor } from "@/lib/contracts";

export async function actorFromSession(): Promise<Actor | null> {
  const h = await headers();
  const req = new Request("https://internal.eoc.local/", {
    headers: h as unknown as HeadersInit,
  });
  return resolveActor(req);
}
