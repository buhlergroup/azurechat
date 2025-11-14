"use client";

import { signOut } from "next-auth/react";

import { ServerActionResponse } from "@/features/common/server-action-response";
import { SESSION_EXPIRED_ERROR_CODE } from "@/features/common/error-codes";

export const logoutOnSessionExpired = (
  response: ServerActionResponse<any>
): boolean => {
  if (response.status !== "UNAUTHORIZED") {
    return false;
  }

  const errors = "errors" in response ? response.errors : undefined;

  if (!errors) {
    return false;
  }

  const hasSessionExpiredError = errors.some(
    (error) => error.code === SESSION_EXPIRED_ERROR_CODE
  );

  if (!hasSessionExpiredError) {
    return false;
  }

  signOut({ callbackUrl: "/" });
  return true;
};
