# Assets 3D — origem e licenças

Todos os arquivos desta pasta são **CC0 1.0** (domínio público): uso comercial livre, sem atribuição obrigatória,
redistribuição permitida. A licença foi conferida no arquivo de licença de cada pacote (copiados em
`LICENSE-gobkit-CC0.txt`, `office/kenney/LICENSE-kenney-CC0.txt` e `office/kaykit/LICENSE-kaykit-CC0.txt`) — Gobkit em
2026-11-19 (também no manifesto `https://gobkit.com/api/free`), Kenney e KayKit em 2026-11-20. Nenhum arquivo foi alterado
(GLB/glTF originais; cores e escala são ajustadas em tempo de execução).

| Pasta / arquivos | Pacote | Fonte oficial | Licença | Observações |
|---|---|---|---|---|
| `characters/Accountant, CompanyCeo, ItEngineer, OfficeIntern, OfficeManager, Receptionist, SalesRep, SecurityGuard .glb` | Gobkit Free Character Pack Vol.2 | https://gobkit.com/freebies/human002/gobkit-human002-pack.zip | CC0 1.0 | 13 ossos (esqueleto compartilhado), 28 clipes nomeados (Idle, Walk, Run, Sit, SitType, Type, Talk, TalkSit, Think, Cheer, Wave, Laugh...), ~2,2–2,9 mil triângulos, textura de paleta 512×2048 embutida |
| `characters/OfficeLady.glb, StoreManager.glb` | Gobkit Free Character Pack Vol.1 | https://gobkit.itch.io/gobkit-free-character-pack-vol-1 · https://gobkit.com/freebies/human001/gobkit-human001-pack.zip | CC0 1.0 | mesmo esqueleto, 7 clipes próprios; recebem a biblioteca do Vol.2 por retarget (world3d/assets.ts) |
| `characters/OfficeWorker.glb, Student.glb` | Gobkit Free Character Pack Vol.15 | https://gobkit.com/freebies/human015/gobkit-human015-pack.zip | CC0 1.0 | idem |
| `nature/*.glb` (Bush, TreeLow, TreeMed, Rock, Grass, Reed) | Gobkit Nature Kit | https://gobkit.com/freebies/environment/gobkit-nature-kit.zip | CC0 1.0 | 3–48 triângulos cada |
| `office/kenney/*.glb` (chairDesk, computerScreen, computerKeyboard, computerMouse, laptop, kitchenCoffeeMachine, kitchenFridgeLarge, kitchenMicrowave, trashcan, toilet, bathroomSink, pottedPlant, plantSmall1–3, tableRound, televisionModern, speaker, radio, coatRackStanding, books) | Kenney Furniture Kit 2.0 | https://kenney.nl/assets/furniture-kit | CC0 1.0 | 21 de 140 modelos; cores lisas por material (o estofado da cadeira é recolorido pelo tema da sala) |
| `office/kaykit/*.gltf/.bin` + `furniturebits_texture.png` (armchair_pillows, couch_pillows, cactus_medium/small A–B, lamp_standing, chair_A_wood, chair_stool, table_low, book_set, pictureframe_medium, pictureframe_large_A, shelf_B_large_decorated) | KayKit Furniture Bits 1.0 (Kay Lousberg) | https://kaylousberg.itch.io/furniture-bits · https://github.com/KayKit-Game-Assets/KayKit-Furniture-Bits-1.0 | CC0 1.0 | 14 de 54 modelos; uma textura de paleta compartilhada (um material para todos) |

## Direção de arte

**Personagens: o Habbinho, criado para o Habblaud** (`client/src/world3d/chibi.ts`). A malha é modelada em código a partir
da aparência de cada agente (a mesma do 2D: pele, 14 penteados, 7 roupas, calça/short/saia, calçados, acessórios,
barba, crachá), com rosto desenhado em canvas e expressões. Dos arquivos Gobkit só se usam o **esqueleto** de 13 ossos e
os **clipes de animação** (a malha deles é descartada); o `CompanyCeo.glb` é a referência porque não segura objeto (braços
livres), e os outros completam os clipes que faltarem. `OfficeLady`, `StoreManager`, `OfficeWorker`, `Student`,
`OfficeIntern` e `SecurityGuard` não são mais carregados.

**Móveis**: os modelos Kenney e KayKit entram onde existem (cadeiras, monitores, plantas, sofás, poltronas, cafeteira,
geladeira, banheiro...), via `client/src/world3d/props.ts`; mesas, divisórias, paredes, pisos, elevador e o resto seguem
como geometria própria (`furniture.ts`, `building.ts`), com a paleta de `kit.ts`. Não há elevador CC0 utilizável: o
elevador é modelado no projeto. Se um modelo não carregar, o móvel procedural correspondente é usado.

## Ao adicionar um asset

1. Confirme a licença no arquivo de licença do próprio pacote (não presuma pelo site).
2. Prefira GLB; registre aqui fonte, versão/data, licença e alterações.
3. Personagens são o Habbinho (chibi.ts); novos clipes de animação devem usar o esqueleto Gobkit de 13 ossos.
4. Móveis: registre o arquivo em `PROP_FILES` (props.ts); a frente do modelo deve apontar para +z.
