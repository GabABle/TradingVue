import { Router, type IRouter } from "express";
import { openai } from "@workspace/integrations-openai-ai-server";

const router: IRouter = Router();

router.post("/chat", async (req, res) => {
  try {
    const { messages, context } = req.body as {
      messages: { role: "user" | "assistant"; content: string }[];
      context?: {
        symbol?: string;
        range?: string;
        interval?: string;
        showRSI?: boolean;
        showStoch?: boolean;
        smaPeriod?: number | null;
        emaPeriod?: number | null;
      };
    };

    if (!Array.isArray(messages) || messages.length === 0) {
      res.status(400).json({ error: "messages array is required" });
      return;
    }

    // Build a context-aware system prompt
    const ctxParts: string[] = [];
    if (context?.symbol)   ctxParts.push(`Current symbol: ${context.symbol}`);
    if (context?.range)    ctxParts.push(`Date range: ${context.range}`);
    if (context?.interval) ctxParts.push(`Bar interval: ${context.interval}`);
    if (context?.showRSI)  ctxParts.push("RSI indicator: ON");
    if (context?.showStoch) ctxParts.push("Stochastic Oscillator: ON");
    if (context?.smaPeriod) ctxParts.push(`SMA period: ${context.smaPeriod}`);
    if (context?.emaPeriod) ctxParts.push(`EMA period: ${context.emaPeriod}`);

    const systemPrompt = [
      "You are an expert trading and market analysis assistant embedded in a professional trading terminal.",
      "Help the user analyze charts, understand technical indicators, interpret price action, and make sense of market data.",
      "Be concise but insightful. Use clear financial terminology. Format numbers clearly.",
      "When relevant, consider the current chart context the user is viewing.",
      ctxParts.length > 0 ? `\nCurrent chart context:\n${ctxParts.join("\n")}` : "",
    ].filter(Boolean).join(" ");

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const stream = await openai.chat.completions.create({
      model: "gpt-5.2",
      max_completion_tokens: 8192,
      messages: [
        { role: "system", content: systemPrompt },
        ...messages,
      ],
      stream: true,
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        res.write(`data: ${JSON.stringify({ content })}\n\n`);
      }
    }

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (err) {
    req.log.error({ err }, "Chat error");
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to stream chat response" });
    } else {
      res.write(`data: ${JSON.stringify({ error: "Stream error" })}\n\n`);
      res.end();
    }
  }
});

export default router;
