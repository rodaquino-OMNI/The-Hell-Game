Quantização do passe final: 5 bits por canal (render.ps1.color_bits), dither Bayer 4×4. Portões: cor exata e média do padrão 4×4 (cor percebida); "pior pixel" é aviso.

## Tokens (15 bits → hex)

| Token | RGB 5 bits | Hex | Variantes após o passe final | Uso |
| --- | --- | --- | --- | --- |
| `ui.bg` | 2, 2, 3 | #101019 | 3 | fundo de menus |
| `ui.panel` | 4, 4, 6 | #212131 | 2 | molduras 9-slice, painéis |
| `ui.text` | 29, 28, 26 | #EFE6D6 | 3 | texto principal (osso) |
| `ui.text_dim` | 19, 19, 20 | #9C9CA5 | 3 | texto secundário |
| `ui.accent` | 31, 22, 6 | #FFB531 | 2 | foco de teclado, seleção |
| `ui.danger` | 31, 9, 5 | #FF4A29 | 1 | alertas, vida baixa |
| `world.fog` | 3, 4, 6 | #192131 | 3 | névoa e fundo a 30 m |
| `world.wall` | 6, 6, 7 | #31313A | 3 | paredes (concreto frio) |
| `world.ground` | 6, 6, 5 | #313129 | 2 | chão |
| `class.curandeiro` | 0, 19, 14 | #009C73 | 2 | Curandeiro |
| `class.mecanico` | 28, 19, 0 | #E69C00 | 2 | Mecânico |
| `class.atacador` | 28, 8, 8 | #E64242 | 2 | Atacador |
| `class.batedor` | 29, 28, 8 | #EFE642 | 3 | Batedor (fase 4) |
| `class.protetor` | 26, 26, 29 | #D6D6EF | 2 | Protetor (fase 4) |
| `gen.pendente` | 26, 12, 0 | #D66300 | 2 | gerador não iniciado |
| `gen.progresso` | 30, 27, 6 | #F7DE31 | 2 | gerador em progresso |
| `gen.pronto` | 4, 24, 20 | #21C5A5 | 3 | gerador pronto |
| `gen.bonus` | 29, 12, 27 | #EF63DE | 2 | gerador bônus |
| `hunter.olhos` | 31, 4, 2 | #FF2110 | 2 | olhos emissivos e telegraph (GDD §10.4) |
| `hunter.espectro` | 22, 23, 25 | #B5BDCE | 2 | Espectro (lançamento) |
| `hunter.carcereiro` | 20, 11, 4 | #A55A21 | 3 | O Carcereiro |
| `hunter.lamento` | 18, 12, 28 | #9463E6 | 3 | O Lamento |
| `fx.ameaca` | 31, 9, 5 | #FF4A29 | 1 | seta de ameaça na borda (GDD §12.1) |
| `fx.preso` | 31, 22, 6 | #FFB531 | 2 | marcador de aliado preso |
| `char.pele` | 27, 22, 18 | #DEB594 | 1 | pele (rosto e mãos) dos sobreviventes |
| `char.calca` | 8, 8, 10 | #424252 | 2 | calça e quadril (secundária: a skin troca) |
| `char.sapato` | 3, 3, 4 | #191921 | 2 | sapatos (secundária: a skin troca) |
| `char.metal` | 19, 19, 21 | #9C9CAD | 3 | chave inglesa, bossa do escudo |
| `char.madeira` | 22, 16, 9 | #B5844A | 2 | haste do cajado do Curandeiro |
| `char.lamina` | 24, 25, 27 | #C5CEDE | 3 | lâmina da espada, asas do caduceu |
| `char.couro` | 8, 5, 3 | #422919 | 2 | guarda da espada |
| `char.cachecol` | 8, 16, 28 | #4284E6 | 3 | cachecol do Batedor (não pode ser ui.accent: é a cor de fx.preso) |
| `char.lanterna` | 20, 27, 31 | #A5DEFF | 2 | lanterna do capacete do Mecânico, emissiva (não pode ser ui.accent) |
| `hunter.olhos_preparo` | 31, 29, 22 | #FFEFB5 | 2 | olhos e lampejo do caçador durante o preparo de golpe e dash (Art Bible §1.5, §4) |
| `hunter.farrapos` | 5, 5, 7 | #29293A | 2 | farrapos e pés do Espectro |
| `world.gerador` | 10, 10, 12 | #525263 | 3 | corpo do gerador |
| `world.gerador_bonus` | 13, 11, 4 | #6B5A21 | 2 | corpo do gerador bônus |
| `world.portao` | 8, 2, 2 | #421010 | 2 | portão fechado |
| `world.gaiola` | 15, 15, 15 | #7B7B7B | 2 | grade da gaiola |
| `fx.armadilha` | 19, 0, 0 | #9C0000 | 2 | armadilha do caçador no chão |
| `light.ambiente` | 8, 8, 11 | #42425A | 2 | cor da luz ambiente (protótipo 0x404058) |
| `light.jogador` | 31, 27, 19 | #FFDE9C | 2 | cor da luz que segue o jogador (protótipo 0xffe0a0) |
| `skin.abo.a` | 16, 6, 0 | #843100 | 3 | skin Abóbora: calça |
| `skin.abo.b` | 4, 9, 3 | #214A19 | 2 | skin Abóbora: sapatos e acessório |
| `skin.som.a` | 3, 3, 4 | #191921 | 2 | skin Sombra: calça |
| `skin.som.b` | 11, 11, 13 | #5A5A6B | 2 | skin Sombra: sapatos e acessório |
| `skin.neo.a` | 2, 13, 18 | #106B94 | 2 | skin Neon Ciano: calça |
| `skin.neo.b` | 14, 29, 31 | #73EFFF | 2 | skin Neon Ciano: sapatos e acessório |
| `skin.car.a` | 13, 1, 4 | #6B0821 | 1 | skin Carmesim: calça |
| `skin.car.b` | 6, 0, 2 | #310010 | 2 | skin Carmesim: sapatos e acessório |
| `skin.our.a` | 11, 8, 2 | #5A4210 | 2 | skin Ouro: calça |
| `skin.our.b` | 23, 21, 15 | #BDAD7B | 3 | skin Ouro: sapatos e acessório |
| `skin.fan.a` | 18, 17, 24 | #948CC5 | 2 | skin Fantasma: calça |
| `skin.fan.b` | 24, 22, 31 | #C5B5FF | 2 | skin Fantasma: sapatos e acessório |

