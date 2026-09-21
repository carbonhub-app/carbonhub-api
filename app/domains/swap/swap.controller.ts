import { currentUser } from "../../middlewares/auth/jwt/jwt.verify";
import type { VerificationResult } from "../../utils/auth/jwt/verify";
import type { Envelope, SetContext } from "../../types/http";
import { asBody, badRequest } from "../../types/http";

type Web3 = typeof import("@solana/web3.js");
type Connection = InstanceType<Web3["Connection"]>;

// Helper to get exchange rate from Yahoo Finance
async function getExchangeRate(): Promise<number> {
  try {
    const { default: yahooFinance } = await import("yahoo-finance2");
    const quote = await yahooFinance.quote("ECF=F");
    return quote.regularMarketPrice as number;
  } catch (error) {
    console.error("Error fetching exchange rate:", error);
    throw new Error("Failed to fetch exchange rate");
  }
}

// Lazy-load all @solana/* modules to prevent them from corrupting the
// MongoDB driver's TCP stack at startup (web3.js modifies global fetch/HTTP
// agents). These imports must stay inside the function body.
async function getSolanaEnv() {
  const web3 = await import("@solana/web3.js");
  const {
    createTransferInstruction,
    createAssociatedTokenAccountInstruction,
    getAssociatedTokenAddress,
    getAccount,
  } = await import("@solana/spl-token");
  const bs58mod = await import("bs58");
  const bs58 = bs58mod.default ?? (bs58mod as unknown as typeof bs58mod.default);

  return {
    web3,
    createTransferInstruction,
    createAssociatedTokenAccountInstruction,
    getAssociatedTokenAddress,
    getAccount,
    bs58,
    ECFCH_PUBLIC_KEY: new web3.PublicKey(process.env.ECFCH_PUBLIC_KEY as string),
    ECFCH_PRIVATE_KEY: bs58.decode(process.env.ECFCH_PRIVATE_KEY as string),
    EURCH_PUBLIC_KEY: new web3.PublicKey(process.env.EURCH_PUBLIC_KEY as string),
    EURCH_PRIVATE_KEY: bs58.decode(process.env.EURCH_PRIVATE_KEY as string),
  };
}

// Helper to try multiple RPC URLs
async function getWorkingSolanaConnection(web3: Web3, urls: string[]): Promise<Connection> {
  let rpcUrlIdx = 0;
  while (rpcUrlIdx < urls.length) {
    try {
      const connection = new web3.Connection(urls[rpcUrlIdx] as string, "confirmed");
      await connection.getEpochInfo();
      return connection;
    } catch {
      console.log(`Failed to connect to RPC URL: ${urls[rpcUrlIdx]}, trying next...`);
      rpcUrlIdx++;
    }
  }
  throw new Error("No working Solana RPC URL found");
}

/** The RPC endpoints for whichever network this deployment is pointed at. */
function rpcUrlList(): string[] {
  const SOLANA_DEVNET_RPC = JSON.parse(process.env.DEVNET_RPC_URLS as string);
  const SOLANA_MAINNET_RPC = JSON.parse(process.env.MAINNET_RPC_URLS as string);
  return process.env.SOLANA_NETWORK === "devnet" ? SOLANA_DEVNET_RPC : SOLANA_MAINNET_RPC;
}

type TokenSymbol = "ECFCH" | "EURCH";

