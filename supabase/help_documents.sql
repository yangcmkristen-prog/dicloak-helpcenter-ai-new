create table if not exists public.help_documents (
  id varchar(255) primary key,
  title varchar(500) not null,
  category varchar(100) default '未分类',
  last_updated varchar(20),
  content text not null,
  source_url text,
  html_content text,
  language varchar(10) default 'unknown',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists help_documents_category_idx on public.help_documents (category);
create index if not exists help_documents_language_idx on public.help_documents (language);
create index if not exists help_documents_created_at_idx on public.help_documents (created_at);

create or replace function public.set_help_documents_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists help_documents_set_updated_at on public.help_documents;
create trigger help_documents_set_updated_at
before update on public.help_documents
for each row
execute function public.set_help_documents_updated_at();