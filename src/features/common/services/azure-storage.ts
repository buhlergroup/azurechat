import { BlobServiceClient, RestError } from "@azure/storage-blob";
import { ServerActionResponse } from "../server-action-response";
import { logInfo, logError } from "./logger";
import { getAzureDefaultCredential } from "./azure-default-credential";

// initialize the blobServiceClient
const InitBlobServiceClient = () => {
  const acc = process.env.AZURE_STORAGE_ACCOUNT_NAME;

  if (!acc)
    throw new Error(
      "Azure Storage Account not configured correctly, check environment variables."
    );

  const endpoint = `https://${acc}.blob.core.windows.net`;
  const credential = getAzureDefaultCredential();

  const blobServiceClient = new BlobServiceClient(endpoint, credential);
  return blobServiceClient;
};

export const UploadBlob = async (
  containerName: string,
  blobName: string,
  blobData: Buffer
): Promise<ServerActionResponse<string>> => {
  const blobServiceClient = InitBlobServiceClient();

  const containerClient = blobServiceClient.getContainerClient(containerName);
  const blockBlobClient = containerClient.getBlockBlobClient(blobName);

  try{
    
  const response = await blockBlobClient.uploadData(blobData);

  // Check for upload success
  if (response.errorCode !== undefined) {
    logError("Azure Storage upload failed", { 
      errorCode: response.errorCode,
      blobName: blobName,
      containerName: containerName 
    });
    return {
      status: "ERROR",
      errors: [
        {
          message: `Error uploading blob to storage: ${response.errorCode}`,
        },
      ],
    };
  }

  logInfo("Azure Storage upload successful", { 
    blobName, 
    containerName,
    url: blockBlobClient.url 
  });

  return {
    status: "OK",
    response: blockBlobClient.url,
  };
  
  } catch (error){
    logError("Azure Storage upload error", { 
      error: error instanceof Error ? error.message : String(error),
      blobName,
      containerName 
    });
    throw error;
  }
};

export const GetBlob = async (
  containerName: string,
  blobPath: string
): Promise<ServerActionResponse<ReadableStream<any>>> => {
  const blobServiceClient = InitBlobServiceClient();

  const containerClient = blobServiceClient.getContainerClient(containerName);
  const blockBlobClient = containerClient.getBlockBlobClient(blobPath);

  try {
    const downloadBlockBlobResponse = await blockBlobClient.download(0);

    // Passes stream to caller to decide what to do with
    if (!downloadBlockBlobResponse.readableStreamBody) {
      return {
        status: "ERROR",
        errors: [
          {
            message: `Error downloading blob: ${blobPath}`,
          },
        ],
      };
    }

    return {
      status: "OK",
      response:
        downloadBlockBlobResponse.readableStreamBody as unknown as ReadableStream<any>,
    };
  } catch (error) {
    if (error instanceof RestError) {
      if (error.statusCode === 404) {
        return {
          status: "NOT_FOUND",
          errors: [
            {
              message: `Blob not found: ${blobPath}`,
            },
          ],
        };
      }
    }

    return {
      status: "ERROR",
      errors: [
        {
          message: `Error downloading blob: ${blobPath}`,
        },
      ],
    };
  }
};
