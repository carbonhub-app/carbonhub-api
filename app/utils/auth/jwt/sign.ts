import jwt from "jsonwebtoken";
import type { SignOptions } from "jsonwebtoken";

export interface TokenPayload {
  publicKey: string;
}

function signToken(
  user: TokenPayload,
  expire: string = process.env.JWT_DEFAULT_EXPIRE as string,
): string {
  return jwt.sign(user, process.env.JWT_SECRET as string, {
    expiresIn: expire,
  } as SignOptions);
}

export { signToken };
