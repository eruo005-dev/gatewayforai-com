const TYPE_BY_STATUS: Record<number, string> = {
  400: "invalid_request_error",
  401: "authentication_error",
  404: "invalid_request_error",
  429: "rate_limit_error",
  502: "api_error",
};

export function errJson(
  status: number,
  code: string,
  message: string,
  extra?: Record<string, unknown>,
  headers?: Record<string, string>,
): Response {
  return Response.json(
    { error: { message, type: TYPE_BY_STATUS[status] ?? "api_error", code, ...extra } },
    { status, headers },
  );
}
