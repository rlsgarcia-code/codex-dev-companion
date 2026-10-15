import * as vscode from "vscode";
import {
  localApprovalPresentation,
  type LocalApprovalRequest
} from "./approval-presentation";
import type { AgentUiEvent } from "./types";

export async function requestLocalApproval(
  onEvent: (event: AgentUiEvent) => void,
  request: LocalApprovalRequest
): Promise<boolean> {
  const presentation = localApprovalPresentation(request);
  onEvent({ type: "status", label: "Waiting for your approval" });
  onEvent({
    type: "activity",
    kind: "approval",
    title: presentation.requestedTitle,
    detail: presentation.activityDetail
  });
  const selection = await vscode.window.showWarningMessage(
    presentation.prompt,
    { modal: true, detail: presentation.modalDetail },
    presentation.action
  );
  const approved = selection === presentation.action;
  onEvent({
    type: "activity",
    kind: "approval",
    title: approved ? presentation.approvedTitle : presentation.declinedTitle
  });
  onEvent({
    type: "status",
    label: approved ? "Approval granted · continuing" : "Approval declined"
  });
  return approved;
}
