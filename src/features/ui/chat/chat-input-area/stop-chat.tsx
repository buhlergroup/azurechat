import { Square } from "lucide-react";
import { Button } from "../../button";

export const StopChat = (props: { stop: () => void }) => {
  return (
    <Button
      size="icon"
      type="button"
      variant={"ghost"}
      onClick={() => props.stop()}
      aria-label="Stop generating"
    >
      <Square size={16} className="fill-current" />
    </Button>
  );
};
