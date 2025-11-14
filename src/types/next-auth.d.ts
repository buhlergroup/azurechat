import { DefaultSession } from "next-auth";

// https://next-auth.js.org/getting-started/typescript#module-augmentation

declare module "next-auth" {
  interface Session {
    user: {
      isAdmin: boolean;
      accessToken: string;
      authProvider: string;
      isLocalDevUser: boolean;
    } & DefaultSession["user"];
  }

  interface Token {
    isAdmin: boolean;
    accessToken: string;
    authProvider?: string;
  }

  interface User {
    isAdmin: boolean;
    accessToken: string;
    authProvider?: string;
  }
}
