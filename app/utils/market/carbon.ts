// Live EU carbon allowance price in EUR.
//
// Yahoo retired its ECF=F carbon futures symbol, so the live quote comes from
// CO2.L, the SparkChange Physical Carbon EUA ETC, which holds EU Allowances
// outright and is quoted in EUR. The v8 chart endpoint serves it without the
// crumb-and-cookie handshake that the quote API demands and kept failing on.

const YAHOO_CHART = "https://query1.finance.yahoo.com/v8/finance/chart";
const USER_AGENT = "Mozilla/5.0 (compatible; carbonhub/1.0)";

const symbol = () => process.env.CARBON_YAHOO_SYMBOL || "CO2.L";

interface ChartResponse {
  chart?: {
    result?: Array<{
      meta?: { regularMarketPrice?: number; currency?: string };
    }>;
  };
}

export async function getLiveCarbonPriceEur(): Promise<number> {
  const response = await fetch(`${YAHOO_CHART}/${symbol()}?interval=1d&range=5d`, {
    headers: { "User-Agent": USER_AGENT },
  });

  if (!response.ok) {
    throw new Error(`Yahoo chart lookup failed with ${response.status}`);
  }

  const { chart } = (await response.json()) as ChartResponse;
  const meta = chart?.result?.[0]?.meta;

  // A retired symbol still answers 200, just with an empty shell, so check the
  // currency rather than trusting the response code.
  if (meta?.currency !== "EUR") {
    throw new Error(`${symbol()} is quoted in ${meta?.currency}, not EUR`);
  }

  const price = meta?.regularMarketPrice;
  if (typeof price !== "number") {
    throw new Error(`Yahoo returned no price for ${symbol()}`);
  }

  return price;
}
