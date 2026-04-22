// Helper to get exchange rate from Yahoo Finance
async function getExchangeRate() {
    try {
        const { default: yahooFinance } = await import('yahoo-finance2');
        const quote = await yahooFinance.quote('ECF=F');
        return quote.regularMarketPrice;
    } catch (error) {
        console.error('Error fetching exchange rate:', error);
        throw new Error('Failed to fetch exchange rate');
    }
}

// Lazy-load all @solana/* modules to prevent them from corrupting the
// MongoDB driver's TCP stack at startup (web3.js modifies global fetch/HTTP agents).
function getSolanaEnv() {
    const web3 = require('@solana/web3.js');
    const { createTransferInstruction, createAssociatedTokenAccountInstruction, getAssociatedTokenAddress, getAccount } = require('@solana/spl-token');
    const bs58 = require('bs58');
    return {
        web3,
        createTransferInstruction,
        createAssociatedTokenAccountInstruction,
        getAssociatedTokenAddress,
        getAccount,
        bs58,
        ECFCH_PUBLIC_KEY: new web3.PublicKey(process.env.ECFCH_PUBLIC_KEY),
        ECFCH_PRIVATE_KEY: bs58.default.decode(process.env.ECFCH_PRIVATE_KEY),
        EURCH_PUBLIC_KEY: new web3.PublicKey(process.env.EURCH_PUBLIC_KEY),
        EURCH_PRIVATE_KEY: bs58.default.decode(process.env.EURCH_PRIVATE_KEY),
    };
}

// Helper to try multiple RPC URLs
async function getWorkingSolanaConnection(web3, urls) {
    let rpcUrlIdx = 0;
    while (rpcUrlIdx < urls.length) {
        try {
            const connection = new web3.Connection(urls[rpcUrlIdx], 'confirmed');
            await connection.getEpochInfo();
            return connection;
        } catch (e) {
            console.log(`Failed to connect to RPC URL: ${urls[rpcUrlIdx]}, trying next...`);
            rpcUrlIdx++;
        }
    }
    throw new Error('No working Solana RPC URL found');
}

// Calculate swap amount using real-time exchange rate
const calculateSwapAmount = async (fromToken, amount) => {
    console.log('Input values:', { fromToken, amount });
    const exchangeRate = await getExchangeRate();
    console.log('Exchange rate:', exchangeRate);
    const rawAmount = fromToken === 'ECFCH' ? amount * exchangeRate : amount / exchangeRate;
    const targetToken = fromToken === 'ECFCH' ? 'EURCH' : 'ECFCH';
    const decimals = targetToken === 'ECFCH' ? 3 : 6;
    const multiplier = Math.pow(10, decimals);
    const roundedAmount = Math.round(rawAmount * multiplier) / multiplier;
    const finalAmount = Math.floor(roundedAmount * multiplier);
    console.log('Final integer amount:', finalAmount);
    return finalAmount;
};

