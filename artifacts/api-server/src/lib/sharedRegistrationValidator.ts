// Keep the backend import path stable while sharing the strict Zod 3
// contract with generated API consumers.
export {
  administratorRegistrationSchema,
  businessRegistrationSchema,
  registerBusinessSchema,
} from "@workspace/api-zod";
export type { RegisterBusinessInput } from "@workspace/api-zod";