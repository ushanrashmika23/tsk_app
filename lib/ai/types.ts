export type Role = "system" | "user" | "assistant" | "tool";

export interface AIMessage {
  role: Role;
  content: string | null;
  name?: string; // used for tool responses
  tool_call_id?: string; // used for tool responses
  tool_calls?: AIToolCall[]; // used for assistant tool calls
}

export interface AIToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string; // JSON string
  };
}

export interface AITool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: any; // JSON Schema
  };
}

export interface AIRequest {
  messages: AIMessage[];
  tools?: AITool[];
  model?: string;
  temperature?: number;
}

export interface AIResponse {
  message: AIMessage;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface AIProvider {
  generateResponse(request: AIRequest): Promise<AIResponse>;
}
