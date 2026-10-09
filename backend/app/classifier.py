"""Our own small model: scam / injection / benign text classifier.

TF-IDF (word 1-2 grams plus character 1-4 grams, so misspellings, Malaysian
English and Chinese still match) feeding a logistic regression. Trains in well under a
second at startup from data/classifier_train.jsonl, runs offline, and can
explain each prediction by listing the features that pushed it.

It never grants permission. It only adds risk and warnings.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Dict, List, Optional

import numpy as np
from sklearn.feature_extraction.text import ENGLISH_STOP_WORDS, TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import FeatureUnion, Pipeline

DATA = Path(__file__).resolve().parent.parent / "data" / "classifier_train.jsonl"


def load_rows(path: Path = DATA) -> List[Dict[str, str]]:
    return [json.loads(l) for l in path.read_text(encoding="utf-8").splitlines() if l.strip()]


class TextRiskClassifier:
    def __init__(self) -> None:
        self.features = FeatureUnion([
            ("word", TfidfVectorizer(ngram_range=(1, 2), lowercase=True, sublinear_tf=True, min_df=1)),
            # Plain char n-grams from 1 to 4: robust to misspellings and Malaysian English, and they also
            # work for Chinese, which has no spaces between words.
            ("char", TfidfVectorizer(analyzer="char", ngram_range=(1, 4), lowercase=True,
                                     sublinear_tf=True, min_df=2)),
        ])
        self.model = LogisticRegression(max_iter=3000, C=20.0, class_weight="balanced")
        self.pipe = Pipeline([("f", self.features), ("clf", self.model)])
        self.trained = False

    def fit(self, rows: Optional[List[Dict[str, str]]] = None) -> "TextRiskClassifier":
        rows = rows if rows is not None else load_rows()
        self.pipe.fit([r["text"] for r in rows], [r["label"] for r in rows])
        self.trained = True
        return self

    def predict(self, text: str) -> Dict[str, object]:
        if not self.trained:
            self.fit()
        probs = self.pipe.predict_proba([text])[0]
        classes = list(self.model.classes_)
        best = int(np.argmax(probs))
        return {
            "label": classes[best],
            "confidence": round(float(probs[best]), 3),
            "probs": {c: round(float(p), 3) for c, p in zip(classes, probs)},
        }

    def explain(self, text: str, top: int = 5) -> List[str]:
        """Word features that pushed the predicted class up (char features are hidden for readability)."""
        if not self.trained:
            self.fit()
        label = self.predict(text)["label"]
        word_vec: TfidfVectorizer = self.features.transformer_list[0][1]
        n_word = len(word_vec.vocabulary_)
        x = self.features.transform([text]).toarray()[0][:n_word]
        ci = list(self.model.classes_).index(label)
        contrib = x * self.model.coef_[ci][:n_word]
        names = word_vec.get_feature_names_out()
        order = np.argsort(-contrib)
        out: List[str] = []
        for i in order:
            if contrib[i] <= 0 or len(out) >= top:
                break
            # Stopwords carry weight in the model but explain nothing to a person.
            if all(w in ENGLISH_STOP_WORDS for w in names[i].split()):
                continue
            out.append(str(names[i]))
        return out


_shared: Optional[TextRiskClassifier] = None


def shared() -> TextRiskClassifier:
    global _shared
    if _shared is None:
        _shared = TextRiskClassifier().fit()
    return _shared
