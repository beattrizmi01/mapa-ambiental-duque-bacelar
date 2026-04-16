# Mapa Ambiental de Duque Bacelar

Aplicacao React + Vite com mapa interativo para registrar areas ambientais e ocorrencias em Duque Bacelar. O projeto funciona localmente com armazenamento no navegador e pode sincronizar dados com Supabase quando as variaveis de ambiente estiverem configuradas.

## Rodar localmente

```bash
npm install
npm run dev
```

Para usar Supabase localmente, crie um arquivo `.env` na raiz do projeto seguindo o modelo de `.env.example`:

```bash
VITE_SUPABASE_URL=https://zebsizvdirevdescsocd.supabase.co
VITE_SUPABASE_ANON_KEY=cole-aqui-a-publishable-key-do-supabase
```

Sem essas variaveis, o app continua funcionando com dados salvos no `localStorage` do navegador.

## Deploy na Vercel

1. Acesse a Vercel e escolha **Add New > Project**.
2. Importe o repositorio `beattrizmi01/mapa-ambiental-duque-bacelar`.
3. Mantenha o framework como **Vite**. A Vercel deve detectar automaticamente:
   - Install Command: `npm install`
   - Build Command: `npm run build`
   - Output Directory: `dist`
4. Em **Environment Variables**, cadastre as variaveis se for usar Supabase:
   - `VITE_SUPABASE_URL`: `https://zebsizvdirevdescsocd.supabase.co`
   - `VITE_SUPABASE_ANON_KEY`: a **Publishable key** do Supabase
5. Clique em **Deploy**.

Sempre que alterar variaveis de ambiente na Vercel, faca um novo deploy para que elas entrem no build.

Para encontrar a chave no painel novo do Supabase:

1. Clique em **Project Settings** no menu lateral esquerdo.
2. Abra **API Keys**.
3. Na secao **Publishable key**, copie a chave `default`.
4. Cole essa chave na Vercel em `VITE_SUPABASE_ANON_KEY`.

Se voce estiver em **Integrations > Data API**, essa tela mostra a URL da API, mas nao e o lugar certo para copiar a chave do app.

## Estrutura do Supabase

O app usa Supabase para persistir:

- `areas`: status atual e dados da area;
- `occurrences`: ocorrencias registradas em campo;
- `area_status_history`: historico auditavel de alteracoes de status.

Antes de usar o banco online, execute o SQL completo em [supabase/schema.sql](supabase/schema.sql) no SQL Editor do Supabase.

Esse arquivo tambem cria a funcao `register_occurrence_with_status`, usada pelo app para salvar a ocorrencia, atualizar o status da area e registrar o historico em uma unica operacao transacional.

Resumo da estrutura principal:

```sql
create table if not exists public.areas (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text,
  status text not null default 'atencao',
  impact text,
  description text,
  latitude double precision,
  longitude double precision,
  image_url text,
  polygon_coords jsonb,
  last_occurrence_id uuid,
  last_status_review_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.occurrences (
  id uuid primary key default gen_random_uuid(),
  area_id uuid not null references public.areas(id) on delete cascade,
  impact text not null,
  description text not null,
  latitude double precision,
  longitude double precision,
  image_url text,
  previous_status text,
  new_status text,
  status_updated boolean not null default false,
  created_by uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.area_status_history (
  id uuid primary key default gen_random_uuid(),
  area_id uuid not null references public.areas(id) on delete cascade,
  occurrence_id uuid not null references public.occurrences(id) on delete cascade,
  previous_status text not null,
  new_status text not null,
  changed_by uuid,
  changed_at timestamptz not null default now()
);
```

Se o projeto for publico, revise as politicas RLS antes de colocar dados sensiveis, porque o modelo incluido permite leitura, cadastro e atualizacao por visitantes do app.

## Build

```bash
npm run build
```

O build de producao gera os arquivos em `dist`.
