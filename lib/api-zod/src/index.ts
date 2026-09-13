export * from "./generated/api";
export * from "./sharedRegistrationValidator";
// Backward-compatible server import while the canonical OpenAPI operation is
// named createShopBay for generated client hook parity.
export { CreateShopBayBody as CreateBayBody } from "./generated/api";
