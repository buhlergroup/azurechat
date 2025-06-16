import React from "react";

export const ChatTextInput = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement> // Add ChatInputAreaProps to the type definition
>(({ ...props }, ref) => {
  return (
    <textarea
      ref={ref}
      className="p-3 md:p-4 w-full focus:outline-none bg-transparent resize-none min-h-[44px] max-h-32"
      placeholder="Type your message here..."
      {...props}
    />
  );
});
ChatTextInput.displayName = "ChatTextInput";
