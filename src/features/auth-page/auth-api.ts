import NextAuth, { NextAuthOptions } from "next-auth";
import AzureADProvider from "next-auth/providers/azure-ad";
import CredentialsProvider from "next-auth/providers/credentials";
import GitHubProvider from "next-auth/providers/github";
import { Provider } from "next-auth/providers/index";
import { hashValue } from "./helpers";
import { JWT } from "next-auth/jwt";

const SCOPES = "offline_access openid profile User.Read email Group.Read.All Files.Read.All";

const configureIdentityProvider = () => {
  const providers: Array<Provider> = [];

  const adminEmails = process.env.ADMIN_EMAIL_ADDRESS?.split(",").map((email) =>
    email.toLowerCase().trim()
  );

  if (process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET) {
    providers.push(
      GitHubProvider({
        clientId: process.env.AUTH_GITHUB_ID!,
        clientSecret: process.env.AUTH_GITHUB_SECRET!,
        async profile(profile, tokens) {
          const newProfile = {
            ...profile,
            isAdmin: adminEmails?.includes(profile.email.toLowerCase()),
            image: profile.avatar_url, // GitHub profile picture
          };

          if (tokens?.access_token) {
            newProfile.accessToken = tokens.access_token;
          }

          return newProfile;
        },
      })
    );
  }

  if (
    process.env.AZURE_AD_CLIENT_ID &&
    process.env.AZURE_AD_CLIENT_SECRET &&
    process.env.AZURE_AD_TENANT_ID
  ) {
    providers.push(
      AzureADProvider({
        clientId: process.env.AZURE_AD_CLIENT_ID,
        clientSecret: process.env.AZURE_AD_CLIENT_SECRET,
        tenantId: process.env.AZURE_AD_TENANT_ID,
        authorization: {
          params: {
            scope: SCOPES,
          },
        },
        async profile(profile, tokens) {
          return {
            ...profile,
            id: profile.sub,
            email: profile.email,
            accessToken: tokens.access_token,
            isAdmin:
              adminEmails?.includes(profile.email.toLowerCase()) ||
              adminEmails?.includes(profile.preferred_username.toLowerCase()),
          };
        },
      })
    );
  }

  if (process.env.NODE_ENV === "development") {
    providers.push(
      CredentialsProvider({
        id: "localdev",
        name: "localdev",
        credentials: {
          username: { label: "Username", type: "text", placeholder: "dev" },
          password: { label: "Password", type: "password" },
        },
        async authorize(credentials, req): Promise<any> {
          const username = credentials?.username || "dev";
          const email = `${username}@localhost`;
          const user = {
            id: hashValue(email),
            name: username,
            email: email,
            isAdmin: false,
            accessToken: "fake_token",
            image: "",
          };
          return user;
        },
      })
    );
  }

  return providers;
};

export const options: NextAuthOptions = {
  secret: process.env.NEXTAUTH_SECRET,
  providers: [...configureIdentityProvider()],
  callbacks: {
    async jwt({ token, user, account }) {
      if (account && user) {
        const extendedUser = user as { accessToken?: string; isAdmin?: boolean };
        const previousExpiry = token.accessTokenExpires as number | undefined;
        const previousRefreshToken = token.refreshToken as string | undefined;
        token.accessToken =
          account.access_token ?? extendedUser.accessToken ?? (token.accessToken as string);
        token.accessTokenExpires =
          account.expires_at ??
          previousExpiry ??
          Math.floor(Date.now() / 1000) + 60 * 60;
        token.refreshToken = account.refresh_token ?? previousRefreshToken;
        token.isAdmin = extendedUser.isAdmin ?? false;
        token.authProvider = account.provider ?? (token.authProvider as string);

        return token;
      }

      token.authProvider =
        (token.authProvider as string) ??
        ((token.refreshToken as string | undefined) ? "azure-ad" : "localdev");

      if (token.authProvider !== "azure-ad") {
        return token;
      }

      if (
        token.accessTokenExpires &&
        Date.now() < (token.accessTokenExpires as number) * 1000
      ) {
        return token;
      }

      return refreshAccessToken(token);
    },
    async session({ session, token }) {
      session.user.isAdmin = Boolean(token.isAdmin);
      session.user.accessToken = (token.accessToken as string) ?? "";
      session.user.authProvider =
        (token.authProvider as string) ??
        ((token.refreshToken as string | undefined) ? "azure-ad" : "localdev");
      const fallbackLocalDev = session.user.email?.endsWith("@localhost") ?? false;
      session.user.isLocalDevUser =
        session.user.authProvider === "localdev" || fallbackLocalDev;
      return session;
    },
  },
  session: {
    strategy: "jwt",
  },
};

async function refreshAccessToken(token: JWT) {
  try {
    const refreshToken = token.refreshToken as string | undefined;

    if (!refreshToken) {
      throw new Error("Missing refresh token");
    }

    const url = `https://login.microsoftonline.com/${process.env.AZURE_AD_TENANT_ID}/oauth2/v2.0/token`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: process.env.AZURE_AD_CLIENT_ID!,
        client_secret: process.env.AZURE_AD_CLIENT_SECRET!,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        scope: SCOPES,
      }),
    });

    const refreshedTokens = await response.json();

    if (!response.ok) {
      throw new Error(
        `Failed to refresh access token: ${refreshedTokens.error}`
      );
    }

    const expiresInSeconds = Number(refreshedTokens.expires_in ?? 0);
    const newExpiry = expiresInSeconds
      ? Math.floor(Date.now() / 1000) + expiresInSeconds
      : (token.accessTokenExpires as number | undefined);

    return {
      ...token,
      accessToken: refreshedTokens.access_token,
      accessTokenExpires: newExpiry,
      refreshToken: refreshedTokens.refresh_token || token.refreshToken,
    };
  } catch (error) {
    return {
      ...token,
      error: "RefreshAccessTokenError",
    };
  }
}

export const handlers = NextAuth(options);
