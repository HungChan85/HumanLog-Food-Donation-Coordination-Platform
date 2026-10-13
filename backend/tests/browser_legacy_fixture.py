"""Create/remove only synthetic legacy fixtures for the browser integration test."""
import argparse
import json

import psycopg
from psycopg import sql
from psycopg.rows import dict_row

from migrate_legacy import connection_settings, convert_row, import_records
from tests.test_legacy_import import legacy_row


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["create", "cleanup"])
    parser.add_argument("suffix")
    args = parser.parse_args()
    if not args.suffix.isdigit():
        raise SystemExit("Browser fixture suffix must be the test's timestamp.")
    result = {}
    for kind, schema, table, prefix in [("donation", "donor", "donations", "DN-"), ("request", "requester", "requests", "RQ-")]:
        row = legacy_row(kind)
        row["user_name" if kind == "donation" else "requester_name"] = "E2E Legacy " + args.suffix
        record = convert_row(kind, row, f"browser-e2e-{args.suffix}.db")
        with psycopg.connect(connection_settings(schema), row_factory=dict_row) as connection:
            if args.action == "create":
                import_records(connection, schema, [record])
            else:
                connection.execute(sql.SQL("DELETE FROM {}.{} WHERE id = %s AND data->'legacy'->>'sourceKey' = %s")
                                   .format(sql.Identifier(schema), sql.Identifier(table)), (record["id"], record["source_key"]))
                connection.execute(sql.SQL("DELETE FROM {}.legacy_imports WHERE source_key = %s AND record_id = %s")
                                   .format(sql.Identifier(schema)), (record["source_key"], record["id"]))
        result[kind + "Id"] = prefix + str(record["id"])
    print(json.dumps(result))


if __name__ == "__main__":
    main()
