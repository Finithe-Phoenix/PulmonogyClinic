CREATE TABLE cash_shift (
    id uuid PRIMARY KEY,
    reference varchar(80) NOT NULL UNIQUE CHECK (length(trim(reference)) > 0 AND reference = upper(trim(reference))),
    opening_command_id uuid NOT NULL UNIQUE REFERENCES inventory_command(id),
    opening_float_cents bigint NOT NULL CHECK (opening_float_cents BETWEEN 0 AND 9000000000000),
    opened_by varchar(200) NOT NULL,
    opened_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    closing_command_id uuid UNIQUE REFERENCES inventory_command(id),
    closed_by varchar(200),
    closed_at timestamptz,
    counted_cash_cents bigint CHECK (counted_cash_cents BETWEEN 0 AND 9000000000000),
    expected_cash_cents bigint CHECK (expected_cash_cents BETWEEN 0 AND 9000000000000),
    closure_reason varchar(240),
    CHECK ((closed_at IS NULL AND closing_command_id IS NULL AND closed_by IS NULL
            AND counted_cash_cents IS NULL AND expected_cash_cents IS NULL AND closure_reason IS NULL)
        OR (closed_at IS NOT NULL AND closing_command_id IS NOT NULL AND closed_by IS NOT NULL
            AND counted_cash_cents IS NOT NULL AND expected_cash_cents IS NOT NULL
            AND closure_reason IS NOT NULL AND length(trim(closure_reason)) > 0 AND closed_at >= opened_at))
);
-- This deployment has one cash register for the clinic, including across concurrent open requests.
CREATE UNIQUE INDEX cash_single_open_shift ON cash_shift ((true)) WHERE closed_at IS NULL;
CREATE INDEX cash_shift_history ON cash_shift(opened_at DESC, id);

CREATE TABLE cash_payment (
    id uuid PRIMARY KEY,
    shift_id uuid NOT NULL REFERENCES cash_shift(id),
    command_id uuid NOT NULL UNIQUE REFERENCES inventory_command(id),
    reference varchar(80) NOT NULL UNIQUE CHECK (length(trim(reference)) > 0 AND reference = upper(trim(reference))),
    amount_cents bigint NOT NULL CHECK (amount_cents BETWEEN 1 AND 9000000000000),
    method varchar(16) NOT NULL CHECK (method IN ('CASH', 'CARD', 'TRANSFER')),
    operation_reference varchar(80) CHECK (operation_reference IS NULL OR
        (length(trim(operation_reference)) > 0 AND operation_reference = upper(trim(operation_reference)))),
    actor varchar(200) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX cash_payment_history ON cash_payment(shift_id, created_at DESC, id);
CREATE INDEX cash_payment_operation ON cash_payment(operation_reference) WHERE operation_reference IS NOT NULL;
CREATE TABLE cash_reversal (
    id uuid PRIMARY KEY,
    payment_id uuid NOT NULL UNIQUE REFERENCES cash_payment(id),
    command_id uuid NOT NULL UNIQUE REFERENCES inventory_command(id),
    reason varchar(240) NOT NULL CHECK (length(trim(reason)) > 0),
    actor varchar(200) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER immutable_cash_payment BEFORE UPDATE OR DELETE ON cash_payment
    FOR EACH ROW EXECUTE FUNCTION protect_inventory_history();
CREATE TRIGGER immutable_cash_reversal BEFORE UPDATE OR DELETE ON cash_reversal
    FOR EACH ROW EXECUTE FUNCTION protect_inventory_history();

CREATE FUNCTION protect_cash_shift() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Cash shifts cannot be deleted';
    END IF;
    IF OLD.closed_at IS NOT NULL OR NEW.closed_at IS NULL OR
       ROW(NEW.id, NEW.reference, NEW.opening_command_id, NEW.opening_float_cents, NEW.opened_by, NEW.opened_at)
       IS DISTINCT FROM
       ROW(OLD.id, OLD.reference, OLD.opening_command_id, OLD.opening_float_cents, OLD.opened_by, OLD.opened_at) THEN
        RAISE EXCEPTION 'Only the first closure of a cash shift is allowed';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER cash_shift_history_guard BEFORE UPDATE OR DELETE ON cash_shift
    FOR EACH ROW EXECUTE FUNCTION protect_cash_shift();
