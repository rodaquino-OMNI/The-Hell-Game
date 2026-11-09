// Modo "Retro FPS" ligado ou não (V9; D-13, D-14, D-15 em docs/plano-construcao.md §7; respostas do A2b na issue #27).
// Fonte de jogador: a opção do menu (Opções > Vídeo, ui/settings.ts `retroFps`, aplicada por ui/apply.ts), desligada
// por padrão. Caminho de depuração: `?retro=1` só com `?debug=1` (D-33; render/options.ts `urlRetro`), usado pelas
// ferramentas de captura e de orçamento. Lido ao montar a partida (main.ts init → scene.ts buildWorld/buildActors):
// mudar a opção no menu vale na próxima partida.
import { urlRetro } from "../options.ts";

let option = false;

/** opção do menu (ui/apply.ts) */
export function setRetroOption(on: boolean) { option = on; }
export const getRetroOption = () => option;

/** modo ligado: opção do jogador ou `?retro=1` com `?debug=1` */
export const retroMode = () => option || urlRetro;
