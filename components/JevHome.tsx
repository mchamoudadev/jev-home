"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import House3D from "./House3D";
import CopyPromptButton from "./CopyPromptButton";
import { applyCommands, touchedRooms } from "@/lib/apply";
import {
  ROOM_IDS,
  ROOM_NAMES,
  initialHouse,
  type Command,
  type CommandResponse,
  type HouseState,
  type RoomId,
} from "@/lib/house";

// No wake word is needed. If someone still says "Hey Jev" (heard as Jeff, Jet,
// Chef, HF...), it is stripped before the phrase goes to Jev.
const NAMES = "jev|jevs|jet|jets|jess|chev|jiff|jeff|jef|jeffs|jeffy|jeffrey|jeb|jed|jeph|geoff|chef|jav|jiv|jive|jay|jeeves|jeev|jv|j v|j\\.v\\.?";
const WAKE = new RegExp(
  `(?:\\b(?:hey|hi|hay|hei|ok|okay|a|yo)[\\s,.!]+(?:${NAMES})\\b|^(?:${NAMES})\\b|\\bh\\s?f\\b|\\bhey\\s?f\\b)[\\s,.!?]*`,
  "i",
);
// Words that make a phrase look like a home command (used while Jev is talking).
const HOME_WORDS = /\b(lights?|lamps?|outside|garden|porch|doors?|power|electricity|mains|fires?|flames?)\b/i;
// A phrase that also names where to act is probably complete, so it can go early.
const SCOPE_WORDS = /\b(bed ?room|kitchen|bath ?room|living ?room|lounge|all|every|everything|house|whole|power|electricity|mains|fires?)\b/i;
const EARLY_COMMIT_MS = 700;
const ECHO_GUARD_MS = 1500;

const words = (t: string) => t.toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter(Boolean);

// True when `text` is mostly Jev's own last reply picked up by the mic.
function isEcho(text: string, spoken: string) {
  const reply = new Set(words(spoken));
  const heard = words(text);
  if (!heard.length || !reply.size) return false;
  return heard.filter((w) => reply.has(w)).length / heard.length >= 0.6;
}

// Chrome often writes room numbers as homophones: "bedroom too", "kitchen won".
function normalizeCommand(text: string) {
  return text
    .replace(/\b(bed ?room|kitchen|bath ?room)\s+(too|to|tu)\b/gi, "$1 two")
    .replace(/\b(bed ?room|kitchen|bath ?room)\s+(won|juan)\b/gi, "$1 one")
    .replace(/\b(bed ?room|kitchen|bath ?room)\s+1\b/gi, "$1 one")
    .replace(/\b(bed ?room|kitchen|bath ?room)\s+2\b/gi, "$1 two");
}

function wakeSplit(text: string): string | null {
  const m = text.match(WAKE);
  return m ? text.slice((m.index ?? 0) + m[0].length).trim() : null;
}

type Status = "idle" | "listening" | "thinking" | "speaking";

const STATUS_TEXT: Record<Status, string> = {
  idle: "Offline",
  listening: "Listening — just say a command",
  thinking: "Jev is deciding…",
  speaking: "Jev is speaking",
};

interface LogEntry {
  id: number;
  kind: "command" | "alert" | "error";
  heard: string;
  reply: string;
  commands?: Command[];
  jevMs?: number;
  totalMs?: number;
}

