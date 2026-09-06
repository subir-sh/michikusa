import argparse
import json
import sys
from pathlib import Path

import torch
from PIL import Image
from transformers import pipeline

MODEL_DEFAULT = "google/siglip2-base-patch16-224"

CATEGORY_PROMPTS = {
    "food": "a photo of food or a drink",
    "restaurant": "a restaurant or cafe, including its interior, exterior, menu, or table",
    "landmark": "a landmark, tourist attraction, museum, shrine, temple, or notable building",
    "accommodation": "a hotel or accommodation, including a hotel room",
    "transit": "a train station, subway station, airport, bus stop, or public transit",
    "nature": "a park, garden, mountain, beach, or natural scenery",
    "street": "a street, neighborhood, storefront, or cityscape",
    "people": "a person or group of people",
    "screenshot": "a screenshot, document, receipt, ticket, or mostly text",
    "other": "an ordinary photo that does not fit the other categories",
}

PROMPT_TO_CATEGORY = {prompt: category for category, prompt in CATEGORY_PROMPTS.items()}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default=MODEL_DEFAULT)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    payload = json.load(sys.stdin)
    items = payload.get("items", [])

    device = 0 if torch.cuda.is_available() else -1
    classifier = pipeline(
        task="zero-shot-image-classification",
        model=args.model,
        device=device,
    )

    results = []
    prompts = list(CATEGORY_PROMPTS.values())

    for item in items:
        photo_id = item["id"]
        path = Path(item["path"])

        try:
            with Image.open(path) as image:
                predictions = classifier(
                    image.convert("RGB"),
                    candidate_labels=prompts,
                )

            top = max(predictions, key=lambda prediction: prediction["score"])
            results.append(
                {
                    "id": photo_id,
                    "category": PROMPT_TO_CATEGORY[top["label"]],
                    "score": float(top["score"]),
                }
            )
        except Exception as error:
            results.append({"id": photo_id, "error": str(error)})

    json.dump(
        {
            "device": "cuda" if device == 0 else "cpu",
            "results": results,
        },
        sys.stdout,
    )


if __name__ == "__main__":
    main()
