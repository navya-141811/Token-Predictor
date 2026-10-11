from flask import Flask, request, jsonify, render_template
import numpy as np
import joblib
import tiktoken
import pandas as pd

app = Flask(__name__)

model = joblib.load("token_predictor.pkl")
embedder = joblib.load("embedder.pkl")
lookup_embeddings = joblib.load("lookup_embeddings.pkl")
lookup_df = pd.read_csv("prompt_response_lookup.csv")
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
    return np.hstack([embedding, numeric]), embedding

def nearest_response(query_embedding: np.ndarray, query: str) -> str:
    # semantic score (cosine, embeddings are L2-normalized by sentence-transformers)
    semantic = (lookup_embeddings @ query_embedding.T).flatten()
    # lexical score: word overlap (jaccard-like)
    q_words = set(query.lower().split())
    lexical = np.array([
        len(q_words & set(p.lower().split())) / (len(q_words | set(p.lower().split())) + 1e-9)
        for p in lookup_df["prompt"]
    ])
    # normalize each to [0,1] then combine 60% semantic + 40% lexical
    sem_norm = (semantic - semantic.min()) / (semantic.max() - semantic.min() + 1e-9)
    lex_norm = (lexical - lexical.min()) / (lexical.max() - lexical.min() + 1e-9)
    score = 0.6 * sem_norm + 0.4 * lex_norm
    idx = int(np.argmax(score))
    return lookup_df.iloc[idx]["response"]

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
    X, embedding = build_features(prompt, input_tokens, quality)
    output_tokens = round(float(np.expm1(model.predict(X)[0])))
    sample_output = nearest_response(embedding, prompt)
    return jsonify({
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "quality": quality,
        "sample_output": sample_output
    })

if __name__ == "__main__":
    app.run(debug=False)
