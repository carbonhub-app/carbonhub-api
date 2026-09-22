import mongoose from "mongoose";

export interface SwapExecutionDocument extends mongoose.Document {
  signature: string;
  publicKey: string;
  fromToken: string;
  amount: number;
  mintResult?: Record<string, unknown>;
}

// One row per executed swap. The unique index on the transaction signature is
// what stops the same transfer being paid out more than once, which nothing
// else does: two requests carrying the same signed transaction can both reach
// the network before either has landed.
const swapExecutionSchema = new mongoose.Schema<SwapExecutionDocument>({
  signature: { type: String, required: true, unique: true },
  publicKey: { type: String, required: true },
  fromToken: { type: String, required: true },
  amount: { type: Number, required: true },
  mintResult: { type: mongoose.Schema.Types.Mixed, required: false },
});

const SwapExecution = mongoose.model<SwapExecutionDocument>("SwapExecution", swapExecutionSchema);

export { SwapExecution };
