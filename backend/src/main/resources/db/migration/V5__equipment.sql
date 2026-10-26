CREATE TABLE equipment_asset (
    id uuid PRIMARY KEY,
    reference varchar(80) NOT NULL UNIQUE CHECK (length(trim(reference)) > 0 AND reference = upper(trim(reference))),
    name varchar(160) NOT NULL CHECK (length(trim(name)) > 0),
    location varchar(160) NOT NULL CHECK (length(trim(location)) > 0),
    serial_number varchar(120) CHECK (serial_number IS NULL OR length(trim(serial_number)) > 0),
    status varchar(16) NOT NULL DEFAULT 'AVAILABLE' CHECK (status IN ('AVAILABLE', 'MAINTENANCE', 'OUT_OF_SERVICE')),
    version bigint NOT NULL DEFAULT 0 CHECK (version >= 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX equipment_asset_availability ON equipment_asset(status, reference, id);

CREATE TABLE equipment_maintenance (
    id uuid PRIMARY KEY,
    asset_id uuid NOT NULL REFERENCES equipment_asset(id),
    command_id uuid NOT NULL UNIQUE REFERENCES inventory_command(id),
    performed_on date NOT NULL CHECK (performed_on >= DATE '1900-01-01' AND performed_on <= DATE '9999-12-31'),
    next_due_on date CHECK (next_due_on > performed_on AND next_due_on <= DATE '9999-12-31'),
    description varchar(1000) NOT NULL CHECK (length(trim(description)) > 0),
    technician varchar(160) NOT NULL CHECK (length(trim(technician)) > 0),
    actor varchar(200) NOT NULL,
    asset_version bigint NOT NULL CHECK (asset_version > 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (asset_id, asset_version)
);
CREATE INDEX equipment_maintenance_history ON equipment_maintenance(asset_id, performed_on DESC, asset_version DESC);
CREATE TRIGGER immutable_equipment_maintenance BEFORE UPDATE OR DELETE ON equipment_maintenance
    FOR EACH ROW EXECUTE FUNCTION protect_inventory_history();
