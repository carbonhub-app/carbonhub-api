import { currentUser } from "../../middlewares/auth/jwt/jwt.verify";
import type { VerificationResult } from "../../utils/auth/jwt/verify";
import type { Envelope, SetContext } from "../../types/http";
import { asBody, badRequest } from "../../types/http";
import { TOKEN_DECIMALS, type TokenSymbol } from "../../utils/web3/solana";

// The carbon price moves slowly, so a short cache is plenty fresh and keeps
// the trading page's polling well clear of Capital.com's rate limit.
const RATE_TTL_MS = 60 * 1000;
const FALLBACK_RATE = 80;

let cachedRate: { price: number; at: number } | null = null;

// Helper to get exchange rate from the carbon market
async function getExchangeRate(): Promise<number> {
  if (cachedRate && Date.now() - cachedRate.at < RATE_TTL_MS) {
    return cachedRate.price;
  }

  try {
    const { getLiveCarbonPriceEur } = await import("../../utils/market/carbon");
    const price = await getLiveCarbonPriceEur();
    cachedRate = { price, at: Date.now() };
    return price;
  } catch (error) {
    console.error("Error fetching exchange rate:", error);

    // Losing the feed for a moment should not take the trading page down with
    // it, so serve the last price we saw rather than failing the request.
    if (cachedRate) {
      const ageSeconds = Math.round((Date.now() - cachedRate.at) / 1000);
      console.warn(
        `Serving a STALE exchange rate of ${cachedRate.price} from ${ageSeconds}s ago`,
      );
      return cachedRate.price;
    }

    const seeded = Number(process.env.EUA_EUR_FALLBACK_PRICE) || FALLBACK_RATE;
    console.warn(
      `Serving a PLACEHOLDER exchange rate of ${seeded}; no live price has been fetched yet`,
    );
    return seeded;
  }
}

// The solana modules are loaded at call time rather than at import time. This
// was originally required because web3.js v1 replaced global fetch on load and
// broke the mongodb driver; it is kept under kit so startup stays free of any
// chain dependency.
async function solana() {
  const kit = await import("@solana/kit");
  const token = await import("@solana-program/token");
  const helpers = await import("../../utils/web3/solana");
  return { kit, token, helpers };
}

const unit = (symbol: TokenSymbol) => 10 ** TOKEN_DECIMALS[symbol];

// Calculate swap amount using real-time exchange rate
const calculateSwapAmount = async (fromToken: TokenSymbol, amount: number): Promise<number> => {
  console.log("Input values:", { fromToken, amount });
  const exchangeRate = await getExchangeRate();
  console.log("Exchange rate:", exchangeRate);
  const rawAmount = fromToken === "ECFCH" ? amount * exchangeRate : amount / exchangeRate;
  const targetToken: TokenSymbol = fromToken === "ECFCH" ? "EURCH" : "ECFCH";
  const multiplier = unit(targetToken);
  const roundedAmount = Math.round(rawAmount * multiplier) / multiplier;
  const finalAmount = Math.floor(roundedAmount * multiplier);
  console.log("Final integer amount:", finalAmount);
  return finalAmount;
};

interface CreateBody {
  userPublicKey?: string;
  fromToken?: TokenSymbol;
  amount?: number;
}

