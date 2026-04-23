export type Role = "user" | "assistant" | "tool";

export type ToolCall = {
  id: string;
  name: string;
  input: Record<string, unknown>;
};

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };

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
  | { type: "tool_call"; call: ToolCall }
  | { type: "done"; stopReason: string; usage?: { input: number; output: number; cacheRead?: number } };

export interface Provider {
  name: string;
  model: string;
  stream(opts: {
    system: string;
    messages: Message[];
    tools: ToolDef[];
  }): AsyncIterable<StreamEvent>;
}
