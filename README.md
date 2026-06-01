# BACKROOMS — nível 0
> Explorador 3D em primeira pessoa com ecos de pensamentos de outros jogadores, distorcidos por IA.

---

## Stack
- **Frontend**: Three.js (3D), HTML/CSS/JS puro
- **Backend**: Vercel Serverless Functions (Node.js)
- **Banco de dados**: Supabase (PostgreSQL)
- **IA**: Claude API (Anthropic) — distorce os pensamentos

---

## 1. Criar banco de dados no Supabase

1. Acesse https://supabase.com e crie uma conta gratuita
2. Crie um novo projeto (escolha a região mais próxima — South America / São Paulo)
3. No menu lateral vá em **SQL Editor** e rode este SQL:

```sql
create table thoughts (
  id           bigint generated always as identity primary key,
  room_key     text not null,
  original_text text not null,
  distorted_text text not null,
  author_name  text default 'anônimo',
  player_id    text,
  created_at   timestamptz default now()
);

-- índice para buscar por sala rápido
create index on thoughts (room_key);

-- política pública de leitura e escrita (jogo aberto)
alter table thoughts enable row level security;
create policy "leitura pública" on thoughts for select using (true);
create policy "escrita pública" on thoughts for insert with check (true);
```

4. Vá em **Project Settings → API** e anote:
   - `Project URL` (ex: `https://xxxx.supabase.co`)
   - `anon public key`

---

## 2. Pegar a chave da API do Claude

1. Acesse https://console.anthropic.com
2. Vá em **API Keys** e crie uma nova chave
3. Anote a chave (começa com `sk-ant-...`)

---

## 3. Deploy no Vercel

### Opção A — pelo site (mais fácil)

1. Faça upload do projeto no GitHub:
   ```bash
   git init
   git add .
   git commit -m "backrooms init"
   gh repo create backrooms --public --push --source=.
   ```

2. Acesse https://vercel.com, clique em **Add New Project**
3. Importe o repositório do GitHub
4. Em **Environment Variables**, adicione:

   | Nome | Valor |
   |------|-------|
   | `ANTHROPIC_API_KEY` | `sk-ant-...` |
   | `SUPABASE_URL` | `https://xxxx.supabase.co` |
   | `SUPABASE_ANON_KEY` | `eyJ...` |

5. Clique em **Deploy** — pronto!

### Opção B — pela CLI

```bash
npm i -g vercel
vercel login
vercel --prod
# quando perguntar sobre env vars, adicione as 3 acima
```

---

## 4. Estrutura de arquivos

```
backrooms/
├── public/
│   ├── index.html   # HTML + tela de loading + tela de nome
│   ├── style.css    # visual amber/monocromático
│   └── game.js      # motor Three.js + labirinto + lógica
├── api/
│   ├── distort.js   # POST — distorce pensamento com Claude e salva
│   └── thoughts.js  # GET  — busca ecos de uma sala
└── vercel.json      # configuração de rotas
```

---

## 5. Como funciona

```
jogador digita pensamento
        ↓
POST /api/distort
        ↓
Claude reescreve como "eco imperfeito"
        ↓
salva no Supabase (sala + texto distorcido + autor)
        ↓
próximos jogadores que entrarem nessa sala
veem o eco aparecer na tela
```

---

## 6. Custos estimados

| Serviço | Tier gratuito |
|---------|---------------|
| Vercel | 100GB banda / mês — suficiente pra projeto pessoal |
| Supabase | 500MB banco, 2GB banda — suficiente pra começar |
| Anthropic | ~$0.0008 por pensamento distorcido (Claude Haiku) |

---

## 7. Próximos passos sugeridos

- [ ] **NPC "versão brava"** — entidade que lê o perfil do jogador e aparece como uma versão distorcida dele (Clark pirata)
- [ ] **Salas temáticas** — geradas com base nos pensamentos mais frequentes daquela área
- [ ] **Minimapa** — revelado progressivamente conforme exploração
- [ ] **Sons** — zumbido de lâmpada com Web Audio API, passos no carpet
- [ ] **Multijogador real** — posições dos outros jogadores via Supabase Realtime
- [ ] **Sistema de sanidade** — quanto mais tempo no mesmo corredor, mais distorcida fica a visão
