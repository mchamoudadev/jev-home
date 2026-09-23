"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { JSX } from "react";
import { ROOM_NAMES, type HouseState, type RoomId } from "@/lib/house";

const WALL_H = 2.2;
const WALL_T = 0.14;
const DOOR_W = 1.1;
const DOOR_H = 1.8;

type Kind = "bedroom" | "kitchen" | "bathroom" | "living";

interface RoomLayout {
  id: RoomId;
  kind: Kind;
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  floor: string;
}

// Back row (z -6..0) opens onto the front row; front row doors face the street (z = 6).
const LAYOUT: RoomLayout[] = [
  { id: "bedroom_1", kind: "bedroom", x0: -8, x1: -4, z0: -6, z1: 0, floor: "#8a6a4f" },
  { id: "bathroom_1", kind: "bathroom", x0: -4, x1: 0, z0: -6, z1: 0, floor: "#9fb3bf" },
  { id: "bathroom_2", kind: "bathroom", x0: 0, x1: 4, z0: -6, z1: 0, floor: "#9fb3bf" },
  { id: "bedroom_2", kind: "bedroom", x0: 4, x1: 8, z0: -6, z1: 0, floor: "#8a6a4f" },
  { id: "kitchen_1", kind: "kitchen", x0: -8, x1: -4, z0: 0, z1: 6, floor: "#b9b2a4" },
  { id: "living_room", kind: "living", x0: -4, x1: 4, z0: 0, z1: 6, floor: "#7d6450" },
  { id: "kitchen_2", kind: "kitchen", x0: 4, x1: 8, z0: 0, z1: 6, floor: "#b9b2a4" },
];

const WALL_COLOR = "#e9e4da";

function Box({
  pos,
  size,
  color,
  emissive,
  emissiveIntensity = 0,
}: {
  pos: [number, number, number];
  size: [number, number, number];
  color: string;
  emissive?: string;
  emissiveIntensity?: number;
}) {
  return (
    <mesh position={pos}>
      <boxGeometry args={size} />
      <meshStandardMaterial
        color={color}
        emissive={emissive ?? "#000"}
        emissiveIntensity={emissiveIntensity}
        roughness={0.85}
      />
    </mesh>
  );
}

// A wall running along x at depth z, with door-sized gaps centred on `gaps`.
function WallX({ x0, x1, z, gaps }: { x0: number; x1: number; z: number; gaps: number[] }) {
  const pieces: JSX.Element[] = [];
  let cursor = x0;
  const edges = [...gaps].sort((a, b) => a - b);
  edges.forEach((g, i) => {
    const a = g - DOOR_W / 2;
    const b = g + DOOR_W / 2;
    if (a > cursor) pieces.push(<Box key={`s${i}`} pos={[(cursor + a) / 2, WALL_H / 2, z]} size={[a - cursor, WALL_H, WALL_T]} color={WALL_COLOR} />);
    pieces.push(
      <Box key={`l${i}`} pos={[g, DOOR_H + (WALL_H - DOOR_H) / 2, z]} size={[DOOR_W, WALL_H - DOOR_H, WALL_T]} color={WALL_COLOR} />,
    );
    cursor = b;
  });
  if (x1 > cursor) pieces.push(<Box key="end" pos={[(cursor + x1) / 2, WALL_H / 2, z]} size={[x1 - cursor, WALL_H, WALL_T]} color={WALL_COLOR} />);
  return <>{pieces}</>;
}

function Walls({ r }: { r: RoomLayout }) {
  const { x0, x1, z0, z1 } = r;
  const d = z1 - z0;
  const cx = (x0 + x1) / 2;
  // Front-row rooms need openings where the back-row doors lead into them.
  const backGaps = LAYOUT.filter((o) => o.z1 === z0)
    .map((o) => (o.x0 + o.x1) / 2)
    .filter((x) => x > x0 && x < x1);
  return (
    <group>
      <WallX x0={x0} x1={x1} z={z0 + WALL_T / 2} gaps={backGaps} />
      <Box pos={[x0 + WALL_T / 2, WALL_H / 2, (z0 + z1) / 2]} size={[WALL_T, WALL_H, d]} color={WALL_COLOR} />
      <Box pos={[x1 - WALL_T / 2, WALL_H / 2, (z0 + z1) / 2]} size={[WALL_T, WALL_H, d]} color={WALL_COLOR} />
      <WallX x0={x0} x1={x1} z={z1 - WALL_T / 2} gaps={[cx]} />
    </group>
  );
}

