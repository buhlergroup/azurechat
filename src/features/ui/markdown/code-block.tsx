import { CheckIcon, ClipboardIcon } from "lucide-react";
import { FC, memo, useEffect, useState } from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneLight, oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { useTheme } from "next-themes";
import { Button } from "../button";

export const fence = {
  render: "CodeBlock",
  attributes: {
    language: {
      type: String,
    },
    value: {
      type: String,
    },
  },
};

interface Props {
  language: string;
  children: string;
}

export const CodeBlock: FC<Props> = memo(({ language, children }) => {
  const [isIconChecked, setIsIconChecked] = useState(false);
  const { theme } = useTheme();

  const handleButtonClick = () => {
    navigator.clipboard.writeText(children);
    setIsIconChecked(true);
  };

  useEffect(() => {
    const timeout = setTimeout(() => {
      setIsIconChecked(false);
    }, 2000);

    return () => clearTimeout(timeout);
  }, [isIconChecked]);

  return (
    <div className="flex flex-col -mx-9">
      <div className="flex items-center justify-end">
        <Button
          variant={"ghost"}
          size={"sm"}
          title="Copy text"
          className="justify-right flex gap-2"
          onClick={handleButtonClick}
        >
          <span className="text-xs text-muted-foreground">Copy {language}</span>
          {isIconChecked ? (
            <CheckIcon size={16} />
          ) : (
            <ClipboardIcon size={16} />
          )}
        </Button>
      </div>

      <SyntaxHighlighter 
        language={language} 
        style={theme === 'dark' ? oneDark : oneLight}
        PreTag="pre" 
        customStyle={{maxInlineSize: "100cqw", boxSizing: "border-box", overflow: "auto"}} 
        showLineNumbers
      >
        {children}
      </SyntaxHighlighter>
    </div>
  );
});

CodeBlock.displayName = "CodeBlock";
