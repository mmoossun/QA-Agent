import bcrypt from "bcryptjs";
export const hash   = (pw: string) => bcrypt.hash(pw, 12);
export const verify = (pw: string, hashed: string) => bcrypt.compare(pw, hashed);