// Calculate swap amount using real-time exchange rate
const calculateSwapAmount = async (fromToken: TokenSymbol, amount: number): Promise<number> => {
  console.log("Input values:", { fromToken, amount });
  const exchangeRate = await getExchangeRate();
  console.log("Exchange rate:", exchangeRate);
  const rawAmount = fromToken === "ECFCH" ? amount * exchangeRate : amount / exchangeRate;
  const targetToken = fromToken === "ECFCH" ? "EURCH" : "ECFCH";
  const decimals = targetToken === "ECFCH" ? 3 : 6;
  const multiplier = Math.pow(10, decimals);
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

    const {
      web3,
      createTransferInstruction,
      createAssociatedTokenAccountInstruction,
      getAssociatedTokenAddress,
      getAccount,
      bs58,
      ECFCH_PUBLIC_KEY,
      ECFCH_PRIVATE_KEY,
      EURCH_PUBLIC_KEY,
      EURCH_PRIVATE_KEY,
    } = await getSolanaEnv();

    const connection = await getWorkingSolanaConnection(web3, rpcUrlList());

    const userPubKey = new web3.PublicKey(userPublicKey);
    const fromTokenMint = fromToken === "ECFCH" ? ECFCH_PUBLIC_KEY : EURCH_PUBLIC_KEY;
    const fromTokenKeypair = fromToken === "ECFCH" ? ECFCH_PRIVATE_KEY : EURCH_PRIVATE_KEY;

    const fromKeypair = web3.Keypair.fromSecretKey(fromTokenKeypair);

    const carbonhubPrivateKey = bs58.decode(process.env.SOLANA_PRIVATE_KEY as string);
    const carbonhubKeypair = web3.Keypair.fromSecretKey(carbonhubPrivateKey);

    console.log("Creating transaction for:", {
      userPublicKey: userPubKey.toBase58(),
      fromToken,
      amount,
      fromTokenMint: fromTokenMint.toBase58(),
      fromAuthority: fromKeypair.publicKey.toBase58(),
      carbonhubAuthority: carbonhubKeypair.publicKey.toBase58(),
    });

    const userFromTokenAddress = await getAssociatedTokenAddress(fromTokenMint, userPubKey);
    const carbonhubFromTokenAddress = await getAssociatedTokenAddress(
      fromTokenMint,
      carbonhubKeypair.publicKey,
    );

    console.log("Token accounts:", {
      userFromTokenAddress: userFromTokenAddress.toBase58(),
      carbonhubFromTokenAddress: carbonhubFromTokenAddress.toBase58(),
    });

    // Check if user's token account exists and has enough balance
    try {
      const userTokenAccount = await getAccount(connection, userFromTokenAddress);
      console.log("User token account balance:", userTokenAccount.amount.toString());

      const requiredAmount = amount * (fromToken === "ECFCH" ? 10 ** 3 : 10 ** 6);
      if (BigInt(userTokenAccount.amount) < BigInt(requiredAmount)) {
        set.status = 400;
        return {
          status: "error",
          message: "Insufficient token balance",
          data: {
            required: requiredAmount,
            available: userTokenAccount.amount.toString(),
          },
        };
      }
    } catch (error) {
      console.log("User token account does not exist or error:", (error as Error).message);
      set.status = 400;
      return {
        status: "error",
        message: "User token account does not exist",
        data: {},
      };
    }

    // Check if Carbonhub's token account exists
    let needsCarbonhubAccount = false;
    try {
      await getAccount(connection, carbonhubFromTokenAddress);
      console.log("Carbonhub token account exists");
    } catch {
      console.log("Carbonhub token account does not exist");
      needsCarbonhubAccount = true;
    }

    const swapAmount = await calculateSwapAmount(fromToken, amount);
    const transferAmount = amount * (fromToken === "ECFCH" ? 10 ** 3 : 10 ** 6);

    const transferTransaction = new web3.Transaction();

    if (needsCarbonhubAccount) {
      console.log("Adding create Carbonhub account instruction");
      transferTransaction.add(
        createAssociatedTokenAccountInstruction(
          carbonhubKeypair.publicKey,
          carbonhubFromTokenAddress,
          carbonhubKeypair.publicKey,
          fromTokenMint,
        ),
      );
    }

    console.log("Adding transfer instruction:", {
      from: userFromTokenAddress.toBase58(),
      to: carbonhubFromTokenAddress.toBase58(),
      amount: transferAmount,
    });

    transferTransaction.add(
      createTransferInstruction(
        userFromTokenAddress,
        carbonhubFromTokenAddress,
        userPubKey,
        transferAmount,
      ),
    );

    const { blockhash } = await connection.getLatestBlockhash();
    transferTransaction.recentBlockhash = blockhash;
    transferTransaction.feePayer = userPubKey;

    if (needsCarbonhubAccount) {
      transferTransaction.partialSign(carbonhubKeypair);
    }

    const serializedTransaction = transferTransaction.serializeMessage().toString("base64");

    set.status = 200;
    return {
      status: "success",
      message: "Successfully create swap",
      data: {
        transaction: serializedTransaction,
        swapAmount: swapAmount / (fromToken === "ECFCH" ? 10 ** 6 : 10 ** 3),
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

    const { web3 } = await getSolanaEnv();
    const ECFCHMinter = await import("../../utils/web3/ECFCH_minter");
    const EURCHMinter = await import("../../utils/web3/EURCH_minter");

    const connection = await getWorkingSolanaConnection(web3, rpcUrlList());

    const transaction = web3.Transaction.from(Buffer.from(signedTransaction, "base64"));

    console.log("Executing transaction:", {
      feePayer: transaction.feePayer!.toBase58(),
      instructions: transaction.instructions.length,
      fromToken,
      amount,
    });

    if (!transaction.signatures.some((sig) => sig.publicKey.equals(transaction.feePayer!))) {
      set.status = 400;
      return {
        status: "error",
        message: "Transaction must be signed by the user",
        data: {},
      };
    }

    const signature = await connection.sendRawTransaction(transaction.serialize());
    console.log("Transaction sent:", signature);

    try {
      const confirmation = await connection.confirmTransaction({
        signature,
        blockhash: transaction.recentBlockhash as string,
        lastValidBlockHeight: (await connection.getLatestBlockhash()).lastValidBlockHeight,
      });
      console.log("Transaction confirmed:", confirmation);
    } catch (error) {
      console.error("Transaction confirmation error:", error);
      if ((error as { logs?: string[] }).logs) {
        console.error("Transaction logs:", (error as { logs?: string[] }).logs);
      }
      throw error;
    }

    const swapAmount = await calculateSwapAmount(fromToken, amount);

    let mintResult;
    if (fromToken === "ECFCH") {
      mintResult = await EURCHMinter.mint(transaction.feePayer!.toBase58(), swapAmount);
    } else {
      mintResult = await ECFCHMinter.mint(transaction.feePayer!.toBase58(), swapAmount);
    }

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
    if ((err as { logs?: string[] }).logs) {
      console.error("Transaction logs:", (err as { logs?: string[] }).logs);
    }
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

    const { web3, getAssociatedTokenAddress, getAccount, ECFCH_PUBLIC_KEY, EURCH_PUBLIC_KEY } =
      await getSolanaEnv();

    const connection = await getWorkingSolanaConnection(web3, rpcUrlList());

    const userPubKey = new web3.PublicKey(userPublicKey);

    console.log("Getting balances for:", {
      userPublicKey: userPubKey.toBase58(),
      ECFCHMint: ECFCH_PUBLIC_KEY.toBase58(),
      EURCHMint: EURCH_PUBLIC_KEY.toBase58(),
    });

    const userECFCHAddress = await getAssociatedTokenAddress(ECFCH_PUBLIC_KEY, userPubKey);
    const userEURCHAddress = await getAssociatedTokenAddress(EURCH_PUBLIC_KEY, userPubKey);

    console.log("Token accounts:", {
      userECFCHAddress: userECFCHAddress.toBase58(),
      userEURCHAddress: userEURCHAddress.toBase58(),
    });

    let ecfchBalance = 0;
    try {
      const ecfchAccount = await getAccount(connection, userECFCHAddress);
      ecfchBalance = Number(ecfchAccount.amount) / 10 ** 3;
      console.log("ECFCH balance:", ecfchBalance);
    } catch (error) {
      console.log("ECFCH account does not exist or error:", (error as Error).message);
    }

    let eurchBalance = 0;
    try {
      const eurchAccount = await getAccount(connection, userEURCHAddress);
      eurchBalance = Number(eurchAccount.amount) / 10 ** 6;
      console.log("EURCH balance:", eurchBalance);
    } catch (error) {
      console.log("EURCH account does not exist or error:", (error as Error).message);
    }

    set.status = 200;
    return {
      status: "success",
      message: "Successfully get balance",
      data: {
        ECFCH: {
          balance: ecfchBalance,
          decimals: 3,
          mint: ECFCH_PUBLIC_KEY.toBase58(),
        },
        EURCH: {
          balance: eurchBalance,
          decimals: 6,
          mint: EURCH_PUBLIC_KEY.toBase58(),
        },
      },
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
