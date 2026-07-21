"""Direction 3: downstream-utility reranking via small-LLM label entropy.

Instead of ranking a candidate abstract by surface relevance (cross-encoder), we
rank it by how much it helps a small LLM perform SciFact's actual downstream task
-- claim verification. For each (claim, abstract) pair we ask the LLM to label the
claim SUPPORT / REFUTE / NEI and read the model's probability over those labels,
then turn that distribution into a *utility* score:

  - semantic_entropy: Shannon entropy over the SUPPORT/REFUTE/NEI buckets. The three
    labels are the semantic clusters (SUPPORT and REFUTE are opposite meanings, NEI a
    third), so semantic entropy (Farquhar et al., Nature 2024) reduces to the entropy
    of the label distribution. Low entropy = the LLM is decisive = the abstract
    carries clear evidence.
  - verification_confidence: max_label_prob * (1 - NEI_prob). A decisive SUPPORT or
    REFUTE outranks a decisive "not enough info".

The label distribution is read from the model's *log-probabilities* of each label
string given the prompt (the MSCP / predictive-entropy variant), not by sampling
discrete answers. On a 0.5B model discrete sampling collapses to a constant "NEI";
the continuous label mass still separates relevant from non-relevant abstracts and
costs one forward pass per pair instead of N.

No gold verification labels are required: entropy/confidence measure the LLM's
self-consistency, and we evaluate the resulting ranking with the same relevance
nDCG@10 used everywhere else. The stage is expensive (a forward pass per candidate),
so it is meant to be gated by the conformal trigger (run_conformal_rerank.py).

References: Farquhar et al., Nature 2024 (semantic entropy); LLM-Confidence
Reranker / MSCP; InfoGain-RAG; LURE-RAG.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

from seg_retrieval.types import Document, Query

LABELS = ("SUPPORT", "REFUTE", "NEI")

_PROMPT = (
    "You are a scientific fact-checker. Decide whether the abstract provides "
    "evidence about the claim.\n"
    "Answer with exactly one word:\n"
    "  SUPPORT - the abstract supports the claim\n"
    "  REFUTE  - the abstract contradicts the claim\n"
    "  NEI     - not enough information in the abstract\n\n"
    "Claim: {claim}\n\n"
    "Abstract: {abstract}\n\n"
    "Answer:"
)

# Claim-only baseline (no abstract) for the InfoGain signal: the model's prior belief
# about the claim with no retrieved evidence.
_PROMPT_CLAIM_ONLY = (
    "You are a scientific fact-checker. Using only your own knowledge, decide whether "
    "the claim is true.\n"
    "Answer with exactly one word:\n"
    "  SUPPORT - the claim is true\n"
    "  REFUTE  - the claim is false\n"
    "  NEI     - not enough information to decide\n\n"
    "Claim: {claim}\n\n"
    "Answer:"
)

Distribution = dict[str, float]


def _detect_device() -> str:
    try:
        import torch

        if torch.cuda.is_available():
            return "cuda"
    except ImportError:
        pass
    return "cpu"


def normalize(dist: dict[str, float]) -> Distribution:
    total = sum(dist.values())
    if total <= 0:
        return {label: 1.0 / len(LABELS) for label in LABELS}
    return {label: dist.get(label, 0.0) / total for label in LABELS}


def semantic_entropy(dist: Distribution, normalize_entropy: bool = True) -> float:
    """Shannon entropy (nats) of the SUPPORT/REFUTE/NEI distribution.

    With normalize_entropy=True the result is divided by ln(|LABELS|) so it lands in
    [0, 1], where 0 = fully decisive and 1 = maximally uncertain.
    """
    h = -sum(p * math.log(p) for p in dist.values() if p > 0.0)
    if normalize_entropy:
        h /= math.log(len(LABELS))
    return h


def verification_confidence(dist: Distribution) -> float:
    """max_label_prob * (1 - NEI_prob): decisive non-NEI answers score highest."""
    return max(dist.values()) * (1.0 - dist.get("NEI", 0.0))


def utility_from_dist(dist: Distribution, mode: str = "confidence") -> float:
    """Higher = more useful. 'confidence' uses verification_confidence;
    'entropy' uses (1 - normalized semantic entropy)."""
    if mode == "entropy":
        return 1.0 - semantic_entropy(dist, normalize_entropy=True)
    if mode == "confidence":
        return verification_confidence(dist)
    raise ValueError(f"unknown utility mode: {mode}")


def decision_mass(dist: Distribution) -> float:
    """Probability the model commits to a definite verdict: 1 - P(NEI)."""
    return 1.0 - dist.get("NEI", 0.0)


def information_gain(base: Distribution, doc: Distribution, mode: str = "entropy") -> float:
    """How much a document improves the model's verification vs the claim-only prior.

    InfoGain-RAG style document utility (unsupervised). Higher = the abstract makes the
    model more able to verify the claim than it was with no evidence.
      - 'entropy':  H(claim only) - H(claim, doc)   (uncertainty reduction, in [-1, 1])
      - 'decision': P(verdict | claim, doc) - P(verdict | claim only)
      - 'confidence': verification_confidence(doc) - verification_confidence(base)
    """
    if mode == "entropy":
        return semantic_entropy(base) - semantic_entropy(doc)
    if mode == "decision":
        return decision_mass(doc) - decision_mass(base)
    if mode == "confidence":
        return verification_confidence(doc) - verification_confidence(base)
    raise ValueError(f"unknown information_gain mode: {mode}")


@dataclass
class UtilityReranker:
    """Small-LLM downstream-utility reranker (mirrors CrossEncoderReranker's API).

    Scores each (claim, abstract) pair by the LLM's log-probability over the
    SUPPORT/REFUTE/NEI labels, reading a continuous distribution in one forward pass.
    """

    model_name: str = "Qwen/Qwen2.5-0.5B-Instruct"
    utility_mode: str = "confidence"
    max_prompt_tokens: int = 2048
    device: str | None = None
    want_4bit: bool = False
    _model: object = field(default=None, init=False, repr=False)
    _tokenizer: object = field(default=None, init=False, repr=False)
    _label_ids: dict = field(default_factory=dict, init=False, repr=False)

    def __post_init__(self) -> None:
        if self.device is None:
            self.device = _detect_device()
        self._load()

    def _load(self) -> None:
        import torch
        from transformers import AutoModelForCausalLM, AutoTokenizer

        compute_dtype = (
            torch.bfloat16
            if (torch.cuda.is_available() and torch.cuda.is_bf16_supported())
            else torch.float16
            if torch.cuda.is_available()
            else torch.float32
        )
        tok = AutoTokenizer.from_pretrained(self.model_name, trust_remote_code=True)
        if tok.pad_token is None:
            tok.pad_token = tok.eos_token
        tok.padding_side = "right"

        model = None
        if self.want_4bit:
            try:
                import bitsandbytes  # noqa: F401
                from transformers import BitsAndBytesConfig

                bnb = BitsAndBytesConfig(
                    load_in_4bit=True,
                    bnb_4bit_quant_type="nf4",
                    bnb_4bit_compute_dtype=compute_dtype,
                    bnb_4bit_use_double_quant=True,
                )
                model = AutoModelForCausalLM.from_pretrained(
                    self.model_name, quantization_config=bnb,
                    device_map="auto", trust_remote_code=True,
                )
            except Exception as exc:  # noqa: BLE001
                print(f"[warn] 4-bit load failed ({type(exc).__name__}: {exc}); "
                      f"falling back to {compute_dtype}.")
                model = None
        if model is None:
            device_map = "auto" if torch.cuda.is_available() else None
            try:
                model = AutoModelForCausalLM.from_pretrained(
                    self.model_name, dtype=compute_dtype,
                    device_map=device_map, trust_remote_code=True,
                )
            except TypeError:  # transformers <5 uses torch_dtype
                model = AutoModelForCausalLM.from_pretrained(
                    self.model_name, torch_dtype=compute_dtype,
                    device_map=device_map, trust_remote_code=True,
                )
            if device_map is None:
                model = model.to(self.device)
        model.eval()
        self._model, self._tokenizer = model, tok
        # Token ids for each label string (with a leading space, as it follows "Answer:").
        self._label_ids = {
            label: tok(" " + label, add_special_tokens=False)["input_ids"]
            for label in LABELS
        }

    def _wrap_chat(self, prompt: str) -> str:
        tok = self._tokenizer
        if getattr(tok, "chat_template", None):
            return tok.apply_chat_template(
                [{"role": "user", "content": prompt}],
                tokenize=False, add_generation_prompt=True,
            )
        return prompt

    def label_distribution(self, claim: str, abstract: str) -> Distribution:
        """Label distribution for a (claim, abstract) pair (one forward pass)."""
        prompt = _PROMPT.format(claim=claim.strip(), abstract=abstract.strip())
        return self._score_labels(self._wrap_chat(prompt))

    def claim_only_distribution(self, claim: str) -> Distribution:
        """Label distribution for the claim with no retrieved evidence (InfoGain prior)."""
        prompt = _PROMPT_CLAIM_ONLY.format(claim=claim.strip())
        return self._score_labels(self._wrap_chat(prompt))

    def _score_labels(self, prompt_text: str) -> Distribution:
        """Softmax over the total log-prob the model assigns to each label string.

        The three label continuations share the prompt prefix, so they are scored in a
        single right-padded batch (one forward pass).
        """
        import torch

        tok, model = self._tokenizer, self._model
        prompt_ids = tok(prompt_text, truncation=True,
                         max_length=self.max_prompt_tokens,
                         add_special_tokens=False)["input_ids"]
        p_len = len(prompt_ids)

        seqs = [prompt_ids + self._label_ids[label] for label in LABELS]
        max_len = max(len(s) for s in seqs)
        pad_id = tok.pad_token_id
        input_ids, attn = [], []
        for s in seqs:
            pad = max_len - len(s)
            input_ids.append(s + [pad_id] * pad)
            attn.append([1] * len(s) + [0] * pad)
        input_ids = torch.tensor(input_ids, device=model.device)
        attn = torch.tensor(attn, device=model.device)

        with torch.no_grad():
            logits = model(input_ids=input_ids, attention_mask=attn).logits
        logprobs = torch.log_softmax(logits.float(), dim=-1)

        totals = {}
        for row, label in enumerate(LABELS):
            lab_ids = self._label_ids[label]
            score = 0.0
            for i, tid in enumerate(lab_ids):
                pos = p_len + i  # token tid sits at position pos; predicted from pos-1
                score += logprobs[row, pos - 1, tid].item()
            totals[label] = score
        m = max(totals.values())
        exp = {label: math.exp(v - m) for label, v in totals.items()}
        return normalize(exp)

    # Alias kept for readability at call sites.
    def verify(self, claim: str, abstract: str) -> Distribution:
        return self.label_distribution(claim, abstract)

    def score_candidates(
        self,
        query: Query,
        documents: dict[str, Document],
        hits: list[tuple[str, float]],
        top_k: int = 20,
    ) -> list[tuple[str, float, Distribution]]:
        """Return [(doc_id, utility, distribution)] for the top_k candidates."""
        scored = []
        for doc_id, _ in hits[:top_k]:
            if doc_id not in documents:
                continue
            dist = self.label_distribution(query.text, documents[doc_id].text)
            scored.append((doc_id, utility_from_dist(dist, self.utility_mode), dist))
        return scored

    def rerank(
        self,
        query: Query,
        documents: dict[str, Document],
        hits: list[tuple[str, float]],
        top_k: int = 20,
    ) -> list[tuple[str, float]]:
        scored = self.score_candidates(query, documents, hits, top_k)
        reranked = sorted(((d, u) for d, u, _ in scored), key=lambda x: x[1], reverse=True)
        scored_ids = {d for d, _, _ in scored}
        untouched = [hit for hit in hits if hit[0] not in scored_ids]
        return reranked + untouched
