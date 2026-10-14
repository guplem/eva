/**
 * A pi extension that Eva loads with `pi --mode rpc -e <this file>`. It asks the RPC
 * client before each tool call, so the policy stays in Eva's pi adapter.
 *
 * Each tool call emits one `extension_ui_request` with `method: "confirm"`, the title
 * `eva-approval`, and a JSON `message` of `{ toolName, toolCallId, input }`. The client
 * answers with `{"type":"extension_ui_response","id":<id>,"confirmed":true|false}`.
 * A `false` or a cancel blocks the tool, and the model sees the block reason. An `abort`
 * command dismisses an open dialog, so the client must ignore a late answer to it.
 *
 * pi loads this file with jiti, so it has no imports: the types below are the small
 * part of pi's `ExtensionAPI` that this file uses.
 */

interface ToolCallEvent {
  readonly toolName: string;
  readonly toolCallId: string;
  readonly input: Record<string, unknown>;
}

interface ToolCallContext {
  readonly hasUI: boolean;
  /** The turn's abort signal. An `abort` command dismisses the open dialog through it. */
  readonly signal: AbortSignal | undefined;
  readonly ui: {
    confirm(title: string, message: string, options?: { signal?: AbortSignal | undefined }): Promise<boolean>;
  };
}

type ToolCallResult = { block: true; reason: string } | undefined;

interface PiExtensionApi {
  on(event: "tool_call", handler: (event: ToolCallEvent, context: ToolCallContext) => Promise<ToolCallResult>): void;
}

export const evaApprovalTitle = "eva-approval";

export default function evaApprovalExtension(pi: PiExtensionApi): void {
  pi.on("tool_call", async (event, context) => {
    if (!context.hasUI) return { block: true, reason: "No client is connected to approve this action." };
    const request = JSON.stringify({ toolName: event.toolName, toolCallId: event.toolCallId, input: event.input });
    const allowed = await context.ui.confirm(evaApprovalTitle, request, { signal: context.signal });
    return allowed ? undefined : { block: true, reason: "The person did not allow this action." };
  });
}
