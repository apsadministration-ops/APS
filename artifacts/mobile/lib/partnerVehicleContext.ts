export type PartnerVehicleContext = {
  ownerId: number | null;
  selectedId: number | null;
  subtype: string | null;
  organizationStatus: string | null;
};

export function partnerVehicleContextKey(context: PartnerVehicleContext) {
  return [
    context.ownerId ?? "none",
    context.selectedId ?? "none",
    context.subtype ?? "none",
    context.organizationStatus ?? "none",
  ].join(":");
}

export function partnerVehicleContextChanged(
  previous: PartnerVehicleContext,
  current: PartnerVehicleContext,
) {
  return partnerVehicleContextKey(previous) !== partnerVehicleContextKey(current);
}