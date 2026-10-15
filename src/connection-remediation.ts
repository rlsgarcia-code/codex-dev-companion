import type { LiteLlmAuthHeader } from "./litellm";

export type ConnectionDiagnosticFix =
  | { kind: "set-reasoning"; label: string; value: "none" | "omit" }
  | { kind: "clear-sampling"; label: string; target: "temperature" | "top-p" | "both" }
  | { kind: "set-auth-header"; label: string; value: LiteLlmAuthHeader }
  | { kind: "open-ca-setup"; label: string }
  | { kind: "focus-field"; label: string; field: "endpoint" | "model" | "api-key" | "auth-header" };

export type ConnectionDiagnosticFixContext = {
  authHeader?: LiteLlmAuthHeader;
  surface?: "configuration" | "catalog" | "chat" | "embeddings";
};

/** Maps known provider failures to explicit, local UI actions without guessing silently. */
export function connectionDiagnosticFixes(
  detail: string,
  context: ConnectionDiagnosticFixContext = {}
): ConnectionDiagnosticFix[] {
  const fixes: ConnectionDiagnosticFix[] = [];
  const surface = context.surface ?? "chat";

  if (/gateway api or subscription key is required|api key is required/i.test(detail)) {
    fixes.push({ kind: "focus-field", label: "Add the gateway key", field: "api-key" });
  }
  if (/model alias is required/i.test(detail)) {
    fixes.push({ kind: "focus-field", label: "Choose a model alias", field: "model" });
  }
  if (/(?:litellm|gateway|models) endpoint must|base url must/i.test(detail)) {
    fixes.push({ kind: "focus-field", label: "Review gateway URL", field: "endpoint" });
  }

  if (
    /(?:function|tool)[-_ ]?(?:calling|calls?|tools?).*reasoning|reasoning(?:_effort)?.*(?:function|tool)|requires reasoning_effort none/i.test(detail)
  ) {
    fixes.push({ kind: "set-reasoning", label: "Use reasoning none and retest", value: "none" });
  }

  const mentionsBothSampling = /temperature\s+(?:or|and)\s+top[_ ]?p|top[_ ]?p\s+(?:or|and)\s+temperature/i.test(detail);
  if (mentionsBothSampling && /not accept|not support|unsupported|leave both blank|omit/i.test(detail)) {
    fixes.push({ kind: "clear-sampling", label: "Omit sampling and retest", target: "both" });
  } else {
    if (/temperature.*(?:not accept|not support|unsupported|does not support|must be omitted|leave.*blank)/i.test(detail)) {
      fixes.push({ kind: "clear-sampling", label: "Omit Temperature and retest", target: "temperature" });
    }
    if (/top[_ ]?p.*(?:not accept|not support|unsupported|does not support|must be omitted|leave.*blank)/i.test(detail)) {
      fixes.push({ kind: "clear-sampling", label: "Omit Top P and retest", target: "top-p" });
    }
  }

  if (/configure either temperature or top[_ ]?p|temperature and top[_ ]?p.*(?:together|both)/i.test(detail)) {
    fixes.push(
      { kind: "clear-sampling", label: "Keep Temperature", target: "top-p" },
      { kind: "clear-sampling", label: "Keep Top P", target: "temperature" }
    );
  }

  if (/missing subscription key/i.test(detail)) {
    if (surface === "catalog") {
      fixes.push({ kind: "focus-field", label: "Check gateway key", field: "api-key" });
    } else {
      if (context.authHeader !== "api-key") {
        fixes.push({ kind: "set-auth-header", label: "Use api-key and retest", value: "api-key" });
      }
      if (context.authHeader !== "ocp-apim-subscription-key") {
        fixes.push({
          kind: "set-auth-header",
          label: "Use APIM subscription header and retest",
          value: "ocp-apim-subscription-key"
        });
      }
    }
  } else if (/\b401\b|\b403\b|unauthorized|forbidden|authentication failed|invalid api key/i.test(detail)) {
    fixes.push({ kind: "focus-field", label: "Review key and authentication", field: "api-key" });
  }

  if (/certificate|self[- ]signed|unable to verify|CERT_|UNABLE_TO_GET_ISSUER/i.test(detail)) {
    fixes.push({ kind: "open-ca-setup", label: "Import or change corporate CA" });
  }

  if (/requires (?:an api other than|the )?responses api|function tools.*(?:unsupported|not supported).*chat completions/i.test(detail)) {
    fixes.push({ kind: "focus-field", label: "Choose a Chat Completions model", field: "model" });
  } else if (/\b404\b|not found|method not allowed|\b405\b/i.test(detail)) {
    fixes.push({ kind: "focus-field", label: "Review gateway route", field: "endpoint" });
  }

  return deduplicateFixes(fixes);
}

function deduplicateFixes(fixes: ConnectionDiagnosticFix[]): ConnectionDiagnosticFix[] {
  const seen = new Set<string>();
  return fixes.filter((fix) => {
    const key = JSON.stringify(fix);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
