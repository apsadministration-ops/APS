import bcrypt from "bcryptjs";

export async function hashPassword(password: string): Promise<string> {
  // Keep the production route's asynchronous hashing boundary while making
  // the test fixture independent of the production auth module and database.
  return bcrypt.hash(password, 4);
}