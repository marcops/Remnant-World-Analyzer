# Remnant World Analyzer

Mostra o que rolou no seu mundo de **Remnant: From the Ashes** (campanha e aventura), o que cada evento dá, **o que você já tem (✔) e o que falta (✘)**, e um resumo do que falta por mundo — Terra, Rhom, Corsus, Yaesha, Reisum, Ward 13, Ward 17, Ward Prime — com a descrição de como obter cada item.

Fork de [hzla/Remnant-World-Analyzer](https://github.com/hzla/Remnant-World-Analyzer), com o parser reescrito (o original não mostrava nada em saves com aventura ativa).

## Como usar

### Jeito automático (Windows) — recomendado
1. Baixe o projeto (`git clone` ou *Code → Download ZIP* e extraia).
2. Dê dois cliques em **`Iniciar.bat`**.
3. O navegador abre sozinho já com o seu save. Deixe a janela preta aberta: **a página se atualiza sozinha quando o jogo salva**.

O script acha a pasta `%LOCALAPPDATA%\Remnant\Saved\SaveGames` (Steam/Epic). Se os seus saves estão em outro lugar:

```bat
Iniciar.bat -SaveDir "D:\Meus saves\Remnant"
```

Outras opções: `-Port 9000` (outra porta), `-NoBrowser` (não abrir o navegador).

> Se o Windows mostrar “O Windows protegeu o seu PC” ao abrir o `.bat` baixado em ZIP, clique em *Mais informações → Executar assim mesmo*. O script só lê a pasta de saves e serve a página em `http://localhost` — nada sai do seu PC.

### Jeito manual (qualquer sistema, sem instalar nada)
1. Abra o `index.html` no navegador.
2. Arraste para a página o `save_N.sav` **e** o `profile.sav` (ou clique e, na pasta, aperte `Ctrl+A`).
   - Pasta: `%LOCALAPPDATA%\Remnant\Saved\SaveGames` (cole na barra de endereço da janela de arquivos).
   - `save_0.sav` é o personagem 1, `save_1.sav` o personagem 2, e assim por diante.
   - Sem o `profile.sav` a página mostra o mundo, mas não sabe o que você já tem.

> Uma página web sozinha não consegue ler essa pasta automaticamente: o Chrome/Edge bloqueiam o acesso de sites a `AppData`. Por isso o jeito automático usa o `Iniciar.bat`.

## O que aparece

- **Mundo atual** — campanha e aventura, cada evento com local, tipo e itens. Clique num item para ver *como obter*. Filtros por mundo, tipo, busca e “só eventos com item faltando”.
- **O que falta** — cartões por mundo (“Corsus: falta 12 · 4 dá para pegar agora”). Clique num cartão para filtrar. Itens que caem no seu mundo atual aparecem primeiro, marcados **disponível agora**, com o local exato. Itens comprados no Ward 13 ficam em **Ward 13**; conquistas e itens sem mundo em **Geral / conquistas**.
- Mods que já vêm em armas (ex.: Skewer no Devastator) contam como seus quando você tem a arma.
- **Skins e consumíveis** aparecem como lista de referência: o save não guarda isso de um jeito que dê para conferir.

## Para quem for mexer no código

```
index.html, css/app.css, js/app.js   página
js/parser.js                          leitura do save e do profile (roda no navegador e no Node)
js/data.js                            GERADO — itens, eventos, locais
tools/build-data.mjs                  gera js/data.js a partir de tools/source/
tools/overrides.mjs                   correções manuais de nomes → caminhos do jogo
server.ps1, Iniciar.bat               servidor local do modo automático
test/parser.test.mjs                  testes
```

```sh
node tools/build-data.mjs --download --report   # baixa a planilha de novo e regenera js/data.js
node --test test/                              # testes de dados e parser
RWA_SAVE=caminho/save_0.sav RWA_PROFILE=caminho/profile.sav node --test test/   # + com seu save
```

O `--report` lista itens da planilha que não foram ligados a um caminho do jogo e caminhos sem item; corrija em `tools/overrides.mjs`.

## Agradecimentos

- [hzla/Remnant-World-Analyzer](https://github.com/hzla/Remnant-World-Analyzer) — o projeto original.
- [Razzmatazzz/RemnantSaveManager](https://github.com/Razzmatazzz/RemnantSaveManager) — a lógica de leitura de campanha, aventura e inventário foi portada dele, e `tools/source/GameInfo.xml` (eventos → itens) vem dele.
- [Remnant: From the Ashes — Completionist's Checklist](https://docs.google.com/spreadsheets/d/1rmmwn-kaVS44qWgub7ubXqL26fAgM7TBIi-dNc7VGdI), de **Amythyst34** — lista completa de itens, mundos, modos, DLC e “How to Obtain” (`tools/source/sheet-*.csv`).
- Forks com correções e ideias: [axllency](https://github.com/axllency/Remnant-World-Analyzer), [tkerzmann](https://github.com/tkerzmann/Remnant-World-Analyzer), [paige404](https://github.com/paige404/Remnant-World-Analyzer), [gmferise](https://github.com/gmferise/Remnant-World-Analyzer), [northy](https://github.com/northy/Remnant-World-Analyzer), [chris-faulkner](https://github.com/chris-faulkner/Remnant-World-Analyzer).
- /u/FAOAB no Reddit, pela [planilha de nomes](https://docs.google.com/spreadsheets/d/1VzmDx0ZXQWN5N_9_zP0gEqToyuB9ZjlxgZOEGdiuA6A) usada pelo original.

## Licença

GPL-3.0 (veja `LICENSE`), porque inclui código portado e dados do RemnantSaveManager, que é GPL-3.0.
