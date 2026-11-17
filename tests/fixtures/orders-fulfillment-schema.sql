-- Disposable fixture of the ALREADY APPLIED 14-column schema. No migration runs.
CREATE TABLE public.orders (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 restaurant_id UUID REFERENCES public.restaurants(id),
 customer_id UUID REFERENCES public.customers(id),
 status TEXT, total_price NUMERIC, created_at TIMESTAMPTZ DEFAULT now(),
 payment_method TEXT, change_for NUMERIC,
 bairro_id UUID REFERENCES public.bairros(id), delivery_address JSONB,
 fulfillment_type VARCHAR(10) NOT NULL DEFAULT 'DELIVERY',
 subtotal NUMERIC(12,2), delivery_fee NUMERIC(12,2), pickup_address JSONB,
 CONSTRAINT orders_fulfillment_type_check CHECK (fulfillment_type IN ('DELIVERY','PICKUP')),
 CONSTRAINT orders_pickup_no_delivery_check CHECK (fulfillment_type<>'PICKUP' OR (bairro_id IS NULL AND delivery_address IS NULL)),
 CONSTRAINT orders_pickup_fee_check CHECK (fulfillment_type<>'PICKUP' OR (delivery_fee IS NOT NULL AND delivery_fee=0)),
 CONSTRAINT orders_subtotal_nonnegative_check CHECK (subtotal IS NULL OR (subtotal>=0 AND subtotal<>'NaN'::numeric)),
 CONSTRAINT orders_delivery_fee_nonnegative_check CHECK (delivery_fee IS NULL OR (delivery_fee>=0 AND delivery_fee<>'NaN'::numeric)),
 CONSTRAINT orders_total_components_check CHECK ((fulfillment_type='DELIVERY' AND (subtotal IS NULL OR delivery_fee IS NULL)) OR (subtotal IS NOT NULL AND delivery_fee IS NOT NULL AND total_price IS NOT NULL AND total_price=subtotal+delivery_fee))
);
