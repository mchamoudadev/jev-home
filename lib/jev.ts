import "server-only";
import {
  ROOM_ACTIONS,
  ROOM_IDS,
  type Action,
  type Command,
  type RoomAction,
} from "./house";

const DECISIONS_URL = "https://openrouter.ai/api/alpha/decisions";
const MODEL = "typesafe/jev-1.13";
const THRESHOLD = 0.6;
// House-wide commands are the vaguest reading of a phrase, so they need more certainty.
const ALL_THRESHOLD = 0.85;
const COMMAND_GATE = 0.5;

const ROOM_PHRASES: Record<(typeof ROOM_IDS)[number], string> = {
  bedroom_1: "bedroom one",
  bedroom_2: "bedroom two",
  kitchen_1: "kitchen one",
  kitchen_2: "kitchen two",
  bathroom_1: "bathroom one",
  bathroom_2: "bathroom two",
  living_room: "the living room",
};

const ACTION_PHRASES: Record<RoomAction, string> = {
  lights_off: "turn off the lights in",
  lights_on: "turn on the lights in",
  door_open: "open the door of",
  door_close: "close the door of",
  extinguish_fire: "put out the fire in",
};

type Noul = { type: "noul"; instructions: string };

// Speculative fan-out: one noul per (action, room) pair plus the house-wide
// power switches. Jev answers all of them in parallel in a single call, and
// code below keeps the ones that fired. This also handles compound requests
// ("lights off and close the door in bedroom one") without an LLM split step.
function buildQuestions(): Record<string, Noul> {
  const q: Record<string, Noul> = {};
  for (const action of ROOM_ACTIONS) {
    const verb = ACTION_PHRASES[action];
    q[`${action}__all`] = {
      type: "noul",
      instructions: `The voice_command asks to ${verb} every room of the house (or names no specific room)`,
    };
    for (const room of ROOM_IDS) {
      q[`${action}__${room}`] = {
        type: "noul",
        instructions: `The voice_command asks to ${verb} ${ROOM_PHRASES[room]}`,
      };
    }
  }
  for (const action of ["lights_off", "lights_on"] as const) {
    q[`${action}__outside`] = {
      type: "noul",
      instructions: `The voice_command asks to ${ACTION_PHRASES[action]} the outside of the house (outdoor, exterior, garden, yard, porch or street lights around the house)`,
    };
  }
  q.is_command = {
    type: "noul",
    instructions:
      "The voice_command is an instruction to the smart home to control lights (inside or outside), doors, the electricity, or a fire (not a question, remark, or unrelated chatter)",
  };
  q.power_off = {
    type: "noul",
    instructions:
      "The voice_command explicitly asks to cut the electricity or main power supply of the house (the words electricity, power or mains appear). Asking only about lights does NOT count.",
  };
  q.power_on = {
    type: "noul",
    instructions:
      "The voice_command explicitly asks to restore the electricity or main power supply of the house (the words electricity, power or mains appear). Asking only about lights does NOT count.",
  };
  return q;
}

const QUESTIONS = buildQuestions();

function toCommands(nouls: Record<string, number>): Command[] {
  const commands: Command[] = [];
  if ((nouls.is_command ?? 0) < COMMAND_GATE) return commands;
  const powerOff = (nouls.power_off ?? 0) >= THRESHOLD;
  const powerOn = (nouls.power_on ?? 0) >= THRESHOLD;
  if (powerOff) commands.push({ action: "power_off", target: "all", probability: nouls.power_off });
  if (powerOn) commands.push({ action: "power_on", target: "all", probability: nouls.power_on });

  for (const action of ROOM_ACTIONS) {
    // A power command already covers the house-wide lights.
    if (powerOff && action === "lights_off") continue;
    if (powerOn && action === "lights_on") continue;

    const all = nouls[`${action}__all`] ?? 0;
    const outside = nouls[`${action}__outside`] ?? 0;
    const rooms = ROOM_IDS.filter((r) => (nouls[`${action}__${r}`] ?? 0) >= THRESHOLD);
    if (rooms.length > 0) {
      for (const r of rooms) commands.push({ action, target: r, probability: nouls[`${action}__${r}`] });
    } else if (all >= ALL_THRESHOLD && outside < THRESHOLD) {
      commands.push({ action, target: "all", probability: all });
    }
    if (outside >= THRESHOLD) commands.push({ action, target: "outside", probability: outside });
  }
  return dropContradictions(commands);
}

const OPPOSITE: Partial<Record<Action, Action>> = {
  lights_off: "lights_on",
  lights_on: "lights_off",
  door_open: "door_close",
  door_close: "door_open",
  power_off: "power_on",
  power_on: "power_off",
};

function dropContradictions(commands: Command[]): Command[] {
  return commands.filter((c) => {
    const opp = OPPOSITE[c.action];
    const rival = commands.find((o) => o.action === opp && o.target === c.target);
    return !rival || rival.probability < c.probability;
  });
}

export async function decide(text: string): Promise<{ commands: Command[]; model: string }> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY is not set");

  const res = await fetch(DECISIONS_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, state: { voice_command: text }, questions: QUESTIONS }),
  });
  if (!res.ok) throw new Error(`Jev ${res.status}: ${(await res.text()).slice(0, 300)}`);

  const data = (await res.json()) as {
    model: string;
    answers: Record<string, { type: string; noul?: number }>;
  };
  const nouls: Record<string, number> = {};
  for (const [k, v] of Object.entries(data.answers)) nouls[k] = v.noul ?? 0;
  return { commands: toCommands(nouls), model: data.model };
}
