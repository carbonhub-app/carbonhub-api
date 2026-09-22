import { Company, Measurement } from "./emission.model";
import type { CompanyDocument } from "./emission.model";
import { currentUser } from "../../middlewares/auth/jwt/jwt.verify";
import type { VerificationResult } from "../../utils/auth/jwt/verify";
import type { Envelope, SetContext } from "../../types/http";
import { asBody, badRequest } from "../../types/http";

const CO2_MOLAR_MASS = 44; // g/mol
const AIR_MOLAR_MASS = 29; // g/mol
const AIR_DENSITY = 1.2; // kg/m3

// Air passing the sensor over the interval one reading covers, i.e. the
// site's ventilation throughput. This was the sensor's own 0.125 m3 sample
// box, which measures the CO2 sitting in that box rather than anything the
// site emitted, and put a full year of readings four orders of magnitude
// below the annual quota they are checked against.
const AIR_VOLUME = Number(process.env.AIR_VOLUME_M3) || 2.2e6; // m3 per reading

const DEFAULT_ANNUAL_CARBON_EMISSION_QUOTA = 1000;

const ppmToTons = (
  ppm: number,
  co2_molar_mass: number = CO2_MOLAR_MASS,
  air_molar_mass: number = AIR_MOLAR_MASS,
  air_density: number = AIR_DENSITY,
  air_volume: number = AIR_VOLUME,
): number => {
  return (ppm * co2_molar_mass * air_density * air_volume) / (air_molar_mass * 10 ** 9);
};

interface AvailableQuota {
  year: string;
  available_quota: number;
}

/**
 * Quota remaining for each year: the annual allowance less what has already
 * been emitted and less everything withdrawn against that same year.
 */
function availableQuotaByYear(company: CompanyDocument): AvailableQuota[] {
  return company.emissions.annual.toObject().map((item: { year: string; totalTon: number }) => {
    const year = parseInt(item.year);
    const withdrawalSum = company.quotaWithdrawal
      .toObject()
      .filter((entry: { time: Date }) => new Date(entry.time).getFullYear() === year)
      .reduce((sum: number, entry: { amount: number }) => sum + entry.amount, 0);
    return {
      year: item.year,
      available_quota: DEFAULT_ANNUAL_CARBON_EMISSION_QUOTA - (item.totalTon + withdrawalSum),
    };
  });
}

interface MeasurementBody {
  ppm?: number;
  time?: string;
}

type Headers = Record<string, string | undefined>;

export const collect = async ({
  body,
  headers,
  set,
}: {
  body: unknown;
  headers: Headers;
  set: SetContext;
}): Promise<Envelope> => {
  try {
    const apiKey = headers["x-api-key"];

    if (!apiKey) {
      set.status = 400;
      return { status: "error", message: "API key missing", data: {} };
    }

    const { ppm, time } = asBody<MeasurementBody>(body);

    if (!ppm || !time) {
      set.status = 400;
      return {
        status: "error",
        message: 'Parameter "ppm" and "time" required',
        data: {},
      };
    }

    const getCompany = await Company.findOne({ apiKey: apiKey });
    if (!getCompany) {
      set.status = 400;
      return { status: "error", message: "Invalid API key", data: {} };
    }

    // Bucket in UTC: the local-time getters made the year, month and day a
    // function of wherever the server happens to run, so the same reading
    // landed in different buckets on different hosts.
    const d = new Date(time);
    const year = d.getUTCFullYear().toString();
    const month = `${year}-${("0" + (d.getUTCMonth() + 1).toString()).slice(-2)}`;
    const date = `${month}-${("0" + d.getUTCDate().toString()).slice(-2)}`;

    const emissionTon = ppmToTons(ppm);

    // Record the reading first. The totals below only ever accumulate, so a
    // replayed batch would silently double them; the unique index on
    // (company, time) is what makes a repeat detectable at all.
    try {
      await Measurement.create({
        company: getCompany._id,
        time: d,
        ppm,
        ton: emissionTon,
      });
    } catch (err) {
      if ((err as { code?: number }).code === 11000) {
        set.status = 409;
        return {
          status: "error",
          message: "Measurement already recorded for this timestamp",
          data: {},
        };
      }
      throw err;
    }

    const annualEntry = getCompany.emissions.annual.find((e) => e.year === year);
    if (annualEntry) {
      annualEntry.totalTon += emissionTon;
    } else {
      getCompany.emissions.annual.push({ year, totalTon: emissionTon });
    }

    const monthlyEntry = getCompany.emissions.monthly.find((e) => e.month === month);
    if (monthlyEntry) {
      monthlyEntry.totalTon += emissionTon;
    } else {
      getCompany.emissions.monthly.push({ month, totalTon: emissionTon });
    }

    const dailyEntry = getCompany.emissions.daily.find((e) => e.date === date);
    if (dailyEntry) {
      dailyEntry.totalTon += emissionTon;
    } else {
      getCompany.emissions.daily.push({ date, totalTon: emissionTon });
    }

    await getCompany.save();

    set.status = 200;
    return {
      status: "success",
      message: "Successfuly add emission data",
      data: {},
    };
  } catch (err) {
    console.error(err);
    return badRequest(set, err);
  }
};

