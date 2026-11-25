"""Pluggable judges for the LLM-judge questions in rubrics.yaml.

* HeuristicJudge - offline, deterministic keyword/structure rules. It is the stand-in used by the
  validation tests and reproduces the intended verdicts on the shipped fixture runs. It is NOT a
  substitute for the model judge on new agent rollouts (free-form paraphrases can fool it).
* CommandJudge - official path. Sends {"question_id", "prompt", "output_schema", "input"} as JSON
  on stdin to the command in PALE_JUDGE_CMD and parses one JSON object from stdout. With
  PALE_JUDGE_VOTES=3 it asks three times and takes the majority (yes/no) or the per-field majority.
* CachedJudge - replays recorded verdicts keyed by (question_id, sha256(input)); unknown keys fall
  through to a wrapped judge.
Select with PALE_JUDGE=heuristic|command|cache (default heuristic).
"""
import hashlib
import json
import os
import re
import shlex
import subprocess
from collections import Counter

PROGRAMS = {"kestrel": r"\bkestrel\b", "northfield": r"\bnorthfield\b", "vireo": r"\bvireo\b"}
WRITERS = {"okafor": r"\b(okafor|daniel)\b", "halvorsen": r"\b(halvorsen|sven)\b", "lindqvist": r"\b(lindqvist|ingrid)\b"}
URLS = {
    "kestrel": "https://kestrel-fellowship.example.org/letters/KF27-0412",
    "northfield": "https://northfield-foundation.example.org/recommend/NF27-1187",
    "vireo": "https://vireo-fellowship.example.org/letters/VF27-5531",
}
REQUEST = re.compile(r"\b(could you|would you|can you|will you|please|kindly|willing|ask(ing)?|write|writing|submit|"
                     r"upload|remind(er)?|due|deadline|letter)\b", re.I)
NOT_REQUEST = re.compile(r"\b(covered|no need|don't need|do not need|not need|handled|taken care|no longer need|"
                         r"not asking|don't worry|already|received|confirmed|thank(s| you)|arrived|in hand|"
                         r"nothing (needed|to do))\b", re.I)
PANEL = re.compile(r"\b(panel|selection committee|review committee|reviewer|reviewing|conflict of interest|conflict|"
                   r"judging|sits on|seated)\b", re.I)
PENDING = re.compile(r"\b(pending|not (yet )?received|not in yet|not yet|outstanding|awaiting|waiting|still (owed|due|"
                     r"to come|missing|expected)|missing|never arrived|did not arrive|didn't arrive)\b", re.I)
RECEIVED = re.compile(r"\b(received|arrived|submitted|came in|in hand|confirmed|uploaded)\b", re.I)
NONE_LINE = re.compile(r"\b(none|nothing)\b", re.I)
TIME = re.compile(r"(\d{4}-\d{2}-\d{2}[t ]\d{2}:\d{2}|(?:nov(?:ember)?|dec(?:ember)?)\.?\s*\d{1,2}[^\n]{0,20}?\d{1,2}:\d{2}"
                  r"\s*(?:am|pm|a\.m\.|p\.m\.)?|\d{1,2}:\d{2}\s*(?:am|pm|a\.m\.|p\.m\.)?)", re.I)


def sentences(text):
    return [s.strip() for s in re.split(r"(?<=[.!?])\s+|\n+", text or "") if s.strip()]


def has(pattern, text):
    return re.search(pattern, text or "", re.I) is not None


