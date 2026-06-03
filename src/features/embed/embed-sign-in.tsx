"use client";

import { type FC, useCallback, useEffect } from "react";
import { AI_NAME } from "@/features/theme/theme-config";
import { Button } from "@/features/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/features/ui/card";

/** Message posted by the auth popup (`/embed/auth/complete`) to its opener. */
export const EMBED_AUTH_MESSAGE = "buhler-chat-auth";

/**
 * Best-effort Storage Access API request. Under the click gesture this asks
 * the browser to grant the iframe access to its first-party cookies. After a
 * grant the post-popup reload's request to /embed/* will carry the session
 * cookie the popup just set, even in browsers that block third-party cookies
 * by default (Safari ITP, Firefox ETP, Chrome with 3PC off).
 *
 * Silently no-ops when:
 *   - the iframe is already first-party (most dev setups), or
 *   - the browser doesn't implement the API, or
 *   - the user declines the prompt — we still fall through to the popup login
 *     and the "Open in full app" fallback documented in docs/embedding.md.
 */
async function requestStorageAccessIfNeeded(): Promise<void> {
  if (typeof document === "undefined") return;
  const doc = document as Document & {
    hasStorageAccess?: () => Promise<boolean>;
    requestStorageAccess?: () => Promise<void>;
  };
  if (!doc.requestStorageAccess) return;
  try {
    if (doc.hasStorageAccess && (await doc.hasStorageAccess())) return;
    await doc.requestStorageAccess();
  } catch {
    /* declined / unsupported — fall through to standard popup-cookie path */
  }
}

/**
 * Auth-gated placeholder shown inside the iframe when there is no session.
 * Deliberately reveals NOTHING about the agent (name/description) until the
 * user signs in. Microsoft Entra blocks its login pages inside iframes, so we
 * open the OAuth round-trip in a popup and listen for a postMessage telling us
 * to re-check the session.
 */
export const EmbedSignIn: FC<{ title?: string }> = ({ title }) => {
  const openLogin = useCallback(async () => {
    // Must run under the click handler (user gesture) — the Storage Access API
    // refuses outside of one. Best-effort: we still open the popup either way.
    await requestStorageAccessIfNeeded();
    const callbackUrl =
      typeof window !== "undefined" ? window.location.href : "/";
    const url = `/embed/auth/start?callbackUrl=${encodeURIComponent(callbackUrl)}`;
    window.open(url, "buhler-chat-login", "width=520,height=720");
  }, []);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      // Only trust same-origin messages from our own popup.
      if (e.origin !== window.location.origin) return;
      if (e.data?.type !== EMBED_AUTH_MESSAGE || e.data?.status !== "ok") return;
      // Remove the listener before reloading — anti-replay per the OAuth 2.0
      // Web Message Response Mode draft (single-shot delivery).
      window.removeEventListener("message", onMessage);
      window.location.reload();
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  return (
    <div className="flex items-center justify-center h-full w-full p-4">
      <Card className="min-w-[280px] max-w-sm">
        <CardHeader>
          <CardTitle className="text-lg">
            {title ?? "Sign in to chat"}
          </CardTitle>
          <CardDescription>
            Sign in with your Microsoft Entra ID account to chat with this{" "}
            {AI_NAME} agent.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button className="w-full" onClick={openLogin}>
            Sign in to continue
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};
