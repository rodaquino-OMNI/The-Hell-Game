// Ações remapeáveis do teclado (GDD v0.3 §12.2: "remapeamento de todas as ações"); padrão em `ui.controls.keyboard`.
// Arquivo sem zod: o cliente importa a lista em tempo de execução, e importar de schema.ts levaria o schema inteiro
// (e o zod) para o pacote do navegador (+145 KB, medido no perfil do V8).
export const CONTROL_ACTIONS = [
  "forward", "back", "left", "right", "run", "interact", "ability", "attack", "camera", "look_left", "look_right",
  "puzzle_confirm", "ping_1", "ping_2", "ping_3", "ping_4", "mute", "tutorial_skip",
] as const;
export type ControlAction = (typeof CONTROL_ACTIONS)[number];

/**
 * Teclas que podem virar atalho (KeyboardEvent.code, https://www.w3.org/TR/uievents-code/): só as que o navegador não
 * usa sozinhas. Ficam de fora F1–F12 (F5 recarrega, F11 tela cheia, F12 ferramentas), Alt e Meta (menu e sistema),
 * ContextMenu, Tab (navegação, WCAG 2.1.2), Esc (cancela a captura e fecha diálogos), / e ' (busca rápida do Firefox)
 * e as de navegação de página (PageUp/Down, Home, End). Vale para o remapeamento no cliente (bindings.ts) e para o
 * padrão em data/balance.yaml (`ui.controls.keyboard`, conferido pelo schema). Lista técnica, não número de jogo.
 */
export const SAFE_KEY_CODE = /^(Key[A-Z]|Digit[0-9]|Numpad[0-9]|Arrow(Up|Down|Left|Right)|Space|Enter|Backspace|(Shift|Control)(Left|Right)|Comma|Period|Semicolon|Minus|Equal|Bracket(Left|Right)|Backslash|Backquote|Numpad(Add|Subtract|Multiply|Decimal|Enter))$/;
