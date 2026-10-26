CREATE TABLE operation_patient (
    id uuid PRIMARY KEY,
    reference varchar(40) NOT NULL UNIQUE CHECK (reference ~ '^[A-Z0-9-]{2,40}$'),
    full_name varchar(160) NOT NULL CHECK (length(trim(full_name)) > 0),
    normalized_name varchar(160) NOT NULL,
    birth_date date NOT NULL,
    phone varchar(30),
    email varchar(160),
    synthetic boolean NOT NULL CHECK (synthetic),
    version bigint NOT NULL DEFAULT 0 CHECK (version >= 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX operation_patient_name ON operation_patient(normalized_name, birth_date);
CREATE INDEX operation_patient_phone ON operation_patient(phone) WHERE phone IS NOT NULL;

CREATE TABLE operation_appointment (
    id uuid PRIMARY KEY,
    patient_id uuid NOT NULL REFERENCES operation_patient(id),
    starts_at timestamptz NOT NULL,
    ends_at timestamptz NOT NULL CHECK (ends_at > starts_at),
    duration_minutes integer NOT NULL CHECK (duration_minutes BETWEEN 5 AND 480),
    service varchar(120) NOT NULL CHECK (length(trim(service)) > 0),
    practitioner varchar(80) NOT NULL CHECK (length(trim(practitioner)) > 0),
    resource varchar(80) NOT NULL CHECK (length(trim(resource)) > 0),
    source varchar(24) NOT NULL CHECK (source IN ('LOCAL', 'DOCTORALIA_MANUAL')),
    external_reference varchar(100),
    status varchar(24) NOT NULL DEFAULT 'BOOKED' CHECK (status IN ('BOOKED', 'ARRIVED', 'IN_CONSULTATION', 'COMPLETED', 'CANCELLED')),
    cancellation_reason varchar(240),
    version bigint NOT NULL DEFAULT 0 CHECK (version >= 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (ends_at = starts_at + duration_minutes * interval '1 minute'),
    CHECK ((status = 'CANCELLED' AND cancellation_reason IS NOT NULL AND length(trim(cancellation_reason)) > 0)
        OR (status <> 'CANCELLED' AND cancellation_reason IS NULL)),
    CHECK (source <> 'DOCTORALIA_MANUAL' OR (external_reference IS NOT NULL AND length(trim(external_reference)) > 0))
);
CREATE INDEX operation_appointment_day ON operation_appointment(starts_at, id);
CREATE INDEX operation_appointment_patient ON operation_appointment(patient_id, starts_at DESC);
CREATE UNIQUE INDEX operation_appointment_external ON operation_appointment(source, external_reference)
    WHERE external_reference IS NOT NULL AND status <> 'CANCELLED';

CREATE TABLE operation_appointment_event (
    id uuid PRIMARY KEY,
    appointment_id uuid NOT NULL REFERENCES operation_appointment(id),
    command_id uuid NOT NULL UNIQUE REFERENCES inventory_command(id),
    action varchar(40) NOT NULL,
    from_status varchar(24),
    to_status varchar(24) NOT NULL,
    version bigint NOT NULL,
    starts_at timestamptz NOT NULL,
    ends_at timestamptz NOT NULL,
    practitioner varchar(80) NOT NULL,
    resource varchar(80) NOT NULL,
    reason varchar(240) NOT NULL,
    actor varchar(200) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX operation_appointment_history ON operation_appointment_event(appointment_id, version);
CREATE TRIGGER immutable_appointment_event BEFORE UPDATE OR DELETE ON operation_appointment_event
    FOR EACH ROW EXECUTE FUNCTION protect_inventory_history();
