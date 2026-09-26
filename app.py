from flask import Flask, request, jsonify, render_template
import numpy as np
import joblib
import tiktoken

app = Flask(__name__)

model = joblib.load("token_predictor.pkl")
embedder = joblib.load("embedder.pkl")
enc = tiktoken.get_encoding("o200k_base")

def quality_score(prompt: str) -> int:
    words = prompt.split()
    wc = len(words)
    has_q = prompt.strip().endswith("?")
    has_context = any(w in prompt.lower() for w in ["explain", "describe", "compare", "analyze", "why", "how", "what", "summarize"])
    score = 2
    if wc >= 5: score += 1
    if wc >= 15: score += 1
    if has_q or has_context: score += 1
    return min(score, 5)

def build_features(prompt: str, input_tokens: int, quality: int) -> np.ndarray:
    p = prompt.lower()
    embedding = embedder.encode([prompt])
    numeric = np.array([[
        input_tokens,
        quality,
        len(prompt.split()),
        len(prompt),
        int(prompt.strip().endswith("?")),
        int(bool(__import__('re').search(r"explain|describe|compare|analyze|summarize|elaborate|detail", p))),
        int(bool(__import__('re').search(r"list|enumerate|give \d|provide \d|steps|examples", p))),
        int(bool(__import__('re').search(r"code|implement|write a|program|function|algorithm|script", p))),
        int(bool(__import__('re').search(r"briefly|short|one.line|in one|tldr|summarize in", p))),
    ]])
    return np.hstack([embedding, numeric])

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/predict", methods=["POST"])
def predict():
    prompt = request.json.get("prompt", "").strip()
    if not prompt:
        return jsonify({"error": "Empty prompt"}), 400
    input_tokens = len(enc.encode(prompt))
    quality = quality_score(prompt)
    X = build_features(prompt, input_tokens, quality)
    output_tokens = round(float(np.expm1(model.predict(X)[0])))
    return jsonify({"input_tokens": input_tokens, "output_tokens": output_tokens, "quality": quality})

if __name__ == "__main__":
    app.run(debug=True)
