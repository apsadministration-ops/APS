import { z } from "zod";

const requiredText = z.string().trim().min(1);
const optionalText = requiredText.optional();

/**
 * Strict business-first signup contract shared by API consumers and the
 * backend. The server still owns role/status/ownership derivation.
 */
export const businessRegistrationSchema = z
  .object({
    legalName: requiredText,
    name: optionalText,
    subtype: z.enum(["shop", "dealership", "fleet"]),
    email: z.string().trim().email(),
    phone: requiredText,
    address: requiredText,
    city: requiredText,
    region: requiredText,
    zipCode: optionalText,
    contactName: optionalText,
  })
  .strict();

export const administratorRegistrationSchema = z
  .object({
    name: requiredText,
    email: z.string().trim().email(),
    phone: optionalText,
    password: requiredText,
  })
  .strict();

export const registerBusinessSchema = z
  .object({
    business: businessRegistrationSchema,
    administrator: administratorRegistrationSchema,
  })
  .strict();

export type RegisterBusinessInput = z.infer<typeof registerBusinessSchema>;