## Contraste de texto (WCAG 2.2 1.4.3) (mínimo 4.5:1)

| Elemento | Fundo | exata | média 4×4 | pior pixel | Resultado |
| --- | --- | --- | --- | --- | --- |
| `ui.text` | `ui.bg` | 15.28:1 | 15.28:1 | 14.39:1 | passa |
| `ui.text` | `ui.panel` | 12.78:1 | 12.76:1 | 12.13:1 | passa |
| `ui.text_dim` | `ui.bg` | 6.95:1 | 6.93:1 | 6.29:1 | passa |
| `ui.text_dim` | `ui.panel` | 5.81:1 | 5.79:1 | 5.31:1 | passa |
| `ui.accent` | `ui.panel` | 8.98:1 | 8.98:1 | 8.97:1 | passa |
| `ui.danger` | `ui.panel` | 4.72:1 | 4.72:1 | 4.72:1 | passa |

## Contraste de elementos gráficos (WCAG 2.2 1.4.11) (mínimo 3:1)

| Elemento | Fundo | exata | média 4×4 | pior pixel | Resultado |
| --- | --- | --- | --- | --- | --- |
| `class.curandeiro` | `world.fog` | 4.61:1 | 4.58:1 | 4.13:1 | passa |
| `class.mecanico` | `world.fog` | 7.00:1 | 6.96:1 | 6.29:1 | passa |
| `class.atacador` | `world.fog` | 4.01:1 | 3.99:1 | 3.74:1 | passa |
| `class.batedor` | `world.fog` | 12.33:1 | 12.29:1 | 11.46:1 | passa |
| `class.protetor` | `world.fog` | 11.30:1 | 11.30:1 | 11.10:1 | passa |
| `class.curandeiro` | `world.wall` | 3.68:1 | 3.68:1 | 3.33:1 | passa |
| `class.mecanico` | `world.wall` | 5.59:1 | 5.59:1 | 5.06:1 | passa |
| `class.atacador` | `world.wall` | 3.20:1 | 3.21:1 | 3.01:1 | passa |
| `class.batedor` | `world.wall` | 9.85:1 | 9.88:1 | 9.22:1 | passa |
| `class.protetor` | `world.wall` | 9.03:1 | 9.08:1 | 8.93:1 | passa |
| `gen.pendente` | `world.fog` | 4.33:1 | 4.34:1 | 4.25:1 | passa |
| `gen.progresso` | `world.fog` | 11.85:1 | 11.85:1 | 11.64:1 | passa |
| `gen.pronto` | `world.fog` | 7.36:1 | 7.33:1 | 6.70:1 | passa |
| `gen.bonus` | `world.fog` | 5.76:1 | 5.79:1 | 5.66:1 | passa |
| `hunter.olhos` | `world.fog` | 4.20:1 | 4.20:1 | 4.13:1 | passa |
| `hunter.espectro` | `world.fog` | 8.54:1 | 8.54:1 | 8.39:1 | passa |
| `hunter.carcereiro` | `world.fog` | 3.13:1 | 3.13:1 | 2.89:1 | passa (aviso) |
| `hunter.lamento` | `world.fog` | 3.98:1 | 3.99:1 | 3.84:1 | passa |
| `fx.ameaca` | `world.fog` | 4.81:1 | 4.80:1 | 4.72:1 | passa |
| `fx.preso` | `world.fog` | 9.14:1 | 9.13:1 | 8.97:1 | passa |
| `char.madeira` | `world.fog` | 4.88:1 | 4.90:1 | 4.80:1 | passa |
| `char.lamina` | `world.fog` | 10.17:1 | 10.20:1 | 9.84:1 | passa |
| `char.cachecol` | `world.fog` | 4.35:1 | 4.37:1 | 4.21:1 | passa |
| `char.lanterna` | `world.fog` | 11.12:1 | 11.12:1 | 10.92:1 | passa |
| `hunter.olhos_preparo` | `world.fog` | 14.02:1 | 14.05:1 | 13.77:1 | passa |
| `hunter.olhos_preparo` | `world.wall` | 11.20:1 | 11.30:1 | 11.08:1 | passa |

