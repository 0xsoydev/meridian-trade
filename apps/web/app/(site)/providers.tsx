"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { WagmiProvider, createConfig } from "@privy-io/wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { hederaTestnet } from "viem/chains";
import { http } from "wagmi";
import { galileo } from "../../lib/chain";

const wagmiConfig = createConfig({
  chains: [galileo, hederaTestnet],
  transports: { [galileo.id]: http(), [hederaTestnet.id]: http() },
  ssr: true,
});

function forPrivy(chain: typeof galileo | typeof hederaTestnet) {
  return {
    id: chain.id,
    name: chain.name,
    nativeCurrency: chain.nativeCurrency,
    rpcUrls: chain.rpcUrls,
    blockExplorers: chain.blockExplorers,
  };
}

export function Providers({ appId, children }: { appId: string; children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <PrivyProvider
      appId={appId}
      config={{
        defaultChain: forPrivy(galileo),
        supportedChains: [forPrivy(galileo), forPrivy(hederaTestnet)],
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
