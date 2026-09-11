export type PushFailureStage =
  | "native-setup"
  | "permission"
  | "project-id"
  | "token"
  | "server";

interface ConstantsProjectConfig {
  expoConfig?: { extra?: { eas?: { projectId?: unknown } } } | null;
  easConfig?: { projectId?: unknown } | null;
}

function validProjectId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * EAS injects the project id in different Constants locations depending on
 * build type.  Prefer expoConfig, then use easConfig as the safe fallback.
 */
export function inferExpoProjectId(constants: ConstantsProjectConfig): string | undefined {
  return (
    validProjectId(constants.expoConfig?.extra?.eas?.projectId) ??
    validProjectId(constants.easConfig?.projectId)
  );
}

/**
 * Diagnostics intentionally expose only a stable stage/code and an error
 * class name.  Never log the error message or token: native push errors can
 * include request URLs or token material.
 */
export function getPushFailureDiagnostic(stage: PushFailureStage, error?: unknown) {
  const errorName =
    error instanceof Error && error.name
      ? error.name.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40)
      : "UnknownError";
  return {
    stage,
    code: `push_${stage.replace("-", "_")}_failed`,
    errorName,
  } as const;
}