export const create = async ({
  body,
  set,
}: {
  body: unknown;
  set: SetContext;
}): Promise<Envelope> => {
  try {
    const { userPublicKey, fromToken, amount } = asBody<CreateBody>(body);

    if (!userPublicKey || !fromToken || !amount) {
      const invalidItems: string[] = [];
      if (!userPublicKey) invalidItems.push('"userPublicKey"');
      if (!fromToken) invalidItems.push('"fromToken"');
      if (!amount) invalidItems.push('"amount"');
      set.status = 400;
      return {
        status: "error",
        message: `Parameter ${invalidItems.join(", ")} required`,
        data: {},
      };
    }

    const { kit, token, helpers } = await solana();
    const { rpc } = await helpers.getWorkingSolanaConnection();

    const userAddress = kit.address(userPublicKey);
    const fromTokenMint = helpers.tokenMint(fromToken);
    const carbonhub = await helpers.carbonhubSigner();

    console.log("Creating transaction for:", {
      userPublicKey: userAddress,
      fromToken,
      amount,
      fromTokenMint,
      carbonhubAuthority: carbonhub.address,
    });

    const [userFromTokenAddress] = await token.findAssociatedTokenPda({
      mint: fromTokenMint,
      owner: userAddress,
      tokenProgram: token.TOKEN_PROGRAM_ADDRESS,
    });
    const [carbonhubFromTokenAddress] = await token.findAssociatedTokenPda({
      mint: fromTokenMint,
      owner: carbonhub.address,
      tokenProgram: token.TOKEN_PROGRAM_ADDRESS,
    });

    console.log("Token accounts:", {
      userFromTokenAddress,
      carbonhubFromTokenAddress,
    });

    // Check if user's token account exists and has enough balance
    const userTokenAccount = await token.fetchMaybeToken(rpc, userFromTokenAddress);
    if (!userTokenAccount.exists) {
      console.log("User token account does not exist");
      set.status = 400;
      return {
        status: "error",
        message: "User token account does not exist",
        data: {},
      };
    }

    console.log("User token account balance:", userTokenAccount.data.amount.toString());
    const requiredAmount = amount * unit(fromToken);
    if (userTokenAccount.data.amount < BigInt(requiredAmount)) {
      set.status = 400;
      return {
        status: "error",
        message: "Insufficient token balance",
        data: {
          required: requiredAmount,
          available: userTokenAccount.data.amount.toString(),
        },
      };
    }

    // Check if Carbonhub's token account exists
    const carbonhubTokenAccount = await token.fetchMaybeToken(rpc, carbonhubFromTokenAddress);
    const needsCarbonhubAccount = !carbonhubTokenAccount.exists;
    console.log(
      needsCarbonhubAccount
        ? "Carbonhub token account does not exist"
        : "Carbonhub token account exists",
    );

    const swapAmount = await calculateSwapAmount(fromToken, amount);
    const transferAmount = amount * unit(fromToken);

    if (needsCarbonhubAccount) console.log("Adding create Carbonhub account instruction");
    const createAtaInstructions = needsCarbonhubAccount
      ? [
          token.getCreateAssociatedTokenIdempotentInstruction({
            payer: carbonhub,
            ata: carbonhubFromTokenAddress,
            owner: carbonhub.address,
            mint: fromTokenMint,
          }),
        ]
      : [];

    console.log("Adding transfer instruction:", {
      from: userFromTokenAddress,
      to: carbonhubFromTokenAddress,
      amount: transferAmount,
    });
    const transferInstruction = token.getTransferInstruction({
      source: userFromTokenAddress,
      destination: carbonhubFromTokenAddress,
      authority: userAddress,
      amount: BigInt(transferAmount),
    });

    const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
    const message = kit.pipe(
      kit.createTransactionMessage({ version: 0 }),
      (tx) => kit.setTransactionMessageFeePayer(userAddress, tx),
      (tx) => kit.setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
      (tx) =>
        kit.appendTransactionMessageInstructions(
          [...createAtaInstructions, transferInstruction],
          tx,
        ),
    );

    // Carbonhub co-signs up front when it is paying to open its own account;
    // the user's wallet supplies the remaining signature.
    const compiled = kit.compileTransaction(message);
    const prepared = needsCarbonhubAccount
      ? await kit.partiallySignTransaction([carbonhub.keyPair], compiled)
      : compiled;

    const serializedTransaction = kit.getBase64EncodedWireTransaction(prepared);

    set.status = 200;
    return {
      status: "success",
      message: "Successfully create swap",
      data: {
        transaction: serializedTransaction,
        swapAmount: swapAmount / unit(fromToken === "ECFCH" ? "EURCH" : "ECFCH"),
        fromToken,
        toToken: fromToken === "ECFCH" ? "EURCH" : "ECFCH",
        needsCarbonhubAccount,
      },
    };
  } catch (err) {
    console.error("Error in create:", err);
    return badRequest(set, err);
  }
};

interface ExecuteBody {
  signedTransaction?: string;
  fromToken?: TokenSymbol;
  amount?: number;
}

