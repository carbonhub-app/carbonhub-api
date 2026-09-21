import {
  address,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  createKeyPairSignerFromBytes,
} from "@solana/kit";
import type { Address, KeyPairSigner, Rpc, SolanaRpcApi, RpcSubscriptions, SolanaRpcSubscriptionsApi } from "@solana/kit";
import bs58mod from "bs58";

const bs58 = (bs58mod as unknown as { default?: typeof bs58mod }).default ?? bs58mod;

export type SolanaRpc = Rpc<SolanaRpcApi>;
export type SolanaRpcSubscriptions = RpcSubscriptions<SolanaRpcSubscriptionsApi>;

/** The RPC endpoints for whichever network this deployment is pointed at. */
export function rpcUrlList(): string[] {
  const devnet = JSON.parse(process.env.DEVNET_RPC_URLS as string);
  const mainnet = JSON.parse(process.env.MAINNET_RPC_URLS as string);
  return process.env.SOLANA_NETWORK === "devnet" ? devnet : mainnet;
}

/** Subscriptions travel over websockets, which the env only lists as http(s). */
function toWebsocketUrl(httpUrl: string): string {
  return httpUrl.replace(/^http:/, "ws:").replace(/^https:/, "wss:");
}

export interface SolanaConnection {
  rpc: SolanaRpc;
  rpcSubscriptions: SolanaRpcSubscriptions;
  url: string;
}

/**
 * Walks the configured endpoints and returns the first that answers, so a
 * single unreachable RPC provider does not take the service down.
 */
export async function getWorkingSolanaConnection(
  urls: string[] = rpcUrlList(),
): Promise<SolanaConnection> {
  for (const url of urls) {
    try {
      const rpc = createSolanaRpc(url);
      await rpc.getEpochInfo().send();
      return { rpc, rpcSubscriptions: createSolanaRpcSubscriptions(toWebsocketUrl(url)), url };
    } catch {
      console.log(`Failed to connect to RPC URL: ${url}, trying next...`);
    }
  }
  throw new Error("No working Solana RPC URL found");
}

/** Builds a signer from a base58 secret key of the kind this service stores. */
export async function signerFromBase58(secret: string): Promise<KeyPairSigner> {
  return createKeyPairSignerFromBytes(bs58.decode(secret));
}

export type TokenSymbol = "ECFCH" | "EURCH";

/** Decimals differ per token and are relied on by every amount conversion. */
export const TOKEN_DECIMALS: Record<TokenSymbol, number> = {
  ECFCH: 3,
  EURCH: 6,
};

export function tokenMint(symbol: TokenSymbol): Address {
  return address(process.env[`${symbol}_PUBLIC_KEY`] as string);
}

export async function tokenAuthority(symbol: TokenSymbol): Promise<KeyPairSigner> {
  return signerFromBase58(process.env[`${symbol}_PRIVATE_KEY`] as string);
}

export async function carbonhubSigner(): Promise<KeyPairSigner> {
  const key = process.env.SOLANA_PRIVATE_KEY;
  if (!key) throw new Error("Missing SOLANA_PRIVATE_KEY in environment variables");
  return signerFromBase58(key);
}
