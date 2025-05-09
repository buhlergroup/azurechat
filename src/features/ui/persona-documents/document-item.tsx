import { DocumentMetadata } from "@/features/persona-page/persona-services/models";

export const DocumentItem = ({
  document,
  children,
}: {
  document: DocumentMetadata;
  children: any;
}) => (
  <div className="flex items-center space-x-2 justify-between border rounded-md p-2 mb-2 border-input bg-background">
    <div>
      <p>{document.name}</p>
      <div className="flex items-center space-x-2 mt-1 text-sm text-muted-foreground">
        <p>{new Date(document.createdDateTime).toLocaleDateString("de-CH")}</p>
        <p className="px-1">|</p>
        <p>{document.createdBy}</p>
      </div>
    </div>
    {children}
  </div>
);