function Door({ r, open }: { r: RoomLayout; open: boolean }) {
  const hinge = useRef<THREE.Group>(null);
  const cx = (r.x0 + r.x1) / 2;
  useFrame((_, dt) => {
    if (!hinge.current) return;
    const target = open ? Math.PI * 0.48 : 0;
    hinge.current.rotation.y = THREE.MathUtils.damp(hinge.current.rotation.y, target, 6, dt);
  });
  return (
    <group position={[cx - DOOR_W / 2, 0, r.z1 - WALL_T / 2]}>
      <group ref={hinge}>
        <Box pos={[DOOR_W / 2, DOOR_H / 2, 0]} size={[DOOR_W - 0.04, DOOR_H - 0.02, 0.07]} color="#6b3f22" />
        <Box pos={[DOOR_W - 0.16, DOOR_H / 2, 0.06]} size={[0.06, 0.06, 0.06]} color="#d8b35a" />
      </group>
      {/* status lamp above the door: green open, red closed */}
      <mesh position={[DOOR_W / 2, DOOR_H + 0.18, 0.09]}>
        <sphereGeometry args={[0.07, 12, 12]} />
        <meshStandardMaterial
          color={open ? "#3ddc84" : "#ff4d4d"}
          emissive={open ? "#3ddc84" : "#ff4d4d"}
          emissiveIntensity={2}
        />
      </mesh>
    </group>
  );
}

function RoomLight({ r, on }: { r: RoomLayout; on: boolean }) {
  const light = useRef<THREE.PointLight>(null);
  const bulb = useRef<THREE.MeshStandardMaterial>(null);
  const cx = (r.x0 + r.x1) / 2;
  const cz = (r.z0 + r.z1) / 2;
  const peak = r.kind === "living" ? 30 : 18;
  useFrame((_, dt) => {
    if (light.current) light.current.intensity = THREE.MathUtils.damp(light.current.intensity, on ? peak : 0, 10, dt);
    if (bulb.current) bulb.current.emissiveIntensity = THREE.MathUtils.damp(bulb.current.emissiveIntensity, on ? 3 : 0, 10, dt);
  });
  return (
    <group position={[cx, WALL_H + 0.1, cz]}>
      <pointLight ref={light} color="#ffd9a0" intensity={peak} distance={r.kind === "living" ? 7 : 4.8} decay={1.2} />
      <mesh>
        <sphereGeometry args={[0.16, 16, 16]} />
        <meshStandardMaterial ref={bulb} color="#fff3d6" emissive="#ffcf7a" emissiveIntensity={3} />
      </mesh>
    </group>
  );
}

