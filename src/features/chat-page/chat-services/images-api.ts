import {
  GetImageFromStore,
  GetThreadAndImageFromUrl,
} from "./chat-image-service";

export const ImageAPIEntry = async (request: Request): Promise<Response> => {
  const urlPath = request.url;

  const response = await GetThreadAndImageFromUrl(urlPath);

  if (response.status !== "OK") {
    return new Response(response.errors[0].message, { status: 404 });
  }

  const { threadId, imgName } = response.response;
  const imageData = await GetImageFromStore(threadId, imgName);

  if (imageData.status === "OK") {
    const { stream, contentType, metadata } = imageData.response;
    const extension = imgName.split(".").pop()?.toLowerCase() || "";
    const extensionContentTypeMap: Record<string, string> = {
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      gif: "image/gif",
      webp: "image/webp",
      csv: "text/csv",
      json: "application/json",
      pdf: "application/pdf",
      txt: "text/plain",
      html: "text/html",
      htm: "text/html",
      xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      xls: "application/vnd.ms-excel",
      zip: "application/zip",
    };
    const resolvedContentType =
      contentType ||
      extensionContentTypeMap[extension] ||
      "application/octet-stream";
    const originalFileName = metadata?.originalfilename || imgName;
    const isImage = resolvedContentType.startsWith("image/");

    return new Response(stream, {
      headers: {
        "content-type": resolvedContentType,
        "content-disposition": `${isImage ? "inline" : "attachment"}; filename="${originalFileName.replace(/"/g, "")}"`,
      },
    });
  } else {
    return new Response(imageData.errors[0].message, { status: 404 });
  }
};
