export interface ApiErrorClassification {
  statusCode: number;
  errorCode: string;
}

const SAFE_SERVICE_ERROR_CODES = new Set([
  "anthropic_provider_unavailable",
  "public_url_not_configured",
  "stripe_provider_not_configured",
]);

export function classifyApiError(err: unknown): ApiErrorClassification {
  const candidate = err as {
    type?: unknown;
    statusCode?: unknown;
    code?: unknown;
  } | null;
  const parserType = typeof candidate?.type === "string" ? candidate.type : "";
  const parserFailure =
    parserType === "entity.parse.failed"
      ? { statusCode: 400, errorCode: "invalid_json" }
      : parserType === "entity.too.large"
        ? { statusCode: 413, errorCode: "request_too_large" }
        : parserType === "request.aborted" || parserType === "encoding.unsupported"
          ? { statusCode: 400, errorCode: "bad_request" }
          : null;
  if (parserFailure) return parserFailure;

  const statusCode =
    typeof candidate?.statusCode === "number" &&
    candidate.statusCode >= 400 &&
    candidate.statusCode < 600
      ? candidate.statusCode
      : 500;
  return {
    statusCode,
    errorCode: statusCode === 503 &&
      typeof candidate?.code === "string" &&
      SAFE_SERVICE_ERROR_CODES.has(candidate.code)
      ? candidate.code
      : statusCode === 503
        ? "service_unavailable"
        : "internal_error",
  };
}