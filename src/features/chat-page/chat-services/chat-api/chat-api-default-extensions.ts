"use server";
import "server-only";

import { ServerActionResponse } from "@/features/common/server-action-response";
import { ChatThreadModel } from "../models";

// Image generation is now handled natively by the v1 Responses API
// using the image_generation tool type. No custom extensions needed.
