"use client";
import { Button } from "@/features/ui/button";
import { Menu } from "lucide-react";
import { menuStore } from "@/features/main-menu/menu-store";

interface MobileHeaderProps {
  title?: string;
  children?: React.ReactNode;
}

export const MobileHeader = ({ title, children }: MobileHeaderProps) => {
  return (
    <div className="bg-background border-b flex items-center py-2 px-3 md:hidden">
      <div className="flex items-center min-w-0 w-full">
        {/* Mobile hamburger menu */}
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0 mr-2"
          onClick={() => menuStore.toggleMainMenu()}
        >
          <Menu size={18} />
        </Button>
        
        {/* Title or custom content */}
        {title && (
          <h1 className="text-lg font-semibold truncate flex-1">{title}</h1>
        )}
        
        {/* Custom content */}
        {children}
      </div>
    </div>
  );
};
