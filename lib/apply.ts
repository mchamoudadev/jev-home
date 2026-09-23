import { ROOM_IDS, ROOM_NAMES, type Command, type HouseState, type RoomId, type Target } from "./house";

const where = (t: Target) => (t === "all" ? "all rooms" : t === "outside" ? "Outside" : ROOM_NAMES[t]);
const roomsOf = (t: Target): RoomId[] => (t === "all" ? [...ROOM_IDS] : t === "outside" ? [] : [t]);

// Applies Jev's commands to the house and returns the sentence Jev speaks back.
export function applyCommands(house: HouseState, commands: Command[]): { house: HouseState; reply: string } {
  const next: HouseState = { ...house, rooms: structuredClone(house.rooms) };
  const said: string[] = [];

  for (const c of commands) {
    const rooms = roomsOf(c.target);
    switch (c.action) {
      case "power_off":
        next.power = false;
        said.push("Power cut. The whole house is off.");
        break;
      case "power_on":
        next.power = true;
        for (const r of ROOM_IDS) next.rooms[r].lights = true;
        next.outsideLights = true;
        said.push("Power restored.");
        break;
      case "lights_off":
        rooms.forEach((r) => (next.rooms[r].lights = false));
        if (c.target === "all" || c.target === "outside") next.outsideLights = false;
        said.push(c.target === "all" ? "All lights off." : `${where(c.target)} lights off.`);
        break;
      case "lights_on":
        rooms.forEach((r) => (next.rooms[r].lights = true));
        if (c.target === "all" || c.target === "outside") next.outsideLights = true;
        said.push(
          next.power
            ? c.target === "all"
              ? "All lights on."
              : `${where(c.target)} lights on.`
            : "The power is off, so the lights can't come on. Ask me to restore the power.",
        );
        break;
      case "door_open":
        rooms.forEach((r) => (next.rooms[r].doorOpen = true));
        said.push(c.target === "all" ? "All doors open." : `${where(c.target)} door open.`);
        break;
      case "door_close":
        rooms.forEach((r) => (next.rooms[r].doorOpen = false));
        said.push(c.target === "all" ? "All doors closed." : `${where(c.target)} door closed.`);
        break;
      case "extinguish_fire": {
        const burning = rooms.filter((r) => next.rooms[r].fire);
        burning.forEach((r) => (next.rooms[r].fire = false));
        if (burning.length === 0) said.push(c.target === "all" ? "There's no fire right now." : `There's no fire in ${where(c.target)}.`);
        else said.push(`Fire in ${burning.map((r) => ROOM_NAMES[r]).join(" and ")} is out.`);
        break;
      }
    }
  }

  return { house: next, reply: said.length ? said.join(" ") : "Sorry, that didn't sound like a home command." };
}

export function touchedRooms(commands: Command[]): RoomId[] {
  return [...new Set(commands.flatMap((c) => roomsOf(c.target)))];
}
