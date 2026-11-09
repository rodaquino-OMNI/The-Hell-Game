// Ações remapeáveis do teclado (GDD v0.3 §12.2: "remapeamento de todas as ações"); padrão em `ui.controls.keyboard`.
// Arquivo sem zod: o cliente importa a lista em tempo de execução, e importar de schema.ts levaria o schema inteiro
// (e o zod) para o pacote do navegador (+145 KB, medido no perfil do V8).
export const CONTROL_ACTIONS = [
  "forward", "back", "left", "right", "run", "interact", "ability", "attack", "camera", "look_left", "look_right",
  "puzzle_confirm", "ping_1", "ping_2", "ping_3", "ping_4",
] as const;
export type ControlAction = (typeof CONTROL_ACTIONS)[number];
