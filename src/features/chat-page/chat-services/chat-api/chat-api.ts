"use server";
import "server-only";

import { SupportedFileExtensionsInputImages, UserPrompt } from "../models";
import { ChatAPIResponse } from "./chat-api-response";

export const ChatAPIEntry = async (props: UserPrompt, signal: AbortSignal) => {
  // Validate multimodal image if provided
  if (props.multimodalImage) {
    const base64Image = props.multimodalImage;
    const matches = base64Image.match(/^data:image\/([a-zA-Z]+);base64,/);
    const fileExtension = matches ? matches[1] : null;

    if (!fileExtension) {
      return new Response("Missing File Extension", { status: 400 });
    }

    if (
      !Object.values(SupportedFileExtensionsInputImages).includes(
        fileExtension.toUpperCase() as SupportedFileExtensionsInputImages
      )
    ) {
      return new Response("Filetype is not supported", { status: 400 });
    }
  }

  return ChatAPIResponse(props, signal);
};
