import numpy as np
import joblib
import re

model = joblib.load("token_predictor.pkl")
embedder = joblib.load("embedder.pkl")

def predict_output_tokens(prompt: str, input_tokens: int, quality_score: int) -> int:
    p = prompt.lower()
    embedding = embedder.encode([prompt])
    numeric = np.array([[
        input_tokens,
        quality_score,
        len(prompt.split()),
        len(prompt),
        int(prompt.strip().endswith("?")),
        int(bool(re.search(r"explain|describe|compare|analyze|summarize|elaborate|detail", p))),
        int(bool(re.search(r"list|enumerate|give \d|provide \d|steps|examples", p))),
        int(bool(re.search(r"code|implement|write a|program|function|algorithm|script", p))),
        int(bool(re.search(r"briefly|short|one.line|in one|tldr|summarize in", p))),
    ]])
    X = np.hstack([embedding, numeric])
    return round(float(np.expm1(model.predict(X)[0])))

if __name__ == "__main__":
    prompt = "Explain how transformers work in deep learning."
    print(predict_output_tokens(prompt, input_tokens=12, quality_score=4))
