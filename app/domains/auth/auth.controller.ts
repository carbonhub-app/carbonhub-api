import crypto from "node:crypto";
import { randomUUID } from "node:crypto";
import nacl from "tweetnacl";

import { Auth } from "./auth.model";
import { Company } from "../emission/emission.model";
import type { CompanyDocument } from "../emission/emission.model";
import { signToken } from "../../utils/auth/jwt/sign";
import { currentUser } from "../../middlewares/auth/jwt/jwt.verify";
import type { VerificationResult } from "../../utils/auth/jwt/verify";
import type { Envelope, SetContext } from "../../types/http";
import { asBody, badRequest } from "../../types/http";

interface ChallengeBody {
  publicKey?: string;
  type?: string;
}

export const challenge = async ({
  body,
  set,
}: {
  body: unknown;
  set: SetContext;
}): Promise<Envelope> => {
  try {
    const { publicKey, type } = asBody<ChallengeBody>(body);

    if (!publicKey || !type) {
      const invalidItems: string[] = [];
      if (!publicKey) invalidItems.push('"publicKey"');
      if (!type) invalidItems.push('"type"');
      set.status = 400;
      return {
        status: "error",
        message: `Parameter ${invalidItems.join(", ")} required`,
        data: {},
      };
    }

    if (!["user", "company"].includes(type)) {
      set.status = 400;
      return {
        status: "error",
        message: `The parameter "type" must be specified as either "user" or "company"`,
        data: {},
      };
    }

    const getAuth = await Auth.findOne({ publicKey: publicKey });
    const challengeValue = crypto.randomBytes(16).toString("hex");
    if (!getAuth) {
      const newAuth = new Auth({
        publicKey: publicKey,
        type: type as "user" | "company",
        latestChallenge: challengeValue,
      });
      await newAuth.save();
    } else {
      getAuth.latestChallenge = challengeValue;
      await getAuth.save();
    }

    set.status = 200;
    return {
      status: "success",
      message: "Successfuly request new auth challenge",
      data: {
        challenge: challengeValue,
      },
    };
  } catch (err) {
    console.error(err);
    return badRequest(set, err);
  }
};

interface VerifyBody {
  publicKey?: string;
  challenge?: string;
  signature?: string;
}

export const verify = async ({
  body,
  set,
}: {
  body: unknown;
  set: SetContext;
}): Promise<Envelope> => {
  try {
    const { publicKey, challenge, signature } = asBody<VerifyBody>(body);

    if (!publicKey || !challenge || !signature) {
      const invalidItems: string[] = [];
      if (!publicKey) invalidItems.push('"publicKey"');
      if (!challenge) invalidItems.push('"challenge"');
      if (!signature) invalidItems.push('"signature"');
      set.status = 400;
      return {
        status: "error",
        message: `Parameter ${invalidItems.join(", ")} required`,
        data: {},
      };
    }

    const getAuth = await Auth.findOne({ publicKey: publicKey });
    if (!getAuth) {
      set.status = 400;
      return {
        status: "error",
        message: "This public key has not initiated any authentication challenge",
        data: {},
      };
    }

    if (challenge != getAuth.latestChallenge) {
      set.status = 400;
      return {
        status: "error",
        message: "The challenge code differs from the one previously requested",
        data: {},
      };
    }

    // The address is base58; kit validates it and hands back the raw 32 bytes
    // the signature was produced against.
    const { address, getAddressEncoder } = await import("@solana/kit");
    const publicKeyBytes = new Uint8Array(getAddressEncoder().encode(address(publicKey)));

    const isValid = nacl.sign.detached.verify(
      new TextEncoder().encode(challenge),
      Buffer.from(signature, "base64"),
      publicKeyBytes,
    );

    if (!isValid) {
      set.status = 400;
      return {
        status: "error",
        message: "Invalid signature",
        data: {},
      };
    }

    let getCompany: CompanyDocument | null = null;
    if (getAuth.type == "company") {
      getCompany = await Company.findOne({ publicKey: publicKey });
      if (!getCompany) {
        getCompany = new Company({
          publicKey: publicKey,
          name: "Company " + publicKey.slice(0, 4) + "..." + publicKey.slice(-4),
          apiKey: randomUUID(),
        });
        await getCompany.save();
      }
    }

    set.status = 200;
    return {
      status: "success",
      message: "Successfuly login as " + getAuth.type,
      data: {
        publicKey: publicKey,
        type: getAuth.type,
        token: signToken({
          publicKey: publicKey,
        }),
        company_id: getCompany?._id ?? null,
        apiKey: getCompany?.apiKey ?? null,
      },
    };
  } catch (err) {
    console.error(err);
    return badRequest(set, err);
  }
};

export const status = async ({
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
      return {
        status: "error",
        message: "Public key not found or account is not a company",
        data: {},
      };
    }

    set.status = 200;
    return {
      status: "success",
      message: "Successfuly get company status",
      data: {
        publicKey: user.publicKey,
        type: "company",
        token: signToken({
          publicKey: user.publicKey,
        }),
        company_id: getCompany._id,
        apiKey: getCompany.apiKey,
      },
    };
  } catch (err) {
    console.error(err);
    return badRequest(set, err);
  }
};
