import jwt from "jsonwebtoken";
import type { TokenPayload } from "./sign";

export interface VerificationSuccess {
  status: "success";
  message: string;
  data: TokenPayload;
}

export interface VerificationFailure {
  status: "error";
  message: string;
  data: Record<string, never>;
}

export type VerificationResult = VerificationSuccess | VerificationFailure;

function verifyToken(token: string): VerificationResult {
  let verification!: VerificationResult;
  jwt.verify(token, process.env.JWT_SECRET as string, (err, decoded) => {
    if (err) {
      verification = {
        status: "error",
        message: process.env.DEBUG ? err.message : "Invalid Token",
        data: {},
      };
    } else {
      verification = {
        status: "success",
        message: "Token Verified",
        data: decoded as unknown as TokenPayload,
      };
    }
  });
  return verification;
}

export { verifyToken };