const create = async (req, res) => {
    try {
        const { userPublicKey, fromToken, amount } = req.body;

        if (!userPublicKey || !fromToken || !amount) {
            let invalidItems = [];
            if (!userPublicKey) invalidItems.push('"userPublicKey"');
            if (!fromToken) invalidItems.push('"fromToken"');
            if (!amount) invalidItems.push('"amount"');
            return res.status(400).json({
                status: 'error',
                message: `Parameter ${invalidItems.join(", ")} required`,
                data: {}
            });
        }

        const { web3, createTransferInstruction, createAssociatedTokenAccountInstruction, getAssociatedTokenAddress, getAccount, bs58, ECFCH_PUBLIC_KEY, ECFCH_PRIVATE_KEY, EURCH_PUBLIC_KEY, EURCH_PRIVATE_KEY } = getSolanaEnv();

        // Load RPC URLs from env
        const SOLANA_DEVNET_RPC = JSON.parse(process.env.DEVNET_RPC_URLS);
        const SOLANA_MAINNET_RPC = JSON.parse(process.env.MAINNET_RPC_URLS);
        const RPC_URL_LIST = process.env.SOLANA_NETWORK === "devnet" ? SOLANA_DEVNET_RPC : SOLANA_MAINNET_RPC;

        const connection = await getWorkingSolanaConnection(web3, RPC_URL_LIST);

        const userPubKey = new web3.PublicKey(userPublicKey);
        const fromTokenMint = fromToken === 'ECFCH' ? ECFCH_PUBLIC_KEY : EURCH_PUBLIC_KEY;
        const toTokenMint = fromToken === 'ECFCH' ? EURCH_PUBLIC_KEY : ECFCH_PUBLIC_KEY;
        const fromTokenKeypair = fromToken === 'ECFCH' ? ECFCH_PRIVATE_KEY : EURCH_PRIVATE_KEY;
        const toTokenKeypair = fromToken === 'ECFCH' ? EURCH_PRIVATE_KEY : ECFCH_PRIVATE_KEY;

        const fromKeypair = web3.Keypair.fromSecretKey(fromTokenKeypair);
        const toKeypair = web3.Keypair.fromSecretKey(toTokenKeypair);

        const carbonhubPrivateKey = bs58.default.decode(process.env.SOLANA_PRIVATE_KEY);
        const carbonhubKeypair = web3.Keypair.fromSecretKey(carbonhubPrivateKey);

        console.log('Creating transaction for:', {
            userPublicKey: userPubKey.toBase58(),
            fromToken,
            amount,
            fromTokenMint: fromTokenMint.toBase58(),
            fromAuthority: fromKeypair.publicKey.toBase58(),
            carbonhubAuthority: carbonhubKeypair.publicKey.toBase58()
        });

        const userFromTokenAddress = await getAssociatedTokenAddress(
            fromTokenMint,
            userPubKey
        );

        const carbonhubFromTokenAddress = await getAssociatedTokenAddress(
            fromTokenMint,
            carbonhubKeypair.publicKey
        );

        console.log('Token accounts:', {
            userFromTokenAddress: userFromTokenAddress.toBase58(),
            carbonhubFromTokenAddress: carbonhubFromTokenAddress.toBase58()
        });

        // Check if user's token account exists and has enough balance
        try {
            const userTokenAccount = await getAccount(connection, userFromTokenAddress);
            console.log('User token account balance:', userTokenAccount.amount.toString());

            const requiredAmount = amount * (fromToken === 'ECFCH' ? 10 ** 3 : 10 ** 6);
            if (BigInt(userTokenAccount.amount) < BigInt(requiredAmount)) {
                return res.status(400).json({
                    status: 'error',
                    message: 'Insufficient token balance',
                    data: {
                        required: requiredAmount,
                        available: userTokenAccount.amount.toString()
                    }
                });
            }
        } catch (error) {
            console.log('User token account does not exist or error:', error.message);
            return res.status(400).json({
                status: 'error',
                message: 'User token account does not exist',
                data: {}
            });
        }

        // Check if Carbonhub's token account exists
        let needsCarbonhubAccount = false;
        try {
            await getAccount(connection, carbonhubFromTokenAddress);
            console.log('Carbonhub token account exists');
        } catch (error) {
            console.log('Carbonhub token account does not exist');
            needsCarbonhubAccount = true;
        }

        const swapAmount = await calculateSwapAmount(fromToken, amount);
        const transferAmount = amount * (fromToken === 'ECFCH' ? 10 ** 3 : 10 ** 6);

        const transferTransaction = new web3.Transaction();

        if (needsCarbonhubAccount) {
            console.log('Adding create Carbonhub account instruction');
            transferTransaction.add(
                createAssociatedTokenAccountInstruction(
                    carbonhubKeypair.publicKey,
                    carbonhubFromTokenAddress,
                    carbonhubKeypair.publicKey,
                    fromTokenMint
                )
            );
        }

        console.log('Adding transfer instruction:', {
            from: userFromTokenAddress.toBase58(),
            to: carbonhubFromTokenAddress.toBase58(),
            amount: transferAmount
        });

        transferTransaction.add(
            createTransferInstruction(
                userFromTokenAddress,
                carbonhubFromTokenAddress,
                userPubKey,
                transferAmount
            )
        );

        const { blockhash } = await connection.getLatestBlockhash();
        transferTransaction.recentBlockhash = blockhash;
        transferTransaction.feePayer = userPubKey;

        if (needsCarbonhubAccount) {
            transferTransaction.partialSign(carbonhubKeypair);
        }

        const serializedTransaction = transferTransaction.serializeMessage().toString('base64');

        res.status(200).json({
            status: "success",
            message: "Successfully create swap",
            data: {
                transaction: serializedTransaction,
                swapAmount: swapAmount / (fromToken === 'ECFCH' ? 10 ** 6 : 10 ** 3),
                fromToken,
                toToken: fromToken === 'ECFCH' ? 'EURCH' : 'ECFCH',
                needsCarbonhubAccount
            }
        });
    } catch (err) {
        console.error('Error in create:', err);
        return res.status(400).json({
            status: 'error',
            message: process.env.DEBUG ? err.message : "Bad Request",
            data: {}
        });
    }
};

