## Tokens (15 bits → hex)

| Token | RGB 5 bits | Hex | Uso |
| --- | --- | --- | --- |
| `ui.bg` | 2, 2, 3 | #101019 | fundo de menus |
| `ui.panel` | 4, 4, 6 | #212131 | molduras 9-slice, painéis |
| `ui.text` | 29, 28, 26 | #EFE6D6 | texto principal (osso) |
| `ui.text_dim` | 19, 19, 20 | #9C9CA5 | texto secundário |
| `ui.accent` | 31, 22, 6 | #FFB531 | foco de teclado, seleção |
| `ui.danger` | 31, 9, 5 | #FF4A29 | alertas, vida baixa |
| `world.fog` | 3, 4, 6 | #192131 | névoa e fundo a 30 m |
| `world.wall` | 6, 6, 7 | #31313A | paredes (concreto frio) |
| `world.ground` | 6, 6, 5 | #313129 | chão |
| `class.curandeiro` | 0, 19, 14 | #009C73 | Curandeiro |
| `class.mecanico` | 28, 19, 0 | #E69C00 | Mecânico |
| `class.atacador` | 10, 20, 31 | #52A5FF | Atacador |
| `class.batedor` | 29, 28, 8 | #EFE642 | Batedor (fase 4) |
| `class.protetor` | 26, 26, 29 | #D6D6EF | Protetor (fase 4) |
| `gen.pendente` | 26, 12, 0 | #D66300 | gerador não iniciado |
| `gen.progresso` | 30, 27, 6 | #F7DE31 | gerador em progresso |
| `gen.pronto` | 4, 24, 20 | #21C5A5 | gerador pronto |
| `gen.bonus` | 29, 12, 27 | #EF63DE | gerador bônus |
| `hunter.olhos` | 31, 4, 2 | #FF2110 | olhos emissivos e telegraph (GDD §10.4) |
| `hunter.espectro` | 22, 23, 25 | #B5BDCE | Espectro (lançamento) |
| `hunter.carcereiro` | 20, 11, 4 | #A55A21 | O Carcereiro |
| `hunter.lamento` | 18, 12, 28 | #9463E6 | O Lamento |
| `fx.ameaca` | 31, 9, 5 | #FF4A29 | seta de ameaça na borda (GDD §12.1) |
| `fx.preso` | 31, 22, 6 | #FFB531 | marcador de aliado preso |

## Contraste de texto (WCAG 2.2 1.4.3, mínimo 4.5:1)

| Texto | Fundo | Razão | Resultado |
| --- | --- | --- | --- |
| `ui.text` | `ui.bg` | 15.28:1 | passa |
| `ui.text` | `ui.panel` | 12.78:1 | passa |
| `ui.text_dim` | `ui.bg` | 6.95:1 | passa |
| `ui.text_dim` | `ui.panel` | 5.81:1 | passa |
| `ui.accent` | `ui.panel` | 8.98:1 | passa |
| `ui.danger` | `ui.panel` | 4.72:1 | passa |

## Contraste de elementos gráficos (WCAG 2.2 1.4.11, mínimo 3:1)

| Elemento | Fundo | Razão | Resultado |
| --- | --- | --- | --- |
| `class.curandeiro` | `world.fog` | 4.61:1 | passa |
| `class.mecanico` | `world.fog` | 7.00:1 | passa |
| `class.atacador` | `world.fog` | 6.28:1 | passa |
| `class.batedor` | `world.fog` | 12.33:1 | passa |
| `class.protetor` | `world.fog` | 11.30:1 | passa |
| `class.curandeiro` | `world.wall` | 3.68:1 | passa |
| `class.mecanico` | `world.wall` | 5.59:1 | passa |
| `class.atacador` | `world.wall` | 5.02:1 | passa |
| `class.batedor` | `world.wall` | 9.85:1 | passa |
| `class.protetor` | `world.wall` | 9.03:1 | passa |
| `gen.pendente` | `world.fog` | 4.33:1 | passa |
| `gen.progresso` | `world.fog` | 11.85:1 | passa |
| `gen.pronto` | `world.fog` | 7.36:1 | passa |
| `gen.bonus` | `world.fog` | 5.76:1 | passa |
| `hunter.olhos` | `world.fog` | 4.20:1 | passa |
| `hunter.espectro` | `world.fog` | 8.54:1 | passa |
| `hunter.carcereiro` | `world.fog` | 3.13:1 | passa |
| `hunter.lamento` | `world.fog` | 3.98:1 | passa |
| `fx.ameaca` | `world.fog` | 4.81:1 | passa |
| `fx.preso` | `world.fog` | 9.14:1 | passa |

## Distinção entre cores do mesmo grupo (CIEDE2000, mínimo 12)

Menor diferença entre dois membros do grupo, em visão normal e sob cada simulação (Machado 2009, severidade 1,0).

| Grupo | Normal | Protanopia | Deuteranopia | Tritanopia | Par mais próximo (pior caso) | Resultado |
| --- | --- | --- | --- | --- | --- | --- |
| classes | 23.6 | 16.2 | 12.3 | 12.7 | mecanico × batedor (deuteranopia) | passa |
| geradores | 37.1 | 24.8 | 20.1 | 14.6 | pendente × bonus (tritanopia) | passa |
| cacadores | 26.4 | 27.5 | 26.7 | 24.8 | espectro × lamento (tritanopia) | passa |

**Resultado:** todos os testes passam.