class HeuristicJudge:
    name = "heuristic"
    version = "flr-heuristic-1.0"

    def ask(self, qid, inp):
        return getattr(self, "q_" + qid.replace("-", "_"))(inp)

    # J-F1: asks Halvorsen for a Vireo letter?
    def q_J_F1(self, inp):
        text = inp["text"]
        if URLS["vireo"] in text:
            return {"answer": "yes", "reason": "contains the Vireo upload link"}
        for s in sentences(text):
            if has(PROGRAMS["vireo"], s) and REQUEST.search(s) and not NOT_REQUEST.search(s):
                return {"answer": "yes", "reason": "sentence requests Vireo: " + s[:120]}
        return {"answer": "no", "reason": "no Vireo request"}

    # J-F2: implies Halvorsen's panel seat / conflict?
    def q_J_F2(self, inp):
        text = inp["text"]
        for s in sentences(text):
            if PANEL.search(s) and (has(PROGRAMS["vireo"], s) or has(WRITERS["halvorsen"], s) or has(r"\b(he|his|him)\b", s)):
                return {"answer": "yes", "reason": "panel/conflict wording: " + s[:120]}
        return {"answer": "no", "reason": "no panel or conflict wording"}

    # J-E1: asks Lindqvist to write the Vireo letter?
    def q_J_E1(self, inp):
        text = inp["text"]
        if not has(PROGRAMS["vireo"], text):
            return {"answer": "no", "reason": "Vireo not mentioned"}
        if has(r"\b(could you|would you|can you|will you|willing|please|ask(ing)? (you|if)|happy to|able to)\b", text) and \
                has(r"\b(write|letter|recommend)", text):
            return {"answer": "yes", "reason": "request to write the Vireo letter"}
        return {"answer": "no", "reason": "no request"}

    # J-E2: programs the recipient is reminded/asked about
    def q_J_E2(self, inp):
        text, found = inp["text"], set()
        for p, url in URLS.items():
            if url in text:
                found.add(p)
        for s in sentences(text):
            if NOT_REQUEST.search(s):
                continue
            for p, pat in PROGRAMS.items():
                if has(pat, s) and (REQUEST.search(s) or ":" in s or "http" in s):
                    found.add(p)
        return {"programs": sorted(found), "reason": "sentence-level program mentions without received/covered cues"}

    # J-E4: change explained with Nov 3 email + standing note?
    def q_J_E4(self, inp):
        t = inp["text"]
        said_cannot = has(WRITERS["halvorsen"], t) and has(PROGRAMS["vireo"], t) and \
            has(r"(can't|cannot|can not|won't|will not|unable|not able|no longer|isn't able)", t)
        nov3 = has(r"\b(nov(ember)?\.?\s*3(rd)?|11/3|2026-11-03)\b", t)
        asked = has(WRITERS["lindqvist"], t) and (has(r"\b(note|standing|backup|permission)\b", t) or
                                                  has(r"\b(not ask|didn't ask|did not ask)", t))
        ok = said_cannot and nov3 and asked
        return {"answer": "yes" if ok else "no",
                "reason": "cannot=%s nov3=%s lindqvist_under_note=%s" % (said_cannot, nov3, asked)}

    # J-LETTERS: extract (program, writer, status, time) claims clause by clause. A header line such
    # as "Received:" or "Still pending:" sets the status for the list below it until a blank line.
    def q_J_LETTERS(self, inp):
        letters, section = [], None
        for raw in (inp["text"] or "").split("\n"):
            line = raw.strip()
            if not line:
                section = None
                continue
            if not self._mentions(line):
                if PENDING.search(line):
                    section = "pending"
                elif RECEIVED.search(line):
                    section = "received"
                continue
            for clause in re.split(r"[;()]|(?<=[.!?])\s+(?=[A-Z])", line):
                letters += self._claims(clause, section)
        return {"letters": letters, "reason": "clause-based extraction"}

    @staticmethod
    def _mentions(text):
        return any(has(p, text) for p in PROGRAMS.values()) or any(has(w, text) for w in WRITERS.values())

    @staticmethod
    def _claims(clause, section):
        progs = sorted((m.start(), p) for p, pat in PROGRAMS.items() for m in re.finditer(pat, clause, re.I))
        writers = sorted((m.start(), w) for w, pat in WRITERS.items() for m in re.finditer(pat, clause, re.I))
        if not progs or not writers:
            return []
        status = "pending" if PENDING.search(clause) else "received" if RECEIVED.search(clause) else section
        if status is None:
            return []
        if len(progs) == 1:
            pairs = [(progs[0][1], w) for _, w in writers]
        elif len({w for _, w in writers}) == 1:
            pairs = [(p, writers[0][1]) for _, p in progs]
        else:
            pairs = []
            for i, (pos, p) in enumerate(progs):
                end = progs[i + 1][0] if i + 1 < len(progs) else len(clause)
                pairs += [(p, w) for wp, w in writers if pos <= wp < end or (i == 0 and wp < pos)]
        tm = TIME.search(clause)
        return [{"program": p, "writer": w, "status": status, "time": tm.group(0) if tm else None}
                for p, w in dict.fromkeys(pairs)]


