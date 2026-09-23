import { decide } from "@/lib/jev";
import type { CommandResponse } from "@/lib/house";

export async function POST(request: Request) {
  const { text } = (await request.json()) as { text?: string };
  if (!text?.trim()) {
    return Response.json({ commands: [], jevMs: 0, model: "", error: "empty command" } satisfies CommandResponse, {
      status: 400,
    });
  }

  const started = performance.now();
  try {
    const { commands, model } = await decide(text.trim());
    const jevMs = Math.round(performance.now() - started);
    return Response.json({ commands, jevMs, model } satisfies CommandResponse);
  } catch (err) {
    const jevMs = Math.round(performance.now() - started);
    const error = err instanceof Error ? err.message : String(err);
    return Response.json({ commands: [], jevMs, model: "", error } satisfies CommandResponse, { status: 502 });
  }
}
