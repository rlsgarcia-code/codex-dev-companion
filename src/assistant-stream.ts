export type StreamedAssistantMessage = {
  text: AsyncIterable<string>;
  output: PromiseLike<{ tool_calls?: unknown[] }>;
};

export async function consumeAssistantMessageStreams(
  streams: AsyncIterable<StreamedAssistantMessage>,
  onDelta: (delta: string) => Promise<void>,
  onMessageEnd: (toolTurn: boolean) => Promise<void>
): Promise<void> {
  for await (const stream of streams) {
    let toolTurn = false;
    try {
      for await (const delta of stream.text) {
        if (delta) await onDelta(delta);
      }
      const message = await stream.output;
      toolTurn = Boolean(Array.isArray(message.tool_calls) && message.tool_calls.length);
    } catch (error) {
      await onMessageEnd(false);
      throw error;
    }
    await onMessageEnd(toolTurn);
  }
}
