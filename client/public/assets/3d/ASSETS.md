# Assets 3D — origem e licenças

Todos os arquivos desta pasta são **CC0 1.0** (domínio público): uso comercial livre, sem atribuição obrigatória,
redistribuição permitida. A licença foi conferida no `LICENSE.txt` de cada pacote (copiado em `LICENSE-gobkit-CC0.txt`)
e no manifesto oficial `https://gobkit.com/api/free` em 2026-11-19. Nenhum arquivo foi alterado (GLB originais).

| Pasta / arquivos | Pacote | Fonte oficial | Licença | Observações |
|---|---|---|---|---|
| `characters/Accountant, CompanyCeo, ItEngineer, OfficeIntern, OfficeManager, Receptionist, SalesRep, SecurityGuard .glb` | Gobkit Free Character Pack Vol.2 | https://gobkit.com/freebies/human002/gobkit-human002-pack.zip | CC0 1.0 | 13 ossos (esqueleto compartilhado), 28 clipes nomeados (Idle, Walk, Run, Sit, SitType, Type, Talk, TalkSit, Think, Cheer, Wave, Laugh...), ~2,2–2,9 mil triângulos, textura de paleta 512×2048 embutida |
| `characters/OfficeLady.glb, StoreManager.glb` | Gobkit Free Character Pack Vol.1 | https://gobkit.itch.io/gobkit-free-character-pack-vol-1 · https://gobkit.com/freebies/human001/gobkit-human001-pack.zip | CC0 1.0 | mesmo esqueleto, 7 clipes próprios; recebem a biblioteca do Vol.2 por retarget (world3d/assets.ts) |
| `characters/OfficeWorker.glb, Student.glb` | Gobkit Free Character Pack Vol.15 | https://gobkit.com/freebies/human015/gobkit-human015-pack.zip | CC0 1.0 | idem |
| `nature/*.glb` (Bush, TreeLow, TreeMed, Rock, Grass, Reed) | Gobkit Nature Kit | https://gobkit.com/freebies/environment/gobkit-nature-kit.zip | CC0 1.0 | 3–48 triângulos cada |

## Direção de arte

A linguagem predominante dos personagens é a da **Gobkit** (referência principal do projeto): todos os bonecos vêm da
mesma família, com o mesmo esqueleto, a mesma paleta e as mesmas proporções chibi. A Kenney (Mini Characters, CC0) foi
avaliada como referência secundária de leitura e escala; os modelos dela **não** foram misturados para não quebrar a
coerência (outro esqueleto e outro estilo de textura).

Móveis, paredes e pisos são geometria própria (`client/src/world3d/furniture.ts`, `building.ts`), feita com o mesmo
vocabulário de formas arredondadas e a paleta de `world3d/kit.ts` — não dependem de nenhum pacote externo.

## Ao adicionar um asset

1. Confirme a licença no arquivo de licença do próprio pacote (não presuma pelo site).
2. Prefira GLB; registre aqui fonte, versão/data, licença e alterações.
3. Para personagens, use a família Gobkit (mesmo esqueleto de 13 ossos) para herdar a biblioteca de animações.
