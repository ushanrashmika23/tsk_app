import { AIProvider, AIMessage, AIRequest } from "./types";
import { getSystemPrompt } from "./prompts";
import { toolsDefinition, executeTool } from "./tools";
import { AI_CONFIG, AIError, getUserFriendlyAIError } from "./config";
import { determineIntent, selectModelConfig, getRequiredToolsForIntent } from "./router";

export class AIService {
  private provider: AIProvider;

  constructor(provider: AIProvider) {
    this.provider = provider;
  }

  async chat(messages: AIMessage[]): Promise<AIMessage[]> {
    try {
      // 1. Route Intent & Config
      const intent = determineIntent(messages);
      const config = selectModelConfig(intent);
      const requiredToolNames = getRequiredToolsForIntent(intent);

      // Filter tools based on intent to save tokens
      const activeTools = requiredToolNames.map(name => toolsDefinition[name]).filter(Boolean);

      // 2. Limit Context History
      // Keep only the last N messages + system prompt
      const recentMessages = messages.slice(-AI_CONFIG.maxHistoryMessages);

      // 3. Build System Prompt Context
      const now = new Date();
      const tz = "Asia/Colombo";
      const formatter = new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: true
      });
      const parts = formatter.formatToParts(now);
      const dateObj: any = {};
      parts.forEach(p => dateObj[p.type] = p.value);
      
      const localDate = `${dateObj.year}-${dateObj.month}-${dateObj.day}`;
      const localTime = `${dateObj.hour}:${dateObj.minute} ${dateObj.dayPeriod}`;

      const systemMessage: AIMessage = {
        role: "system",
        content: getSystemPrompt(localDate, localTime, tz, intent),
      };

      let fullMessages = [systemMessage, ...recentMessages];
      const newMessages = [...messages]; // What we will return

      // 4. Tool Loop Execution
      let iterations = 0;
      let isDone = false;

      while (!isDone && iterations < AI_CONFIG.maxToolIterations) {
        iterations++;

        const request: AIRequest = {
          messages: fullMessages,
          tools: activeTools.length > 0 ? activeTools : undefined,
          model: config.model,
          temperature: config.temperature,
          // Limit output length to save budget
          // maxCompletionTokens is handled inside provider or mapped there
        };

        // Inject max_tokens to request via extension (or we map it inside provider later)
        (request as any).max_tokens = config.maxCompletionTokens;

        const response = await Promise.race([
          this.provider.generateResponse(request),
          new Promise<never>((_, reject) => 
            setTimeout(() => reject(new AIError("TIMEOUT", "Request timed out")), AI_CONFIG.timeoutMs)
          )
        ]);

        const finalMessage = response.message;
        fullMessages.push(finalMessage);
        
        // Log token usage (simple stdout simulation)
        console.log(`[AI Usage] intent=${intent} model=${config.model} in=${response.usage?.promptTokens} out=${response.usage?.completionTokens}`);

        if (finalMessage.tool_calls && finalMessage.tool_calls.length > 0) {
          // Hide intermediate tool calls from final output array if desired,
          // but we usually want to keep them so UI knows what happened.
          newMessages.push(finalMessage);

          for (const toolCall of finalMessage.tool_calls) {
            try {
              const toolResult = await executeTool(toolCall.function.name, toolCall.function.arguments);
              const toolMessage: AIMessage = {
                role: "tool",
                content: toolResult,
                tool_call_id: toolCall.id,
                name: toolCall.function.name,
              };
              fullMessages.push(toolMessage);
              newMessages.push(toolMessage);
            } catch (err: any) {
              const errorMessage: AIMessage = {
                role: "tool",
                content: JSON.stringify({ error: err.message }),
                tool_call_id: toolCall.id,
                name: toolCall.function.name,
              };
              fullMessages.push(errorMessage);
              newMessages.push(errorMessage);
            }
          }
          // Loop again for the LLM to read the tool result
        } else {
          // No tools called, we are done
          newMessages.push(finalMessage);
          isDone = true;
        }
      }

      if (!isDone) {
        // We hit the max iterations limit
        newMessages.push({
          role: "assistant",
          content: "I've reached my thinking limit for this request. Is there a simpler way I can help?",
        });
      }

      return newMessages;

    } catch (error: any) {
      console.error("[AI Chat Error]:", error);
      const friendlyMsg = getUserFriendlyAIError(error);
      return [
        ...messages,
        { role: "assistant", content: friendlyMsg }
      ];
    }
  }
}
