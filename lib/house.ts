export const ROOM_IDS = [
  "bedroom_1",
  "bedroom_2",
  "kitchen_1",
  "kitchen_2",
  "bathroom_1",
  "bathroom_2",
  "living_room",
] as const;

export type RoomId = (typeof ROOM_IDS)[number];
export type Target = RoomId | "all" | "outside";

export const ROOM_NAMES: Record<RoomId, string> = {
  bedroom_1: "Bedroom one",
  bedroom_2: "Bedroom two",
  kitchen_1: "Kitchen one",
  kitchen_2: "Kitchen two",
  bathroom_1: "Bathroom one",
  bathroom_2: "Bathroom two",
  living_room: "Living room",
};

// Actions Jev can pick per room. Power is house-wide and handled separately.
export const ROOM_ACTIONS = [
  "lights_off",
  "lights_on",
  "door_open",
  "door_close",
  "extinguish_fire",
] as const;

export type RoomAction = (typeof ROOM_ACTIONS)[number];
export type Action = RoomAction | "power_off" | "power_on";

export interface Command {
  action: Action;
  target: Target;
  probability: number;
}

export interface CommandResponse {
  commands: Command[];
  jevMs: number;
  model: string;
  error?: string;
}

export interface RoomState {
  lights: boolean;
  doorOpen: boolean;
  fire: boolean;
}

export interface HouseState {
  power: boolean;
  outsideLights: boolean;
  rooms: Record<RoomId, RoomState>;
}

export function initialHouse(): HouseState {
  const rooms = {} as Record<RoomId, RoomState>;
  for (const id of ROOM_IDS) rooms[id] = { lights: true, doorOpen: false, fire: false };
  return { power: true, outsideLights: true, rooms };
}
