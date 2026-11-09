// Modos daltônicos de data/art/palette.json (`modos_daltonico`; GDD v0.3 §12.4, Art Bible §5.2), na ordem do menu.
// Arquivo sem zod: o cliente importa a lista em tempo de execução, e importar de art.ts levaria os schemas e o zod
// para o pacote do navegador (+145 KB, medido no perfil do V8).
export const COLOR_MODES = ["protanopia", "deuteranopia", "tritanopia"] as const;
export type ColorMode = (typeof COLOR_MODES)[number];
