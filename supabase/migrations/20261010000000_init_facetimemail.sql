create extension if not exists "uuid-ossp";

create table public.profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    display_name text,
    status text not null default 'active' check (status in ('active', 'suspended', 'pending')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table public.domains (
    id uuid primary key default uuid_generate_v4(),
    domain_name text unique not null,
    is_active boolean not null default false,
    verification_status text not null default 'pending' check (verification_status in ('pending', 'verified', 'failed')),
    provider_reference text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    administrative_notes text
);

create table public.temporary_addresses (
    id uuid primary key default uuid_generate_v4(),
    user_id uuid not null references public.profiles(id) on delete cascade,
    domain_id uuid not null references public.domains(id) on delete restrict,
    normalized_address text unique not null,
    status text not null default 'active' check (status in ('active', 'expiring', 'expired', 'suspended', 'deleted')),
    created_at timestamptz not null default now(),
    expires_at timestamptz not null,
    rotated_at timestamptz,
    deleted_at timestamptz
);

create table public.mailboxes (
    id uuid primary key default uuid_generate_v4(),
    temporary_address_id uuid not null references public.temporary_addresses(id) on delete cascade,
    provider_reference text,
    status text not null default 'active',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table public.messages (
    id uuid primary key default uuid_generate_v4(),
    mailbox_id uuid not null references public.mailboxes(id) on delete cascade,
    provider_message_id text,
    sender text not null,
    recipient text not null,
    subject text,
    sanitized_text_body text,
    sanitized_html_reference text,
    received_at timestamptz not null default now(),
    read_at timestamptz,
    deleted_at timestamptz
);
