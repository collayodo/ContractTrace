import os

import httpx

from app.models import AIAnalysis, ReviewCase


NVIDIA_CHAT_URL = "https://integrate.api.nvidia.com/v1/chat/completions"


async def analyze_case(case: ReviewCase) -> AIAnalysis:
    api_key = os.getenv("NVIDIA_API_KEY")
    if not api_key:
        raise RuntimeError("NVIDIA_API_KEY is required to request an AI case analysis.")

    model = os.getenv("NVIDIA_MODEL", "nvidia/llama-3.1-nemotron-70b-instruct")
    prompt = (
        "Write a neutral public-spending review aid using only the supplied case record. "
        "Do not infer intent, fraud, or wrongdoing. A discrepancy is not a finding. "
        "Return JSON with keys summary (string), evidence_observations (array of strings), "
        "and limitation (string) that says what source records should be verified. "
        f"Case record: {case.model_dump(mode='json')}"
    )
    async with httpx.AsyncClient(timeout=45) as client:
        response = await client.post(
            NVIDIA_CHAT_URL,
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={
                "model": model,
                "messages": [
                    {"role": "system", "content": "You assist reviewers. Never make accusations."},
                    {"role": "user", "content": prompt},
                ],
                "temperature": 0.1,
                "response_format": {"type": "json_object"},
            },
        )
        response.raise_for_status()
        result = response.json()["choices"][0]["message"]["content"]

    import json

    parsed = json.loads(result)
    return AIAnalysis(
        case_id=case.id,
        summary=parsed["summary"],
        evidence_observations=parsed["evidence_observations"],
        limitation=parsed["limitation"],
        model=model,
    )
