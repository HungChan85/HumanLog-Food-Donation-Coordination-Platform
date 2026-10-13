import argparse
import importlib

from waitress import serve

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("service", choices=["coordinator", "donor", "requester"])
    parser.add_argument("--port", type=int)
    args = parser.parse_args()
    module = importlib.import_module("services." + args.service)
    serve(module.create_app(), host="0.0.0.0", port=args.port or {"coordinator": 5000, "donor": 5001, "requester": 5002}[args.service], threads=8)

