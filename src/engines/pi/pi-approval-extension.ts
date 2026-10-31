/**
 * The pi extension that Eva writes to disk and loads with `pi --mode rpc -e <file>`. pi has no
 * permission prompts, so this extension asks the RPC client before each tool call, and the
 * policy stays in the adapter. Eva keeps the source as text because the single
 * executable has no source files on disk, and pi runs in its own process.
 *
 * Each tool call emits one `extension_ui_request` with `method: "confirm"`, the title below,
 * and a JSON `message` of `{ toolName, toolCallId, input }`. A `false` or a cancel blocks the
 * tool, and the model sees the reason. A confirm carries no reason back, so one reason covers both a
 * person's no and the file wall of a Project chat (#711). An `abort` dismisses an open dialog through the signal.
 */
export const approvalTitle = "eva-approval";

export const approvalExtensionSource = `export default function evaApproval(pi) {
  pi.on("tool_call", async (event, context) => {
    if (!context.hasUI) return { block: true, reason: "No client is connected to approve this action." };
    const request = JSON.stringify({ toolName: event.toolName, toolCallId: event.toolCallId, input: event.input });
    const allowed = await context.ui.confirm("${approvalTitle}", request, { signal: context.signal });
    return allowed
      ? undefined
      : { block: true, reason: "This action was not allowed: the person said no, or a path is outside this chat's folder." };
  });
}
`;