export const report = async ({
  body,
  headers,
  set,
}: {
  body: unknown;
  headers: Headers;
  set: SetContext;
}): Promise<Envelope> => {
  try {
    const apiKey = headers["x-api-key"];

    if (!apiKey) {
      set.status = 400;
      return { status: "error", message: "API key missing", data: {} };
    }

    const { ppm, time } = asBody<MeasurementBody>(body);

    if (!ppm || !time) {
      set.status = 400;
      return {
        status: "error",
        message: 'Parameter "ppm" and "time" required',
        data: {},
      };
    }

    const getCompany = await Company.findOne({ apiKey: apiKey });
    if (!getCompany) {
      set.status = 400;
      return { status: "error", message: "Invalid API key", data: {} };
    }

    const newReport = {
      ppm: ppm,
      ton: ppmToTons(ppm),
      time: time,
    };

    getCompany.reports.push(newReport as never);

    await getCompany.save();

    set.status = 200;
    return {
      status: "success",
      message: "Successfuly add possible emission manipulation report",
      data: newReport,
    };
  } catch (err) {
    console.error(err);
    return badRequest(set, err);
  }
};

export const companies = async ({ set }: { set: SetContext }): Promise<Envelope> => {
  try {
    const getCompany = await Company.find({}, { __v: 0, apiKey: 0, reports: 0 });
    set.status = 200;
    return {
      status: "success",
      message: "Successfuly read all participating companies",
      data: getCompany.map(({ _id, name, emissions }) => ({
        id: _id,
        name,
        annual_emissions: emissions.annual
          .toObject()
          .map(({ _id, ...keys }: { _id?: unknown } & AnnualEntry) => keys),
      })),
    };
  } catch (err) {
    console.error(err);
    return badRequest(set, err);
  }
};

interface AnnualEntry {
  year: string;
  totalTon: number;
}

type Params = { id: string };

export const annual = async ({
  params,
  set,
}: {
  params: Params;
  set: SetContext;
}): Promise<Envelope> => {
  try {
    const { id } = params;

    if (!id) {
      set.status = 400;
      return { status: "error", message: 'Parameter "id" required', data: {} };
    }

    const getCompany = await Company.findOne({ _id: id }, { "emissions.annual": 1, _id: 0 });
    if (!getCompany) {
      set.status = 400;
      return { status: "error", message: "Invalid Company ID", data: {} };
    }

    set.status = 200;
    return {
      status: "success",
      message: "Successfully read company's annual emission",
      data: getCompany.emissions.annual.map(({ year, totalTon }) => ({ year, totalTon })),
    };
  } catch (err) {
    console.error(err);
    return badRequest(set, err);
  }
};

