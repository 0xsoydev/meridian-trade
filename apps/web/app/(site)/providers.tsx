"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { WagmiProvider, createConfig } from "@privy-io/wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { http } from "wagmi";
import { galileo } from "../../lib/chain";

const wagmiConfig = createConfig({ chains: [galileo], transports: { [galileo.id]: http() }, ssr: true });

const privyChain = {
  id: galileo.id,
  name: galileo.name,
  nativeCurrency: galileo.nativeCurrency,
  rpcUrls: galileo.rpcUrls,
  blockExplorers: galileo.blockExplorers,
};

export function Providers({ appId, children }: { appId: string; children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <PrivyProvider
      appId={appId}
      config={{
        defaultChain: privyChain,
        supportedChains: [privyChain],
        loginMethods: ["email", "wallet"],
        embeddedWallets: { ethereum: { createOnLogin: "users-without-wallets" } },
      }}
    >
      <QueryClientProvider client={queryClient}>
        <WagmiProvider config={wagmiConfig}>{children}</WagmiProvider>
      </QueryClientProvider>
    </PrivyProvider>
  );
}
