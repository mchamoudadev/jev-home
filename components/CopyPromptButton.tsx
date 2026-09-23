"use client";

import { useState } from "react";
import { VOICE_PROMPT } from "@/lib/voicePrompt";

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for browsers or contexts without the async clipboard API.
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  }
}

export default function CopyPromptButton() {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  async function onClick() {
    setState((await copyText(VOICE_PROMPT)) ? "copied" : "failed");
    setTimeout(() => setState("idle"), 2500);
  }

  return (
    <button className={`copy-prompt ${state}`} onClick={onClick}>
      {state === "copied" ? "✅ Prompt copied!" : state === "failed" ? "⚠️ Copy failed — try again" : "📋 Copy Somali voice prompt"}
    </button>
  );
}
