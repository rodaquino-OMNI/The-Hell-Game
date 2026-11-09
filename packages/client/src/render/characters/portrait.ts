// Retrato de personagens para o teste de silhueta (Art Bible §5.1, marco A2): cena à parte com os modelos finais
// (.glb), desenhada pelo mesmo caminho do jogo (alvo na resolução interna do preset, material PS1, passe final).
// Modos: "preto" (silhueta em preto chapado), "cor" (cores dos tokens chapadas, sem luz) e "luz" (luz ambiente e
// luz do jogador do jogo, render.lights). Ferramenta de captura, sem efeito na partida: a câmera e o enquadramento
// vêm de quem chama (tools/art/a2-capturas.mjs).
import * as THREE from "three";
import { balance } from "../../data.ts";
import { skinDef, tok, WORLD } from "../../look.ts";
import { setHunterOutlineRetroView, type Ps1Material } from "../ps1.ts";
import type { RenderCtx } from "../scene.ts";
import { animateCharacter, charactersReady, createCharacter, setTelegraph } from "./runtime.ts";

export interface PortraitOptions {
  /** personagens (id da ficha), da esquerda para a direita */
  ids: string[];
  mode: "preto" | "cor" | "luz";
  /** giro do personagem em radianos: 0 = de frente para a câmera, π/2 = de lado, π = de costas */
  yaw: number;
  /** distância entre personagens vizinhos (m) */
  spacing: number;
  /** câmera: campo de visão vertical (graus), distância (m), altura da câmera e do ponto olhado (m) */
  fov: number; dist: number; camHeight: number; lookHeight: number;
  /** token do fundo */
  bg: string;
  /** skin vestida (chave da loja); sem ela, a padrão */
  skin?: string;
  /** olhos do caçador acesos (preparo) */
  telegraph?: boolean;
  /** instante do clipe idle (s) */
  t?: number;
}

/** material do retrato a partir do material do jogo: preto chapado ou cor chapada (sem luz) */
function portraitMaterial(src: THREE.Material, mode: PortraitOptions["mode"]): THREE.Material {
  if (mode === "luz") return src;
  const m = src.clone() as Ps1Material;
  delete m.defines.PS1_LIT;
  m.lights = false;
  m.fog = false;
  if (mode === "preto") m.color.setHex(0x000000);
  m.needsUpdate = true;
  return m;
}

export async function portrait(ctx: RenderCtx, o: PortraitOptions) {
  // retrato não é a 1ª pessoa do Retro: contorno com a intensidade cheia (issue #48)
  setHunterOutlineRetroView(false);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(tok(o.bg));
  const roots = o.ids.map(id => createCharacter(id, o.skin ? skinDef(o.skin) : undefined));
  await charactersReady();
  const [iw, ih] = balance.render.presets[ctx.presenter.preset].internal;
  const cam = new THREE.PerspectiveCamera(o.fov, iw / ih, balance.render.camera.near, balance.render.camera.far);
  cam.position.set(0, o.camHeight, o.dist);
  cam.lookAt(0, o.lookHeight, 0);
  cam.updateMatrixWorld();
  if (o.mode === "luz") {
    const l = balance.render.lights;
    scene.add(new THREE.AmbientLight(tok(WORLD.ambient), l.ambient * Math.PI));
    const pl = new THREE.PointLight(tok(WORLD.playerLight), l.player * Math.PI, balance.render.player_light_radius, l.player_decay);
    pl.position.set(0, l.player_height, o.dist);
    scene.add(pl);
  }
  roots.forEach((root, i) => {
    const x = (i - (roots.length - 1) / 2) * o.spacing;
    root.position.set(x, 0, 0);
    // rumo 0 da simulação olha para −Z; a câmera está em +Z
    root.rotation.y = Math.PI + o.yaw;
    animateCharacter(root, { x, z: 0, atk: 0 }, { t: o.t ?? 0, walk: balance.survivor.walk, run: balance.survivor.run });
    setTelegraph(root, !!o.telegraph);
    root.traverse(obj => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh) mesh.material = portraitMaterial(mesh.material as THREE.Material, o.mode);
    });
    scene.add(root);
  });
  scene.updateMatrixWorld(true);
  ctx.R.info.reset();
  ctx.presenter.present(scene, cam);
}
