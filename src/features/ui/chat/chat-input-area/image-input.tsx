import { Image as ImageIcon } from "lucide-react";
import { FC, useRef } from "react";
import { Button } from "../../button";
import { InputImageStore, useInputImage } from "./input-image-store";
import { SupportedFileExtensionsInputImages } from "@/features/chat-page/chat-services/models";

export const ImageInput: FC = () => {
  const { base64Image } = useInputImage();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleButtonClick = () => {
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    fileInputRef.current?.click();
  };

  return (
    <div className="flex gap-2">
      {/* Hidden inputs for form submission */}
      <input
        type="hidden"
        name="image-base64"
        value={base64Image}
        onChange={(e) => InputImageStore.UpdateBase64Image(e.target.value)}
      />
      <input
        type="file"
        accept={Object.values(SupportedFileExtensionsInputImages)
          .map((ext) => "image/" + ext.toLowerCase())
          .join(",")}
        name="image"
        ref={fileInputRef}
        className="hidden"
        onChange={(e) => InputImageStore.OnFileChange(e)}
      />
      <Button
        size="icon"
        variant={"ghost"}
        type="button"
        onClick={handleButtonClick}
        aria-label="Add an image to the chat input"
      >
        <ImageIcon size={16} />
      </Button>
    </div>
  );
};