const execute = async (req, res) => {
    try {
        const { signedTransaction, fromToken, amount } = req.body;

        if (!signedTransaction || !fromToken || !amount) {
            let invalidItems = [];
            if (!signedTransaction) invalidItems.push('"signedTransaction"');
            if (!fromToken) invalidItems.push('"fromToken"');
            if (!amount) invalidItems.push('"amount"');
            return res.status(400).json({
                status: 'error',
                message: `Parameter ${invalidItems.join(", ")} required`,
                data: {}
            });
        }

        const { web3 } = getSolanaEnv();
        const ECFCHMinter = require('../../utils/web3/ECFCH_minter');
        const EURCHMinter = require('../../utils/web3/EURCH_minter');

        const SOLANA_DEVNET_RPC = JSON.parse(process.env.DEVNET_RPC_URLS);
        const SOLANA_MAINNET_RPC = JSON.parse(process.env.MAINNET_RPC_URLS);
        const RPC_URL_LIST = process.env.SOLANA_NETWORK === "devnet" ? SOLANA_DEVNET_RPC : SOLANA_MAINNET_RPC;

        const connection = await getWorkingSolanaConnection(web3, RPC_URL_LIST);

        const transaction = web3.Transaction.from(
            Buffer.from(signedTransaction, 'base64')
        );

        console.log('Executing transaction:', {
            feePayer: transaction.feePayer.toBase58(),
            instructions: transaction.instructions.length,
            fromToken,
            amount
        });

        if (!transaction.signatures.some(sig => sig.publicKey.equals(transaction.feePayer))) {
            return res.status(400).json({
                status: 'error',
                message: 'Transaction must be signed by the user',
                data: {}
            });
        }

        const signature = await connection.sendRawTransaction(transaction.serialize());
        console.log('Transaction sent:', signature);

        try {
            const confirmation = await connection.confirmTransaction({
                signature,
                blockhash: transaction.recentBlockhash,
                lastValidBlockHeight: (await connection.getLatestBlockhash()).lastValidBlockHeight
            });
            console.log('Transaction confirmed:', confirmation);
        } catch (error) {
            console.error('Transaction confirmation error:', error);
            if (error.logs) {
                console.error('Transaction logs:', error.logs);
            }
            throw error;
        }

        const swapAmount = await calculateSwapAmount(fromToken, amount);

        let mintResult;
        if (fromToken === 'ECFCH') {
            mintResult = await EURCHMinter.mint(transaction.feePayer.toBase58(), swapAmount);
        } else {
            mintResult = await ECFCHMinter.mint(transaction.feePayer.toBase58(), swapAmount);
        }

        res.status(200).json({
            status: "success",
            message: "Successfully execute swap",
            data: {
                signature,
                mintResult
            }
        });
    } catch (err) {
        console.error('Error in execute:', err);
        if (err.logs) {
            console.error('Transaction logs:', err.logs);
        }
        return res.status(400).json({
            status: 'error',
            message: process.env.DEBUG ? err.message : "Bad Request",
            data: {}
        });
    }
};

