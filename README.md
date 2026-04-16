# Mapa Ambiental de Duque Bacelar

Aplicacao React + Vite com mapa interativo para registrar areas ambientais e ocorrencias em Duque Bacelar. O projeto funciona localmente com armazenamento no navegador e pode sincronizar dados com Supabase quando as variaveis de ambiente estiverem configuradas.

## Rodar localmente

```bash
npm install
npm run dev
```

Para usar Supabase localmente, crie um arquivo `.env` na raiz do projeto seguindo o modelo de `.env.example`:

```bash
VITE_SUPABASE_URL=https://seu-projeto.supabase.co
VITE_SUPABASE_ANON_KEY=sua-chave-anon-publica
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
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
5. Clique em **Deploy**.

Sempre que alterar variaveis de ambiente na Vercel, faca um novo deploy para que elas entrem no build.

## Tabela do Supabase

O app usa uma tabela chamada `areas`. Um modelo simples para criar a tabela e liberar leitura/escrita para a chave anonima e:

```sql
create table if not exists public.areas (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text,
  status text,
  impact text,
  description text,
  latitude double precision,
  longitude double precision,
  image_url text,
  polygon_coords jsonb,
  created_at timestamptz not null default now()
);

alter table public.areas enable row level security;

create policy "Permitir leitura publica de areas"
on public.areas for select
to anon
using (true);

create policy "Permitir cadastro publico de areas"
on public.areas for insert
to anon
with check (true);

create policy "Permitir atualizacao publica de areas"
on public.areas for update
to anon
using (true)
with check (true);
```

Se o projeto for publico, revise essas politicas antes de colocar dados sensiveis, porque elas permitem leitura, cadastro e atualizacao por visitantes do app.

## Build

```bash
npm run build
```

O build de producao gera os arquivos em `dist`.
