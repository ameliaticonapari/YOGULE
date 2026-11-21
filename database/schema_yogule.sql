-- ============================================================================
-- ESQUEMA DE BASE DE DATOS: AGROINDUSTRIA YOGULÉ S.A.C.
-- "Leche de altura hecha delicia" - Cabana, San Román, Puno
-- Trazabilidad en 3 estados (PENDIENTE, RECIBIDO, ENTREGADO) - Sin RLS
-- Proyecto Supabase conectado: bpaxkwzbknmntqdsdzwu (https://bpaxkwzbknmntqdsdzwu.supabase.co)
-- ============================================================================

create extension if not exists pgcrypto;

-- 1. TABLA: CLIENTES (Cartera de clientes + acceso con usuario y contraseña)
create table if not exists public.clientes (
    id uuid primary key default gen_random_uuid(),
    codigo_cliente text generated always as ('CLI-' || upper(substring(replace(id::text, '-', ''), 1, 6))) stored,
    nombre_contacto text not null,
    nombre_negocio text not null,
    ciudad text not null,
    region text not null default 'Puno',
    telefono_whatsapp text not null,
    agencia_preferida text not null default 'Shalom',
    direccion_entrega text not null default '',
    notas_necesidades text not null default '',
    frecuencia_pedido text not null default 'Semanal',
    usuario text unique not null,
    password_hash text not null,
    password_visible text not null default '123456',
    rol text not null default 'cliente' check (rol in ('encargado', 'cliente')),
    activo boolean not null default true,
    created_at timestamptz not null default now()
);

-- 2. TABLA: PRODUCTOS (Los 10 sabores saludables de Yogurt Probio Yogulé + derivados)
create table if not exists public.productos (
    id uuid primary key default gen_random_uuid(),
    sku text unique not null,
    nombre text not null,
    linea text not null default 'Yogurt Probio',
    sabor text not null,
    presentacion text not null default 'Botella 1000 cc (1L)',
    precio numeric(10, 2) not null check (precio >= 0),
    stock integer not null default 100,
    color_hex text not null default '#EC407A',
    icono_emoji text not null default '🍓',
    beneficio text not null default 'Probiótico natural de altura',
    palabras_clave text[] not null default '{}',
    activo boolean not null default true,
    created_at timestamptz not null default now()
);

-- 3. TABLA: CLIENTE_PRODUCTOS_FRECUENTES (Qué necesita habitualmente cada cliente)
create table if not exists public.cliente_productos_frecuentes (
    id uuid primary key default gen_random_uuid(),
    cliente_id uuid not null references public.clientes(id) on delete cascade,
    producto_id uuid not null references public.productos(id) on delete cascade,
    cantidad_habitual integer not null default 6 check (cantidad_habitual > 0),
    nota text not null default '',
    unique (cliente_id, producto_id)
);

-- 4. TABLA: PEDIDOS (Con código único autogenerado por Supabase y 3 estados)
create table if not exists public.pedidos (
    id uuid primary key default gen_random_uuid(),
    numero_pedido bigint generated always as identity,
    codigo_pedido text generated always as ('YOG-' || lpad(numero_pedido::text, 5, '0')) stored unique,
    cliente_id uuid not null references public.clientes(id) on delete restrict,
    registrado_por_id uuid references public.clientes(id) on delete set null,
    estado text not null default 'PENDIENTE' check (estado in ('PENDIENTE', 'RECIBIDO', 'ENTREGADO')),
    origen text not null default 'PORTAL_CLIENTE' check (origen in ('PORTAL_CLIENTE', 'WHATSAPP_TEXTO', 'MANUAL_ENCARGADO')),
    agencia_envio text not null default '',
    texto_whatsapp text not null default '',
    observaciones text not null default '',
    total numeric(10, 2) not null default 0.00,
    created_at timestamptz not null default now(),
    recibido_at timestamptz,
    entregado_at timestamptz,
    updated_at timestamptz not null default now()
);

-- 5. TABLA: PEDIDO_DETALLE (Unido por FK a pedidos y productos, con check de alistado)
create table if not exists public.pedido_detalle (
    id uuid primary key default gen_random_uuid(),
    pedido_id uuid not null references public.pedidos(id) on delete cascade,
    producto_id uuid not null references public.productos(id) on delete restrict,
    cantidad integer not null check (cantidad > 0),
    precio_unitario numeric(10, 2) not null check (precio_unitario >= 0),
    subtotal numeric(10, 2) generated always as (round(cantidad * precio_unitario, 2)) stored,
    alistado boolean not null default false,
    created_at timestamptz not null default now()
);

-- 6. TABLA: PEDIDO_TRAZABILIDAD (Historial exacto de los 3 estados: PENDIENTE, RECIBIDO, ENTREGADO)
create table if not exists public.pedido_trazabilidad (
    id uuid primary key default gen_random_uuid(),
    pedido_id uuid not null references public.pedidos(id) on delete cascade,
    estado text not null check (estado in ('PENDIENTE', 'RECIBIDO', 'ENTREGADO')),
    usuario_id uuid references public.clientes(id) on delete set null,
    responsable_nombre text not null default 'Sistema Yogulé',
    nota text not null default '',
    created_at timestamptz not null default now()
);

-- ÍNDICES
create index if not exists idx_pedidos_cliente_id on public.pedidos(cliente_id);
create index if not exists idx_pedidos_registrado_por_id on public.pedidos(registrado_por_id);
create index if not exists idx_pedidos_estado_created on public.pedidos(estado, created_at desc);
create index if not exists idx_pedido_detalle_pedido_id on public.pedido_detalle(pedido_id);
create index if not exists idx_pedido_detalle_producto_id on public.pedido_detalle(producto_id);
create index if not exists idx_pedido_trazabilidad_pedido_id on public.pedido_trazabilidad(pedido_id, created_at asc);
create index if not exists idx_cliente_frecuentes_cliente_id on public.cliente_productos_frecuentes(cliente_id);

-- TRIGGERS AUTOMÁTICOS
create or replace function public.fn_recalcular_total_pedido()
returns trigger
language plpgsql
as $$
declare
    v_pedido_id uuid;
begin
    v_pedido_id := coalesce(new.pedido_id, old.pedido_id);
    update public.pedidos
    set total = coalesce((
        select round(sum(subtotal), 2)
        from public.pedido_detalle
        where pedido_id = v_pedido_id
    ), 0.00),
    updated_at = now()
    where id = v_pedido_id;
    return null;
end;
$$;

create or replace trigger trg_recalcular_total_pedido
after insert or update or delete on public.pedido_detalle
for each row execute function public.fn_recalcular_total_pedido();

create or replace function public.fn_trazabilidad_pedido()
returns trigger
language plpgsql
as $$
declare
    v_responsable text;
begin
    if (tg_op = 'INSERT') then
        select coalesce(nombre_contacto || ' (' || nombre_negocio || ')', 'Cliente / Encargado')
        into v_responsable
        from public.clientes
        where id = coalesce(new.registrado_por_id, new.cliente_id);

        insert into public.pedido_trazabilidad (pedido_id, estado, usuario_id, responsable_nombre, nota, created_at)
        values (
            new.id,
            new.estado,
            coalesce(new.registrado_por_id, new.cliente_id),
            coalesce(v_responsable, 'Registro inicial'),
            case
                when new.origen = 'WHATSAPP_TEXTO' then 'Pedido registrado pegando mensaje de WhatsApp'
                when new.origen = 'PORTAL_CLIENTE' then 'Pedido enviado directamente por el cliente desde su portal'
                else 'Pedido registrado por la encargada'
            end,
            new.created_at
        );
        return new;
    elsif (tg_op = 'UPDATE' and old.estado is distinct from new.estado) then
        if new.estado = 'RECIBIDO' and new.recibido_at is null then
            new.recibido_at := now();
        elsif new.estado = 'ENTREGADO' and new.entregado_at is null then
            new.entregado_at := now();
        end if;
        new.updated_at := now();

        insert into public.pedido_trazabilidad (pedido_id, estado, usuario_id, responsable_nombre, nota, created_at)
        values (
            new.id,
            new.estado,
            new.registrado_por_id,
            'Encargada Yogulé',
            case
                when new.estado = 'RECIBIDO' then 'Pedido visto y alistado en planta Yogulé'
                when new.estado = 'ENTREGADO' then 'Pedido entregado satisfactoriamente al cliente'
                else 'Actualización de estado a ' || new.estado
            end,
            now()
        );
        return new;
    end if;
    return new;
end;
$$;

create or replace trigger trg_trazabilidad_pedido_insert
after insert on public.pedidos
for each row execute function public.fn_trazabilidad_pedido();

create or replace trigger trg_trazabilidad_pedido_update
before update on public.pedidos
for each row execute function public.fn_trazabilidad_pedido();

-- FUNCIÓN RPC DE LOGIN SIN RLS
create or replace function public.iniciar_sesion(p_usuario text, p_password text)
returns jsonb
language plpgsql
as $$
declare
    v_cliente record;
begin
    select id, codigo_cliente, nombre_contacto, nombre_negocio, ciudad, region,
           telefono_whatsapp, agencia_preferida, direccion_entrega, notas_necesidades,
           usuario, rol
    into v_cliente
    from public.clientes
    where lower(trim(usuario)) = lower(trim(p_usuario))
      and activo = true
      and (password_hash = crypt(p_password, password_hash) or password_visible = p_password)
    limit 1;

    if not found then
        return jsonb_build_object('ok', false, 'mensaje', 'Usuario o contraseña incorrectos');
    end if;

    return jsonb_build_object(
        'ok', true,
        'usuario', to_jsonb(v_cliente)
    );
end;
$$;

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to anon, authenticated;
grant usage, select on all sequences in schema public to anon, authenticated;
grant execute on all functions in schema public to anon, authenticated;
