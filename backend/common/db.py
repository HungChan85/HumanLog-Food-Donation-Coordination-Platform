import os
from contextlib import contextmanager

import psycopg
from psycopg.rows import dict_row


@contextmanager
def database():
    # Every process receives its own restricted PostgreSQL login.
    with psycopg.connect(os.environ["DATABASE_URL"], row_factory=dict_row) as connection:
        yield connection


def initialize_records(schema, table):
    from psycopg import sql
    with database() as connection:
        connection.execute(sql.SQL("""
            CREATE TABLE IF NOT EXISTS {}.{} (
                id uuid PRIMARY KEY,
                owner_id uuid,
                data jsonb NOT NULL,
                status text NOT NULL DEFAULT 'Pending'
                    CHECK (status IN ('Pending', 'Processed', 'Picked Up')),
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now()
            )
        """).format(sql.Identifier(schema), sql.Identifier(table)))
        # Legacy rows have no authenticated owner. SQL NULL keeps them out of
        # every personal history until a coordinator assigns a real account.
        connection.execute(sql.SQL("ALTER TABLE {}.{} ALTER COLUMN owner_id DROP NOT NULL")
                           .format(sql.Identifier(schema), sql.Identifier(table)))
        connection.execute(sql.SQL("""
            CREATE TABLE IF NOT EXISTS {}.legacy_imports (
                source_key text PRIMARY KEY,
                source_hash text NOT NULL,
                record_id uuid NOT NULL,
                imported_at timestamptz NOT NULL DEFAULT now()
            )
        """).format(sql.Identifier(schema)))
        connection.execute(sql.SQL("CREATE INDEX IF NOT EXISTS {} ON {}.{} (owner_id, created_at DESC)")
                           .format(sql.Identifier(table + "_owner_created"), sql.Identifier(schema), sql.Identifier(table)))

