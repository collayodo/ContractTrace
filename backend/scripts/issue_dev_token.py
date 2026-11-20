"""Print a development bearer token.

Usage: AUTH_JWT_SECRET=... python scripts/issue_dev_token.py <viewer|reviewer|admin> <user>
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

from app.auth import Role, issue_token  # noqa: E402


def main() -> None:
    if len(sys.argv) != 3 or sys.argv[1] not in {role.value for role in Role}:
        sys.exit("Usage: python scripts/issue_dev_token.py <viewer|reviewer|admin> <user>")
    print(issue_token(sys.argv[2], sys.argv[1]))


if __name__ == "__main__":
    main()