interface SpeechResult extends ArrayLike<{ transcript: string }> {
  isFinal: boolean;
}
interface SpeechEvent {
  resultIndex: number;
  results: ArrayLike<SpeechResult>;
}
interface Recognizer {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onresult: ((e: SpeechEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}
type RecognizerCtor = new () => Recognizer;

function commandLabel(c: Command) {
  const where = c.target === "all" ? "house" : c.target === "outside" ? "outside" : ROOM_NAMES[c.target];
  return `${c.action.replace("_", " ")} · ${where} · ${Math.round(c.probability * 100)}%`;
}

export default function JevHome() {
  const [house, setHouse] = useState<HouseState>(initialHouse);
  const [flashes, setFlashes] = useState<Record<RoomId, number>>({} as Record<RoomId, number>);
  const [started, setStarted] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [heard, setHeard] = useState("");
  const [log, setLog] = useState<LogEntry[]>([]);
  const [micError, setMicError] = useState<string | null>(null);
  const [lastFinal, setLastFinal] = useState<{ text: string; verdict: string } | null>(null);
  const [recIssue, setRecIssue] = useState<string | null>(null);
  // False in the server HTML, true once React has hydrated. A click before that is lost.
  const hydrated = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  const houseRef = useRef(house);
  const speaking = useRef(0);
  const lastSpoken = useRef({ text: "", endedAt: 0 });
  const utterances = useRef(new Set<SpeechSynthesisUtterance>());
  const voice = useRef<SpeechSynthesisVoice | null>(null);
  const audio = useRef<AudioContext | null>(null);
  const logId = useRef(0);

  function commit(next: HouseState, rooms: RoomId[]) {
    houseRef.current = next;
    setHouse(next);
    if (rooms.length) {
      const now = performance.now();
      setFlashes((f) => ({ ...f, ...Object.fromEntries(rooms.map((r) => [r, now])) }));
    }
  }

  function addLog(entry: Omit<LogEntry, "id">) {
    const id = ++logId.current;
    setLog((l) => [{ ...entry, id }, ...l].slice(0, 8));
  }

  function tone(freqs: number[], dur: number, gain = 0.08) {
    const ctx = audio.current;
    if (!ctx) return;
    freqs.forEach((f, i) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      const t = ctx.currentTime + i * dur;
      osc.frequency.value = f;
      g.gain.setValueAtTime(gain, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(g).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + dur);
    });
  }

  function speak(text: string) {
    const u = new SpeechSynthesisUtterance(text);
    if (voice.current) u.voice = voice.current;
    u.rate = 1.1;
    // Chrome drops onend for utterances that get garbage-collected; hold a reference.
    utterances.current.add(u);
    speaking.current++;
    lastSpoken.current = { text, endedAt: Infinity };
    setStatus("speaking");
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      utterances.current.delete(u);
      speaking.current = Math.max(0, speaking.current - 1);
      if (speaking.current === 0) {
        lastSpoken.current = { text: lastSpoken.current.text, endedAt: performance.now() };
        setStatus("listening");
      }
    };
    u.onend = done;
    u.onerror = done;
    setTimeout(done, 2500 + text.length * 90);
    speechSynthesis.speak(u);
  }