const balance = async (req, res) => {
    try {
        const userPublicKey = req.user.publicKey;
        if (!userPublicKey) {
            return res.status(400).json({
                status: 'error',
                message: 'User public key not found',
                data: {}
            });
        }

        const { web3, getAssociatedTokenAddress, getAccount, ECFCH_PUBLIC_KEY, EURCH_PUBLIC_KEY } = getSolanaEnv();

        const SOLANA_DEVNET_RPC = JSON.parse(process.env.DEVNET_RPC_URLS);
        const SOLANA_MAINNET_RPC = JSON.parse(process.env.MAINNET_RPC_URLS);
        const RPC_URL_LIST = process.env.SOLANA_NETWORK === "devnet" ? SOLANA_DEVNET_RPC : SOLANA_MAINNET_RPC;

        const connection = await getWorkingSolanaConnection(web3, RPC_URL_LIST);

        const userPubKey = new web3.PublicKey(userPublicKey);

        console.log('Getting balances for:', {
            userPublicKey: userPubKey.toBase58(),
            ECFCHMint: ECFCH_PUBLIC_KEY.toBase58(),
            EURCHMint: EURCH_PUBLIC_KEY.toBase58()
        });

        const userECFCHAddress = await getAssociatedTokenAddress(ECFCH_PUBLIC_KEY, userPubKey);
        const userEURCHAddress = await getAssociatedTokenAddress(EURCH_PUBLIC_KEY, userPubKey);

        console.log('Token accounts:', {
            userECFCHAddress: userECFCHAddress.toBase58(),
            userEURCHAddress: userEURCHAddress.toBase58()
        });

        let ecfchBalance = 0;
        try {
            const ecfchAccount = await getAccount(connection, userECFCHAddress);
            ecfchBalance = Number(ecfchAccount.amount) / (10 ** 3);
            console.log('ECFCH balance:', ecfchBalance);
        } catch (error) {
            console.log('ECFCH account does not exist or error:', error.message);
        }

        let eurchBalance = 0;
        try {
            const eurchAccount = await getAccount(connection, userEURCHAddress);
            eurchBalance = Number(eurchAccount.amount) / (10 ** 6);
            console.log('EURCH balance:', eurchBalance);
        } catch (error) {
            console.log('EURCH account does not exist or error:', error.message);
        }

        res.status(200).json({
            status: "success",
            message: "Successfully get balance",
            data: {
                ECFCH: {
                    balance: ecfchBalance,
                    decimals: 3,
                    mint: ECFCH_PUBLIC_KEY.toBase58()
                },
                EURCH: {
                    balance: eurchBalance,
                    decimals: 6,
                    mint: EURCH_PUBLIC_KEY.toBase58()
                }
            }
        });
    } catch (err) {
        console.error('Error in balance:', err);
        return res.status(400).json({
            status: 'error',
            message: process.env.DEBUG ? err.message : "Bad Request",
            data: {}
        });
    }
};

const price = async (req, res) => {
    try {
        const exchangeRate = await getExchangeRate();
        res.status(200).json({
            status: "success",
            message: "Successfully get price",
            data: {
                price: exchangeRate
            }
        });
    } catch (err) {
        console.error('Error in price:', err);
        return res.status(400).json({
            status: 'error',
            message: process.env.DEBUG ? err.message : "Bad Request",
            data: {}
        });
    }
};

module.exports = {
    create,
    execute,
    balance,
    price
};
