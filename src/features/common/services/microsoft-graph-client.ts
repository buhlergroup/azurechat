import { Client } from "@microsoft/microsoft-graph-client";

export function getGraphClient(accessToken: string) {
  const client = Client.init({
    authProvider: (done) => {
      done(null, accessToken);
    },
  });

  return client;
}