CREATE TABLE purchase_supplier (
    id uuid PRIMARY KEY,
    reference varchar(80) NOT NULL UNIQUE CHECK (length(trim(reference)) > 0 AND reference = upper(trim(reference))),
    name varchar(160) NOT NULL CHECK (length(trim(name)) > 0)
);
CREATE TABLE purchase_order (
    id uuid PRIMARY KEY,
    reference varchar(80) NOT NULL UNIQUE CHECK (length(trim(reference)) > 0 AND reference = upper(trim(reference))),
    supplier_id uuid NOT NULL REFERENCES purchase_supplier(id),
    order_date date NOT NULL,
    expected_on date NOT NULL CHECK (expected_on >= order_date),
    currency char(3) NOT NULL DEFAULT 'MXN' CHECK (currency = 'MXN'),
    cancelled boolean NOT NULL DEFAULT false,
    cancellation_reason varchar(240),
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((cancelled AND cancellation_reason IS NOT NULL AND length(trim(cancellation_reason)) > 0) OR (NOT cancelled AND cancellation_reason IS NULL))
);
CREATE INDEX purchase_supplier_history ON purchase_order(supplier_id, created_at DESC, id);
CREATE TABLE purchase_line (
    id uuid PRIMARY KEY,
    order_id uuid NOT NULL REFERENCES purchase_order(id),
    product_id uuid NOT NULL REFERENCES inventory_product(id),
    position integer NOT NULL CHECK (position BETWEEN 0 AND 99),
    sku varchar(40) NOT NULL,
    product_name varchar(160) NOT NULL,
    category varchar(16) NOT NULL CHECK (category IN ('FARMACIA', 'INSUMOS')),
    unit varchar(40) NOT NULL,
    ordered integer NOT NULL CHECK (ordered BETWEEN 1 AND 1000000),
    received integer NOT NULL DEFAULT 0 CHECK (received BETWEEN 0 AND ordered),
    unit_cost_cents bigint NOT NULL CHECK (unit_cost_cents BETWEEN 1 AND 100000000),
    UNIQUE (order_id, product_id),
    UNIQUE (order_id, position),
    UNIQUE (id, order_id)
);
CREATE TABLE purchase_receipt (
    id uuid PRIMARY KEY,
    reference varchar(80) NOT NULL UNIQUE CHECK (length(trim(reference)) > 0 AND reference = upper(trim(reference))),
    command_id uuid NOT NULL UNIQUE REFERENCES inventory_command(id),
    order_id uuid NOT NULL REFERENCES purchase_order(id),
    line_id uuid NOT NULL,
    lot_id uuid NOT NULL REFERENCES inventory_lot(id),
    movement_id uuid NOT NULL UNIQUE REFERENCES inventory_movement(id),
    batch varchar(80) NOT NULL,
    expires_on date,
    quarantined boolean NOT NULL,
    quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 1000000),
    unit_cost_cents bigint NOT NULL CHECK (unit_cost_cents BETWEEN 1 AND 100000000),
    actor varchar(200) NOT NULL,
    received_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (line_id, order_id) REFERENCES purchase_line(id, order_id)
);
CREATE INDEX purchase_receipt_history ON purchase_receipt(order_id, received_at DESC, id);
CREATE INDEX purchase_receipt_lot ON purchase_receipt(lot_id, received_at DESC, id);
CREATE TRIGGER immutable_purchase_receipt BEFORE UPDATE OR DELETE ON purchase_receipt
    FOR EACH ROW EXECUTE FUNCTION protect_inventory_history();
