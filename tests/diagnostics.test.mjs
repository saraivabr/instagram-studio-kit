import { test } from "node:test";
import assert from "node:assert/strict";
import {
  errorDiagnostic,
  redactDiagnostic,
  createWorkerBackoff,
} from "../apps/studio/server/diagnostics.mjs";

test("server diagnostics preserve causal errors and stack without attached request data", () => {
  const cause = new SyntaxError("JSON inválido em items.json. Posição 12.");
  const error = new Error("Falha na migração de items.json", { cause });
  error.request = { body: "PRIVATE_REQUEST_BODY", headers: { Authorization: "PRIVATE_HEADER" } };
  const logged = errorDiagnostic(error);
  assert.equal(logged.name, "Error");
  assert.match(logged.message, /migração/);
  assert.equal(logged.cause.name, "SyntaxError");
  assert.match(logged.cause.message, /items\.json/);
  assert.match(logged.stack, /diagnostics\.test\.mjs/);
  assert.ok(!JSON.stringify(logged).includes("PRIVATE_"));
});
test("native JSON diagnostics never repeat private input snippets", () => {
  const marker = "PRIVATE_JSON_CONTENT_DO_NOT_LOG";
  let parsedError;
  try {
    JSON.parse(marker);
  } catch (error) {
    parsedError = error;
  }
  const logged = errorDiagnostic(parsedError);
  assert.equal(logged.name, "SyntaxError");
  assert.equal(logged.message, "JSON inválido.");
  assert.ok(!JSON.stringify(logged).includes(marker));
  assert.match(logged.stack, /diagnostics\.test\.mjs/);
  const quoted = new SyntaxError('"PRIVATE_QUOTED_CONTENT" is not valid JSON');
  const safe = new SyntaxError("JSON inválido em items.json.", { cause: quoted });
  assert.equal(errorDiagnostic(safe).cause.message, "JSON inválido.");
  assert.ok(!JSON.stringify(errorDiagnostic(safe)).includes("PRIVATE_QUOTED_CONTENT"));
});
test("credential values, auth headers, URL credentials and nested causes are redacted", () => {
  const previous = process.env.OPENAI_API_KEY;
  const secret = "provider-credential-without-a-standard-prefix";
  process.env.OPENAI_API_KEY = secret;
  try {
    const cause = new Error(
      `Authorization: Bearer bearerCredential123\nURL https://user:pass@example.com/api?token=queryCredential456`,
    );
    const logged = JSON.stringify(
      errorDiagnostic(
        new Error(
          `Failure ${secret} sk-proj-fakeCredential123 ghp_fakeGithubCredential token=rawCredential789`,
          { cause },
        ),
      ),
    );
    for (const value of [
      secret,
      "bearerCredential123",
      "user:pass",
      "queryCredential456",
      "sk-proj-fakeCredential123",
      "ghp_fakeGithubCredential",
      "rawCredential789",
    ])
      assert.ok(!logged.includes(value), value);
    assert.ok(logged.includes("REDACTED"));
  } finally {
    if (previous === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previous;
  }
  assert.equal(redactDiagnostic("failed", ["failed"]), "[REDACTED]");
});
test("diagnostics bound recursive causes and never serialize thrown payload objects", () => {
  const error = new Error("Cycle");
  error.cause = error;
  assert.equal(errorDiagnostic(error).cause.name, "TruncatedCause");
  const payload = { body: "PRIVATE_BODY", message: "PRIVATE_BODY", authorization: "PRIVATE_AUTH" };
  assert.ok(!JSON.stringify(errorDiagnostic(payload)).includes("PRIVATE"));
});
test("worker failure backoff limits unchanged logs and resets when healthy", () => {
  let now = 0;
  const backoff = createWorkerBackoff(() => now);
  const error = new Error("Storage unavailable");
  let logged = 0;
  const delays = [];
  for (let i = 0; i < 6; i++) {
    assert.equal(backoff.ready(), true);
    const result = backoff.failure(error);
    delays.push(result.retry_in_ms);
    if (result.shouldLog) logged++;
    assert.equal(backoff.ready(), false);
    now += result.retry_in_ms;
  }
  assert.deepEqual(delays, [5000, 10000, 20000, 40000, 60000, 60000]);
  assert.equal(logged, 3);
  backoff.success();
  assert.equal(backoff.ready(), true);
  const next = backoff.failure(error);
  assert.equal(next.shouldLog, true);
  assert.equal(next.retry_in_ms, 5000);
});
test("a changed worker failure logs immediately while stack variation does not flood logs", () => {
  let now = 0;
  const backoff = createWorkerBackoff(() => now);
  assert.equal(backoff.failure(new Error("Corrupt JSON")).shouldLog, true);
  now = 5000;
  assert.equal(backoff.failure(new Error("Corrupt JSON")).shouldLog, false);
  now = 15000;
  const changed = backoff.failure(new Error("SQLite permission denied"));
  assert.equal(changed.shouldLog, true);
  assert.equal(changed.retry_in_ms, 5000);
});