## Mudança de estado por brilho (Art Bible §1.5 e §4) (mínimo 3:1)

| Elemento | Fundo | exata | média 4×4 | pior pixel | Resultado |
| --- | --- | --- | --- | --- | --- |
| `hunter.olhos_preparo` | `hunter.olhos` | 3.33:1 | 3.35:1 | 3.33:1 | passa |

## Distinção entre cores do mesmo grupo (CIEDE2000, mínimo 12)

Menor diferença entre dois membros, em visão normal e sob cada simulação (Machado 2009, severidade 1,0); cada célula: exata / média 4×4 / pior pixel.

| Grupo | Normal | Protanopia | Deuteranopia | Tritanopia | Par mais próximo (pior caso) | Resultado |
| --- | --- | --- | --- | --- | --- | --- |
| classes | 23.6 / 23.5 / 21.1 | 15.8 / 15.8 / 14.1 | 12.3 / 12.4 / 11.1 | 17.2 / 17.2 / 15.5 | mecanico × batedor (deuteranopia, exata) | passa (aviso) |
| geradores | 37.1 / 37.2 / 36.8 | 24.8 / 25.1 / 24.8 | 20.1 / 19.4 / 14.7 | 14.6 / 14.6 / 13.4 | pendente × bonus (tritanopia, média 4×4) | passa |
| cacadores | 26.4 / 26.3 / 24.4 | 27.5 / 27.3 / 24.4 | 26.7 / 26.5 / 23.8 | 24.8 / 24.7 / 22.1 | espectro × lamento (tritanopia, média 4×4) | passa |

## Cores que não podem ser confundidas com estado nem com cor dominante (CIEDE2000, mínimo 12)

Menor diferença entre dois membros, em visão normal e sob cada simulação (Machado 2009, severidade 1,0); cada célula: exata / média 4×4 / pior pixel.

| Grupo | Normal | Protanopia | Deuteranopia | Tritanopia | Par mais próximo (pior caso) | Resultado |
| --- | --- | --- | --- | --- | --- | --- |
| acessorios | 36.3 / 36.4 / 36.1 | 34.1 / 34.1 / 33.8 | 37.4 / 37.5 / 36.9 | 33.1 / 32.8 / 28.6 | char.lanterna × olhos_preparo (tritanopia, média 4×4) | passa |
| skins_estado | 15.9 / 15.8 / 14.4 | 12.7 / 12.8 / 12.5 | 12.9 / 12.8 / 11.5 | 12.7 / 12.8 / 12.3 | skin.our.b × fx.preso (tritanopia, exata) | passa (aviso) |
| skins_classe | 13.3 / 13.2 / 11.3 | — | — | — | skin.fan.b × protetor (normal, média 4×4) | passa (aviso) |

**Avisos (pior pixel, informativo):** 4

- contraste gráfico hunter.carcereiro sobre world.fog (pior pixel): 2.89
- grupo classes: class.mecanico × class.batedor em deuteranopia, pior pixel com ΔE00 11.1
- grupo skins_estado: skin.our.b × fx.ameaca em deuteranopia, pior pixel com ΔE00 11.5
- grupo skins_classe: skin.fan.b × class.protetor em normal, pior pixel com ΔE00 11.3

**Resultado:** todos os testes passam.
