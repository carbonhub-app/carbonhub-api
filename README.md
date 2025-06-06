# CarbonHub Core

A decentralized integrated carbon trading solution built on the Solana blockchain. CarbonHub Core provides a robust API for managing carbon credits, emissions tracking, and token swaps between different carbon credit types.

## 🚀 Features

- Decentralized carbon credit trading
- Real-time emissions tracking and reporting
- Token swaps between ECFCH and EURCH
- Secure authentication using Solana wallet signatures
- Carbon quota management
- Integration with Yahoo Finance for market data
- Interactive price charts with TradingView integration

## 🛠 Tech Stack

- **Backend Framework**: Node.js with Express.js
- **Blockchain**: Solana
- **Token Standards**: SPL Token
- **Database**: MongoDB
- **Authentication**: JWT with Solana wallet signatures
- **API Documentation**: OpenAPI 3.0
- **Market Data**: Yahoo Finance API
- **Charting**: TradingView Charts Embed

## 📦 Installation

1. Clone the repository:
```bash
git clone https://github.com/carbonhub-app/carbonhub-core.git
cd carbonhub-core
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file with the following variables:
```env
MONGODB_URI=your_mongodb_uri
JWT_SECRET=your_jwt_secret
SOLANA_RPC_URL=your_solana_rpc_url
```

4. Start the development server:
```bash
npm run dev
```

## 🔑 API Endpoints

### Authentication

#### Request Challenge
- **POST** `/auth/request-challenge`
- Creates an authentication challenge for wallet signature
- Required fields:
  - `publicKey`: User's Solana public key
  - `type`: Authentication type (user/company)

#### Verify Signature
- **POST** `/auth/verify-signature`
- Verifies the challenge signature and returns JWT token
- Required fields:
  - `publicKey`: User's Solana public key
  - `challenge`: Challenge string
  - `signature`: Base64 encoded signature

### Token Swaps

#### Create Swap
- **POST** `/swap/create`
- Creates a new token swap transaction
- Required fields:
  - `userPublicKey`: User's Solana public key
  - `fromToken`: Token to swap from (ECFCH/EURCH)
  - `amount`: Amount to swap

#### Execute Swap
- **POST** `/swap/execute`
- Executes a signed swap transaction
- Required fields:
  - `signedTransaction`: Base64 encoded signed transaction
  - `fromToken`: Token that was swapped from
  - `amount`: Amount that was swapped

#### Get Balance
- **GET** `/swap/balance`
- Retrieves token balances for both ECFCH and EURCH

#### Get Price
- **GET** `/swap/price`
- Retrieves current exchange rate between ECFCH and EURCH

### Emissions

#### Collect Emissions
- **POST** `/emissions/collect`
- Records new emission measurements
- Required fields:
  - `ppm`: Parts per million of CO2
  - `time`: Time of emission measurement

#### Report Emissions
- **POST** `/emissions/report`
- Generates emission reports
- Required fields:
  - `ppm`: Parts per million of CO2
  - `time`: Time of emission measurement

#### Withdraw Emissions
- **POST** `/emissions/withdraw`
- Withdraws carbon quota
- Required fields:
  - `amount`: Amount of carbon quota to withdraw

## 🔒 Security

- All sensitive endpoints are protected with JWT authentication
- Wallet-based authentication using Solana signatures
- Secure token management using SPL Token standards