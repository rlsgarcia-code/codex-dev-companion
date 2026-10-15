import { redactSensitiveText } from "./redaction";

export type LocalApprovalRequest = {
  prompt: string;
  action: string;
  target: string;
  explanation: string;
  risk: "standard" | "destructive" | "sensitive";
  sensitiveValues?: readonly string[];
};

export type LocalApprovalPresentation = {
  prompt: string;
  action: string;
  modalDetail: string;
  requestedTitle: string;
  approvedTitle: string;
  declinedTitle: string;
  activityDetail: string;
};

export function localApprovalPresentation(request: LocalApprovalRequest): LocalApprovalPresentation {
  const sensitiveValues = request.sensitiveValues ?? [];
  const prompt = singleLine(redactSensitiveText(request.prompt, sensitiveValues), 240);
  const action = singleLine(redactSensitiveText(request.action, sensitiveValues), 80);
  const target = singleLine(redactSensitiveText(request.target, sensitiveValues), 800);
  const explanation = boundedDetail(redactSensitiveText(request.explanation, sensitiveValues), 3_000);
  const riskLabel = request.risk === "destructive"
    ? "Destructive"
    : request.risk === "sensitive"
      ? "Sensitive"
      : "Approval";
  const activityDetail = [target, explanation].filter(Boolean).join("\n\n");
  return {
    prompt,
    action,
    modalDetail: activityDetail,
    requestedTitle: `${riskLabel} required · ${action}`,
    approvedTitle: `Approved · ${action}`,
    declinedTitle: `Declined · ${action}`,
    activityDetail
  };
}

function singleLine(value: string, maximum: number): string {
  return value.replace(/[\r\n\t\0]+/g, " ").replace(/\s+/g, " ").trim().slice(0, maximum);
}

function boundedDetail(value: string, maximum: number): string {
  return value.replace(/\0/g, "").trim().slice(0, maximum);
}
