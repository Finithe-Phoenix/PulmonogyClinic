CREATE TABLE inventory_product (
    id uuid PRIMARY KEY,
    sku varchar(40) NOT NULL UNIQUE CHECK (sku ~ '^[A-Z0-9-]{2,40}$'),
    name varchar(160) NOT NULL CHECK (length(trim(name)) > 0),
    category varchar(16) NOT NULL CHECK (category IN ('FARMACIA', 'INSUMOS')),
    unit varchar(40) NOT NULL CHECK (length(trim(unit)) > 0),
    minimum_stock integer NOT NULL CHECK (minimum_stock BETWEEN 0 AND 1000000)
);
CREATE TABLE inventory_lot (
    id uuid PRIMARY KEY,
    product_id uuid NOT NULL REFERENCES inventory_product(id),
    batch varchar(80) NOT NULL CHECK (length(trim(batch)) > 0 AND batch = upper(trim(batch))),
    expires_on date,
    quantity integer NOT NULL DEFAULT 0 CHECK (quantity BETWEEN 0 AND 1000000000),
    quarantined boolean NOT NULL,
    UNIQUE (product_id, batch)
);
CREATE INDEX lot_fefo ON inventory_lot(product_id, expires_on, id) WHERE quantity > 0 AND NOT quarantined;
CREATE TABLE inventory_command (
    id uuid PRIMARY KEY,
    request_hash char(64) NOT NULL,
    actor varchar(200) NOT NULL,
    result jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE inventory_movement (
    id uuid PRIMARY KEY,
    command_id uuid NOT NULL UNIQUE REFERENCES inventory_command(id),
    lot_id uuid NOT NULL REFERENCES inventory_lot(id),
    kind varchar(16) NOT NULL CHECK (kind IN ('RECEIPT', 'ISSUE', 'DISPOSAL')),
    quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 1000000),
    balance_after integer NOT NULL CHECK (balance_after BETWEEN 0 AND 1000000000),
    reason varchar(240) NOT NULL CHECK (length(trim(reason)) > 0),
    actor varchar(200) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX movement_history ON inventory_movement(lot_id, created_at DESC, id);
CREATE TABLE audit_event (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    command_id uuid NOT NULL REFERENCES inventory_command(id),
    action varchar(40) NOT NULL,
    entity_id uuid NOT NULL,
    actor varchar(200) NOT NULL,
    reason varchar(240) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION protect_inventory_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'Inventory history is append-only';
END;
$$;
CREATE TRIGGER immutable_movement BEFORE UPDATE OR DELETE ON inventory_movement
    FOR EACH ROW EXECUTE FUNCTION protect_inventory_history();
CREATE TRIGGER immutable_audit BEFORE UPDATE OR DELETE ON audit_event
    FOR EACH ROW EXECUTE FUNCTION protect_inventory_history();
