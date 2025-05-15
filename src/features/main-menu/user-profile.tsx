"use client";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu";
import { menuIconProps } from "@/ui/menu";
import { LogOut } from "lucide-react";
import { signOut, useSession } from "next-auth/react";
import { Avatar, AvatarImage } from "../ui/avatar";
import { ThemeToggle } from "./theme-toggle";
import { useProfilePicture } from "@/features/common/hooks/useProfilePicture";

export const UserProfile = () => {
  const { data: session } = useSession();
  const profilePicture = useProfilePicture(session?.user?.accessToken);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Avatar className="rounded-md">
          <AvatarImage src={profilePicture} alt={session?.user?.name!} />
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="right" className="w-56" align="end">
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium leading-none">
              {session?.user?.name}
            </p>
            <p className="text-xs leading-none text-muted-foreground">
              {session?.user?.email}
            </p>
            {session?.user?.isAdmin ? (
              <p className="text-xs leading-none text-muted-foreground">
                Admin
              </p>
            ) : null}
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium leading-none">Switch themes</p>
            <ThemeToggle />
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="flex gap-2"
          onClick={() => signOut({ callbackUrl: "/" })}
        >
          <LogOut {...menuIconProps} size={18} />
          <span>Log out</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