export const execute = async ({
  body,
  set,
}: {
  body: unknown;
  set: SetContext;
}): Promise<Envelope> => {
  try {
    const { signedTransaction, fromToken, amount } = asBody<ExecuteBody>(body);

    if (!signedTransaction || !fromToken || !amount) {
      const invalidItems: string[] = [];
      if (!signedTransaction) invalidItems.push('"signedTransaction"');
      if (!fromToken) invalidItems.push('"fromToken"');
      if (!amount) invalidItems.push('"amount"');
      set.status = 400;
      return {
        status: "error",
        message: `Parameter ${invalidItems.join(", ")} required`,
        data: {},
      };
    }

    const { kit, helpers } = await solana();
    const { mintTo } = await import("../../utils/web3/token-minter");
    const { rpc, rpcSubscriptions } = await helpers.getWorkingSolanaConnection();

    const transaction = kit
      .getTransactionDecoder()
      .decode(kit.getBase64Encoder().encode(signedTransaction));

    const signatures = transaction.signatures as Record<string, Uint8Array | null>;
    const feePayer = Object.keys(signatures)[0];
    console.log("Executing transaction:", {
      feePayer,
      signers: Object.keys(signatures).length,
      fromToken,
      amount,
    });

    if (!feePayer || signatures[feePayer] == null) {
      set.status = 400;
      return {
        status: "error",
        message: "Transaction must be signed by the user",
        data: {},
      };
    }

    const signature = kit.getSignatureFromTransaction(transaction);
    const sendAndConfirm = kit.sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });
    // The message was built with a blockhash lifetime before it went to the
    // wallet, and decoding preserves it; the send call rejects it otherwise.
    await sendAndConfirm(transaction as Parameters<typeof sendAndConfirm>[0], {
      commitment: "confirmed",
    });
    console.log("Transaction confirmed:", signature);

    const swapAmount = await calculateSwapAmount(fromToken, amount);
    const mintResult = await mintTo(
      fromToken === "ECFCH" ? "EURCH" : "ECFCH",
      feePayer,
      swapAmount,
    );

    set.status = 200;
    return {
      status: "success",
      message: "Successfully execute swap",
      data: {
        signature,
        mintResult,
      },
    };
  } catch (err) {
    console.error("Error in execute:", err);
    return badRequest(set, err);
  }
};

export const balance = async ({
  verification,
  set,
}: {
  verification: VerificationResult | null;
  set: SetContext;
}): Promise<Envelope> => {
  try {
    const userPublicKey = currentUser(verification)?.publicKey;
    if (!userPublicKey) {
      set.status = 400;
      return {
        status: "error",
        message: "User public key not found",
        data: {},
      };
    }

    const { kit, token, helpers } = await solana();
    const { rpc } = await helpers.getWorkingSolanaConnection();
    const userAddress = kit.address(userPublicKey);

    const balances: Record<string, { balance: number; decimals: number; mint: string }> = {};
    for (const symbol of ["ECFCH", "EURCH"] as TokenSymbol[]) {
      const mint = helpers.tokenMint(symbol);
      const [ata] = await token.findAssociatedTokenPda({
        mint,
        owner: userAddress,
        tokenProgram: token.TOKEN_PROGRAM_ADDRESS,
      });
      const account = await token.fetchMaybeToken(rpc, ata);
      const value = account.exists ? Number(account.data.amount) / unit(symbol) : 0;
      console.log(`${symbol} balance:`, value);
      balances[symbol] = { balance: value, decimals: TOKEN_DECIMALS[symbol], mint };
    }

    set.status = 200;
    return {
      status: "success",
      message: "Successfully get balance",
      data: balances,
    };
  } catch (err) {
    console.error("Error in balance:", err);
    return badRequest(set, err);
  }
};

export const price = async ({ set }: { set: SetContext }): Promise<Envelope> => {
  try {
    const exchangeRate = await getExchangeRate();
    set.status = 200;
    return {
      status: "success",
      message: "Successfully get price",
      data: {
        price: exchangeRate,
      },
    };
  } catch (err) {
    console.error("Error in price:", err);
    return badRequest(set, err);
  }
};
