import { AIProvider, AIRequest, AIResponse, AIMessage, AIToolCall } from "../types";
import Groq from "groq-sdk";

export class GroqProvider implements AIProvider {
  private client: Groq;

  constructor(apiKey: string) {
    if (!apiKey) {
      throw new Error("GROQ_API_KEY is not defined");
    }
    this.client = new Groq({ apiKey });
  }

  async generateResponse(request: AIRequest): Promise<AIResponse> {
    const model = request.model || process.env.GROQ_MODEL || "llama3-8b-8192";
    
    // Transform our AIMessage format into Groq SDK format
    const groqMessages = request.messages.map((msg) => {
      const gMsg: any = {
        role: msg.role,
      };
      
      if (msg.content) gMsg.content = msg.content;
      if (msg.name) gMsg.name = msg.name;
      if (msg.tool_call_id) gMsg.tool_call_id = msg.tool_call_id;
      
      if (msg.tool_calls) {
        gMsg.tool_calls = msg.tool_calls.map(tc => ({
          id: tc.id,
          type: "function",
          function: {
            name: tc.function.name,
            arguments: tc.function.arguments,
          }
        }));
      }

      return gMsg;
    });

    const options: any = {
      model,
      messages: groqMessages,
      temperature: request.temperature ?? 0.1,
    };

    if (request.tools && request.tools.length > 0) {
      options.tools = request.tools.map(tool => ({
        type: tool.type,
        function: {
          name: tool.function.name,
          description: tool.function.description,
          parameters: tool.function.parameters,
        }
      }));
      // Force auto tool choice
      options.tool_choice = "auto";
    }

    if ((request as any).max_tokens) {
      options.max_tokens = (request as any).max_tokens;
    }

    try {
      const chatCompletion = await this.client.chat.completions.create(options);

      const responseMessage = chatCompletion.choices[0]?.message;
      
      let parsedToolCalls: AIToolCall[] | undefined = undefined;
      if (responseMessage?.tool_calls && responseMessage.tool_calls.length > 0) {
        parsedToolCalls = responseMessage.tool_calls.map((tc: any) => ({
          id: tc.id,
          type: "function",
          function: {
            name: tc.function.name,
            arguments: tc.function.arguments,
          }
        }));
      }

      return {
        message: {
          role: "assistant",
          content: responseMessage?.content || null,
          tool_calls: parsedToolCalls,
        },
        usage: {
          promptTokens: chatCompletion.usage?.prompt_tokens || 0,
          completionTokens: chatCompletion.usage?.completion_tokens || 0,
          totalTokens: chatCompletion.usage?.total_tokens || 0,
        }
      };
    } catch (error: any) {
      if (error.status === 429) {
        throw { code: "RATE_LIMITED", message: error.message }; // Using duck typing to match AIError
      }
      if (error.status === 401 || error.status === 403) {
        throw { code: "AUTH_ERROR", message: error.message };
      }
      if (error.status >= 500) {
        throw { code: "PROVIDER_ERROR", message: error.message };
      }
      throw { code: "UNKNOWN", message: error.message };
    }
  }
}
