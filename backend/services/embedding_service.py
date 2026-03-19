import os
from pathlib import Path
from typing import Any, Dict, List, Optional

import numpy as np
from nomic import embed
from PIL import Image

from config import settings

TEXT_MODEL = "nomic-embed-text-v1.5"
IMAGE_MODEL = "nomic-embed-vision-v1.5"
EMBEDDING_DIMENSIONALITY = 768


def _ensure_nomic_api_key() -> None:
    os.environ["NOMIC_API_KEY"] = settings.NOMIC_API_KEY


def _extract_first_embedding(result: Dict[str, Any]) -> List[float]:
    vectors = result.get("embeddings")
    if not vectors:
        raise ValueError("No embeddings returned by model")
    return np.array(vectors)[0].tolist()


def create_text_embedding_vector(text: str) -> List[float]:
    _ensure_nomic_api_key()
    output = embed.text(
        texts=[text],
        model=TEXT_MODEL,
        task_type="search_document",
        dimensionality=EMBEDDING_DIMENSIONALITY,
    )
    vector = _extract_first_embedding(output)
    if len(vector) != EMBEDDING_DIMENSIONALITY:
        raise ValueError("Text embedding dimensionality mismatch")
    return vector


def create_image_embedding_vector(image_path: str) -> List[float]:
    _ensure_nomic_api_key()
    path = Path(image_path)
    if not path.exists():
        raise FileNotFoundError(f"Image not found: {image_path}")

    with Image.open(path) as img:
        output = embed.image(
            images=[img.convert("RGB")],
            model=IMAGE_MODEL,
        )

    vector = _extract_first_embedding(output)
    if len(vector) != EMBEDDING_DIMENSIONALITY:
        raise ValueError("Image embedding dimensionality mismatch")
    return vector


def create_complaint_embeddings(
    translated_description: str,
    primary_image_path: Optional[str],
) -> Dict[str, Optional[List[float]]]:
    text_embedding = create_text_embedding_vector(translated_description)
    image_embedding = None
    if primary_image_path:
        image_embedding = create_image_embedding_vector(primary_image_path)

    return {
        "text_embedding": text_embedding,
        "image_embedding": image_embedding,
    }