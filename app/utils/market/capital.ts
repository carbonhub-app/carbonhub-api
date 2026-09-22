// Capital.com market data. The trading page charts CAPITALCOM:ECFZ2026, so
// quoting the swap from the same venue keeps the price and the chart in step.

const DEFAULT_HOST = "https://api-capital.backend-capital.com";
const DEFAULT_EPIC = "ECFZ2026";

// Capital.com drops idle sessions after ten minutes; renew ahead of that
// rather than paying for a 401 round trip on every quote.
const SESSION_TTL_MS = 8 * 60 * 1000;

interface Session {
  cst: string;
  securityToken: string;
  openedAt: number;
}

let session: Session | null = null;

const host = () => process.env.CAPITAL_API_HOST || DEFAULT_HOST;
const epic = () => process.env.CAPITAL_ECF_EPIC || DEFAULT_EPIC;

async function openSession(): Promise<Session> {
  const apiKey = process.env.CAPITAL_API_KEY;
  const identifier = process.env.CAPITAL_IDENTIFIER;
  const password = process.env.CAPITAL_PASSWORD;

  if (!apiKey || !identifier || !password) {
    throw new Error("Capital.com credentials are not configured");
  }

  const response = await fetch(`${host()}/api/v1/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-CAP-API-KEY": apiKey },
    body: JSON.stringify({ identifier, password }),
  });

  if (!response.ok) {
    throw new Error(`Capital.com session failed with ${response.status}`);
  }

  const cst = response.headers.get("CST");
  const securityToken = response.headers.get("X-SECURITY-TOKEN");

  if (!cst || !securityToken) {
    throw new Error("Capital.com session returned no tokens");
  }

  return { cst, securityToken, openedAt: Date.now() };
}

async function authorised(): Promise<Session> {
  if (!session || Date.now() - session.openedAt > SESSION_TTL_MS) {
    session = await openSession();
  }
  return session;
}

interface MarketResponse {
  snapshot?: { bid?: number; offer?: number };
}

const fetchMarket = (current: Session) =>
  fetch(`${host()}/api/v1/markets/${epic()}`, {
    headers: { CST: current.cst, "X-SECURITY-TOKEN": current.securityToken },
  });

// The mid of bid and offer: the swap quotes both directions, so neither side
// of the spread is the right one to favour.
export async function getCarbonPriceEur(): Promise<number> {
  let response = await fetchMarket(await authorised());

  if (response.status === 401) {
    session = null;
    response = await fetchMarket(await authorised());
  }

  if (!response.ok) {
    throw new Error(`Capital.com market lookup failed with ${response.status}`);
  }

  const { snapshot } = (await response.json()) as MarketResponse;
  const { bid, offer } = snapshot ?? {};

  if (typeof bid !== "number" || typeof offer !== "number") {
    throw new Error(`Capital.com returned no price for ${epic()}`);
  }

  return (bid + offer) / 2;
}