export const monthly = async ({
  params,
  set,
}: {
  params: Params;
  set: SetContext;
}): Promise<Envelope> => {
  try {
    const { id } = params;

    if (!id) {
      set.status = 400;
      return { status: "error", message: 'Parameter "id" required', data: {} };
    }

    const getCompany = await Company.findOne({ _id: id }, { "emissions.monthly": 1, _id: 0 });
    if (!getCompany) {
      set.status = 400;
      return { status: "error", message: "Invalid Company ID", data: {} };
    }

    set.status = 200;
    return {
      status: "success",
      message: "Successfuly read company's monthly emission",
      data: getCompany.emissions.monthly.map(({ month, totalTon }) => ({ month, totalTon })),
    };
  } catch (err) {
    console.error(err);
    return badRequest(set, err);
  }
};

export const daily = async ({
  params,
  set,
}: {
  params: Params;
  set: SetContext;
}): Promise<Envelope> => {
  try {
    const { id } = params;

    if (!id) {
      set.status = 400;
      return { status: "error", message: 'Parameter "id" required', data: {} };
    }

    const getCompany = await Company.findOne({ _id: id }, { "emissions.daily": 1, _id: 0 });
    if (!getCompany) {
      set.status = 400;
      return { status: "error", message: "Invalid Company ID", data: {} };
    }

    set.status = 200;
    return {
      status: "success",
      message: "Successfuly read company's daily emission",
      data: getCompany.emissions.daily.map(({ date, totalTon }) => ({ date, totalTon })),
    };
  } catch (err) {
    console.error(err);
    return badRequest(set, err);
  }
};

export const quota = async ({
  verification,
  set,
}: {
  verification: VerificationResult | null;
  set: SetContext;
}): Promise<Envelope> => {
  try {
    const user = currentUser(verification);
    const getCompany = await Company.findOne({ publicKey: user.publicKey });
    if (!getCompany) {
      set.status = 400;
      return { status: "error", message: "Company not found", data: {} };
    }

    set.status = 200;
    return {
      status: "success",
      message: "Successfully read company's annual emission current available quota",
      data: availableQuotaByYear(getCompany),
    };
  } catch (err) {
    console.error(err);
    return badRequest(set, err);
  }
};

interface WithdrawBody {
  amount?: number;
}

export const withdraw = async ({
  body,
  verification,
  set,
}: {
  body: unknown;
  verification: VerificationResult | null;
  set: SetContext;
}): Promise<Envelope> => {
  try {
    const user = currentUser(verification);
    const getCompany = await Company.findOne({ publicKey: user.publicKey });
    if (!getCompany) {
      set.status = 400;
      return { status: "error", message: "Company not found", data: {} };
    }

    const { amount } = asBody<WithdrawBody>(body);

    if (!amount) {
      set.status = 400;
      return {
        status: "error",
        message: 'Parameter "amount" required',
        data: {},
      };
    }

    const available_quota = availableQuotaByYear(getCompany).filter((item) => {
      return item.year == new Date().getFullYear().toString();
    })[0]!.available_quota;

    if (amount > available_quota) {
      set.status = 400;
      return {
        status: "error",
        message: "Not enough carbon quota to withdraw",
        data: {},
      };
    }

    getCompany.quotaWithdrawal.push({
      amount,
      time: new Date(),
    } as never);

    await getCompany.save();

    // Minting is deferred to call time so the solana modules are not loaded
    // during startup. See the note in swap.controller.
    const { mint } = await import("../../utils/web3/ECFCH_minter");
    const mintResult = await mint(getCompany.publicKey as string, amount);

    set.status = 200;
    return {
      status: "success",
      message: `Successfully withdraw ${amount} tonnes of carbon quota and minted the tokenized quota`,
      data: {
        mintResult,
      },
    };
  } catch (err) {
    console.error(err);
    return badRequest(set, err);
  }
};
