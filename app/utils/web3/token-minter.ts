import {
  address,
  pipe,
  createTransactionMessage,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions,
  signTransactionMessageWithSigners,
  sendAndConfirmTransactionFactory,
  getSignatureFromTransaction,
  assertIsTransactionWithBlockhashLifetime,
} from "@solana/kit";
import type { Address } from "@solana/kit";
import {
  findAssociatedTokenPda,
  fetchMaybeToken,
  fetchMint,
  getCreateAssociatedTokenIdempotentInstruction,
  getMintToInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";

import {
  getWorkingSolanaConnection,
  carbonhubSigner,
  tokenMint,
  type TokenSymbol,
} from "./solana";

export interface MintResult {
  tokenPublicKey: string | undefined;
  tokenMetadataPda: string | undefined;
  targetPublicKey: string;
  amount: number;
  associatedTokenAccount: string;
  signature: string;
}

/**
 * Mints `amount` (already in the token's smallest unit) of `symbol` to
 * `targetPublicKey`, creating the recipient's associated token account when it
 * does not exist yet.
 */
export async function mintTo(
  symbol: TokenSymbol,
  targetPublicKey: string,
  amount: number,
): Promise<MintResult> {
  console.log("Starting mint process...");
  console.log("Target Public Key:", targetPublicKey);
  console.log("Amount:", amount);

  if (typeof amount !== "number" || amount <= 0) {
    throw new Error("Amount must be a positive number");
  }

  let target: Address;
  try {
    target = address(targetPublicKey);
  } catch {
    throw new Error("Invalid target public key format");
  }

  console.log("Using network:", process.env.SOLANA_NETWORK);
  const { rpc, rpcSubscriptions } = await getWorkingSolanaConnection();
  console.log("Connection established successfully");

  const payer = await carbonhubSigner();
  console.log("Solana authority loaded:", payer.address);

  const mint = tokenMint(symbol);
  console.log("Token public key loaded:", mint);

  // The payer must still be the mint authority, exactly as when the token was
  // created; minting with any other key would fail on chain anyway, but this
  // reports the mismatch clearly.
  const mintAccount = await fetchMint(rpc, mint);
  console.log("Mint Authority:", mintAccount.data.mintAuthority.toString());
  console.log("Decimals:", mintAccount.data.decimals);
  console.log("Supply:", mintAccount.data.supply.toString());

  const mintAuthority =
    mintAccount.data.mintAuthority.__option === "Some"
      ? mintAccount.data.mintAuthority.value
      : null;
  if (!mintAuthority) {
    throw new Error("Token has no mint authority set");
  }
  if (mintAuthority !== payer.address) {
    throw new Error(`Mint authority mismatch. Expected: ${payer.address}, Got: ${mintAuthority}`);
  }

  const [ata] = await findAssociatedTokenPda({
    mint,
    owner: target,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });
  console.log("Associated token account:", ata);

  const existing = await fetchMaybeToken(rpc, ata);
  if (!existing.exists) console.log("Recipient token account does not exist, creating it");
  const createAtaInstructions = existing.exists
    ? []
    : [getCreateAssociatedTokenIdempotentInstruction({ payer, ata, owner: target, mint })];
  const mintInstruction = getMintToInstruction({
    mint,
    token: ata,
    mintAuthority: payer,
    amount: BigInt(amount),
  });

  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (tx) => setTransactionMessageFeePayerSigner(payer, tx),
    (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
    (tx) => appendTransactionMessageInstructions([...createAtaInstructions, mintInstruction], tx),
  );

  console.log("Sending transaction...");
  const signed = await signTransactionMessageWithSigners(message);
  assertIsTransactionWithBlockhashLifetime(signed);
  const signature = getSignatureFromTransaction(signed);
  await sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions })(signed, {
    commitment: "confirmed",
  });

  console.log(`${symbol} tokens minted successfully!`);
  console.log("Target Public Key:", targetPublicKey);
  console.log("Amount Minted:", amount);
  console.log("Transaction Signature:", signature);

  return {
    tokenPublicKey: process.env[`${symbol}_PUBLIC_KEY`],
    tokenMetadataPda: process.env[`${symbol}_METADATA_PDA`],
    targetPublicKey,
    amount,
    associatedTokenAccount: ata,
    signature,
  };
}
