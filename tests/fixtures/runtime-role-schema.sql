-- LOCAL TEMPORARY CLUSTER FIXTURE ONLY. Never execute this file in Neon.
CREATE TABLE public.restaurants (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name TEXT NOT NULL, email TEXT UNIQUE, password TEXT, phone TEXT, city TEXT, neighborhood TEXT, street TEXT, number TEXT, image_url TEXT, public_id TEXT, status BOOLEAN DEFAULT TRUE, created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE public.restaurant_types (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name TEXT, slug TEXT UNIQUE, active BOOLEAN DEFAULT TRUE);
CREATE TABLE public.restaurant_type_links (restaurant_id UUID REFERENCES public.restaurants(id), type_id UUID REFERENCES public.restaurant_types(id), is_primary BOOLEAN NOT NULL DEFAULT FALSE, PRIMARY KEY(restaurant_id,type_id));
CREATE TABLE public.products (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), restaurant_id UUID NOT NULL REFERENCES public.restaurants(id), name TEXT NOT NULL, description TEXT, price NUMERIC NOT NULL, image_url TEXT, public_id TEXT, available BOOLEAN NOT NULL DEFAULT TRUE, published BOOLEAN NOT NULL DEFAULT FALSE, created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE public.product_variants (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), product_id UUID NOT NULL REFERENCES public.products(id), name TEXT NOT NULL, price NUMERIC NOT NULL, available BOOLEAN NOT NULL DEFAULT TRUE);
CREATE TABLE public.product_option_groups (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), product_id UUID NOT NULL REFERENCES public.products(id), name TEXT NOT NULL, required BOOLEAN NOT NULL, min_select INTEGER NOT NULL, max_select INTEGER NOT NULL);
CREATE TABLE public.product_options (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), group_id UUID NOT NULL REFERENCES public.product_option_groups(id), name TEXT NOT NULL, additional_price NUMERIC NOT NULL, available BOOLEAN NOT NULL DEFAULT TRUE);
CREATE TABLE public.product_variant_group_limits (variant_id UUID NOT NULL REFERENCES public.product_variants(id), group_id UUID NOT NULL REFERENCES public.product_option_groups(id), min_select INTEGER NOT NULL, max_select INTEGER NOT NULL, PRIMARY KEY(variant_id,group_id));
CREATE TABLE public.product_templates (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), slug TEXT UNIQUE, active BOOLEAN DEFAULT TRUE);
CREATE TABLE public.product_template_versions (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), template_id UUID REFERENCES public.product_templates(id), version INTEGER, configuration JSONB, active BOOLEAN DEFAULT TRUE);
CREATE TABLE public.customers (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), restaurant_id UUID REFERENCES public.restaurants(id), name TEXT, phone TEXT, city TEXT, street TEXT, number TEXT, neighborhood TEXT, complement TEXT, created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE public.bairros (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bairro TEXT, frete NUMERIC, lanchonete_id UUID REFERENCES public.restaurants(id));
CREATE TABLE public.orders (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), restaurant_id UUID REFERENCES public.restaurants(id), customer_id UUID REFERENCES public.customers(id), status TEXT, total_price NUMERIC, payment_method TEXT, change_for NUMERIC, created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE public.order_items (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), order_id UUID REFERENCES public.orders(id), product_id UUID REFERENCES public.products(id), quantity INTEGER, item_price NUMERIC, variant_id UUID REFERENCES public.product_variants(id), variant_name TEXT, created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE public.order_item_options (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), order_item_id UUID REFERENCES public.order_items(id) ON DELETE CASCADE, option_id UUID REFERENCES public.product_options(id), option_name TEXT, group_name TEXT, additional_price NUMERIC);
CREATE TABLE public.chats (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), order_id UUID REFERENCES public.orders(id), restaurant_id UUID REFERENCES public.restaurants(id), created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE public.chat_messages (id BIGSERIAL PRIMARY KEY, chat_id UUID REFERENCES public.chats(id), sender_type TEXT, sender_id TEXT, message TEXT, read BOOLEAN DEFAULT FALSE, name TEXT, created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE public.password_tokens (id BIGSERIAL PRIMARY KEY, email TEXT UNIQUE, token TEXT, expires_at TIMESTAMPTZ);
-- Non-owned sequence used by an INSERT-table default: discovery must cover this too.
CREATE SEQUENCE public.runtime_fixture_default_sequence;
ALTER TABLE public.password_tokens ADD COLUMN audit_number BIGINT DEFAULT nextval('public.runtime_fixture_default_sequence');
CREATE SEQUENCE public.unrelated_sequence;
INSERT INTO public.restaurants(id,name,email,password) VALUES
('00000000-0000-4000-8000-000000000001','Local A','a@example.invalid','local-fixture'),
('00000000-0000-4000-8000-000000000002','Local B','b@example.invalid','local-fixture');
INSERT INTO public.products(id,restaurant_id,name,price) VALUES ('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000001','Local source',20);
INSERT INTO public.product_variants(id,product_id,name,price) VALUES ('00000000-0000-4000-8000-000000000030','00000000-0000-4000-8000-000000000010','P',20);
INSERT INTO public.product_option_groups(id,product_id,name,required,min_select,max_select) VALUES ('00000000-0000-4000-8000-000000000040','00000000-0000-4000-8000-000000000010','Extras',FALSE,0,2);
INSERT INTO public.product_options(group_id,name,additional_price) VALUES ('00000000-0000-4000-8000-000000000040','Molho',0),('00000000-0000-4000-8000-000000000040','Ovo',2.50);
INSERT INTO public.product_variant_group_limits VALUES ('00000000-0000-4000-8000-000000000030','00000000-0000-4000-8000-000000000040',0,2);
