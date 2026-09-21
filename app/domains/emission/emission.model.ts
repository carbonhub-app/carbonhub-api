import mongoose from "mongoose";
import { randomUUID } from "node:crypto";

export interface QuotaWithdrawal {
  amount: number;
  time: Date;
}

export interface AnnualEmission {
  year: string;
  totalTon: number;
}

export interface MonthlyEmission {
  month: string;
  totalTon: number;
}

export interface DailyEmission {
  date: string;
  totalTon: number;
}

export interface EmissionReport {
  ppm: number;
  ton: number;
  time: Date;
}

export interface CompanyDocument extends mongoose.Document {
  publicKey?: string;
  name: string;
  apiKey: string;
  quotaWithdrawal: mongoose.Types.DocumentArray<QuotaWithdrawal & mongoose.Types.Subdocument>;
  emissions: {
    annual: mongoose.Types.DocumentArray<AnnualEmission & mongoose.Types.Subdocument>;
    monthly: mongoose.Types.DocumentArray<MonthlyEmission & mongoose.Types.Subdocument>;
    daily: mongoose.Types.DocumentArray<DailyEmission & mongoose.Types.Subdocument>;
  };
  reports: mongoose.Types.DocumentArray<EmissionReport & mongoose.Types.Subdocument>;
}

const companySchema = new mongoose.Schema<CompanyDocument>({
  publicKey: { type: String, required: false },
  name: { type: String, required: true },
  apiKey: { type: String, required: true, default: randomUUID },
  quotaWithdrawal: [
    {
      amount: { type: Number, required: true },
      time: { type: Date, required: true },
    },
  ],
  emissions: {
    annual: [
      {
        year: { type: String, required: true },
        totalTon: { type: Number, required: true },
      },
    ],
    monthly: [
      {
        month: { type: String, required: true },
        totalTon: { type: Number, required: true },
      },
    ],
    daily: [
      {
        date: { type: String, required: true },
        totalTon: { type: Number, required: true },
      },
    ],
  },
  reports: [
    {
      ppm: { type: Number, required: true },
      ton: { type: Number, required: true },
      time: { type: Date, required: true },
    },
  ],
});

const Company = mongoose.model<CompanyDocument>("Company", companySchema);

export { Company };
