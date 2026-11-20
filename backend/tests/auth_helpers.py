from typing import Optional

from app.auth import issue_token


def headers(role: str = "reviewer", user: Optional[str] = None) -> dict[str, str]:
    return {"Authorization": f"Bearer {issue_token(user or f'{role}@example.gov', role)}"}
