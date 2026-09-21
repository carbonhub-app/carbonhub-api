// CarbonHub's European Carbon Credits for Carbon Trading

import { mintTo, type MintResult } from "./token-minter";

export const mint = (targetPublicKey: string, amount: number): Promise<MintResult> =>
  mintTo("ECFCH", targetPublicKey, amount);
