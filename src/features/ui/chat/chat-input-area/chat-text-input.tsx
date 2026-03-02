import React from "react";

export const ChatTextInput = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ ...props }, ref) => {
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  React.useImperativeHandle(ref, () => textareaRef.current as HTMLTextAreaElement);

  const adjustHeight = React.useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  React.useEffect(() => {
    adjustHeight();
  }, [props.value, adjustHeight]);

  return (
    <textarea
      ref={textareaRef}
      rows={1}
      className="p-3 md:p-4 w-full focus:outline-none bg-transparent resize-y min-h-[44px] max-h-[50vh] md:max-h-[33vh] overflow-y-auto"
      placeholder="Type your message here..."
      {...props}
    />
  );
});
ChatTextInput.displayName = "ChatTextInput";
