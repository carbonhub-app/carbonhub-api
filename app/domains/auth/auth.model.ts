import mongoose from "mongoose";

export type AccountType = "user" | "company";

export interface AuthDocument extends mongoose.Document {
  publicKey: string;
  type: AccountType;
  latestChallenge?: string;
}

const authSchema = new mongoose.Schema<AuthDocument>({
  publicKey: { type: String, required: true },
  type: { type: String, enum: ["user", "company"], required: true },
  latestChallenge: { type: String, required: false },
});

const Auth = mongoose.model<AuthDocument>("Auth", authSchema);

export { Auth };