  async function runCommand(text: string) {
    setStatus("thinking");
    const t0 = performance.now();
    let data: CommandResponse;
    try {
      const res = await fetch("/api/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      data = await res.json();
    } catch (err) {
      data = { commands: [], jevMs: 0, model: "", error: String(err) };
    }
    const totalMs = Math.round(performance.now() - t0);

    if (data.error) {
      addLog({ kind: "error", heard: text, reply: data.error, totalMs });
      speak("Sorry, I couldn't reach Jev.");
      return;
    }
    if (data.commands.length === 0) {
      // Background talk, not a home command: stay quiet.
      setLastFinal({ text, verdict: `Jev: not a home command (${data.jevMs} ms)` });
      setStatus(speaking.current ? "speaking" : "listening");
      return;
    }
    setLastFinal({ text, verdict: `Jev: done in ${data.jevMs} ms` });
    const { house: next, reply } = applyCommands(houseRef.current, data.commands);
    commit(next, touchedRooms(data.commands));
    addLog({ kind: "command", heard: text, reply, commands: data.commands, jevMs: data.jevMs, totalMs });
    speak(reply);
  }

  function onUtterance(alternatives: string[]) {
    const alts = alternatives.map((a) => (wakeSplit(a) ?? a).trim()).filter((a) => a.replace(/[^a-z]/gi, "").length >= 3);
    if (!alts.length) return;
    // Prefer an alternative that sounds like a home command.
    const text = alts.find((a) => HOME_WORDS.test(a)) ?? alts[0];
    const verdict = (v: string) => setLastFinal({ text, verdict: v });

    const jevTalking = speaking.current > 0 || performance.now() - lastSpoken.current.endedAt < ECHO_GUARD_MS;
    if (isEcho(text, lastSpoken.current.text)) {
      verdict("ignored — that was Jev talking");
      return;
    }
    if (jevTalking) {
      // While Jev talks, only a clear home command interrupts it.
      if (!HOME_WORDS.test(text)) {
        verdict("ignored — Jev was talking");
        return;
      }
      speechSynthesis.cancel();
    }

    verdict("sent to Jev…");
    const cleaned = normalizeCommand(text);
    setHeard(cleaned);
    void runCommand(cleaned);
  }

  function ignite() {
    const current = houseRef.current;
    const burning = ROOM_IDS.filter((r) => current.rooms[r].fire);
    if (burning.length >= 2) return;
    const candidates = ROOM_IDS.filter((r) => !current.rooms[r].fire);
    const room = candidates[Math.floor(Math.random() * candidates.length)];
    const next: HouseState = { ...current, rooms: { ...current.rooms, [room]: { ...current.rooms[room], fire: true } } };
    commit(next, [room]);
    const reply = `Warning! Fire detected in ${ROOM_NAMES[room]}.`;
    addLog({ kind: "alert", heard: "🔥 fire alarm", reply });
    speak(reply);
  }

  function start() {
    const w = window as unknown as { SpeechRecognition?: RecognizerCtor; webkitSpeechRecognition?: RecognizerCtor };
    const SR = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!SR) {
      setMicError("This browser has no speech recognition. Please open the app in Chrome.");
      return;
    }

    audio.current = new AudioContext();
    const pickVoice = () => {
      const voices = speechSynthesis.getVoices();
      voice.current =
        voices.find((v) => v.name === "Google US English") ??
        voices.find((v) => v.name.startsWith("Samantha")) ??
        voices.find((v) => v.lang === "en-US") ??
        null;
    };
    pickVoice();
    speechSynthesis.onvoiceschanged = pickVoice;

    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-US";
    rec.maxAlternatives = 5;

    // Chrome can take ~1s to finalize a phrase. If an interim result already
    // reads like a complete command and stops changing, act on it early.
    let early: { index: number; timer: ReturnType<typeof setTimeout> } | null = null;
    const committedEarly = new Set<number>();
    let fatal = false;

    const altsOf = (r: SpeechResult) => Array.from({ length: r.length }, (_, k) => r[k].transcript);

    rec.onstart = () => setRecIssue(null);
    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const alts = altsOf(r);
        if (r.isFinal) {
          if (early?.index === i) {
            clearTimeout(early.timer);
            early = null;
          }
          if (committedEarly.has(i)) committedEarly.delete(i);
          else onUtterance(alts);
        } else {
          interim = alts[0];
          if (early) clearTimeout(early.timer);
          early = null;
          const t = alts[0];
          if (HOME_WORDS.test(t) && SCOPE_WORDS.test(t) && t.trim().split(/\s+/).length >= 3) {
            const index = i;
            early = {
              index,
              timer: setTimeout(() => {
                committedEarly.add(index);
                early = null;
                onUtterance(alts);
              }, EARLY_COMMIT_MS),
            };
          }
        }
      }
      setHeard(interim);
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        fatal = true;
        setMicError("Microphone access was blocked. Allow the mic for this site in Chrome and reload.");
        setStatus("idle");
      } else if (e.error !== "no-speech" && e.error !== "aborted") {
        setRecIssue(`Speech recognition error: ${e.error}${e.error === "network" ? " (Chrome's speech service is unreachable)" : ""}`);
      }
    };
    rec.onend = () => {
      if (fatal) return;
      committedEarly.clear();
      setTimeout(() => {
        try {
          rec.start();
        } catch {
          /* already running */
        }
      }, 150);
    };
    rec.start();

    setStarted(true);
    setStatus("listening");
    speak("Hi, I'm Jev. Just tell me what to do.");

    // Dev-only hook so the voice pipeline can be exercised without a microphone.
    if (process.env.NODE_ENV !== "production") {
      (window as unknown as { jev: object }).jev = { say: (t: string) => onUtterance([t]), ignite };
    }
  }

  const anyFire = ROOM_IDS.some((r) => house.rooms[r].fire);

  // Alarm beeps while anything is burning.
  useEffect(() => {
    if (!anyFire) return;
    const id = setInterval(() => tone([880, 660], 0.18, 0.05), 1400);
    return () => clearInterval(id);
     
  }, [anyFire]);

  const fires = ROOM_IDS.filter((r) => house.rooms[r].fire);
  const litCount = ROOM_IDS.filter((r) => house.power && house.rooms[r].lights).length;
  const openCount = ROOM_IDS.filter((r) => house.rooms[r].doorOpen).length;

  return (
    <div className="app">
      <House3D house={house} flashes={flashes} />

      <header className="hud top-left">
        <div className="brand">
          Jev Home
          <small>Voice control · TypeSafe Jev 1.13 via OpenRouter</small>
        </div>
        <div className={`status ${status}`}>
          <span className="dot" />
          {STATUS_TEXT[status]}
        </div>
        <div className="heard">{heard ? `“${heard}”` : " "}</div>
        {lastFinal && (
          <div className="last-final">
            Heard “{lastFinal.text}” → <b>{lastFinal.verdict}</b>
          </div>
        )}
        {recIssue && <div className="rec-issue">{recIssue}</div>}
      </header>

      <aside className="hud top-right hints">
        <div className="hint-title">Just say…</div>
        <ul>
          <li>turn off the lights in bedroom two</li>
          <li>open the kitchen one door</li>
          <li>close every door</li>
          <li>turn off the outside lights</li>
          <li>cut the electricity / restore the power</li>
          <li>lights off and close the door in the living room</li>
        </ul>
      </aside>

      <section className="hud bottom-left log">
        {log.length === 0 && <div className="log-empty">Commands and Jev’s decisions appear here.</div>}
        {log.map((e) => (
          <div key={e.id} className={`log-entry ${e.kind}`}>
            <div className="log-heard">{e.heard}</div>
            {e.commands && e.commands.length > 0 && (
              <div className="chips">
                {e.commands.map((c, i) => (
                  <span key={i} className="chip">
                    {commandLabel(c)}
                  </span>
                ))}
              </div>
            )}
            <div className="log-reply">
              {e.reply}
              {e.jevMs !== undefined && (
                <span className="timing">
                  {" "}
                  · Jev {e.jevMs} ms · total {e.totalMs} ms
                </span>
              )}
            </div>
          </div>
        ))}
      </section>

      <section className="hud bottom-right house-status">
        <div className={`power ${house.power ? "on" : "off"}`}>⚡ Power {house.power ? "ON" : "OFF"}</div>
        <div>💡 {litCount}/7 rooms lit</div>
        <div>🌳 Outside lights {house.power && house.outsideLights ? "on" : "off"}</div>
        <div>🚪 {openCount}/7 doors open</div>
        <div className={fires.length ? "fire-alert" : ""}>
          🔥 {fires.length ? fires.map((r) => ROOM_NAMES[r]).join(", ") : "No fire"}
        </div>
      </section>

      {!started && !micError && (
        <div className="overlay">
          <button className="wake" onClick={start} disabled={!hydrated}>
            {hydrated ? "🎙️ Wake Jev" : "Loading…"}
          </button>
          <p>Chrome needs one click to allow the microphone and speaker. After that, everything is voice.</p>
        </div>
      )}
      <CopyPromptButton />

      {micError && (
        <div className="overlay">
          <p className="error">{micError}</p>
        </div>
      )}
    </div>
  );
}