function Flames({ r }: { r: RoomLayout }) {
  const group = useRef<THREE.Group>(null);
  const light = useRef<THREE.PointLight>(null);
  const cx = (r.x0 + r.x1) / 2 + 0.6;
  const cz = (r.z0 + r.z1) / 2 + 0.4;
  const tongues = useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) => ({
        x: Math.cos(i * 2.4) * 0.35 * (i % 3 === 0 ? 0.2 : 1),
        z: Math.sin(i * 2.4) * 0.35 * (i % 3 === 0 ? 0.2 : 1),
        h: 0.7 + (i % 3) * 0.35,
        phase: i * 1.7,
        color: i % 2 ? "#ff7a1a" : "#ffc233",
      })),
    [],
  );
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    group.current?.children.forEach((c, i) => {
      const f = tongues[i];
      c.scale.y = 0.75 + 0.35 * Math.sin(t * 9 + f.phase) + 0.15 * Math.sin(t * 23 + f.phase);
      c.rotation.z = 0.12 * Math.sin(t * 5 + f.phase);
    });
    if (light.current) light.current.intensity = 16 + 8 * Math.sin(t * 13) + 5 * Math.sin(t * 31);
  });
  return (
    <group position={[cx, 0, cz]}>
      <pointLight ref={light} position={[0, 1, 0]} color="#ff6a1a" distance={7} decay={1.5} />
      <group ref={group}>
        {tongues.map((f, i) => (
          <mesh key={i} position={[f.x, f.h / 2, f.z]}>
            <coneGeometry args={[0.22, f.h, 10]} />
            <meshStandardMaterial color={f.color} emissive={f.color} emissiveIntensity={2.5} transparent opacity={0.9} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

function Furniture({ r, power }: { r: RoomLayout; power: boolean }) {
  const cx = (r.x0 + r.x1) / 2;
  const cz = (r.z0 + r.z1) / 2;
  switch (r.kind) {
    case "bedroom":
      return (
        <group>
          <Box pos={[cx, 0.25, r.z0 + 1.4]} size={[1.8, 0.5, 2.3]} color="#4d5b8c" />
          <Box pos={[cx, 0.55, r.z0 + 0.55]} size={[1.5, 0.18, 0.45]} color="#f2efe8" />
          <Box pos={[cx, 0.6, r.z0 + 0.2]} size={[1.9, 1.2, 0.12]} color="#5a3b26" />
          <Box pos={[r.x1 - 0.5, 0.3, r.z0 + 0.6]} size={[0.55, 0.6, 0.55]} color="#6d4a31" />
          <Box pos={[r.x0 + 0.45, 0.9, cz + 0.8]} size={[0.6, 1.8, 1.4]} color="#7b5a3e" />
        </group>
      );
    case "bathroom":
      return (
        <group>
          <Box pos={[cx - 0.6, 0.3, r.z0 + 0.9]} size={[2.2, 0.6, 1.1]} color="#f7f7f7" />
          <Box pos={[cx - 0.6, 0.55, r.z0 + 0.9]} size={[1.9, 0.1, 0.8]} color="#7fc6e6" />
          <Box pos={[r.x1 - 0.6, 0.25, cz + 0.6]} size={[0.5, 0.5, 0.65]} color="#ffffff" />
          <Box pos={[r.x0 + 0.5, 0.45, cz + 0.7]} size={[0.7, 0.9, 0.6]} color="#dcdcdc" />
          <Box
            pos={[r.x0 + 0.2, 1.45, cz + 0.7]}
            size={[0.04, 0.7, 0.55]}
            color="#cfe8f5"
            emissive="#bfe6ff"
            emissiveIntensity={power ? 0.6 : 0}
          />
        </group>
      );
    case "kitchen":
      return (
        <group>
          <Box pos={[cx, 0.45, r.z0 + 0.45]} size={[r.x1 - r.x0 - 0.4, 0.9, 0.7]} color="#5e6b73" />
          <Box pos={[cx, 0.92, r.z0 + 0.45]} size={[r.x1 - r.x0 - 0.4, 0.05, 0.75]} color="#e8e2d6" />
          <Box pos={[r.x0 + 0.5, 0.95, cz + 0.2]} size={[0.75, 1.9, 0.75]} color="#d7dde2" />
          <Box
            pos={[r.x0 + 0.89, 1.3, cz + 0.2]}
            size={[0.02, 0.06, 0.4]}
            color="#58e0ff"
            emissive="#58e0ff"
            emissiveIntensity={power ? 3 : 0}
          />
          <Box pos={[cx + 0.3, 0.4, cz + 0.9]} size={[1.4, 0.8, 0.9]} color="#a57a52" />
          {/* stove burner glow */}
          <Box
            pos={[cx + 0.7, 0.96, r.z0 + 0.45]}
            size={[0.35, 0.02, 0.35]}
            color="#330000"
            emissive="#ff3b1f"
            emissiveIntensity={power ? 1.6 : 0}
          />
        </group>
      );
    case "living":
      return (
        <group>
          <Box pos={[cx, 0.02, cz + 0.3]} size={[4, 0.03, 2.6]} color="#8c3b3b" />
          <Box pos={[cx, 0.35, cz + 1.4]} size={[3, 0.7, 0.9]} color="#3f6f68" />
          <Box pos={[cx, 0.8, cz + 1.8]} size={[3, 0.6, 0.2]} color="#3f6f68" />
          <Box pos={[cx, 0.22, cz]} size={[1.4, 0.44, 0.8]} color="#6d4a31" />
          <Box pos={[cx, 0.35, r.z0 + 0.45]} size={[2.6, 0.7, 0.5]} color="#3a2a20" />
          <Box
            pos={[cx, 1.35, r.z0 + 0.28]}
            size={[2.4, 1.2, 0.06]}
            color="#0a0a0a"
            emissive="#3d8bff"
            emissiveIntensity={power ? 1.4 : 0}
          />
        </group>
      );
  }
}

function Room({ r, house, flashAt }: { r: RoomLayout; house: HouseState; flashAt: number }) {
  const s = house.rooms[r.id];
  const lit = house.power && s.lights;
  const floorMat = useRef<THREE.MeshStandardMaterial>(null);
  useFrame(() => {
    if (!floorMat.current) return;
    const age = (performance.now() - flashAt) / 1000;
    floorMat.current.emissiveIntensity = age < 1.2 ? 0.6 * (1 - age / 1.2) : 0;
  });
  const cx = (r.x0 + r.x1) / 2;
  const cz = (r.z0 + r.z1) / 2;
  return (
    <group>
      <mesh position={[cx, 0, cz]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[r.x1 - r.x0, r.z1 - r.z0]} />
        <meshStandardMaterial ref={floorMat} color={r.floor} emissive="#6fc3ff" emissiveIntensity={0} roughness={0.9} />
      </mesh>
      <Walls r={r} />
      <Door r={r} open={s.doorOpen} />
      <RoomLight r={r} on={lit} />
      <Furniture r={r} power={house.power} />
      {s.fire && <Flames r={r} />}
    </group>
  );
}

// Garden lamp posts around the house: corners, sides, back, and either side of the front path.
const LAMP_POSTS: [number, number][] = [
  [-9.6, -7.4], [0, -7.6], [9.6, -7.4],
  [-9.8, 0], [9.8, 0],
  [-9.6, 7.8], [-2.4, 8.2], [2.4, 8.2], [9.6, 7.8],
];

function LampPost({ x, z, on }: { x: number; z: number; on: boolean }) {
  const light = useRef<THREE.PointLight>(null);
  const head = useRef<THREE.MeshStandardMaterial>(null);
  useFrame((_, dt) => {
    if (light.current) light.current.intensity = THREE.MathUtils.damp(light.current.intensity, on ? 14 : 0, 10, dt);
    if (head.current) head.current.emissiveIntensity = THREE.MathUtils.damp(head.current.emissiveIntensity, on ? 4 : 0, 10, dt);
  });
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 1.1, 0]}>
        <cylinderGeometry args={[0.06, 0.09, 2.2, 10]} />
        <meshStandardMaterial color="#2b2f36" metalness={0.4} roughness={0.5} />
      </mesh>
      <mesh position={[0, 2.3, 0]}>
        <sphereGeometry args={[0.2, 16, 16]} />
        <meshStandardMaterial ref={head} color="#fff1cf" emissive="#ffd27a" emissiveIntensity={4} />
      </mesh>
      <pointLight ref={light} position={[0, 2.2, 0]} color="#ffe2a8" intensity={14} distance={7} decay={1.3} />
    </group>
  );
}

function Garden({ lampsOn }: { lampsOn: boolean }) {
  return (
    <group>
      {/* front path from the street to the living room door */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, 8.5]}>
        <planeGeometry args={[1.6, 5]} />
        <meshStandardMaterial color="#8d8a82" roughness={1} />
      </mesh>
      {[-7.5, -4.8, 4.8, 7.5].map((x) => (
        <mesh key={x} position={[x, 0.4, 7.4]}>
          <sphereGeometry args={[0.55, 14, 12]} />
          <meshStandardMaterial color="#2f5d34" roughness={1} />
        </mesh>
      ))}
      {LAMP_POSTS.map(([x, z]) => (
        <LampPost key={`${x},${z}`} x={x} z={z} on={lampsOn} />
      ))}
    </group>
  );
}

