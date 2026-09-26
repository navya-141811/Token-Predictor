import pandas as pd
import numpy as np
from sentence_transformers import SentenceTransformer
from xgboost import XGBRegressor
from sklearn.model_selection import train_test_split
from sklearn.metrics import mean_absolute_error, r2_score
import joblib

# --- Load and combine ---
df1 = pd.read_csv("combined_prompts_with_quality.csv")
df1.columns = df1.columns.str.strip().str.lower()
df1 = df1.rename(columns={"chatgpt_response": "response"})

df2 = pd.read_csv("combined_chatgpt_tokens_with_quality.csv")
df2.columns = df2.columns.str.strip().str.lower()
df2 = df2.rename(columns={"chatgpt output": "response", "input tokens": "input_tokens", "output tokens": "output_tokens"})

df = pd.concat([
    df1[["prompt", "input_tokens", "output_tokens", "quality_of_prompt"]],
    df2[["prompt", "input_tokens", "output_tokens", "quality_of_prompt"]]
], ignore_index=True)
df = df.dropna(subset=["prompt", "output_tokens", "input_tokens", "quality_of_prompt"])
df = df[df["output_tokens"] > 0]
df = df.drop_duplicates(subset=["prompt"])
print(f"Total rows after dedup: {len(df)}")

# --- Features ---
p = df["prompt"].str.lower()
df["word_count"]   = df["prompt"].str.split().str.len()
df["char_length"]  = df["prompt"].str.len()
df["is_question"]  = df["prompt"].str.strip().str.endswith("?").astype(int)
df["has_explain"]  = p.str.contains(r"explain|describe|compare|analyze|summarize|elaborate|detail").astype(int)
df["has_list"]     = p.str.contains(r"list|enumerate|give \d|provide \d|steps|examples").astype(int)
df["has_code"]     = p.str.contains(r"code|implement|write a|program|function|algorithm|script").astype(int)
df["has_short"]    = p.str.contains(r"briefly|short|one.line|in one|tldr|summarize in").astype(int)

df["log_output"] = np.log1p(df["output_tokens"])

# --- Embed ---
print("Embedding prompts...")
embedder = SentenceTransformer("all-MiniLM-L6-v2")
embeddings = embedder.encode(df["prompt"].tolist(), show_progress_bar=True, batch_size=32)

# --- Feature matrix ---
numeric_cols = ["input_tokens", "quality_of_prompt", "word_count", "char_length",
                "is_question", "has_explain", "has_list", "has_code", "has_short"]
numeric = df[numeric_cols].values
X = np.hstack([embeddings, numeric])
y = df["log_output"].values

# --- Split ---
X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

# --- Train with early stopping ---
print("Training...")
model = XGBRegressor(
    n_estimators=1000,
    max_depth=5,
    learning_rate=0.03,
    subsample=0.8,
    colsample_bytree=0.6,
    min_child_weight=5,
    reg_alpha=0.1,
    reg_lambda=1.0,
    random_state=42,
    n_jobs=2,
    tree_method="hist",
    early_stopping_rounds=30,
    eval_metric="rmse"
)
model.fit(X_train, y_train, eval_set=[(X_test, y_test)], verbose=50)

# --- Evaluate ---
preds = np.expm1(model.predict(X_test))
actual = np.expm1(y_test)
print(f"MAE:  {mean_absolute_error(actual, preds):.1f} tokens")
print(f"R²:   {r2_score(actual, preds):.3f}")

# --- Save ---
joblib.dump(model, "token_predictor.pkl")
joblib.dump(embedder, "embedder.pkl")
print("Saved token_predictor.pkl and embedder.pkl")
