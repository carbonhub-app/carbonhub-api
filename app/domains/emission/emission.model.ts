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

export interface MeasurementDocument extends mongoose.Document {
  company: mongoose.Types.ObjectId;
  time: Date;
  ppm: number;
  ton: number;
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

// One row per reading, so a replayed batch is rejected by the unique index
// instead of being added on top of the totals it already produced.
const measurementSchema = new mongoose.Schema<MeasurementDocument>({
  company: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },
  time: { type: Date, required: true },
  ppm: { type: Number, required: true },
  ton: { type: Number, required: true },
});

measurementSchema.index({ company: 1, time: 1 }, { unique: true });

const Measurement = mongoose.model<MeasurementDocument>("Measurement", measurementSchema);

export { Company, Measurement };