// Projects each room's label anchor to screen space every frame and moves the
// matching DOM label there (plain DOM instead of drei <Html>, which trips over
// React 19 root unmounting in dev).
function LabelProjector() {
  const { camera, size } = useThree();
  const v = useMemo(() => new THREE.Vector3(), []);
  const els = useRef<Partial<Record<RoomId, HTMLDivElement | null>>>({});
  useFrame(() => {
    for (const r of LAYOUT) {
      let el = els.current[r.id];
      if (!el?.isConnected) el = els.current[r.id] = document.querySelector<HTMLDivElement>(`[data-room-label="${r.id}"]`);
      if (!el) continue;
      v.set((r.x0 + r.x1) / 2, WALL_H + 0.7, (r.z0 + r.z1) / 2).project(camera);
      const x = (v.x * 0.5 + 0.5) * size.width;
      const y = (-v.y * 0.5 + 0.5) * size.height;
      el.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px)`;
    }
  });
  return null;
}

export default function House3D({ house, flashes }: { house: HouseState; flashes: Record<RoomId, number> }) {
  return (
    <div className="scene">
      <Canvas camera={{ position: [0, 16, 16], fov: 45 }} dpr={[1, 2]}>
        <color attach="background" args={["#0b1020"]} />
        <fog attach="fog" args={["#0b1020", 30, 60]} />
        <ambientLight intensity={0.05} color="#8aa0ff" />
        <directionalLight position={[-10, 14, 8]} intensity={0.12} color="#9fb4ff" />
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
          <planeGeometry args={[80, 80]} />
          <meshStandardMaterial color="#1b2a1f" roughness={1} />
        </mesh>
        {LAYOUT.map((r) => (
          <Room key={r.id} r={r} house={house} flashAt={flashes[r.id] ?? 0} />
        ))}
        <Garden lampsOn={house.power && house.outsideLights} />
        <LabelProjector />
        <OrbitControls
          target={[0, 0, 0]}
          enablePan={false}
          minDistance={10}
          maxDistance={30}
          maxPolarAngle={Math.PI * 0.42}
          enableDamping
        />
      </Canvas>
      <div className="labels">
        {LAYOUT.map((r) => {
          const s = house.rooms[r.id];
          const lit = house.power && s.lights;
          return (
            <div
              key={r.id}
              data-room-label={r.id}
              className={`room-label${s.fire ? " fire" : ""}${lit ? "" : " dark"}`}
            >
              <span>{ROOM_NAMES[r.id]}</span>
              <span className="room-icons">
                {lit ? "💡 on" : "⚫ off"} · {s.doorOpen ? "🚪 open" : "🚪 shut"}
                {s.fire ? " · 🔥" : ""}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
