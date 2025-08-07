import { LoadingIndicator } from "../../loading";

export const ChatLoading = () => {
  return (
    <div className="flex flex-col items-center justify-center p-8 space-y-4">
      <LoadingIndicator isLoading={true} />
      <div className="text-sm text-muted-foreground">Thinking...</div>
    </div>
  );
};
