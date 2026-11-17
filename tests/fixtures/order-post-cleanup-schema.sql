-- Disposable-only CURRENT schema: 10 pre-006 columns, three FKs, no legacy freight objects.
CREATE ROLE gama_app NOLOGIN;
CREATE TABLE public.restaurants(id uuid PRIMARY KEY);
CREATE TABLE public.customers(id uuid PRIMARY KEY);
CREATE TABLE public.bairros(id uuid PRIMARY KEY);
CREATE TABLE public.orders(
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id uuid REFERENCES public.restaurants(id),
    customer_id uuid REFERENCES public.customers(id),
    status text, total_price numeric, created_at timestamptz DEFAULT now(),
    payment_method text, change_for numeric,
    bairro_id uuid REFERENCES public.bairros(id), delivery_address jsonb
);
INSERT INTO public.restaurants VALUES ('00000000-0000-4000-8000-000000000001');
INSERT INTO public.customers VALUES ('00000000-0000-4000-8000-000000000002');
INSERT INTO public.bairros VALUES ('00000000-0000-4000-8000-000000000003');
INSERT INTO public.orders(restaurant_id,customer_id,status,total_price,bairro_id,delivery_address)
VALUES ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002',
        'pending',25,'00000000-0000-4000-8000-000000000003','{"street":"Test street"}');
GRANT USAGE ON SCHEMA public TO gama_app;
GRANT SELECT ON public.orders TO gama_app;
GRANT INSERT(restaurant_id,customer_id,status,total_price,payment_method,change_for) ON public.orders TO gama_app;
GRANT UPDATE(status) ON public.orders TO gama_app;
