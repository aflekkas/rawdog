export type Role = "user" | "assistant" | "tool";

export type ToolCall = {
  id: string;
  name: string;
  input: Record<string, unknown>;
};

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; mediaType: string; data: string } // base64-encoded, no data: prefix
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean; tool_name?: string };

export type Message = {
  role: Role;
  content: string | ContentBlock[];
};

export type ToolDef = {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
};

export type StreamEvent =
  | { type: "text_delta"; text: string }
  | { type: "thinking_delta"; text: string }
  | { type: "tool_call"; call: ToolCall }
  | { type: "done"; stopReason: string; usage?: { input: number; output: number; cacheRead?: number } };

export interface Provider {
  name: string;
  model: string;
  stream(opts: {
    system: string;
    messages: Message[];
    tools: ToolDef[];
    signal?: AbortSignal;
  }): AsyncIterable<StreamEvent>;
}
