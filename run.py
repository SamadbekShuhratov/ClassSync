#!/usr/bin/env python3
"""Start the ClassSync server.

    python run.py                    # http://localhost:8000
    python run.py --port 9000 --data ./my-data
"""
import argparse
import logging
import sys
import webbrowser
from pathlib import Path

if sys.version_info < (3, 9):
    sys.exit("ClassSync needs Python 3.9 or newer.")

from classsync import __version__
from classsync.context import Config
from classsync.server import create_app


def main():
    ap = argparse.ArgumentParser(description="ClassSync classroom server")
    ap.add_argument("--host", default="0.0.0.0", help="interface to bind (default: all)")
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--data", default=str(Path(__file__).resolve().parent / "data"),
                    help="folder for the database and uploaded files")
    ap.add_argument("--no-register", action="store_true", help="disable new teacher sign-ups")
    ap.add_argument("--secure-cookies", action="store_true", help="set when served over HTTPS")
    ap.add_argument("--open", action="store_true", help="open the dashboard in a browser")
    ap.add_argument("--debug", action="store_true")
    args = ap.parse_args()

    logging.basicConfig(level=logging.DEBUG if args.debug else logging.INFO,
                        format="%(asctime)s  %(levelname)-7s %(message)s", datefmt="%H:%M:%S")
    config = Config(host=args.host, port=args.port, data_dir=Path(args.data),
                    allow_registration=not args.no_register, secure_cookies=args.secure_cookies)
    try:
        server = create_app(config)
    except OSError as e:
        sys.exit(f"Could not start on port {args.port}: {e.strerror}. Try --port 8080.")

    from classsync.context import ctx
    line = "─" * 58
    print(f"\n  \033[1mClassSync {__version__}\033[0m is running\n  {line}")
    print(f"  Teacher dashboard   http://localhost:{args.port}")
    for url in ctx.lan_urls:
        print(f"  Students join at    {url}/join")
    print(f"  Data folder         {Path(args.data).resolve()}")
    print(f"  {line}\n  Press Ctrl+C to stop.\n")
    if args.open:
        webbrowser.open(f"http://localhost:{args.port}/dashboard")
    try:
        server.serve_forever(poll_interval=0.5)
    except KeyboardInterrupt:
        print("\n  Stopped. See you next lesson!\n")


if __name__ == "__main__":
    main()