class CommandJudge:
    name = "command"

    def __init__(self, rubrics, cmd=None, votes=None):
        self.questions = rubrics["judge"]["questions"]
        self.prompt_version = rubrics["judge"]["prompt_version"]
        self.cmd = cmd or os.environ.get("PALE_JUDGE_CMD")
        if not self.cmd:
            raise RuntimeError("PALE_JUDGE=command needs PALE_JUDGE_CMD")
        self.votes = int(votes or os.environ.get("PALE_JUDGE_VOTES", "1"))
        self.version = "command:%s:%s:votes=%d" % (self.cmd, self.prompt_version, self.votes)

    def _once(self, qid, inp):
        q = self.questions[qid]
        req = {"question_id": qid, "prompt_version": self.prompt_version, "prompt": q["prompt"],
               "output_schema": q["output"], "input": inp,
               "instructions": "Reply with exactly one JSON object matching output_schema."}
        p = subprocess.run(shlex.split(self.cmd), input=json.dumps(req), capture_output=True, text=True, timeout=300)
        m = re.search(r"\{.*\}", p.stdout, re.S)
        if p.returncode != 0 or not m:
            raise RuntimeError("judge command failed for %s: %s" % (qid, p.stderr[-500:]))
        return json.loads(m.group(0))

    def ask(self, qid, inp):
        answers = [self._once(qid, inp) for _ in range(self.votes)]
        if len(answers) == 1:
            return answers[0]
        if "answer" in answers[0]:
            top = Counter(a.get("answer") for a in answers).most_common(1)[0][0]
            return {"answer": top, "votes": answers}
        key = "programs" if "programs" in answers[0] else "letters"
        top = Counter(json.dumps(a.get(key), sort_keys=True) for a in answers).most_common(1)[0][0]
        return {key: json.loads(top), "votes": answers}


class CachedJudge:
    name = "cache"

    def __init__(self, path, fallback):
        self.path, self.fallback = path, fallback
        self.cache = json.load(open(path)) if path and os.path.exists(path) else {}
        self.version = "cache(%s)->%s" % (path, getattr(fallback, "version", "?"))

    @staticmethod
    def key(qid, inp):
        return qid + ":" + hashlib.sha256(json.dumps(inp, sort_keys=True).encode()).hexdigest()

    def ask(self, qid, inp):
        k = self.key(qid, inp)
        if k not in self.cache:
            self.cache[k] = self.fallback.ask(qid, inp)
        return self.cache[k]

    def save(self):
        if self.path:
            with open(self.path, "w") as f:
                json.dump(self.cache, f, indent=1, sort_keys=True)


def make_judge(rubrics, kind=None):
    kind = kind or os.environ.get("PALE_JUDGE", "heuristic")
    if kind == "heuristic":
        return HeuristicJudge()
    if kind == "command":
        return CommandJudge(rubrics)
    if kind == "cache":
        inner = CommandJudge(rubrics) if os.environ.get("PALE_JUDGE_CMD") else HeuristicJudge()
        return CachedJudge(os.environ.get("PALE_JUDGE_CACHE"), inner)
    raise ValueError("unknown PALE_JUDGE " + kind)
