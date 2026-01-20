import { Button } from "@/features/ui/button";
import { FC, PropsWithChildren } from "react";
import { MobileHeader } from "./mobile-header";

interface HeroProps extends PropsWithChildren {
  title: React.ReactNode;
  description: string;
}

export const Hero: FC<HeroProps> = (props) => {
  // Extract title text for mobile header - handle React elements with text content
  const extractTextFromReactNode = (node: React.ReactNode): string => {
    if (typeof node === 'string') return node;
    if (typeof node === 'number') return String(node);
    if (Array.isArray(node)) {
      return node.map(extractTextFromReactNode).join(' ');
    }
    if (node && typeof node === 'object' && 'props' in node) {
      const element = node as React.ReactElement<{ children?: React.ReactNode }>;
      if (element.props && element.props.children) {
        return extractTextFromReactNode(element.props.children);
      }
    }
    return 'Page';
  };

  const titleText = extractTextFromReactNode(props.title);

  return (
    <>
      <MobileHeader title={titleText} />
      <div className="border-b w-full pt-8 pb-4">
        <div className="container max-w-4xl h-full flex flex-col gap-4">
          <div className="flex gap-6 flex-col items-start">
            <h1 className="text-4xl font-bold flex gap-2 items-center">
              {props.title}
            </h1>
            <p className="text-muted-foreground max-w-xl">{props.description}</p>
          </div>
          <div className="grid grid-cols-3 gap-2">{props.children}</div>
        </div>
      </div>
    </>
  );
};

interface HeroButtonProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  onClick: () => void;
}

export const HeroButton: FC<HeroButtonProps> = (props) => {
  return (
    <Button
      variant={"outline"}
      className="flex flex-col gap-4 h-auto p-4 items-start text-start justify-start"
      onClick={props.onClick}
    >
      <span className="flex gap-2 items-center text-primary">
        <span>{props.icon}</span>
        <span className="">{props.title}</span>
      </span>

      <span className="text-muted-foreground whitespace-break-spaces font-normal">
        {props.description}
      </span>
    </Button>
  );
};
