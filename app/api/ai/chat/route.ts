import { NextResponse } from 'next/server';
import { AIService } from '@/lib/ai/AIService';
import { GroqProvider } from '@/lib/ai/providers/GroqProvider';
import { AIMessage } from '@/lib/ai/types';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { messages } = body as { messages: AIMessage[] };

    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json({ error: 'Invalid messages format' }, { status: 400 });
    }

    // Provider Factory (Strategy pattern selection)
    const aiProviderName = process.env.AI_PROVIDER || 'groq';
    let provider;

    if (aiProviderName === 'groq') {
      const groqKey = process.env.GROQ_API_KEY;
      if (!groqKey) {
        return NextResponse.json({ error: 'Groq API Key missing on server' }, { status: 500 });
      }
      provider = new GroqProvider(groqKey);
    } else {
      return NextResponse.json({ error: `Unsupported AI Provider: ${aiProviderName}` }, { status: 500 });
    }

    const aiService = new AIService(provider);
    
    // Execute chat sequence (this will handle tool calls internally)
    const newMessages = await aiService.chat(messages);

    return NextResponse.json({ messages: newMessages });

  } catch (error: any) {
    console.error('AI Chat Error:', error);
    // Don't leak exact error details in production
    return NextResponse.json({ 
      error: 'I couldn\'t reach the AI service right now. You can still manage your tasks normally.' 
    }, { status: 500 });
  }
}
