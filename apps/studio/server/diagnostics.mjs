/** Server diagnostics deliberately accept errors and fixed metadata, never request/provider bodies. */
export function redactDiagnostic(value, secrets = []) {
  let text = String(value);
  const configured = Object.entries(process.env)
    .filter(([name]) =>
      /TOKEN|SECRET|PASSWORD|API_KEY|PRIVATE_KEY|COOKIE|AUTHORIZATION/i.test(name),
    )
    .map(([, secret]) => secret?.trim())
    .filter((secret) => secret && secret.length >= 4);
  for (const secret of [...configured, ...secrets].sort((a, b) => b.length - a.length)) {
    if (secret) text = text.split(secret).join("[REDACTED]");
  }
  return text
    .replace(
      /\bauthorization\s*[:=]\s*(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\r\n;,]*)/gi,
      "[REDACTED_HEADER]",
    )
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9+/._=-]+/gi, "[REDACTED_AUTH]")
    .replace(/\b(?:sk|rk)[-_][A-Za-z0-9_-]{8,}/g, "[REDACTED_KEY]")
    .replace(
      /\b(?:gh[pousr]_[A-Za-z0-9]+|github_pat_[A-Za-z0-9_]+|AKIA[A-Z0-9]{16})\b/g,
      "[REDACTED_KEY]",
    )
    .replace(
      /\b(?:api[_-]?key|access[_-]?token|token|password|secret)\s*["']?\s*[:=]\s*(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;}]+)/gi,
      "[REDACTED_CREDENTIAL]",
    )
    .replace(/(https?:\/\/)[^/\s@]+@/gi, "$1[REDACTED]@")
    .replace(/([?&](?:token|key|api_key|secret|password)=)[^&#\s]+/gi, "$1[REDACTED]");
}
/** Keep the cause chain and failure location without serializing arbitrary attached objects. */
export function errorDiagnostic(error, seen = new Set(), depth = 0) {
  if (!(error instanceof Error))
    return { name: "NonError", message: "Falha sem objeto Error.", stack: "" };
  if (seen.has(error) || depth >= 5)
    return {
      name: "TruncatedCause",
      message: "Causa circular ou limite de profundidade.",
      stack: "",
    };
  seen.add(error);
  const name = redactDiagnostic(error.name).slice(0, 120);
  // Native JSON errors may quote stored/request content. Storage wrappers supply a safe file label.
  const rawMessage =
    error instanceof SyntaxError &&
    /JSON/i.test(error.message) &&
    !error.message.startsWith("JSON inválido em ")
      ? "JSON inválido."
      : error.message;
  const message = redactDiagnostic(rawMessage).slice(0, 2000);
  const frames = (error.stack ?? "")
    .split("\n")
    .filter((line) => /^\s*at\s/.test(line))
    .slice(0, 20);
  const stack = redactDiagnostic([`${name}: ${message}`, ...frames].join("\n")).slice(0, 6000);
  return {
    name,
    message,
    stack,
    ...(error.cause === undefined ? {} : { cause: errorDiagnostic(error.cause, seen, depth + 1) }),
  };
}
export function logFailure(fields, error) {
  console.error(JSON.stringify({ ...fields, error: errorDiagnostic(error) }));
}
function signature(error) {
  return JSON.stringify({
    name: error.name,
    message: error.message,
    ...(error.cause ? { cause: signature(error.cause) } : {}),
  });
}
/** Retry storage work less often; unchanged failures log at most once per minute. */
export function createWorkerBackoff(now = Date.now) {
  let attempts = 0;
  let retryAt = 0;
  let lastSignature = "";
  let lastLogAt = 0;
  return {
    ready() {
      return now() >= retryAt;
    },
    success() {
      attempts = 0;
      retryAt = 0;
      lastSignature = "";
      lastLogAt = 0;
    },
    failure(error) {
      const timestamp = now();
      const current = signature(errorDiagnostic(error));
      const changed = current !== lastSignature;
      if (changed) attempts = 0;
      attempts += 1;
      const delay = Math.min(60_000, 5_000 * 2 ** Math.min(attempts - 1, 4));
      retryAt = timestamp + delay;
      const shouldLog = changed || timestamp - lastLogAt >= 60_000;
      if (shouldLog) {
        lastSignature = current;
        lastLogAt = timestamp;
      }
      return { shouldLog, retry_in_ms: delay, attempt: attempts };
    },
  };
}
